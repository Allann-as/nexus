/**
 * Aurora primitives. Deliberately few: every screen composes from these, so
 * consistency is structural rather than a thing to remember.
 */

import type { ReactNode, ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ===== Button ===== */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: LucideIcon;
};

const BUTTON_VARIANTS: Record<string, string> = {
  primary:
    "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-transparent",
  secondary:
    "bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]",
  ghost:
    "bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
  danger:
    "bg-transparent text-[var(--danger)] border border-[var(--border-subtle)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium select-none",
        "transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {Icon && <Icon size={size === "sm" ? 13 : 15} strokeWidth={2} />}
      {children}
    </button>
  );
}

/* ===== Card ===== */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  // Elevation via border + background delta, never a diffuse shadow. Shadows
  // are reserved for genuinely floating layers (palette, dialogs).
  return (
    <div
      className={cx(
        "rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ===== Kbd ===== */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-1.5 font-mono text-[10px] font-medium text-[var(--text-tertiary)]">
      {children}
    </kbd>
  );
}

/* ===== EmptyState ===== */

/**
 * Every module ships one of these. A blank screen is a dead end; an empty
 * state tells you what this place is for and how to start.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <Icon size={20} className="text-[var(--text-tertiary)]" strokeWidth={1.75} />
      </div>
      <div className="space-y-1">
        <h2 className="text-[15px] font-medium text-[var(--text-primary)]">{title}</h2>
        <p className="max-w-[340px] text-[13px] leading-[20px] text-[var(--text-tertiary)]">
          {hint}
        </p>
      </div>
      {action}
    </div>
  );
}

/* ===== PageHeader ===== */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 px-8 pt-8 pb-6">
      <div>
        <h1 className="text-[20px] leading-[28px] font-semibold tracking-[-0.01em]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 pt-1">{actions}</div>}
    </header>
  );
}
