/**
 * A MARCA do NEXUS — a BÚSSOLA (v1.2, substitui o astrolábio do M4.6).
 *
 * Por que a troca (ADR-0069): o astrolábio era bonito e ilegível. Em uso real o
 * dono do app não reconheceu a própria marca ("abstrata, não faz o menor
 * sentido") — quatro anéis, um limbo graduado e uma alidade viram um borrão
 * cinza a 28px, que é o tamanho em que a marca de fato vive (rail, cabeçalho,
 * bandeja). A bússola guarda a MESMA metáfora — o instrumento com que se navega
 * a própria vida — e a entrega numa silhueta que se lê num piscar: uma rosa dos
 * ventos de 4 pontas com a agulha do norte destacada.
 *
 * A receita de execução (a referência que o dono trouxe): **ícone branco simples
 * e geométrico dentro de um squircle escuro, com glow suave atrás.** Branco, e
 * não a rampa índigo: o contraste contra o squircle é o que sobrevive ao
 * downscale. O índigo continua sendo a marca — ele agora é o FUNDO (o squircle),
 * não o traço.
 *
 * A GRADE É O DESENHO: nada aqui nasce a olho. Centro 120 num quadro 240, anel
 * em 96, pontas da rosa em 76, cintura em 26. Os mesmos números vivem em
 * `docs/logo-concepts-v2/generate.mjs` (que escreve os SVGs do bundle) e no
 * splash do `index.html` — três desenhos, uma geometria só.
 *
 * Por que hex cru aqui, se "hex cru em componente é bug"? Porque um LOGO é um
 * ativo de marca com UMA identidade — ele não se tinge com o tema nem com a
 * Esfera (ADR-0043, que segue valendo). A variável de tema seria a exceção
 * errada aqui.
 */

import { useId } from "react";

/** O vocabulário fechado da marca. Branco para o traço; índigo para o fundo. */
const INK = {
  white: "#FFFFFF",
  plateTop: "#2B3585",
  plateBottom: "#10163A",
  plateEdge: "#414FB4",
  glow: "#7C8CF8",
};

const C = 120;
/** O anel de graduação. */
const R_RING = 96;
/** As pontas da rosa. */
const R_POINT = 76;
/** A cintura entre as pontas — o que dá a silhueta de estrela, não de losango. */
const R_WAIST = 26;

/** deg 0 = norte, crescendo no sentido horário. */
function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [C + r * Math.cos(a), C + r * Math.sin(a)];
}
const nf = (n: number) => Number(n.toFixed(2));
const pt = (r: number, deg: number) => polar(r, deg).map(nf).join(",");

/**
 * As marcas cardeais do anel. Só 8 — quatro maiores (N/L/S/O) e quatro menores
 * nas diagonais. O limbo de 60 tiques do astrolábio era exatamente o detalhe que
 * não sobrevivia a 32px; aqui a graduação existe para dizer "instrumento de
 * medida" e para de existir antes de virar ruído.
 */
function cardinals() {
  return [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const major = deg % 90 === 0;
    const len = major ? 13 : 7;
    return (
      <line
        key={deg}
        x1={nf(polar(R_RING, deg)[0])}
        y1={nf(polar(R_RING, deg)[1])}
        x2={nf(polar(R_RING - len, deg)[0])}
        y2={nf(polar(R_RING - len, deg)[1])}
        stroke={INK.white}
        strokeWidth={major ? 5 : 3}
        strokeLinecap="round"
        opacity={major ? 0.85 : 0.4}
      />
    );
  });
}

/** A rosa inteira: 4 pontas alternando com a cintura. */
const ROSE = [
  `M${pt(R_POINT, 0)}`,
  `L${pt(R_WAIST, 45)}`,
  `L${pt(R_POINT, 90)}`,
  `L${pt(R_WAIST, 135)}`,
  `L${pt(R_POINT, 180)}`,
  `L${pt(R_WAIST, 225)}`,
  `L${pt(R_POINT, 270)}`,
  `L${pt(R_WAIST, 315)}`,
  "Z",
].join(" ");

/**
 * A agulha do norte, sobreposta em branco sólido sobre a rosa translúcida. É o
 * único acento do desenho — sem ele a rosa é simétrica demais e perde a leitura
 * de "isto aponta para algum lugar", que é a ideia inteira.
 */
const NEEDLE = [
  `M${pt(R_POINT, 0)}`,
  `L${pt(R_WAIST, 45)}`,
  `L${C},${C}`,
  `L${pt(R_WAIST, 315)}`,
  "Z",
].join(" ");

export function NexusMark({
  size = 28,
  plate = false,
  glow = false,
  className,
}: {
  size?: number;
  /** O squircle índigo por trás — o look de ícone de app. */
  plate?: boolean;
  /** O halo suave atrás do squircle (a tela de bloqueio, o Sobre). */
  glow?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const bg = `plate-${uid}`;
  const halo = `glow-${uid}`;

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
        {plate && (
          <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={INK.plateTop} />
            <stop offset="100%" stopColor={INK.plateBottom} />
          </linearGradient>
        )}
        {glow && (
          <radialGradient id={halo} cx="50%" cy="50%" r="50%">
            <stop offset="35%" stopColor={INK.glow} stopOpacity={0.42} />
            <stop offset="70%" stopColor={INK.glow} stopOpacity={0.12} />
            <stop offset="100%" stopColor={INK.glow} stopOpacity={0} />
          </radialGradient>
        )}
      </defs>

      {/* O glow vem primeiro e ocupa a moldura inteira: ele existe para vazar
          por fora do squircle, então o squircle é inset o bastante para deixá-lo. */}
      {glow && <circle cx={C} cy={C} r="118" fill={`url(#${halo})`} />}

      {plate && (
        <>
          <rect x="16" y="16" width="208" height="208" rx="60" fill={`url(#${bg})`} />
          <rect
            x="16"
            y="16"
            width="208"
            height="208"
            rx="60"
            fill="none"
            stroke={INK.plateEdge}
            strokeWidth="1.5"
            opacity="0.55"
          />
        </>
      )}

      {/* O anel: um traço só, fino. */}
      <circle
        cx={C}
        cy={C}
        r={R_RING}
        fill="none"
        stroke={INK.white}
        strokeWidth="3"
        opacity="0.3"
      />
      <g>{cardinals()}</g>

      {/* A rosa, e por cima dela a agulha. */}
      <path d={ROSE} fill={INK.white} opacity="0.45" />
      <path d={NEEDLE} fill={INK.white} />

      {/* O pivô: o furo no centro por onde a agulha gira. */}
      <circle cx={C} cy={C} r="9" fill={plate ? INK.plateBottom : INK.plateTop} />
      <circle cx={C} cy={C} r="9" fill="none" stroke={INK.white} strokeWidth="3" />
    </svg>
  );
}
