/**
 * A visão ANO: os 12 meses de um ano numa grade, cada um com sua barra de
 * atividade e seu total contando na entrada.
 *
 * Os números vêm de `timelineYear`, que devolve UM resumo por mês COM dado — a
 * lista é esparsa de propósito (um mês sem eventos não existe no ledger). A grade
 * preenche os buracos com células apagadas, para o ano ter sempre 12 lugares.
 *
 * Clicar num mês abre a visão MÊS dele (`onPickMonth`).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Trophy } from "lucide-react";

import { EmptyState } from "../../design-system/primitives";
import { CountUp } from "../../design-system/cards";
import { cx } from "../../design-system/primitives";
import { timelineYear, type MonthRollup } from "../../lib/ipc";
import { monthKey, monthNameLong } from "./dates";

interface Cell {
  month1: number;
  key: string;
  rollup: MonthRollup | null;
}

export function YearView({
  year,
  onPickMonth,
}: {
  /** 'YYYY'. */
  year: string;
  onPickMonth: (month: string) => void;
}) {
  const q = useQuery({
    queryKey: ["timeline", "year", year],
    queryFn: () => timelineYear(year),
  });

  const cells = useMemo<Cell[]>(() => {
    const byMonth = new Map<string, MonthRollup>();
    for (const r of q.data ?? []) byMonth.set(r.month, r);
    return Array.from({ length: 12 }, (_, i) => {
      const month1 = i + 1;
      const key = monthKey(Number(year), month1);
      return { month1, key, rollup: byMonth.get(key) ?? null };
    });
  }, [q.data, year]);

  const maxEvents = Math.max(1, ...cells.map((c) => c.rollup?.events ?? 0));
  const totalEvents = cells.reduce((s, c) => s + (c.rollup?.events ?? 0), 0);
  const totalCompleted = cells.reduce((s, c) => s + (c.rollup?.completed ?? 0), 0);

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="h-[112px] animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
          />
        ))}
      </div>
    );
  }

  if (totalEvents === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-10">
        <EmptyState
          icon={History}
          title={`Nada aconteceu em ${year}`}
          hint="Nenhum evento neste ano. Escolha outro ano na barra acima, ou volte ao mês atual."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tabular text-[28px] leading-[30px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">
          <CountUp to={totalEvents} />
        </span>
        <span className="text-[13px] text-[var(--text-secondary)]">
          eventos em {year}
        </span>
        {totalCompleted > 0 && (
          <span className="ml-1 inline-flex items-center gap-1 text-[12px] text-[var(--warning)]">
            <Trophy size={12} strokeWidth={2} />
            <span className="tabular font-medium">{totalCompleted}</span> conquistas
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {cells.map((cell) => (
          <MonthCell
            key={cell.key}
            cell={cell}
            maxEvents={maxEvents}
            onPick={() => onPickMonth(cell.key)}
          />
        ))}
      </div>
    </div>
  );
}

function MonthCell({
  cell,
  maxEvents,
  onPick,
}: {
  cell: Cell;
  maxEvents: number;
  onPick: () => void;
}) {
  const events = cell.rollup?.events ?? 0;
  const completed = cell.rollup?.completed ?? 0;
  const checked = cell.rollup?.checked ?? 0;
  const empty = events === 0;

  const eventsPct = (events / maxEvents) * 100;
  const completedPct = (completed / maxEvents) * 100;

  return (
    <button
      onClick={onPick}
      className={cx(
        "group flex flex-col rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 text-left",
        "transition-[transform,border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "hover:-translate-y-0.5 hover:border-[var(--border-glow)] hover:shadow-[var(--glow-accent)]",
        empty && "opacity-60 hover:opacity-100",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-[var(--text-secondary)] capitalize">
          {monthNameLong(cell.month1)}
        </span>
        {completed > 0 && (
          <Trophy size={13} strokeWidth={2} className="text-[var(--warning)]" />
        )}
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <span className="tabular text-[26px] leading-[28px] font-bold tracking-[-0.02em] text-[var(--text-primary)]">
          {empty ? "—" : <CountUp to={events} />}
        </span>
        {!empty && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {events === 1 ? "evento" : "eventos"}
          </span>
        )}
      </div>

      {/* A barra de atividade: o volume do mês vs. o mês mais cheio do ano, com
          a fração de conquistas em dourado por cima. SVG puro, sem lib. */}
      <svg
        viewBox="0 0 100 6"
        width="100%"
        height="6"
        preserveAspectRatio="none"
        className="mt-3"
        aria-hidden
      >
        <rect x={0} y={0} width={100} height={6} rx={3} fill="var(--bg-base)" />
        {events > 0 && (
          <rect
            x={0}
            y={0}
            width={Math.max(3, eventsPct)}
            height={6}
            rx={3}
            fill="var(--accent)"
            opacity={0.85}
          />
        )}
        {completed > 0 && (
          <rect
            x={0}
            y={0}
            width={Math.max(3, completedPct)}
            height={6}
            rx={3}
            fill="var(--warning)"
          />
        )}
      </svg>

      <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
        {empty
          ? "sem atividade"
          : checked > 0
            ? `${checked} ${checked === 1 ? "check" : "checks"}`
            : `${completed} ${completed === 1 ? "conquista" : "conquistas"}`}
      </p>
    </button>
  );
}
