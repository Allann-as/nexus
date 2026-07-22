/**
 * O controle do topo da Timeline: o modo (Ano | Mês), o ano (◀ 2026 ▶) e, no
 * modo Mês, o mês (◀ julho ▶).
 *
 * Puramente controlado: o estado mora na tela, e o Scrubber só desenha e avisa.
 * O alternador é o `SegToggle` do Cockpit — o mesmo trilho de pastilha do resto
 * do app, em vez de um par de pílulas que só esta tela conhecia.
 *
 * **O scrubber conhece as bordas da história** (`timelineYears`). Antes ele
 * deixava andar até 2099 e cada ano vazio respondia "nada aconteceu" como se
 * fosse um fato sobre a vida do usuário; agora a seta morre na borda, e a borda
 * é o primeiro ano com evento no ledger. A Timeline é global, então a cor ativa
 * é o `--accent` do NEXUS, não a de uma Esfera.
 */

import { CalendarDays, ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";

import { cx } from "../../design-system/primitives";
import { SegToggle } from "../../design-system/instruments";
import { monthNameLong } from "./dates";

export type TimelineMode = "month" | "year";

export function Scrubber({
  mode,
  year,
  month,
  years,
  onMode,
  onYear,
  onMonth,
}: {
  mode: TimelineMode;
  year: number;
  /** 1..12. */
  month: number;
  /** Os anos com evento no ledger, do mais antigo ao mais recente. */
  years: string[];
  onMode: (mode: TimelineMode) => void;
  onYear: (year: number) => void;
  onMonth: (month: number) => void;
}) {
  /* As bordas: o primeiro ano com história e o ano corrente. O futuro fica de
     fora porque o ledger é o passado — não há evento para ver em 2031, e uma
     seta que anda para lá só produz telas vazias. */
  const currentYear = new Date().getFullYear();
  const known = years.map(Number).filter(Number.isFinite);
  const first = known.length ? Math.min(...known) : currentYear;
  const last = Math.max(currentYear, ...(known.length ? known : [currentYear]));

  const canPrev = year > first;
  const canNext = year < last;

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
    if (y < first || y > last) return; // a mesma borda vale para a virada do mês
    if (y !== year) onYear(y);
    onMonth(m);
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SegToggle
        tone="phos"
        value={mode}
        onChange={onMode}
        options={[
          { value: "month" as TimelineMode, label: "Mês", icon: CalendarDays },
          { value: "year" as TimelineMode, label: "Ano", icon: LayoutGrid },
        ]}
      />

      <div className="flex items-center gap-2">
        {mode === "month" && (
          <Stepper
            label={monthNameLong(month)}
            capitalize
            minWidth={92}
            onPrev={() => stepMonth(-1)}
            onNext={() => stepMonth(1)}
            canPrev={year > first || month > 1}
            canNext={year < last || month < 12}
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
          canPrev={canPrev}
          canNext={canNext}
          prevLabel="Ano anterior"
          nextLabel="Próximo ano"
        />
      </div>
    </div>
  );
}

function Stepper({
  label,
  onPrev,
  onNext,
  canPrev,
  canNext,
  capitalize = false,
  tabular = false,
  minWidth,
  prevLabel,
  nextLabel,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  capitalize?: boolean;
  tabular?: boolean;
  minWidth: number;
  prevLabel: string;
  nextLabel: string;
}) {
  return (
    <div className="inline-flex h-8 items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1">
      <StepButton onClick={onPrev} label={prevLabel} disabled={!canPrev}>
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
      <StepButton onClick={onNext} label={nextLabel} disabled={!canNext}>
        <ChevronRight size={15} strokeWidth={2} />
      </StepButton>
    </div>
  );
}

function StepButton({
  onClick,
  label,
  disabled,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={disabled ? `${label} — não há história` : label}
      className={cx(
        "grid size-6 place-items-center rounded-full text-[var(--text-secondary)]",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease)]",
        disabled
          ? "cursor-default opacity-25"
          : "hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)] active:scale-[0.94]",
      )}
    >
      {children}
    </button>
  );
}
