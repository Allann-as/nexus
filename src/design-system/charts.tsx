/**
 * Os gráficos pequenos do Midnight, em SVG puro.
 *
 * Por que não ECharts aqui: um sparkline de 30 pontos e um arco de progresso são
 * ~20 linhas de path. Instanciar uma engine de gráficos por card do Hub custaria
 * uma ordem de grandeza mais de RAM e de tempo de montagem que o SVG que eles
 * viram, para desenhar exatamente a mesma linha. O ECharts entra no M3, onde as
 * telas pedem eixo, tooltip, zoom e legenda de verdade — coisas que não se
 * reimplementa à mão. Ver docs/DECISIONS.md (ADR-0007).
 *
 * A regra de cor destes componentes: eles NUNCA são a única forma de distinguir
 * uma Esfera de outra. A cor tinge; quem identifica é o ícone e o nome ao lado.
 * (O violeta da Carreira e o azul das Finanças ficam a ΔE 11 em visão normal —
 * indistinguíveis por cor sozinha. Ver ADR-0008.)
 */

import { useId } from "react";

import { cx } from "./primitives";
import { useCountUp } from "./useCountUp";

/* ===== Sparkline ===== */

/**
 * A linha de tendência de um card. Sem eixo, sem grid, sem tooltip: é uma
 * FORMA, não um gráfico de leitura precisa. Quem quer o número exato abre a
 * Esfera.
 *
 * O glow sai de dois traços sobrepostos (largo e translúcido + fino e opaco), e
 * não de um `filter: blur`. Mesmo resultado, e sem pedir ao compositor uma
 * rasterização de filtro por card — que é justamente o que a §6 raciona.
 */
