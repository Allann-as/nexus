/**
 * O anel de streak — o micro-feedback que faz o app parecer vivo.
 *
 * O "uau" do Aurora vem daqui: marcar um hábito preenche o anel com um pulso
 * sutil. Nada de confete; um pulso de 200ms e pronto.
 */

import { Check } from "lucide-react";

import { cx } from "../../design-system/primitives";
import type { TickStatus } from "../../lib/ipc";

/** Acima disto o anel fica cheio: um streak de 30+ já "chegou lá". A escala
 *  existe para dar progresso visível cedo, não para medir com precisão. */
const FULL_AT = 30;

export function StreakRing({
  streak,
  status,
  size = 32,
  onClick,
  disabled,
  title,
}: {
  streak: number;
  status: TickStatus | null;
  size?: number;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const r = (size - 4) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(streak / FULL_AT, 1);

  const done = status === "done";
  const failed = status === "failed";
  const skipped = status === "skipped";

  const stroke = failed
    ? "var(--danger)"
    : skipped
      ? "var(--text-tertiary)"
      : "var(--success)";

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cx(
        "relative shrink-0 rounded-full transition-transform duration-[var(--dur-fast)] ease-[var(--ease)]",
        onClick && !disabled && "hover:scale-105 active:scale-95",
        disabled && "opacity-50",
      )}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth="2"
        />
        {streak > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            className="transition-[stroke-dashoffset] duration-[var(--dur-base)] ease-[var(--ease)]"
          />
        )}
      </svg>

      <span className="absolute inset-0 flex items-center justify-center">
        {done ? (
          // `animate-none` respeita prefers-reduced-motion via tokens.css.
          <Check
            size={size * 0.42}
            strokeWidth={3}
            className="text-[var(--success)]"
            style={{ animation: "nexus-pulse var(--dur-base) var(--ease)" }}
          />
        ) : failed ? (
          <span className="text-[10px] text-[var(--danger)]">✕</span>
        ) : skipped ? (
          <span className="text-[10px] text-[var(--text-tertiary)]">–</span>
        ) : (
          <span
            className={cx(
              "tabular text-[10px]",
              streak > 0 ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]",
            )}
          >
            {streak > 0 ? streak : ""}
          </span>
        )}
      </span>
    </button>
  );
}
