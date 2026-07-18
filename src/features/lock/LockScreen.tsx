/**
 * A tela de bloqueio por PIN (M5.5 §3.5).
 *
 * Privacidade de TELA: impede que alguém que pega o computador desbloqueado abra
 * o NEXUS e leia a sua vida. NÃO é cifra de disco — o banco segue legível para
 * quem tem acesso à máquina (documentado com honestidade no ADR-0054 e no
 * MANUAL). O PIN nunca viaja nem é guardado em claro: o backend só devolve um
 * veredito.
 *
 * Seis círculos que se preenchem a cada dígito; teclado físico E o teclado
 * numérico na tela; erro = tremor curto + limpa; a partir do 3º erro, um atraso
 * de 1s por tentativa esfria o brute force manual.
 *
 * O fundo é `.nx-page` — herda a geometria do astrolábio (§3.2) na cor da marca,
 * com o NexusMark presente. É a mesma casa, trancada.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";

import { verifyPin } from "../../lib/ipc";
import { useLock } from "../../stores/lock";
import { NexusMark } from "../../design-system/NexusMark";
import { cx } from "../../design-system/primitives";

const PIN_LEN = 6;

export function LockScreen() {
  const unlock = useLock((s) => s.unlock);
  const [entry, setEntry] = useState("");
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [coolUntilMs, setCoolUntilMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const checking = useRef(false);

  const cooling = coolUntilMs > now;
  const coolLeft = cooling ? Math.ceil((coolUntilMs - now) / 1000) : 0;

  // Um tique de 250ms só enquanto esfria, para o contador andar e destravar.
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
          unlock();
          return;
        }
        // Errou: conta a tentativa e, do 3º erro em diante, esfria 1s/tentativa.
        setAttempts((a) => {
          const next = a + 1;
          if (next >= 3) setCoolUntilMs(Date.now() + (next - 2) * 1000);
          return next;
        });
        setError(true);
        setEntry("");
        window.setTimeout(() => setError(false), 400);
      } finally {
        checking.current = false;
      }
    },
    [unlock],
  );

  const push = useCallback(
    (digit: string) => {
      if (cooling || checking.current) return;
      setEntry((cur) => {
        if (cur.length >= PIN_LEN) return cur;
        const next = cur + digit;
        if (next.length === PIN_LEN) void submit(next);
        return next;
      });
    },
    [cooling, submit],
  );

  const backspace = useCallback(() => setEntry((c) => c.slice(0, -1)), []);

  // Teclado físico: dígitos, Backspace. (Enter é dispensável — preencheu 6, vai.)
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
    <div className="nx-page fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 overflow-hidden">
      <div className="flex flex-col items-center gap-3">
        <NexusMark size={64} />
        <div className="text-center">
          <h1 className="text-[17px] font-semibold tracking-[0.14em] text-[var(--text-primary)]">
            NEXUS
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">
            Digite seu PIN para entrar
          </p>
        </div>
      </div>

      {/* os seis círculos */}
      <div
        className={cx("flex items-center gap-4", error && "motion-safe:animate-[nexus-shake_400ms_var(--ease)]")}
      >
        {Array.from({ length: PIN_LEN }).map((_, i) => {
          const filled = i < entry.length;
          return (
            <span
              key={i}
              className={cx(
                "size-3.5 rounded-full border transition-colors duration-[var(--dur-fast)]",
                error
                  ? "border-[var(--danger)] bg-[var(--danger)]"
                  : filled
                    ? "border-[var(--text-primary)] bg-[var(--text-primary)]"
                    : "border-[var(--border-strong)] bg-transparent",
              )}
            />
          );
        })}
      </div>

      {/* o teclado numérico na tela */}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <PadKey key={d} onClick={() => push(d)} disabled={cooling}>
            {d}
          </PadKey>
        ))}
        <span />
        <PadKey onClick={() => push("0")} disabled={cooling}>
          0
        </PadKey>
        <PadKey onClick={backspace} disabled={cooling} aria-label="Apagar">
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
        "tabular grid size-16 place-items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[22px] font-medium text-[var(--text-primary)]",
        "transition-[transform,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "hover:border-[var(--border-glow)] hover:bg-[var(--bg-raised)] active:scale-[0.94] disabled:opacity-40 disabled:pointer-events-none",
      )}
    >
      {children}
    </button>
  );
}
