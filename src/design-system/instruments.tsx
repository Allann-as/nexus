/**
 * A biblioteca de INSTRUMENTOS do Cockpit (v1.3).
 *
 * O Midnight deu cards e gráficos; o Cockpit acrescenta as peças de um PAINEL DE
 * INSTRUMENTOS — medidores segmentados, listas com LED, células de intensidade,
 * o terminal de operação. Toda tela do app compõe daqui, então mudar uma peça
 * muda o app inteiro (a alavanca da §1 do plano). Nenhum estilo solto por tela.
 *
 * As três leis que atravessam tudo:
 *   1. MONO É O DADO — número, rótulo, status: JetBrains Mono, tabular.
 *   2. SÓ TOKENS — hex cru em componente é bug; a cor vem de `--sphere`/`--phos`.
 *   3. NADA ANIMA PARADO — só transform/opacity, e só na montagem ou no gesto.
 *
 * Ordem de dependência: instruments → {primitives, charts, useCountUp}. Nunca
 * importa `cards` (que importa daqui), para o grafo ficar acíclico.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cx, Button } from "./primitives";
import { useCountUp } from "./useCountUp";

/** O vocabulário de tom — os acentos de estado/Esfera do Cockpit. */
export type Tone =
  | "sphere"
  | "phos"
  | "success"
  | "amber"
  | "warning"
  | "red"
  | "danger"
  | "cyan"
  | "violet"
  | "muted";

const TONE: Record<Tone, string> = {
  sphere: "var(--sphere)",
  phos: "var(--accent)",
  success: "var(--success)",
  amber: "var(--warning)",
  warning: "var(--warning)",
  red: "var(--danger)",
  danger: "var(--danger)",
  cyan: "var(--cyan)",
  violet: "var(--violet)",
  muted: "var(--text-tertiary)",
};

export function toneColor(tone: Tone = "sphere"): string {
  return TONE[tone] ?? TONE.sphere;
}

/** O botão do Cockpit é o mesmo `Button` de profundidade (ADR-0067) — um só, o
 *  app inteiro muda junto. Reexportado com o nome do plano para descoberta. */
export { Button as Btn };

/* ============================================================
   SegBar — o medidor segmentado
   ------------------------------------------------------------
   Substitui TODO velocímetro/gauge de ponteiro (o dono os reprovou). É a barra
   de um medidor de áudio: N segmentos acesos até X%. O segmento da ponta esmaece
   proporcional à fração que sobra — a leitura fica precisa sem número.
   ============================================================ */
