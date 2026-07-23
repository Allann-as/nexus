/**
 * Os primitives base do Midnight. Deliberadamente poucos: toda tela compõe a
 * partir daqui, então a consistência é estrutural em vez de ser uma coisa a
 * lembrar.
 *
 * As receitas de card (HeroCard, StatCard, SummaryCard, GlassPanel) moram em
 * `cards.tsx`, e os gráficos em `charts.tsx`. Aqui ficam só as peças que toda
 * tela usa, inclusive as que não têm dado nenhum para mostrar.
 */

import type { ReactNode, ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

import { EmptyGlyph } from "./EmptyGlyph";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ===== Button ===== */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: LucideIcon;
};

const BUTTON_VARIANTS: Record<string, string> = {
  // O primário — redesenho definitivo do B1 (ADR-0067). O pill chapado morreu: a
  // profundidade de um app maduro vem de QUATRO coisas empilhadas, todas estáticas:
  //   1. gradiente vertical de 3 paradas — o TOPO clareia com um toque de branco
  //      (color-mix, não `--accent-hover`, que no tema claro é mais ESCURO e
  //      inverteria a luz), o miolo é o accent, a base afunda no accent-deep;
  //   2. uma borda de LUZ no topo por `inset 0 1px` branco — o fio que o olho lê
  //      como a quina iluminada de uma tecla;
  //   3. uma sombra curta PARA BAIXO (preto + halo da cor) — profundidade, não neon;
  //   4. gestos: hover ELEVA 1px e adensa a sombra; active AFUNDA (o press real).
  // A sombra entra na transição — é gesto do usuário, não loop (o que a §6 proíbe).
  primary:
    "text-white border border-[color-mix(in_srgb,var(--accent-deep)_65%,#000)] " +
    "bg-[linear-gradient(180deg,color-mix(in_srgb,var(--accent)_86%,#fff),var(--accent)_46%,var(--accent-deep))] " +
    "shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_24%,transparent),0_1px_2px_rgb(0_0_0/0.30),0_3px_10px_color-mix(in_srgb,var(--accent)_26%,transparent)] " +
    "hover:-translate-y-px hover:brightness-[1.04] " +
    "hover:shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_30%,transparent),0_3px_6px_rgb(0_0_0/0.32),0_7px_20px_color-mix(in_srgb,var(--accent)_34%,transparent)] " +
    "active:translate-y-px active:brightness-95",
  // Secundária/ghost/destrutiva na MESMA família: a luz no topo e a elevação no
  // hover repetem o gesto do primário, uma oitava abaixo.
  secondary:
    "bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-subtle)] " +
    "shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_6%,transparent),0_1px_2px_rgb(0_0_0/0.16)] " +
    "hover:-translate-y-px hover:bg-[var(--bg-hover)] hover:border-[var(--border-glow)] active:translate-y-px",
  ghost:
    "bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
  danger:
    "bg-transparent text-[var(--danger)] border border-[var(--border-subtle)] " +
    "hover:-translate-y-px hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] hover:border-[var(--danger)] active:translate-y-px",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium select-none",
        "transition-[background-color,border-color,color,transform,box-shadow,filter] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {Icon && <Icon size={size === "sm" ? 13 : 15} strokeWidth={2} />}
      {children}
    </button>
  );
}

/* ===== Card ===== */

export function Card({
  children,
  className,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  /** Liga a resposta de hover. Só para card que É clicável — elevar um card
   *  inerte promete uma ação que não existe. */
  hover?: boolean;
}) {
  // Elevação por borda + delta de fundo, nunca por sombra difusa. Sombra fica
  // reservada para o que flutua de verdade (palette, diálogos).
  return (
    <div
      className={cx(
        // `--panel-bg` translúcido (fase 9 §4): o card flutua sobre a poeira
        // estelar. Sem backdrop-filter por card — só alfa (ver o token).
        "rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--panel-bg)]",
        hover &&
          "transition-[transform,border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease)] hover:-translate-y-0.5 hover:border-[var(--border-glow)] hover:shadow-[var(--glow-accent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ===== Kbd ===== */

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] px-1.5 font-mono text-[10px] font-medium text-[var(--text-tertiary)]">
      {children}
    </kbd>
  );
}

/* ===== EmptyState ===== */

/**
 * Every module ships one of these. A blank screen is a dead end; an empty
 * state tells you what this place is for and how to start.
 *
 * A ilustração é o `EmptyGlyph`: um disco discreto na cor da Esfera com o ícone
 * do módulo dentro, e nada mais — o ícone já é contextual em cada chamada, então
 * a geometria não precisa dizer nada por cima dele. Cada tela passa a própria
 * frase e a própria ação primária: o "Nada por aqui ainda" genérico morre por
 * construção, porque não há default de texto para cair.
 */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <EmptyGlyph icon={Icon} />
      <div className="space-y-1">
        <h2 className="text-[15px] font-medium text-[var(--text-primary)]">{title}</h2>
        <p className="max-w-[340px] text-[13px] leading-[20px] text-[var(--text-tertiary)]">
          {hint}
        </p>
      </div>
      {action}
    </div>
  );
}

/* ===== PageContainer ===== */

/**
 * O container central de TODA página (M5.5 §3.1). Uma largura máxima e um padding
 * lateral únicos, para nenhuma tela inventar a própria margem — antes, Conquistas
 * e Insights colavam na borda do monitor enquanto o Hub respirava num container.
 * Agora a régua é uma só: `PageHeader` e o corpo de cada tela vestem esta classe,
 * e o conteúdo alinha da esquerda à direita em qualquer largura de janela.
 */
export const PAGE_CONTAINER = "mx-auto w-full max-w-[1360px] px-6 sm:px-8";

export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cx(PAGE_CONTAINER, className)}>{children}</div>;
}

/* ===== PageHeader ===== */

/**
 * O cabeçalho de página é uma BARRA de largura total (título + ações), com o
 * mesmo padding lateral do `PageContainer` (32px em sm+). O CONTEÚDO da página
 * vive num `PageContainer` central logo abaixo — a barra atravessa, a coluna de
 * dado é contida. É o par que resolve o "cada tela inventa sua margem" (M5.5
 * §3.1): antes, telas como Conquistas e Insights colavam os cards na borda por
 * não terem container nenhum.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 px-6 pt-9 pb-6 sm:px-8">
      <div>
        <h1 className="text-[26px] leading-[32px] font-semibold tracking-[-0.03em] text-[var(--text-primary)]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[13px] text-[var(--text-tertiary)]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 pt-1">{actions}</div>}
    </header>
  );
}
