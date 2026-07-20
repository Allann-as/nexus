/**
 * A marca dos empty states (substitui o `AstrolabeGlyph` da v1.1).
 *
 * Por que a troca: o emblema anterior desenhava anéis, um limbo graduado e uma
 * "constelação" atrás do ícone. Era ornamento sem referente — o dono do app leu
 * a tela e disse que aquilo "não faz sentido algum". Um empty state não é o
 * lugar de exibir instrumento nenhum: o trabalho dele é apontar o ícone do
 * módulo e sair da frente.
 *
 * O que sobrou: um disco levemente tingido pela Esfera, um aro fino por fora, e
 * o ícone que o chamador já passa. Nada mais. A cor continua vindo de
 * `var(--sphere)`, então o glifo veste a Esfera ativa sem nenhuma prop extra.
 *
 * Estático e barato: SVG puro, nada anima, nada mede.
 */

import type { LucideIcon } from "lucide-react";

export function EmptyGlyph({
  icon: Icon,
  size = 96,
}: {
  icon: LucideIcon;
  size?: number;
}) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        fill="none"
        aria-hidden
        className="absolute inset-0"
      >
        {/* o disco: presença suficiente para o ícone não flutuar no vazio */}
        <circle
          cx="50"
          cy="50"
          r="48"
          fill="var(--sphere)"
          opacity="0.07"
          stroke="none"
        />
        {/* o aro: um traço só, fino, discreto */}
        <circle cx="50" cy="50" r="48" stroke="var(--sphere)" strokeWidth="1" opacity="0.28" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <Icon size={Math.round(size * 0.34)} className="text-[var(--sphere)]" strokeWidth={1.5} />
      </div>
    </div>
  );
}