export function SegBar({
  value,
  segments = 22,
  color = "var(--sphere)",
  height = 10,
  gap = 3,
  className,
  animate = true,
}: {
  /** 0..1 */
  value: number;
  segments?: number;
  color?: string;
  height?: number;
  gap?: number;
  className?: string;
  animate?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const animated = useCountUp(clamped, animate ? 600 : 0);
  const filledFloat = animated * segments;

  return (
    <div
      className={cx("flex w-full items-stretch", className)}
      style={{ gap, height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {Array.from({ length: segments }, (_, i) => {
        const fill = Math.max(0, Math.min(1, filledFloat - i));
        // fill=0 → trilho (--bg-base); fill=1 → cor cheia; parcial → esmaece.
        const bg =
          fill <= 0.001
            ? "var(--bg-base)"
            : `color-mix(in srgb, ${color} ${Math.round(20 + fill * 80)}%, var(--bg-base))`;
        return (
          <span
            key={i}
            className="flex-1 rounded-[2px]"
            style={{
              background: bg,
              boxShadow:
                fill > 0.5
                  ? `0 0 6px color-mix(in srgb, ${color} ${Math.round(fill * 40)}%, transparent)`
                  : undefined,
              border: fill <= 0.001 ? "1px solid var(--border-subtle)" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/* ============================================================
   BarSpark — barras finas de uma série
   ------------------------------------------------------------
   O primo de barras da Sparkline: uma série 0..1 vira colunas finas. Para
   "aportes por mês", "horas por dia da semana" — onde a barra lê melhor que a
   linha porque cada valor é discreto.
   ============================================================ */
export function BarSpark({
  data,
  color = "var(--sphere)",
  width = 120,
  height = 36,
  className,
}: {
  /** Série 0..1, antigo→recente. */
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (data.length === 0) {
    return <div style={{ width, height }} className={className} aria-hidden />;
  }
  const gap = data.length > 20 ? 1 : 2;
  const bw = (width - gap * (data.length - 1)) / data.length;
  const maxH = height - 2;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      {data.map((v, i) => {
        const clamped = Math.max(0, Math.min(1, v));
        const bh = Math.max(1.5, clamped * maxH);
        const x = i * (bw + gap);
        const last = i === data.length - 1;
        return (
          <rect
            key={i}
            x={x}
            y={height - bh}
            width={bw}
            height={bh}
            rx={1.5}
            fill={color}
            opacity={last ? 1 : 0.45 + clamped * 0.4}
          />
        );
      })}
    </svg>
  );
}

/* ============================================================
   Ring — anel de progresso simples, número mono no centro
   ------------------------------------------------------------
   Sem ponteiro. 360°, o valor conta na montagem. É o `ProgressRing` do Midnight
   com o miolo em mono por padrão — o Cockpit fala em números-mono.
   ============================================================ */
export function Ring({
  value,
  size = 72,
  thickness = 6,
  color = "var(--sphere)",
  label,
  center,
}: {
  /** 0..1 */
  value: number;
  size?: number;
  thickness?: number;
  color?: string;
  label?: string;
  /** Sobrescreve o miolo (por padrão, a porcentagem em mono). */
  center?: ReactNode;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const animated = useCountUp(clamped, 600);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const hasArc = c * animated > 0.5;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90 block">
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
            style={{ filter: `drop-shadow(0 0 5px color-mix(in srgb, ${color} 40%, transparent))` }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {center ?? (
          <span
            className="tabular font-bold leading-none text-[var(--text-primary)]"
            style={{ fontSize: size * 0.26 }}
          >
            {Math.round(animated * 100)}
          </span>
        )}
        {label && (
          <span className="mt-0.5 text-[8px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   StatusList — a lista com LED por item
   ------------------------------------------------------------
   Para telemetria e Esferas: cada linha é um LED colorido + rótulo + valor mono
   à direita, e (opcional) uma SegBar de progresso. O LED codifica o estado
   (fósforo=ok, âmbar=atenção, vermelho=alerta) — mas nunca sozinho: o valor e o
   rótulo estão sempre lá (a cor tinge, não codifica — ADR-0017).
   ============================================================ */
export type StatusRow = {
  id?: string;
  icon?: LucideIcon;
  label: string;
  value?: ReactNode;
  sub?: string;
  tone?: Tone;
  /** 0..1 — vira uma SegBar curta sob o rótulo. */
  progress?: number;
  onClick?: () => void;
};

export function StatusList({ rows, className }: { rows: StatusRow[]; className?: string }) {
  return (
    <ul className={cx("flex flex-col", className)}>
      {rows.map((r, i) => {
        const color = toneColor(r.tone);
        const Tag = r.onClick ? "button" : "div";
        return (
          <li key={r.id ?? i} className={i > 0 ? "border-t border-[var(--border-subtle)]" : undefined}>
            <Tag
              onClick={r.onClick}
              className={cx(
                "flex w-full items-center gap-3 px-1 py-2.5 text-left",
                r.onClick &&
                  "cursor-pointer rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--bg-raised)]",
              )}
            >
              {/* O LED */}
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: color, boxShadow: `0 0 6px color-mix(in srgb, ${color} 55%, transparent)` }}
              />
              {r.icon && <r.icon size={14} strokeWidth={2} style={{ color }} className="shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {r.label}
                  </span>
                  {r.value != null && (
                    <span className="tabular shrink-0 text-[13px] font-semibold text-[var(--text-primary)]">
                      {r.value}
                    </span>
                  )}
                </div>
                {r.progress != null && (
                  <SegBar value={r.progress} color={color} segments={16} height={6} gap={2} className="mt-1.5" />
                )}
                {r.sub && <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]">{r.sub}</p>}
              </div>
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

/* ============================================================
   Heatmap — grade de células por intensidade
   ------------------------------------------------------------
   A grade de dia/semana (hábitos, treino, "guardar por dia", ano em pixels).
   Célula 2px de canto, intensidade por valor. SVG-agnóstico: recebe as células
   já resolvidas em 0..1 e desenha; quem monta a grade decide o significado.
   ============================================================ */
export type HeatCell = { value: number | null; title?: string };

export function Heatmap({
  cells,
  columns,
  color = "var(--sphere)",
  cell = 12,
  gap = 3,
  radius = 2,
  className,
}: {
  /** As células, na ordem de leitura (linha a linha). value 0..1, ou null = vazio. */
  cells: HeatCell[];
  columns: number;
  color?: string;
  cell?: number;
  gap?: number;
  radius?: number;
  className?: string;
}) {
  return (
    <div
      className={cx("grid w-max", className)}
      style={{
        gridTemplateColumns: `repeat(${columns}, ${cell}px)`,
        gap,
      }}
    >
      {cells.map((c, i) => {
        const v = c.value;
        const bg =
          v == null
            ? "var(--bg-base)"
            : v <= 0.001
              ? "var(--bg-raised)"
              : `color-mix(in srgb, ${color} ${Math.round(18 + Math.min(1, v) * 82)}%, var(--bg-base))`;
        return (
          <span
            key={i}
            title={c.title}
            className="block"
            style={{
              width: cell,
              height: cell,
              borderRadius: radius,
              background: bg,
              border: v == null ? "1px solid var(--border-subtle)" : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/* ============================================================
   Terminal — o painel de operação
   ------------------------------------------------------------
   Fundo painel, um FIO DE LUZ no topo (a quina iluminada), cabeçalho em mono.
   Base do aporte e das modais densas. Não é um card qualquer: é a superfície
   onde se OPERA — tem cabeçalho de comando e corpo de trabalho.
   ============================================================ */
export function Terminal({
  title,
  icon: Icon,
  right,
  tone = "sphere",
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  icon?: LucideIcon;
  right?: ReactNode;
  tone?: Tone;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const color = toneColor(tone);
  return (
    <section
      className={cx(
        "relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--bg-surface)]",
        "shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_8%,transparent),0_1px_2px_rgb(0_0_0/0.3)]",
        className,
      )}
    >
      {/* O fio de luz superior, tingido de leve pela cor da operação. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${color} 55%, transparent), transparent)` }}
      />
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={13} strokeWidth={2.2} style={{ color }} />}
            {title && (
              <span className="font-mono text-[11px] font-semibold tracking-[0.16em] text-[var(--text-secondary)] uppercase">
                {title}
              </span>
            )}
          </div>
          {right}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ============================================================
   Chip — a tag/pílula
   ------------------------------------------------------------
   Filtro de classe, tag de status, seletor rápido. Ativa = tingida; inerte =
   grafite. Clicável opcional.
   ============================================================ */
export function Chip({
  children,
  icon: Icon,
  tone = "sphere",
  active = false,
  onClick,
  className,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const color = toneColor(tone);
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      className={cx(
        "inline-flex h-7 select-none items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium",
        onClick && "transition-colors",
        className,
      )}
      style={
        active
          ? {
              color,
              borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
              background: `color-mix(in srgb, ${color} 14%, transparent)`,
            }
          : {
              color: "var(--text-secondary)",
              borderColor: "var(--border-subtle)",
              background: "var(--bg-raised)",
            }
      }
    >
      {Icon && <Icon size={12} strokeWidth={2.2} />}
      {children}
    </Tag>
  );
}

/* ============================================================
   SegToggle — o alternador segmentado
   ------------------------------------------------------------
   Aporte/Resgate, mês/semana/dia. Dois ou mais botões num trilho; o ativo tem a
   pastilha tingida. Teclado-navegável por serem botões reais.
   ============================================================ */
export function SegToggle<T extends string>({
  options,
  value,
  onChange,
  tone = "sphere",
  size = "md",
  className,
}: {
  options: Array<{ value: T; label: string; icon?: LucideIcon }>;
  value: T;
  onChange: (v: T) => void;
  tone?: Tone;
  size?: "sm" | "md";
  className?: string;
}) {
  const color = toneColor(tone);
  return (
    <div
      className={cx(
        "inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-1",
        className,
      )}
      role="tablist"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] font-medium transition-[background-color,color]",
              size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-3 text-[12px]",
              !on && "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
            )}
            style={
              on
                ? {
                    color: "#05100c",
                    background: color,
                    boxShadow: `0 1px 6px color-mix(in srgb, ${color} 40%, transparent)`,
                  }
                : undefined
            }
          >
            {o.icon && <o.icon size={13} strokeWidth={2.2} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   BankTile — a conta com a marca do banco
   ------------------------------------------------------------
   O terminal de aporte lista os bancos como ladrilhos. Enquanto o dono não cola
   as logos oficiais, o monograma na cor da marca já dá identidade. O registro
   abaixo tem as cores que o plano fixou; "+ conta" é o genérico.
   ============================================================ */
export const BANK_BRANDS: Record<string, { color: string; short: string }> = {
  nubank: { color: "#820AD1", short: "Nu" },
  btg: { color: "#00234B", short: "BTG" },
  santander: { color: "#EC0000", short: "St" },
  itau: { color: "#EC7000", short: "Itaú" },
  bradesco: { color: "#CC092F", short: "Bra" },
  inter: { color: "#FF7A00", short: "Int" },
};

/** Resolve a marca por nome livre (case/acentos-insensível), com fallback fósforo. */
export function bankBrand(name: string): { color: string; short: string } {
  const key = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  for (const k of Object.keys(BANK_BRANDS)) {
    if (key.includes(k)) return BANK_BRANDS[k];
  }
  const short = name.trim().slice(0, 2).toUpperCase() || "•";
  return { color: "var(--accent)", short };
}

export function BankTile({
  name,
  balance,
  selected = false,
  onClick,
  add = false,
  className,
}: {
  name: string;
  /** Legenda opcional sob o nome (ex.: saldo). */
  balance?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** O ladrilho genérico "+ conta". */
  add?: boolean;
  className?: string;
}) {
  const brand = add ? { color: "var(--text-tertiary)", short: "+" } : bankBrand(name);
  return (
    <button
      onClick={onClick}
      className={cx(
        "group flex items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-[transform,border-color,background-color]",
        "hover:-translate-y-px",
        selected
          ? "border-[color-mix(in_srgb,var(--sphere)_60%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-raised)] hover:border-[var(--border-glow)]",
        add && "border-dashed",
        className,
      )}
    >
      <span
        className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] font-mono text-[11px] font-bold text-white"
        style={{ background: brand.color }}
      >
        {brand.short}
      </span>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{name}</div>
        {balance != null && (
          <div className="tabular truncate text-[11px] text-[var(--text-tertiary)]">{balance}</div>
        )}
      </div>
    </button>
  );
}

/* ============================================================
   SphereHeader — o cabeçalho tingido de uma Esfera
   ------------------------------------------------------------
   O par do `PageHeader` para as telas de Esfera: o mesmo padding lateral, mas
   com o emblema da Esfera na cor dela, o nome, e (opcional) as abas-pílula e as
   ações. A cor vem do `--sphere` do container — o componente não sabe de Esferas.
   ============================================================ */
export function SphereHeader({
  icon: Icon,
  title,
  subtitle,
  tabs,
  activeTab,
  onTab,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  tabs?: Array<{ id: string; label: string; icon?: LucideIcon }>;
  activeTab?: string;
  onTab?: (id: string) => void;
  actions?: ReactNode;
}) {
  return (
    <header className="px-6 pt-9 pb-4 sm:px-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-md)] border"
            style={{
              color: "var(--sphere)",
              borderColor: "color-mix(in srgb, var(--sphere) 40%, transparent)",
              background: "color-mix(in srgb, var(--sphere) 12%, transparent)",
            }}
          >
            <Icon size={22} strokeWidth={2} />
          </span>
          <div>
            <h1 className="text-[24px] leading-[30px] font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
              {title}
            </h1>
            {subtitle && <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 pt-1">{actions}</div>}
      </div>

      {tabs && tabs.length > 0 && (
        <nav className="mt-5 flex items-center gap-1.5" role="tablist">
          {tabs.map((t) => {
            const on = t.id === activeTab;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={on}
                onClick={() => onTab?.(t.id)}
                className={cx(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
                  on ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
                style={
                  on
                    ? {
                        background: "color-mix(in srgb, var(--sphere) 16%, transparent)",
                        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--sphere) 45%, transparent)",
                      }
                    : undefined
                }
              >
                {t.icon && <t.icon size={14} strokeWidth={2} />}
                {t.label}
              </button>
            );
          })}
        </nav>
      )}
    </header>
  );
}

/* ============================================================
   MonoLabel / LED — micro-peças de telemetria
   ============================================================ */

/** O rótulo em caps mono do Cockpit — o "OSD" de um instrumento. */
export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "font-mono text-[10px] font-semibold tracking-[0.16em] text-[var(--text-tertiary)] uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Um LED solto, para status inline. */
export function Led({ tone = "sphere", size = 8 }: { tone?: Tone; size?: number }) {
  const color = toneColor(tone);
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: color, boxShadow: `0 0 6px color-mix(in srgb, ${color} 55%, transparent)` }}
    />
  );
}
