/**
 * A avaliação em estrelas de um livro.
 *
 * Sem `onChange` é só leitura (o card). Com `onChange` fica interativo, com o
 * preview no hover — a fila de estrelas acende até onde o mouse está, para o
 * clique ser sobre o que já se vê. As cheias tingem na cor da Esfera.
 */

import { useState } from "react";
import { Star } from "lucide-react";

import { cx } from "../../design-system/primitives";

export function Stars({
  value,
  onChange,
  size = 16,
}: {
  value: number | null;
  onChange?: (n: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const interactive = !!onChange;
  // No hover mostra a prévia; senão o valor gravado (0 se nulo).
  const shown = hover ?? value ?? 0;

  return (
    <div
      className={cx("inline-flex items-center gap-0.5", interactive && "cursor-pointer")}
      onMouseLeave={() => setHover(null)}
      role={interactive ? "radiogroup" : "img"}
      aria-label={interactive ? "Avaliação" : `${value ?? 0} de 5 estrelas`}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= shown;
        return (
          <button
            key={n}
            type="button"
            disabled={!interactive}
            onClick={() => {
              if (!onChange) return;
              // Clicar na estrela atual zera — é o gesto de "tirar a nota".
              onChange(value === n ? 0 : n);
            }}
            onMouseEnter={() => interactive && setHover(n)}
            className={cx(
              "grid place-items-center rounded-[var(--radius-sm)] transition-transform duration-[var(--dur-fast)]",
              interactive && "hover:scale-110",
              !interactive && "pointer-events-none",
            )}
            aria-label={`${n} ${n === 1 ? "estrela" : "estrelas"}`}
            aria-checked={interactive ? value === n : undefined}
            role={interactive ? "radio" : undefined}
          >
            <Star
              size={size}
              strokeWidth={2}
              style={{
                color: filled ? "var(--sphere)" : "var(--text-tertiary)",
                fill: filled ? "var(--sphere)" : "transparent",
                opacity: filled ? 1 : 0.5,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
