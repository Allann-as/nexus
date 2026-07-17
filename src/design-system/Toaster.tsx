import { AlertCircle, Check, X } from "lucide-react";

import { useToasts } from "../stores/toasts";
import { cx } from "./primitives";

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[380px] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "nx-enter pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-md)] border p-3",
            // Sem `nx-glass`: o toast pode aparecer COM a palette aberta, e o
            // orçamento é de UM backdrop-filter na tela (ver styles.css). O
            // fundo opaco custa zero e some em 4s de qualquer jeito.
            "bg-[var(--bg-raised)]",
            t.kind === "error"
              ? "border-[var(--danger)]"
              : "border-[color-mix(in_srgb,var(--success)_40%,transparent)]",
          )}
          style={{ boxShadow: "var(--shadow-float)" }}
        >
          {t.kind === "error" ? (
            <AlertCircle
              size={15}
              className="mt-0.5 shrink-0 text-[var(--danger)]"
            />
          ) : (
            <Check size={15} className="mt-0.5 shrink-0 text-[var(--success)]" />
          )}
          {/* break-words: mensagens do Rust podem trazer um caminho longo ou
              um erro do SQLite sem espaços; sem isto o toast estoura. */}
          <p
            data-selectable
            className="flex-1 text-[12px] leading-[18px] break-words text-[var(--text-primary)]"
          >
            {t.message}
          </p>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Dispensar"
            className="shrink-0 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
