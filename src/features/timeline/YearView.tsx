/**
 * A visão ANO: os 12 meses de um ano numa grade, cada um com seu medidor de
 * atividade e seu total contando na entrada.
 *
 * Os números vêm de `timelineYear`, que devolve UM resumo por mês COM dado — a
 * lista é esparsa de propósito (um mês sem eventos não existe no ledger). A
 * grade preenche os buracos com células apagadas, para o ano ter sempre 12
 * lugares.
 *
 * **A conquista voltou a ser conquista.** Até a v1.2 esta tela punha um troféu
 * dourado sobre `completed` e escrevia "conquistas" — mas `completed` conta toda
 * tarefa, sub-desafio, meta e livro fechados. Um mês de 40 tarefas anunciava "40
 * conquistas" enquanto a galeria mostrava duas. O rollup passou a contar
 * `achievement_unlocked` numa métrica própria (ADR-0104); "concluídos" perdeu o
 * troféu e ficou com o que sempre foi.
 *
 * Clicar num mês abre a visão MÊS dele (`onPickMonth`).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, History, Trophy } from "lucide-react";

import { EmptyState } from "../../design-system/primitives";
import { CountUp } from "../../design-system/cards";
import { cx } from "../../design-system/primitives";
import { SegBar } from "../../design-system/instruments";
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
  const totalDone = cells.reduce((s, c) => s + (c.rollup?.completed ?? 0), 0);
  const totalAchievements = cells.reduce((s, c) => s + (c.rollup?.achievements ?? 0), 0);

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className="h-[128px] animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
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
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular text-[28px] leading-[30px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">
          <CountUp to={totalEvents} />
        </span>
        <span className="text-[13px] text-[var(--text-secondary)]">eventos em {year}</span>

        {totalDone > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-[var(--success)]">
            <CheckCircle2 size={12} strokeWidth={2} />
            <span className="tabular font-medium">{totalDone}</span> concluídos
          </span>
        )}
        {totalAchievements > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-[var(--warning)]">
            <Trophy size={12} strokeWidth={2} />
            <span className="tabular font-medium">{totalAchievements}</span>{" "}
            {totalAchievements === 1 ? "conquista" : "conquistas"}
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

      <p className="text-[11px] text-[var(--text-tertiary)]">
        O medidor de cada mês é o volume dele contra o mês mais cheio de {year} (
        <span className="tabular">{maxEvents}</span> eventos) — a escala é do ano, não
        absoluta.
      </p>
    </div>
  );
}

/** "42 checks · 3 concluídos", pulando o que é zero. Vazio quando não há nada. */
function breakdown(checked: number, completed: number): string {
  const parts: string[] = [];
  if (checked > 0) parts.push(`${checked} ${checked === 1 ? "check" : "checks"}`);
  if (completed > 0) {
    parts.push(`${completed} ${completed === 1 ? "concluído" : "concluídos"}`);
  }
  return parts.join(" · ");
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
  const achievements = cell.rollup?.achievements ?? 0;
  const empty = events === 0;
  const detail = breakdown(checked, completed);

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
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-[var(--text-secondary)] capitalize">
          {monthNameLong(cell.month1)}
        </span>
        {/* O troféu só aparece onde HÁ conquista — e agora ele conta a conquista,
            não a tarefa fechada. */}
        {achievements > 0 && (
          <span className="inline-flex items-center gap-1 text-[var(--warning)]">
            <Trophy size={12} strokeWidth={2} />
            <span className="tabular text-[11px] font-semibold">{achievements}</span>
          </span>
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

      {/* O medidor do Cockpit no lugar do retângulo: o volume do mês contra o mês
          mais cheio do ano. A escala é COMPARTILHADA e está escrita sob a grade —
          sem o denominador declarado, 12 segmentos acesos não querem dizer nada. */}
      <SegBar
        value={events / maxEvents}
        segments={12}
        height={7}
        gap={2}
        color="var(--accent)"
        className="mt-3"
        animate={false}
      />

      {/* A quebra só cita o que ACONTECEU, e só existe quando há o que citar.
          Escrever "0 checks" num mês sem hábito marcado é uma negativa que o
          número grande acima já não afirmava; e um texto de preenchimento
          ("registros do mês") no lugar dela seria enfeite ocupando a linha do
          dado. Mês vazio é o único que ganha uma frase, porque aí a frase É o
          dado. */}
      {(empty || detail) && (
        <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
          {empty ? "sem atividade" : detail}
        </p>
      )}
    </button>
  );
}
