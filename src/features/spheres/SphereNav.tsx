/**
 * A navegação interna de uma Esfera — o padrão ÚNICO que substituiu as tabs pill
 * genéricas (ADR-0044). Uma seção = ícone + rótulo + micro-indicador de estado.
 *
 * É um `tablist` de verdade: roving tabindex, setas/Home/End movem e ATIVAM (o
 * conteúdo troca junto), e 1–9 saltam direto. A cor ativa vem da Esfera (`--sphere`),
 * a mesma variável que tinge a página inteira — o componente não sabe qual Esfera é.
 */

import { useRef } from "react";

import { cx } from "../../design-system/primitives";
import type { IndicatorView, SphereSection } from "./sections";

export function SphereNav({
  sections,
  active,
  indicators,
  onSelect,
}: {
  sections: SphereSection[];
  active: string;
  indicators: Record<string, IndicatorView | null>;
  onSelect: (key: string) => void;
}) {
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(
    0,
    sections.findIndex((s) => s.key === active),
  );

  const move = (to: number) => {
    const i = (to + sections.length) % sections.length;
    onSelect(sections[i].key);
    btns.current[i]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(activeIndex + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(activeIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(sections.length - 1);
    } else if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (i < sections.length) {
        e.preventDefault();
        move(i);
      }
    }
  };

  return (
    <nav
      role="tablist"
      aria-label="Seções da Esfera"
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-1.5"
    >
      {sections.map((section, i) => {
        const on = section.key === active;
        const ind = indicators[section.key] ?? null;
        return (
          <button
            key={section.key}
            ref={(el) => {
              btns.current[i] = el;
            }}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(section.key)}
            className={cx(
              "group flex h-9 items-center gap-2 rounded-full border pr-2.5 pl-3 text-[12.5px] font-medium",
              "transition-[background-color,color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
              "outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--sphere)_45%,transparent)]",
              on
                ? "border-[color-mix(in_srgb,var(--sphere)_40%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] text-[var(--text-primary)]"
                : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
            )}
          >
            <section.icon
              size={15}
              strokeWidth={1.9}
              className={cx(
                "shrink-0 transition-colors",
                on ? "text-[var(--sphere)]" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]",
              )}
            />
            <span>{section.label}</span>
            {ind && <IndicatorBadge view={ind} />}
          </button>
        );
      })}
    </nav>
  );
}

function IndicatorBadge({ view }: { view: IndicatorView }) {
  const tone =
    view.tone === "good"
      ? "border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_16%,transparent)] text-[var(--sphere)]"
      : view.tone === "pending"
        ? "border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning)]"
        : "border-[var(--border-subtle)] bg-[var(--bg-raised)] text-[var(--text-tertiary)]";
  return (
    <span
      aria-hidden
      className={cx(
        "flex h-5 items-center gap-1 rounded-full border px-1.5 font-mono text-[10.5px] tabular-nums",
        tone,
      )}
    >
      {view.icon && <view.icon size={10} strokeWidth={2.2} />}
      {view.text}
    </span>
  );
}
