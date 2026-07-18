/**
 * A tela de bloqueio por PIN (M5.5 §3.5 — redesenhada no REFINO R8).
 *
 * Privacidade de TELA: impede que alguém que pega o computador desbloqueado abra
 * o NEXUS e leia a sua vida. NÃO é cifra de disco — o banco segue legível para
 * quem tem acesso à máquina (ADR-0054). O PIN nunca viaja nem é guardado em
 * claro: o backend só devolve um veredito.
 *
 * A abertura é cerimonial: o astrolábio GRANDE é o protagonista, com os anéis em
 * rotação lentíssima em idle (congela em reduced-motion); as seis bolinhas do PIN
 * ficam assentadas sobre um arco orbital, preenchendo com um pulso a cada dígito.
 * Acerto: os anéis dão um giro rápido e a tela dissolve para o app (400ms). Erro:
 * tremor + um anel vermelho breve. Tudo CSS/SVG — zero canvas, abre instantâneo.
 *
 * Teclado físico E teclado numérico na tela; do 3º erro, 1s de atraso por
 * tentativa esfria o brute force manual.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";

import { verifyPin } from "../../lib/ipc";
import { useLock } from "../../stores/lock";
import { NexusMark } from "../../design-system/NexusMark";
import { cx } from "../../design-system/primitives";

const PIN_LEN = 6;
const SIZE = 300;
const CX = SIZE / 2;

/** Ângulo (graus, 0=direita, 90=baixo) de cada bolinha no arco orbital de baixo.
 *  Vai da esquerda (144°) à direita (36°) passando pelo fundo (90°), então preenche
 *  na ordem de leitura sem competir com a saudação lá em cima. */
function dotAngle(i: number): number {
  const start = 144;
  const span = 108;
  return start - (i * span) / (PIN_LEN - 1);
}
function dotPos(i: number, r: number): [number, number] {
  const a = (dotAngle(i) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CX + r * Math.sin(a)];
}

