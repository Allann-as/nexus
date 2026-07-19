/**
 * Semana Perfeita (ARSENAL) — o calendário anual das semanas em que 100% do
 * agendado foi cumprido, a sequência atual e o recorde.
 *
 * Tudo DERIVADO das séries de hábito (nada gravado): desmarcar um tick pode
 * desfazer uma semana perfeita, e é assim que tem que ser. Uma semana perfeita é
 * exigente por definição — sem abono: pular não conta como cumprir.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarHeart, ChevronLeft, ChevronRight, Flame, Trophy } from "lucide-react";

import { perfectWeekView, type PerfectWeekCell, type PerfectWeekStatus } from "../../lib/ipc";
import { PageHeader, PAGE_CONTAINER, Card, EmptyState, cx } from "../../design-system/primitives";
import { StatCard } from "../../design-system/cards";
import { Formula } from "../../design-system/Formula";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function PerfectWeeksScreen() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const view = useQuery({
    queryKey: ["perfect-weeks", year],
    queryFn: () => perfectWeekView(year),
  });
  const data = view.data;
  const hasData = !!data && data.weeks.length > 0;

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Semana Perfeita"
        subtitle="As semanas em que você cumpriu 100% do que estava agendado — sem abono"
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setYear((y) => y - 1)}
              aria-label="Ano anterior"
              className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-glow)] hover:text-[var(--text-primary)]"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="tabular w-14 text-center text-[14px] font-semibold text-[var(--text-primary)]">
              {year}
            </span>
            <button
              onClick={() => setYear((y) => Math.min(currentYear, y + 1))}
              disabled={year >= currentYear}
              aria-label="Próximo ano"
              className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-glow)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      <div className={cx(PAGE_CONTAINER, "flex flex-col gap-4 pb-10")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={Flame}
            label="Sequência atual"
            value={data?.streak.current ?? 0}
            unit="semanas"
            tone="success"
          />
          <StatCard
            icon={Trophy}
            label="Recorde"
            value={data?.streak.record ?? 0}
            unit="semanas"
            tone="accent"
          />
          <StatCard
            icon={CalendarHeart}
            label={`Perfeitas em ${year}`}
            value={data?.totalYear ?? 0}
            unit="semanas"
            tone="sphere"
          />
        </div>

        {!hasData ? (
          <Card className="p-0">
            <EmptyState
              icon={CalendarHeart}
              title={`Nenhuma semana completa em ${year}`}
              hint="Uma semana perfeita é aquela em que todo hábito agendado foi cumprido, de segunda a domingo. Marque seus hábitos e as semanas perfeitas aparecem aqui — a régua é exigente de propósito."
            />
          </Card>
        ) : (
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                O ano em semanas
              </h2>
              <Legend />
            </div>
            <WeekCalendar weeks={data!.weeks} />
            <Formula>
              Semana perfeita = toda ocorrência agendada (Daily/Weekdays por dia,
              "N x/semana" pela cota) cumprida com "done" entre segunda e domingo.
              Pular NÃO abona. Só semanas encerradas entram; a corrente fica de fora
              até terminar.
            </Formula>
          </Card>
        )}
      </div>
    </div>
  );
}

function WeekCalendar({ weeks }: { weeks: PerfectWeekCell[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {weeks.map((w) => (
        <WeekPip key={w.weekStart} cell={w} />
      ))}
    </div>
  );
}

function WeekPip({ cell }: { cell: PerfectWeekCell }) {
  const label = statusLabel(cell.status);
  const [, m, d] = cell.weekStart.split("-");
  const nice = `Semana de ${d}/${MONTHS[Number(m) - 1]} — ${label}`;
  return (
    <span
      title={nice}
      aria-label={nice}
      className={cx(
        "size-5 rounded-[5px] transition-transform hover:scale-110",
        cell.status === "perfect" &&
          "bg-[var(--success)] shadow-[0_0_8px_color-mix(in_srgb,var(--success)_55%,transparent)]",
        cell.status === "broken" &&
          "bg-[color-mix(in_srgb,var(--text-tertiary)_22%,transparent)]",
        cell.status === "empty" && "border border-dashed border-[var(--border-subtle)]",
      )}
    />
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-[4px] bg-[var(--success)]" />
        Perfeita
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-[4px] bg-[color-mix(in_srgb,var(--text-tertiary)_22%,transparent)]" />
        Faltou algo
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-[4px] border border-dashed border-[var(--border-subtle)]" />
        Sem hábito
      </span>
    </div>
  );
}

function statusLabel(s: PerfectWeekStatus): string {
  switch (s) {
    case "perfect":
      return "perfeita";
    case "broken":
      return "faltou algo";
    default:
      return "sem hábito agendado";
  }
}
