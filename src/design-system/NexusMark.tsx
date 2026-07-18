/**
 * A MARCA do NEXUS — o astrolábio (Aurora 2.0, escolha do arquiteto no M4.6).
 *
 * Anéis concêntricos = as esferas da vida; o limbo externo é graduado como um
 * instrumento de medida; a alidade cruza o centro; o núcleo é o nexo, e é o que
 * brilha. A geometria é a mesma de `docs/logo-concepts-v2/generate.mjs` (raios
 * 104/84/65/47, centro 120, alidade a −34°) — a grade é o desenho.
 *
 * Por que hex cru aqui, se "hex cru em componente é bug"? Porque um LOGO é um
 * ativo de marca com UMA identidade — ele não se tinge com o tema nem com a
 * Esfera (ADR-0043). A rampa índigo (#7C8CF8 e vizinhos) é o vocabulário fechado
 * da marca; a variável seria a exceção errada aqui.
 *
 * `plate` desenha o squircle de fundo (o look de ícone de app). Sem ele, a marca
 * assenta sobre a superfície do chrome (o cabeçalho do menu, o Sobre).
 */

import { useId, type ReactElement } from "react";

const INK = {
  l3: "#EEF1FF",
  l2: "#CAD3FF",
  l1: "#A7B4FB",
  base: "#7C8CF8",
  d1: "#5D6BDC",
  d2: "#414FB4",
  d3: "#2B3585",
  d4: "#1B2258",
  d5: "#10163A",
};

const C = 120;
const RINGS = [
  { r: 104, w: 3.4, tone: INK.d2 },
  { r: 84, w: 2.2, tone: INK.d1 },
  { r: 65, w: 1.7, tone: INK.base },
  { r: 47, w: 1.35, tone: INK.l1 },
];
const ALIDADE = -34;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}
const nf = (n: number) => Number(n.toFixed(2));

/** Os tiques do limbo, hierarquizados (maior a cada 30°, médio a cada 15°). */
function ticks() {
  const out: ReactElement[] = [];
  for (let deg = 0; deg < 360; deg += 6) {
    const major = deg % 30 === 0;
    const medium = !major && deg % 15 === 0;
    const len = major ? 11 : medium ? 6.5 : 3.5;
    const w = major ? 1.5 : medium ? 0.9 : 0.6;
    const tone = major ? INK.l1 : medium ? INK.base : INK.d1;
    const op = major ? 0.95 : medium ? 0.8 : 0.55;
    const [ox, oy] = polar(102, deg);
    const [ix, iy] = polar(102 - len, deg);
    out.push(
      <line
        key={deg}
        x1={nf(ox)}
        y1={nf(oy)}
        x2={nf(ix)}
        y2={nf(iy)}
        stroke={tone}
        strokeWidth={w}
        strokeLinecap="round"
        opacity={op}
      />,
    );
  }
  return out;
}

export function NexusMark({
  size = 28,
  plate = false,
  className,
}: {
  size?: number;
  plate?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const core = `core-${uid}`;
  const halo = `halo-${uid}`;
  const bg = `bg-${uid}`;

  const [ax1, ay1] = polar(100, ALIDADE);
  const [ax2, ay2] = polar(100, ALIDADE + 180);
  const [px, py] = polar(104, ALIDADE);
  // normal unitária da barra (não passa por `polar`, que já soma o centro)
  const arad = (ALIDADE * Math.PI) / 180;
  const nx = Math.cos(arad);
  const ny = Math.sin(arad);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 240"
      fill="none"
      role="img"
      aria-label="NEXUS"
      className={className}
    >
      <defs>
        <radialGradient id={core} cx="38%" cy="34%" r="72%">
          <stop offset="0%" stopColor={INK.l3} />
          <stop offset="30%" stopColor={INK.l1} />
          <stop offset="70%" stopColor={INK.base} />
          <stop offset="100%" stopColor={INK.d2} />
        </radialGradient>
        <radialGradient id={halo} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={INK.base} stopOpacity={0.5} />
          <stop offset="60%" stopColor={INK.base} stopOpacity={0.12} />
          <stop offset="100%" stopColor={INK.base} stopOpacity={0} />
        </radialGradient>
        {RINGS.map((ring, i) => (
          <linearGradient key={i} id={`ring-${i}-${uid}`} x1="18%" y1="8%" x2="86%" y2="94%">
            <stop offset="0%" stopColor={INK.l2} />
            <stop offset="42%" stopColor={ring.tone} />
            <stop offset="100%" stopColor={INK.d4} />
          </linearGradient>
        ))}
        {plate && (
          <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={INK.d3} />
            <stop offset="100%" stopColor={INK.d5} />
          </linearGradient>
        )}
      </defs>

      {plate && (
        <>
          <rect x="8" y="8" width="224" height="224" rx="52" fill={`url(#${bg})`} />
          <rect
            x="8"
            y="8"
            width="224"
            height="224"
            rx="52"
            fill="none"
            stroke={INK.d2}
            strokeWidth="1.5"
            opacity="0.6"
          />
        </>
      )}

      <g>{ticks()}</g>

      {RINGS.map((ring, i) => (
        <circle
          key={i}
          cx={C}
          cy={C}
          r={ring.r}
          fill="none"
          stroke={`url(#ring-${i}-${uid})`}
          strokeWidth={ring.w}
        />
      ))}

      {/* alidade: régua diametral + ponteiro */}
      <g strokeLinecap="round">
        <line x1={nf(ax2)} y1={nf(ay2)} x2={nf(ax1)} y2={nf(ay1)} stroke={INK.d4} strokeWidth="6" opacity="0.35" />
        <line x1={nf(ax2)} y1={nf(ay2)} x2={nf(ax1)} y2={nf(ay1)} stroke={INK.l1} strokeWidth="2.2" />
        <line x1={nf(ax2)} y1={nf(ay2)} x2={nf(ax1)} y2={nf(ay1)} stroke={INK.l3} strokeWidth="0.8" opacity="0.7" />
      </g>
      <path
        d={`M${nf(px)},${nf(py)} L${nf(ax1 - nx * 5)},${nf(ay1 - ny * 5)} L${nf(ax1 + nx * 5)},${nf(ay1 + ny * 5)} Z`}
        fill={INK.l2}
      />

      {/* núcleo: o nexo */}
      <circle cx={C} cy={C} r="46" fill={`url(#${halo})`} />
      <circle cx={C} cy={C} r="27" fill={`url(#${core})`} />
      <circle cx={C} cy={C} r="27" fill="none" stroke={INK.d3} strokeWidth="0.8" opacity="0.6" />
      <circle cx={C} cy={C} r="20" fill="none" stroke={INK.l3} strokeWidth="0.7" opacity="0.55" />
      <circle cx={C - 6} cy={C - 7} r="4.5" fill={INK.l3} opacity="0.9" />
      <circle cx={C} cy={C} r="2.4" fill={INK.d4} />
    </svg>
  );
}
