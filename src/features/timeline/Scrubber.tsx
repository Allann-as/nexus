/**
 * O controle do topo da Timeline: o modo (Ano | Mês), o ano (◀ 2026 ▶) e, no
 * modo Mês, o mês (◀ julho ▶).
 *
 * Puramente controlado: o estado mora na tela, e o Scrubber só desenha e avisa.
 * As pílulas seguem o estilo das tabs da Esfera — mas a Timeline é global, então
 * a cor ativa é o `--accent` do NEXUS, não a cor de uma Esfera.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

import { cx } from "../../design-system/primitives";
import { monthNameLong } from "./dates";

export type TimelineMode = "month" | "year";

export function Scrubber({
  mode,
  year,
  month,
  onMode,
  onYear,
  onMonth,
}: {
  mode: TimelineMode;
  year: number;
  /** 1..12. */
  month: number;
  onMode: (mode: TimelineMode) => void;
  onYear: (year: number) => void;
  onMonth: (month: number) => void;
}) {
  /** Anda um mês, virando o ano quando cruza a fronteira de dezembro/janeiro. */
  const stepMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    if (y !== year) onYear(y);
    onMonth(m);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1">
        <ModePill active={mode === "year"} onClick={() => onMode("year")}>
          Ano
        </ModePill>
        <ModePill active={mode === "month"} onClick={() => onMode("month")}>
          Mês
        </ModePill>
      </div>

      <div className="flex items-center gap-2">
        {mode === "month" && (
          <Stepper
            label={monthNameLong(month)}
            capitalize
            minWidth={92}
            onPrev={() => stepMonth(-1)}
            onNext={() => stepMonth(1)}
            prevLabel="Mês anterior"
            nextLabel="Próximo mês"
          />
        )}
        <Stepper
          label={String(year)}
          tabular
          minWidth={56}
          onPrev={() => onYear(year - 1)}
          onNext={() => onYear(year + 1)}
          prevLabel="Ano anterior"
          nextLabel="Próximo ano"
        />
      </div>
    </div>
  );
}

function ModePill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "h-7 rounded-full px-3.5 text-[12.5px] font-medium",
        "transition-[background-color,color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "border",
        active
          ? "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
      )}
    >
      {children}
    </button>
  );
}

function Stepper({
  label,
  onPrev,
  onNext,
  capitalize = false,
  tabular = false,
  minWidth,
  prevLabel,
  nextLabel,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  capitalize?: boolean;
  tabular?: boolean;
  minWidth: number;
  prevLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="inline-flex h-8 items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1">
      <StepButton onClick={onPrev} label={prevLabel}>
        <ChevronLeft size={15} strokeWidth={2} />
      </StepButton>
      <span
        className={cx(
          "text-center text-[12.5px] font-medium text-[var(--text-primary)]",
          capitalize && "capitalize",
          tabular && "tabular",
        )}
        style={{ minWidth }}
      >
        {label}
      </span>
      <StepButton onClick={onNext} label={nextLabel}>
        <ChevronRight size={15} strokeWidth={2} />
      </StepButton>
    </div>
  );
}

function StepButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cx(
        "grid size-6 place-items-center rounded-full text-[var(--text-secondary)]",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease)]",
        "hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] active:scale-[0.94]",
      )}
    >
      {children}
    </button>
  );
}
