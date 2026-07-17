/**
 * As receitas de card do Midnight.
 *
 * Uma tela do NEXUS é: um HeroCard no topo (o assunto), uma linha de StatCards
 * (os satélites), um SummaryCard (a frase), e o conteúdo específico. Compondo
 * daqui, a consistência é estrutural em vez de ser uma coisa a lembrar.
 *
 * A regra que atravessa todos: **o dado é o herói**. O rótulo é pequeno, terciário
 * e em caps; o valor é grande, mono e tabular. Se o olho bater no rótulo antes
 * do número, o card está errado.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { cx } from "./primitives";
import { useCountUp } from "./useCountUp";

/* ===== HeroCard ===== */

/**
 * UM por tela, no topo. É o card que responde à pergunta da tela inteira.
 *
 * O gradiente diagonal + o brilho interno no canto são o que dá volume: um card
 * chapado sobre um fundo com profundidade parece um recorte de papel colado.
 */
export function HeroCard({
  label,
  value,
  unit,
  hint,
  aside,
  children,
  className,
}: {
  label: string;
  /** O número gigante. String porque quem formata é a tela (R$, %, 4/6…). */
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  /** O gráfico à direita: sparkline, gauge, anel. */
  aside?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] p-6",
        className,
      )}
      style={{
        background:
          "linear-gradient(135deg, var(--bg-surface) 0%, color-mix(in srgb, var(--sphere) 8%, var(--bg-surface)) 60%, color-mix(in srgb, var(--sphere) 22%, var(--bg-surface)) 100%)",
      }}
    >
      {/* O brilho do canto. `pointer-events-none` porque é decoração pura:
          um pseudo-elemento que come cliques é um bug caro de achar. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full opacity-70"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--sphere) 26%, transparent), transparent 70%)",
        }}
      />

      <div className="relative flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
            {label}
          </p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="tabular text-[40px] leading-[44px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">
              {value}
            </span>
            {unit && (
              <span className="text-[15px] font-medium text-[var(--text-secondary)]">
                {unit}
              </span>
            )}
          </div>
          {hint && (
            <p className="mt-1.5 text-[12px] leading-[18px] text-[var(--text-secondary)]">
              {hint}
            </p>
          )}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>

      {children && <div className="relative mt-5">{children}</div>}
    </section>
  );
}

/* ===== StatCard ===== */

export function StatCard({
  icon: Icon,
  label,
  value,
  unit,
  delta,
  tone = "sphere",
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  unit?: string;
  /** Variação vs. período anterior, em pontos percentuais ou absoluto. */
  delta?: { value: number; suffix?: string };
  tone?: "sphere" | "accent" | "success" | "warning" | "danger";
  onClick?: () => void;
}) {
  const color = TONE_VAR[tone];
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      onClick={onClick}
      className={cx(
        "group rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left",
        // Só transform e box-shadow entram na transição, e ambos por gesto do
        // usuário — nada disso roda sozinho.
        "transition-[transform,border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "hover:-translate-y-0.5 hover:border-[var(--border-glow)] hover:shadow-[var(--glow-accent)]",
        onClick && "cursor-pointer",
      )}
    >
      {/* O chip do ícone: quadrado arredondado, fundo na cor com 12%. */}
      <div
        className="flex size-10 items-center justify-center rounded-[var(--radius-md)]"
        style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}
      >
        <Icon size={17} strokeWidth={2} style={{ color }} />
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="tabular text-[24px] leading-[28px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
          {value}
        </span>
        {unit && <span className="text-[12px] text-[var(--text-tertiary)]">{unit}</span>}
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-medium tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
          {label}
        </span>
        {delta != null && <Delta {...delta} />}
      </div>
    </Tag>
  );
}

const TONE_VAR: Record<string, string> = {
  sphere: "var(--sphere)",
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
};

/**
 * A seta de variação.
 *
 * Zero não ganha seta nem cor: "estável" é uma terceira informação, e pintá-la
 * de verde ou vermelho seria inventar um movimento que não houve.
 */
function Delta({ value, suffix = "" }: { value: number; suffix?: string }) {
  if (value === 0) {
    return <span className="tabular text-[10px] text-[var(--text-tertiary)]">—</span>;
  }
  const up = value > 0;
  return (
    <span
      className="tabular flex shrink-0 items-center gap-0.5 text-[10px] font-medium"
      style={{ color: up ? "var(--success)" : "var(--danger)" }}
    >
      {up ? <ArrowUp size={10} strokeWidth={2.5} /> : <ArrowDown size={10} strokeWidth={2.5} />}
      {Math.abs(value)}
      {suffix}
    </span>
  );
}

/* ===== SummaryCard ===== */

/**
 * A frase em linguagem natural, com os valores inline coloridos.
 *
 * Gerada por template determinístico a partir dos mesmos números que os cards
 * mostram — zero IA, constituição §2. O texto vem montado pela tela; este
 * componente só o veste. `<Val>` marca os números dentro da frase.
 */
export function SummaryCard({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4">
      {/* `first-letter:uppercase` e não capitalização no template: as orações da
          frase são montadas soltas e em qualquer ordem, então NENHUMA delas sabe
          se é a primeira. O CSS sabe. */}
      <p className="text-[13px] leading-[22px] text-[var(--text-secondary)] first-letter:uppercase">
        {children}
      </p>
    </section>
  );
}

/** Um valor destacado dentro de uma frase do SummaryCard. */
export function Val({
  children,
  tone = "sphere",
}: {
  children: ReactNode;
  tone?: "sphere" | "accent" | "success" | "warning" | "danger";
}) {
  return (
    <strong className="tabular font-semibold" style={{ color: TONE_VAR[tone] }}>
      {children}
    </strong>
  );
}

/* ===== GlassPanel ===== */

/**
 * O painel dos overlays.
 *
 * MÁXIMO UM VISÍVEL POR VEZ — ver a nota em `.nx-glass` (styles.css). O
 * backdrop-filter é o efeito mais caro do arsenal e é racionado por regra.
 */
export function GlassPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("nx-glass rounded-[var(--radius-lg)]", className)}>{children}</div>
  );
}

/* ===== CountUpValue ===== */

/**
 * Um número que conta até o seu valor na montagem.
 *
 * `decimals` existe porque interpolação produz 47.38271 no meio do caminho: sem
 * arredondar, o count-up de um inteiro vira uma roleta de 5 dígitos.
 */
export function CountUp({
  to,
  decimals = 0,
  prefix = "",
  suffix = "",
  durMs,
}: {
  to: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  durMs?: number;
}) {
  const v = useCountUp(to, durMs);
  return (
    <>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </>
  );
}