export function LockScreen() {
  const unlockStore = useLock((s) => s.unlock);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [coolUntilMs, setCoolUntilMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const checking = useRef(false);

  const cooling = coolUntilMs > now;
  const coolLeft = cooling ? Math.ceil((coolUntilMs - now) / 1000) : 0;

  useEffect(() => {
    if (!cooling) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [cooling]);

  const submit = useCallback(
    async (pin: string) => {
      if (checking.current) return;
      checking.current = true;
      try {
        const ok = await verifyPin(pin);
        if (ok) {
          // O gesto de acerto: os anéis giram e a tela dissolve, e só então o
          // app aparece — a transição é a recompensa de entrar.
          setUnlocking(true);
          window.setTimeout(() => unlockStore(), 420);
          return;
        }
        setAttempts((a) => {
          const next = a + 1;
          if (next >= 3) setCoolUntilMs(Date.now() + (next - 2) * 1000);
          return next;
        });
        setError(true);
        setEntry("");
        window.setTimeout(() => setError(false), 450);
      } finally {
        checking.current = false;
      }
    },
    [unlockStore],
  );

  const push = useCallback(
    (digit: string) => {
      if (cooling || checking.current || unlocking) return;
      setEntry((cur) => {
        if (cur.length >= PIN_LEN) return cur;
        const next = cur + digit;
        if (next.length === PIN_LEN) void submit(next);
        return next;
      });
    },
    [cooling, unlocking, submit],
  );

  const backspace = useCallback(() => setEntry((c) => c.slice(0, -1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        push(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [push, backspace]);

  return (
    <div
      className={cx(
        "nx-page fixed inset-0 z-[100] flex flex-col items-center justify-center gap-7 overflow-hidden",
        "transition-opacity duration-[400ms] ease-[var(--ease)]",
        unlocking ? "opacity-0" : "opacity-100",
      )}
    >
      <p className="text-[15px] text-[var(--text-secondary)]">
        {greeting()}, <span className="font-semibold text-[var(--text-primary)]">Allan</span>
      </p>

      {/* ===== o astrolábio protagonista + as bolinhas no arco ===== */}
      <div
        className={cx(
          "relative",
          error && "motion-safe:animate-[nexus-shake_450ms_var(--ease)]",
        )}
        style={{ width: SIZE, height: SIZE }}
      >
        <OrbitRings error={error} unlocking={unlocking} />

        {/* o NexusMark ao centro, grande */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            style={{
              filter: "drop-shadow(0 0 40px color-mix(in srgb, var(--accent) 34%, transparent))",
            }}
          >
            <NexusMark size={112} />
          </div>
        </div>

        {/* as seis bolinhas, assentadas sobre o arco orbital de baixo */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          fill="none"
          aria-hidden
        >
          {Array.from({ length: PIN_LEN }).map((_, i) => {
            const [x, y] = dotPos(i, 128);
            const filled = i < entry.length;
            return (
              <g key={i}>
                <circle
                  cx={x}
                  cy={y}
                  r="7"
                  fill={
                    error
                      ? "var(--danger)"
                      : filled
                        ? "var(--text-primary)"
                        : "transparent"
                  }
                  stroke={
                    error
                      ? "var(--danger)"
                      : filled
                        ? "var(--text-primary)"
                        : "var(--border-strong)"
                  }
                  strokeWidth="1.5"
                  style={{
                    transition: "fill 120ms var(--ease)",
                    transform: filled ? "scale(1)" : "scale(0.9)",
                    transformOrigin: `${x}px ${y}px`,
                    transformBox: "fill-box",
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* ===== o teclado numérico ===== */}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <PadKey key={d} onClick={() => push(d)} disabled={cooling || unlocking}>
            {d}
          </PadKey>
        ))}
        <span />
        <PadKey onClick={() => push("0")} disabled={cooling || unlocking}>
          0
        </PadKey>
        <PadKey onClick={backspace} disabled={cooling || unlocking} aria-label="Apagar">
          <Delete size={20} strokeWidth={1.8} />
        </PadKey>
      </div>

      <p className="h-4 text-[12px] text-[var(--text-tertiary)]">
        {cooling
          ? `Aguarde ${coolLeft}s antes de tentar de novo`
          : attempts > 0
            ? "PIN incorreto. Tente novamente."
            : ""}
      </p>
    </div>
  );
}

/**
 * Os anéis orbitais que giram lentíssimo em idle. Dois anéis graduados em
 * sentidos opostos + o arco onde as bolinhas assentam. Ao acertar, gira rápido;
 * ao errar, o anel externo pisca vermelho. Reduced-motion congela tudo.
 */
function OrbitRings({ error, unlocking }: { error: boolean; unlocking: boolean }) {
  const ticks = [];
  for (let deg = 0; deg < 360; deg += 10) {
    const major = deg % 30 === 0;
    const a = ((deg - 90) * Math.PI) / 180;
    const r1 = 142;
    const r2 = 142 - (major ? 9 : 5);
    ticks.push(
      <line
        key={deg}
        x1={CX + r1 * Math.cos(a)}
        y1={CX + r1 * Math.sin(a)}
        x2={CX + r2 * Math.cos(a)}
        y2={CX + r2 * Math.sin(a)}
        stroke="var(--accent)"
        strokeWidth={major ? 1.4 : 0.8}
        strokeLinecap="round"
        opacity={major ? 0.5 : 0.28}
      />,
    );
  }

  return (
    <>
      {/* anel externo graduado — gira devagar; pisca vermelho no erro */}
      <svg
        className="absolute inset-0 h-full w-full motion-safe:animate-[nexus-orbit_150s_linear_infinite]"
        style={unlocking ? { animation: "nexus-orbit 0.8s cubic-bezier(0.2,0,0,1)" } : undefined}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        fill="none"
        aria-hidden
      >
        <circle
          cx={CX}
          cy={CX}
          r="142"
          stroke={error ? "var(--danger)" : "var(--accent)"}
          strokeWidth={error ? 2 : 1}
          opacity={error ? 0.8 : 0.22}
          style={{ transition: "stroke 200ms, opacity 200ms" }}
        />
        <g>{ticks}</g>
      </svg>

      {/* anel médio — gira no sentido oposto, mais devagar */}
      <svg
        className="absolute inset-0 h-full w-full motion-safe:animate-[nexus-orbit_220s_linear_infinite_reverse]"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        fill="none"
        aria-hidden
      >
        <circle cx={CX} cy={CX} r="128" stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="2 6" opacity="0.5" />
        <circle cx={CX} cy={CX} r="96" stroke="var(--accent)" strokeWidth="0.8" opacity="0.16" />
      </svg>
    </>
  );
}

function PadKey({
  children,
  onClick,
  disabled,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "tabular grid size-16 place-items-center rounded-full border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_80%,transparent)] text-[22px] font-medium text-[var(--text-primary)]",
        "transition-[transform,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "hover:border-[var(--border-glow)] hover:bg-[var(--bg-raised)] active:scale-[0.94] disabled:opacity-40 disabled:pointer-events-none",
      )}
    >
      {children}
    </button>
  );
}

/** A saudação segue o relógio — a única linha da tela que fala com o usuário. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Boa madrugada";
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
