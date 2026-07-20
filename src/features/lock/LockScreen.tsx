/**
 * A tela de bloqueio por PIN (M5.5 §3.5 — recomposta na v1.2, D2).
 *
 * Privacidade de TELA: impede que alguém que pega o computador desbloqueado abra
 * o NEXUS e leia a sua vida. NÃO é cifra de disco — o banco segue legível para
 * quem tem acesso à máquina (ADR-0054). O PIN nunca viaja nem é guardado em
 * claro: o backend só devolve um veredito.
 *
 * A COMPOSIÇÃO (v1.2): a v1.1 tinha o astrolábio PROTAGONISTA girando dentro de
 * três anéis graduados, saudação por hora do dia e o teclado embaixo. Bonito de
 * descrever, poluído de olhar. A referência que o dono trouxe é a tela de
 * bloqueio de um app de banco: quase preto, dois ou três aros finos e nada mais
 * de decoração, a marca num squircle com glow, e MUITO vazio. A elegância aqui
 * vem do que não está na tela.
 *
 * A pilha, de cima para baixo: a bússola (squircle + glow) · NEXUS · a instrução
 * · as seis bolinhas · o teclado (1-9, depois apagar · 0 · OK) · a versão, no
 * rodapé, pequena. Sem saudação, sem anéis girando, sem estado inventado.
 *
 * Tudo CSS/SVG estático — zero canvas, zero animação em idle, abre instantâneo.
 *
 * Teclado físico E teclado numérico na tela; do 3º erro, 1s de atraso por
 * tentativa esfria o brute force manual.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";

import { systemInfo, verifyPin } from "../../lib/ipc";
import { useLock } from "../../stores/lock";
import { NexusMark } from "../../design-system/NexusMark";
import { cx } from "../../design-system/primitives";

const PIN_LEN = 6;

export function LockScreen() {
  const unlockStore = useLock((s) => s.unlock);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [coolUntilMs, setCoolUntilMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [version, setVersion] = useState<string | null>(null);
  const checking = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const cooling = coolUntilMs > now;
  const coolLeft = cooling ? Math.ceil((coolUntilMs - now) / 1000) : 0;

  useEffect(() => {
    if (!cooling) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [cooling]);

  /* A versão vem da MESMA fonte que a tela Sobre (`system_info` → `appVersion`),
     para não existirem dois números divergindo. Se a chamada falhar, o rodapé
     simplesmente não mostra a versão — nada trava o desbloqueio por causa disso. */
  useEffect(() => {
    let alive = true;
    void systemInfo()
      .then((info) => {
        if (alive) setVersion(info.appVersion);
      })
      .catch(() => {
        /* silencioso de propósito: o rodapé é decoração, não função */
      });
    return () => {
      alive = false;
    };
  }, []);

  /* O foco entra na coluna ao montar: o listener de teclado é da janela, mas sem
     isto o primeiro Tab começaria fora da tela de bloqueio. */
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const submit = useCallback(
    async (pin: string) => {
      if (checking.current) return;
      checking.current = true;
      try {
        const ok = await verifyPin(pin);
        if (ok) {
          // O gesto de acerto: a tela dissolve, e só então o app aparece — a
          // transição é a recompensa de entrar.
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

  /* O OK confirma o que já está digitado. Com 6 dígitos o envio é automático, de
     modo que ele serve para quem digitou menos e quer o veredito assim mesmo. */
  const confirm = useCallback(() => {
    if (cooling || checking.current || unlocking) return;
    if (entry.length === 0) return;
    void submit(entry);
  }, [cooling, unlocking, entry, submit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        push(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [push, backspace, confirm]);

  const locked = cooling || unlocking;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className={cx(
        "fixed inset-0 z-[100] flex flex-col items-center overflow-y-auto bg-[var(--bg-void)] px-6 py-12 outline-none",
        "transition-opacity duration-[400ms] ease-[var(--ease)]",
        unlocking ? "opacity-0" : "opacity-100",
      )}
    >
      <BackdropRings />

      {/* A coluna: tudo centrado, o vazio em cima e embaixo faz o resto. */}
      <div className="relative m-auto flex flex-col items-center">
        <NexusMark size={92} plate glow />

        <h1 className="mt-7 text-[22px] font-bold tracking-[0.18em] text-[var(--text-primary)]">
          NEXUS
        </h1>
        <p className="mt-2 text-[13px] text-[var(--text-tertiary)]">
          Digite seu PIN para desbloquear.
        </p>

        {/* ===== as seis bolinhas ===== */}
        <div
          className={cx(
            "mt-8 flex items-center gap-4",
            error && "motion-safe:animate-[nexus-shake_450ms_var(--ease)]",
          )}
          role="status"
          aria-label={`${entry.length} de ${PIN_LEN} dígitos`}
        >
          {Array.from({ length: PIN_LEN }).map((_, i) => {
            const filled = i < entry.length;
            return (
              <span
                key={i}
                className={cx(
                  "size-3 rounded-full border transition-[background-color,border-color,transform] duration-[var(--dur-fast)]",
                  error
                    ? "border-[var(--danger)] bg-[var(--danger)]"
                    : filled
                      ? "scale-100 border-[var(--text-primary)] bg-[var(--text-primary)]"
                      : "scale-90 border-[var(--border-strong)] bg-transparent",
                )}
                style={
                  filled && !error
                    ? { animation: "nexus-pulse 180ms var(--ease) both" }
                    : undefined
                }
              />
            );
          })}
        </div>

        {/* ===== o teclado numérico ===== */}
        <div className="mt-9 grid grid-cols-3 gap-4">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <PadKey key={d} onClick={() => push(d)} disabled={locked}>
              {d}
            </PadKey>
          ))}
          <PadKey onClick={backspace} disabled={locked} aria-label="Apagar">
            <Delete size={20} strokeWidth={1.8} />
          </PadKey>
          <PadKey onClick={() => push("0")} disabled={locked}>
            0
          </PadKey>
          <PadKey
            onClick={confirm}
            disabled={locked || entry.length === 0}
            aria-label="Confirmar"
            accent
          >
            <span className="text-[15px] font-semibold tracking-[0.06em]">OK</span>
          </PadKey>
        </div>

        <p className="mt-6 h-4 text-[12px] text-[var(--text-tertiary)]" role="status">
          {cooling
            ? `Aguarde ${coolLeft}s antes de tentar de novo`
            : attempts > 0
              ? "PIN incorreto. Tente novamente."
              : ""}
        </p>
      </div>

      {/* ===== o rodapé: pequeno, discreto, último ===== */}
      <p className="relative mt-auto pt-8 text-[11px] tracking-[0.08em] text-[var(--text-tertiary)] opacity-60">
        NEXUS{version ? ` · v${version}` : ""}
      </p>
    </div>
  );
}

/**
 * A única decoração da tela: três aros finos, centrados atrás da composição.
 * Não gira, não pulsa, não reage — é geometria parada, e é isso que a deixa calma.
 *
 * Sem as marcas cardeais, e a dirigida é que decidiu: a 1296px os tiques caíam
 * longe do aro que deveriam graduar e liam como quatro riscos soltos nas bordas
 * da janela — um deles atravessando o rodapé da versão. A referência pedia
 * "apenas 2-3 anéis finos"; os aros sozinhos são exatamente isso, e o
 * instrumento já está desenhado no squircle logo acima.
 */
function BackdropRings() {
  return (
    <svg
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      width="760"
      height="760"
      viewBox="0 0 600 600"
      fill="none"
      stroke="var(--accent)"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="300" cy="300" r="280" strokeWidth="1.4" opacity="0.16" />
      <circle cx="300" cy="300" r="210" strokeWidth="1.2" opacity="0.11" />
      <circle cx="300" cy="300" r="140" strokeWidth="1" opacity="0.07" />
    </svg>
  );
}

function PadKey({
  children,
  onClick,
  disabled,
  accent,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** O OK — a única tecla que se anuncia como ação. */
  accent?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "tabular grid size-16 place-items-center rounded-full border text-[22px] font-medium",
        "transition-[transform,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "active:scale-[0.94] disabled:pointer-events-none disabled:opacity-30",
        accent
          ? "border-transparent bg-[var(--accent)] text-white hover:bg-[var(--accent-bright)]"
          : cx(
              "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_55%,transparent)] text-[var(--text-primary)]",
              "hover:border-[var(--border-glow)] hover:bg-[var(--bg-raised)]",
            ),
      )}
    >
      {children}
    </button>
  );
}
