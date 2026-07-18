/**
 * O emblema geométrico dos empty states (M5.5 §3.4).
 *
 * A mesma família do astrolábio dos fundos (§3.2), agora concentrada num
 * símbolo: anéis, um limbo graduado e uma constelação curta, em linha, na cor da
 * Esfera. O ícone do módulo mora no núcleo — a geometria diz "NEXUS", o ícone diz
 * "aqui é o lugar de X". Substitui a caixinha de ícone genérica: uma tela vazia
 * deixa de ser um beco sem saída e passa a ter a assinatura da marca.
 *
 * Estático e barato: SVG puro, `stroke`/`fill` lendo `var(--sphere)`, nada anima.
 */

import type { LucideIcon } from "lucide-react";

const C = 60;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}
const nf = (n: number) => Number(n.toFixed(2));

/** Os tiques do limbo — maior a cada 30°, menor a cada 15° (como o NexusMark). */
function ticks() {
  const out = [];
  for (let deg = 0; deg < 360; deg += 15) {
    const major = deg % 30 === 0;
    const len = major ? 5 : 3;
    const [ox, oy] = polar(50, deg);
    const [ix, iy] = polar(50 - len, deg);
    out.push(
      <line
        key={deg}
        x1={nf(ox)}
        y1={nf(oy)}
        x2={nf(ix)}
        y2={nf(iy)}
        strokeWidth={major ? 1.3 : 0.9}
        strokeLinecap="round"
        opacity={major ? 0.7 : 0.4}
      />,
    );
  }
  return out;
}

export function AstrolabeGlyph({
  icon: Icon,
  size = 128,
}: {
  icon: LucideIcon;
  size?: number;
}) {
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        fill="none"
        stroke="var(--sphere)"
        aria-hidden
        className="absolute inset-0"
      >
        <g>{ticks()}</g>
        <circle cx={C} cy={C} r="50" strokeWidth="1.1" opacity="0.5" />
        {/* o anel médio, um arco aberto para não fechar demais o desenho */}
        <path
          d={`M${polar(38, 40).map(nf).join(",")} A38,38 0 1 1 ${polar(38, 30).map(nf).join(",")}`}
          strokeWidth="1"
          opacity="0.32"
        />
        {/* a constelação: três pontos ligados, saindo do núcleo para a borda */}
        <g opacity="0.55">
          <line x1="60" y1="60" x2="86" y2="40" strokeWidth="0.8" />
          <line x1="86" y1="40" x2="98" y2="52" strokeWidth="0.8" />
          <circle cx="86" cy="40" r="1.7" fill="var(--sphere)" stroke="none" />
          <circle cx="98" cy="52" r="1.3" fill="var(--sphere)" stroke="none" />
        </g>
        {/* o núcleo: um disco que abre espaço para o ícone respirar */}
        <circle cx={C} cy={C} r="23" fill="var(--bg-surface)" stroke="none" />
        <circle cx={C} cy={C} r="23" strokeWidth="1" opacity="0.6" />
      </svg>
      <div
        className="absolute inset-0 flex h-full w-full items-center justify-center"
        style={{ filter: "drop-shadow(0 0 12px color-mix(in srgb, var(--sphere) 30%, transparent))" }}
      >
        <Icon size={size * 0.26} className="text-[var(--sphere)]" strokeWidth={1.6} />
      </div>
    </div>
  );
}