export function Sparkline({
  data,
  color = "var(--sphere)",
  width = 96,
  height = 32,
  className,
}: {
  /** Série já normalizada em 0..1, do mais antigo ao mais recente. */
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const gradId = useId();

  if (data.length < 2) {
    // Uma linha precisa de dois pontos. Um traço reto no meio diz "sem dados
    // ainda" sem quebrar o layout do card com um buraco.
    return (
      <svg width={width} height={height} className={className} aria-hidden>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--border-subtle)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  // 1.5px de respiro em cima e embaixo: sem isso, um ponto em 1.0 fica com
  // metade do traço cortada pela borda do viewBox.
  const pad = 2;
  const h = height - pad * 2;
  const step = width / (data.length - 1);

  const pts = data.map((v, i) => {
    const clamped = Math.max(0, Math.min(1, v));
    return [i * step, pad + h - clamped * h] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lastX, lastY] = pts[pts.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx("overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#${gradId})`} />

      {/* O halo: o mesmo traço, largo e quase transparente. */}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeOpacity={0.16}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* O ponto de hoje, com o anel na cor da superfície para continuar
          legível onde cruza a própria linha. */}
      <circle cx={lastX} cy={lastY} r={3.5} fill={color} stroke="var(--bg-surface)" strokeWidth={2} />
    </svg>
  );
}

/* ===== Gauge ===== */

/**
 * O arco de 270° dos scores. Sem ponteiro: só o arco preenchendo, contando até
 * o valor na montagem.
 *
 * A geometria: um círculo com `strokeDasharray` mostrando 3/4 da circunferência,
 * girado 135° para a abertura ficar embaixo e centrada. É um elemento e duas
 * contas — um path de arco daria o mesmo desenho com trigonometria a mais.
 */
export function Gauge({
  value,
  size = 132,
  thickness = 9,
  color = "var(--sphere)",
  label,
  sublabel,
}: {
  /** 0..100. `null` = não havia nada a medir (≠ zero, que seria "você falhou"). */
  value: number | null;
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
  sublabel?: string;
}) {
  const gradId = useId();
  const animated = useCountUp(value ?? 0, 700);

  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75; // 270°
  const pct = Math.max(0, Math.min(100, animated)) / 100;

  // `strokeLinecap="round"` desenha as duas pontas redondas de um traço — e um
  // traço de comprimento ZERO ainda tem duas pontas. Sem esta guarda, um score
  // de 0 aparece como um ponto colorido solto na beira do arco, que lê como
  // sujeira de render (ou pior: como se o score fosse >0). Meio pixel é o piso
  // em que a ponta some.
  const hasArc = arc * pct > 0.5;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="block">
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>

        <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
          {/* O trilho: os 270° inteiros, apagados. `--border-subtle` e não
              `--bg-base`: o gauge do Hub fica sobre o próprio `--bg-base`, e um
              trilho da cor do fundo é um trilho que não existe. */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--border-subtle)"
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${c}`}
          />
          {value != null && hasArc && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={thickness}
              strokeLinecap="round"
              strokeDasharray={`${arc * pct} ${c}`}
              // O glow do arco. Estático: `useCountUp` move o dasharray, não a
              // sombra — animar drop-shadow seria repintar todo frame.
              style={{ filter: `drop-shadow(0 0 6px color-mix(in srgb, ${color} 45%, transparent))` }}
            />
          )}
        </g>
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {value == null ? (
          <span className="text-[13px] text-[var(--text-tertiary)]">—</span>
        ) : (
          <span className="tabular text-[34px] leading-none font-bold tracking-[-0.03em] text-[var(--text-primary)]">
            {Math.round(animated)}
          </span>
        )}
        {label && (
          <span className="mt-1 text-[9px] font-semibold tracking-[0.12em] text-[var(--text-tertiary)] uppercase">
            {label}
          </span>
        )}
        {sublabel && (
          <span className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{sublabel}</span>
        )}
      </div>
    </div>
  );
}

/* ===== ProgressRing ===== */

/** O anel fechado (360°) de progresso — para "4/6 checkpoints". */
export function ProgressRing({
  value,
  size = 44,
  thickness = 4,
  color = "var(--sphere)",
  children,
}: {
  /** 0..1 */
  value: number;
  size?: number;
  thickness?: number;
  color?: string;
  children?: React.ReactNode;
}) {
  const animated = useCountUp(Math.max(0, Math.min(1, value)), 600);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  // Mesma armadilha do `Gauge`: ponta redonda em traço de comprimento zero
  // ainda desenha a ponta. 0% tem que ser 0% na tela, não um pontinho.
  const hasArc = c * animated > 0.5;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={thickness}
        />
        {hasArc && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - animated)}
          />
        )}
      </svg>
      {children && (
        <div className="absolute inset-0 flex items-center justify-center">{children}</div>
      )}
    </div>
  );
}

/* ===== ProgressBar ===== */

/**
 * A barra grossa com glow.
 *
 * `active` liga as listras diagonais em movimento. Ele é OPT-IN e some sozinho
 * quando não há atividade recente: uma barra listrada animando para sempre é
 * exatamente a animação em idle que a §6 proíbe — 60 repaints por segundo para
 * dizer o mesmo que uma barra parada já dizia.
 */
export function ProgressBar({
  value,
  color = "var(--sphere)",
  height = 8,
  active = false,
  className,
}: {
  /** 0..1 */
  value: number;
  color?: string;
  height?: number;
  active?: boolean;
  className?: string;
}) {
  const animated = useCountUp(Math.max(0, Math.min(1, value)), 600);

  return (
    <div
      className={cx("w-full overflow-hidden rounded-full bg-[var(--bg-base)]", className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${animated * 100}%`,
          background: `linear-gradient(90deg, color-mix(in srgb, ${color} 55%, transparent), ${color})`,
          boxShadow: `0 0 12px color-mix(in srgb, ${color} 45%, transparent)`,
          ...(active
            ? {
                backgroundImage: `repeating-linear-gradient(115deg, rgb(255 255 255 / 0.16) 0 6px, transparent 6px 14px), linear-gradient(90deg, color-mix(in srgb, ${color} 55%, transparent), ${color})`,
                animation: "nexus-stripes 700ms linear infinite",
              }
            : {}),
        }}
      />
    </div>
  );
}
