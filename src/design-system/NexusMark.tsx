/**
 * A MARCA do NEXUS — o SINAL-N (v1.3 COCKPIT, substitui a bússola da v1.2).
 *
 * Por que a troca: a bússola resolveu a legibilidade a 32px, mas ela era a marca
 * do Midnight — a metáfora da navegação, num app que virou um COCKPIT. O Cockpit
 * pede um emblema de instrumento: o N desenhado como um TRAÇO DE SINAL/CIRCUITO,
 * com NÓS acesos nas pontas. É a letra e é um diagrama de conexão ao mesmo tempo —
 * o "nexus" (o ponto onde as coisas se ligam) dito na própria forma.
 *
 * A receita: um traço único em FÓSFORO (o accent do Cockpit) desenhando o N, dois
 * nós preenchidos nas pontas em diagonal (superior-esquerda ↘ inferior-direita — a
 * diagonal do sinal), dentro de um squircle GRAFITE com um glow de fósforo suave
 * atrás. Inverte a bússola: lá o traço era branco sobre índigo; aqui é fósforo
 * sobre grafite — a luz de um mostrador aceso.
 *
 * A GRADE É O DESENHO: nada a olho. Num quadro 240, o N ocupa x∈[84,156],
 * y∈[76,164]; traço de 14 (≈2.4 na grade de 40 da referência × 6); nós de raio 12.
 * Os mesmos números vivem em `docs/logo-concepts-v3/generate.mjs` (que escreve os
 * SVGs do bundle: .ico/.png/.icns) e no splash do `index.html` — três desenhos,
 * uma geometria só.
 *
 * Por que hex cru aqui, se "hex cru em componente é bug"? Porque um LOGO é um ativo
 * de marca com UMA identidade — não se tinge com o tema nem com a Esfera (ADR-0043).
 */

import { useId } from "react";

/** O vocabulário fechado da marca. Fósforo para o traço; grafite para o fundo. */
const INK = {
  phos: "#33E1A0",
  plateTop: "#12181B",
  plateBottom: "#070A0B",
  plateEdge: "#2C4A40",
  glow: "#33E1A0",
};

const C = 120;
/** As colunas do N. */
const X_L = 84;
const X_R = 156;
/** O topo e a base do traço. */
const Y_T = 76;
const Y_B = 164;
/** O traço do N — um caminho único: sobe a esquerda, desce a diagonal, sobe a direita. */
const STEM = `M${X_L} ${Y_B} L${X_L} ${Y_T} L${X_R} ${Y_B} L${X_R} ${Y_T}`;

/** Os dois nós acesos, na diagonal do sinal. */
const NODES: Array<[number, number]> = [
  [X_L, Y_T], // superior-esquerda
  [X_R, Y_B], // inferior-direita
];

export function NexusMark({
  size = 28,
  plate = false,
  glow = false,
  className,
}: {
  size?: number;
  /** O squircle grafite por trás — o look de ícone de app. */
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
            <stop offset="30%" stopColor={INK.glow} stopOpacity={0.4} />
            <stop offset="66%" stopColor={INK.glow} stopOpacity={0.11} />
            <stop offset="100%" stopColor={INK.glow} stopOpacity={0} />
          </radialGradient>
        )}
      </defs>

      {/* O glow vem primeiro e ocupa a moldura inteira: existe para vazar por fora
          do squircle, então o squircle é inset o bastante para deixá-lo. */}
      {glow && <circle cx={C} cy={C} r="118" fill={`url(#${halo})`} />}

      {plate && (
        <>
          <rect x="16" y="16" width="208" height="208" rx="58" fill={`url(#${bg})`} />
          <rect
            x="16"
            y="16"
            width="208"
            height="208"
            rx="58"
            fill="none"
            stroke={INK.plateEdge}
            strokeWidth="1.5"
            opacity="0.8"
          />
        </>
      )}

      {/* O anel de nó (halo fino) atrás de cada nó — a "luz" acesa. */}
      {NODES.map(([x, y]) => (
        <circle
          key={`ring-${x}-${y}`}
          cx={x}
          cy={y}
          r="19"
          fill="none"
          stroke={INK.phos}
          strokeWidth="2.5"
          opacity="0.35"
        />
      ))}

      {/* O traço do N. */}
      <path
        d={STEM}
        fill="none"
        stroke={INK.phos}
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Os nós preenchidos por cima das pontas. */}
      {NODES.map(([x, y]) => (
        <circle key={`node-${x}-${y}`} cx={x} cy={y} r="12" fill={INK.phos} />
      ))}
    </svg>
  );
}
