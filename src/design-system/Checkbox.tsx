/**
 * O checkbox do NEXUS.
 *
 * É o gesto mais repetido do app: se ele não for gostoso, nada é. O orçamento
 * dele é o mais duro do produto — marcar tem que responder em menos de 16 ms
 * PERCEBIDOS, o que significa que a animação começa no clique e não espera o
 * banco. A confirmação vem depois; o feedback vem agora.
 *
 * Anatomia: um círculo que preenche na cor da Esfera + um pulinho (scale
 * 1→1.15→1) + o risco no texto (que é do chamador). Nada disso toca layout —
 * só `transform` e `opacity`, o par que o compositor resolve sozinho.
 */

import { Check } from "lucide-react";

import { cx } from "./primitives";

export function Checkbox({
  checked,
  onChange,
  disabled,
  size = 20,
  color = "var(--sphere)",
  title,
  /** 'skipped' desenha o traço neutro da folga assumida — nem feito, nem falho. */
  variant = "default",
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  size?: number;
  color?: string;
  title?: string;
  variant?: "default" | "skipped";
}) {
  const skipped = variant === "skipped";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={onChange}
      className={cx(
        "group relative grid shrink-0 place-items-center rounded-full",
        "transition-transform duration-[var(--dur-fast)] ease-[var(--ease)]",
        "active:scale-90 disabled:opacity-40 disabled:pointer-events-none",
      )}
      style={{ width: size, height: size }}
    >
      {/* O aro. Fica na cor da Esfera quando marcado; some para o cinza da
          borda quando não. O hover acende o aro mesmo desmarcado — todo item
          interativo do Midnight responde a alguma coisa. */}
      <span
        aria-hidden
        className="absolute inset-0 rounded-full border-2 transition-colors duration-[var(--dur-fast)]"
        style={{
          borderColor: checked
            ? color
            : skipped
              ? "var(--text-tertiary)"
              : "var(--border-strong)",
        }}
      />

      {/* O preenchimento. `nexus-pulse` roda UMA vez, na transição para marcado:
          a key muda com `checked`, então o React remonta o nó e o browser
          reinicia a animação. Sem a key, marcar de novo não animaria. */}
      {checked && (
        <span
          key="fill"
          aria-hidden
          className="absolute inset-0 grid place-items-center rounded-full"
          style={{ background: color, animation: "nexus-pulse 180ms var(--ease) both" }}
        >
          <Check
            size={size * 0.55}
            strokeWidth={3.5}
            className="text-[var(--bg-base)]"
          />
        </span>
      )}

      {skipped && !checked && (
        <span
          aria-hidden
          className="h-[2px] w-[45%] rounded-full bg-[var(--text-tertiary)]"
        />
      )}

      {/* O halo do hover: um círculo maior por trás, que só aparece no hover.
          Escala em transform — não mexe no fluxo, não empurra vizinho. */}
      <span
        aria-hidden
        className="absolute inset-0 scale-100 rounded-full opacity-0 transition-[opacity,transform] duration-[var(--dur-fast)] group-hover:scale-[1.45] group-hover:opacity-100"
        style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
      />
    </button>
  );
}
