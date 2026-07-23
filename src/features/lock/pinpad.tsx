/**
 * As peças de teclado do PIN, compartilhadas entre o BLOQUEIO e o ONBOARDING.
 *
 * As duas telas falam o mesmo idioma visual (fase 9 §3): as seis bolinhas e o
 * teclado circular. A LÓGICA difere — o bloqueio envia sozinho ao sexto dígito, o
 * onboarding tem duas fases (criar/confirmar) —, mas o DESENHO é um só. Uma cópia
 * divergiria no dia em que só um dos teclados fosse ajustado.
 */

import { Delete } from "lucide-react";

import { cx } from "../../design-system/primitives";

/**
 * As seis bolinhas do PIN. `error` acende todas em vermelho; `success` (o PIN
 * correto, fase 10) acende todas em FÓSFORO com glow — o "operador reconhecido"
 * dito também na cor.
 */
export function PinDots({
  length,
  filled,
  error,
  success,
}: {
  length: number;
  filled: number;
  error?: boolean;
  success?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-4"
      style={error ? { animation: "nexus-shake 450ms var(--ease)" } : undefined}
      role="status"
      aria-label={`${filled} de ${length} dígitos`}
    >
      {Array.from({ length }).map((_, i) => {
        const on = i < filled;
        return (
          <span
            key={i}
            className={cx(
              "size-3 rounded-full border transition-[background-color,border-color,transform,box-shadow] duration-[var(--dur-fast)]",
              error
                ? "border-[var(--danger)] bg-[var(--danger)]"
                : success
                  ? "scale-100 border-[var(--accent)] bg-[var(--accent)] shadow-[0_0_11px_var(--accent)]"
                  : on
                    ? "scale-100 border-[var(--text-primary)] bg-[var(--text-primary)]"
                    : "scale-90 border-[var(--border-strong)] bg-transparent",
            )}
            style={on && !error && !success ? { animation: "nexus-pulse 180ms var(--ease) both" } : undefined}
          />
        );
      })}
    </div>
  );
}

export function PadKey({
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
      // O SQUIRCLE D1 (fase 10): `border-radius: 44% / 44%` — nem círculo nem
      // quadrado, a tecla de um mostrador. Vale para o bloqueio e o onboarding.
      style={{ borderRadius: "44% / 44%", ...(rest.style ?? {}) }}
      className={cx(
        "tabular grid size-16 place-items-center border text-[22px] font-medium",
        "transition-[transform,background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "active:scale-[0.94] disabled:pointer-events-none disabled:opacity-30",
        accent
          ? "border-transparent bg-[var(--accent)] text-white hover:bg-[var(--accent-bright)]"
          : cx(
              "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-surface)_55%,transparent)] text-[var(--text-primary)] backdrop-blur-[2px]",
              "hover:border-[var(--border-glow)] hover:bg-[var(--bg-raised)]",
            ),
      )}
    >
      {children}
    </button>
  );
}

/**
 * O teclado numérico completo (1–9, ⌫, 0, OK). O `onKey` recebe o dígito; o ⌫
 * chama `onBackspace`; o OK chama `onOk`. Quem usa decide o que cada um faz.
 */
export function NumPad({
  onKey,
  onBackspace,
  onOk,
  disabled,
  okDisabled,
}: {
  onKey: (d: string) => void;
  onBackspace: () => void;
  onOk: () => void;
  disabled?: boolean;
  okDisabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <PadKey key={d} onClick={() => onKey(d)} disabled={disabled}>
          {d}
        </PadKey>
      ))}
      <PadKey onClick={onBackspace} disabled={disabled} aria-label="Apagar">
        <Delete size={20} strokeWidth={1.8} />
      </PadKey>
      <PadKey onClick={() => onKey("0")} disabled={disabled}>
        0
      </PadKey>
      <PadKey onClick={onOk} disabled={disabled || okDisabled} aria-label="Confirmar" accent>
        <span className="text-[15px] font-semibold tracking-[0.06em]">OK</span>
      </PadKey>
    </div>
  );
}
