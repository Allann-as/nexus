/**
 * Detalhe do hábito: heatmap anual, streaks e taxa por dia da semana.
 *
 * As correlações entre hábitos (a "IA sem IA") chegam no M4, com o bi_engine —
 * elas exigem 30+ dias de amostra para não serem ruído.
 */

import { useQuery } from "@tanstack/react-query";
import { X, Flame, Trophy } from "lucide-react";

import {
  getHabit,
  habitHeatmap,
  habitStreaks,
  habitWeekdayStats,
  toNexusError,
} from "../../lib/ipc";
import { cx } from "../../design-system/primitives";
import { Heatmap } from "./Heatmap";
import { describeSchedule } from "./HabitsScreen";

/** Abaixo disto, "a sexta é seu pior dia" é ruído, não padrão. */
const MIN_SAMPLE = 4;

export function HabitDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: habit, error } = useQuery({
    queryKey: ["habits", "one", id],
    queryFn: () => getHabit(id),
  });
  const { data: streaks } = useQuery({
    queryKey: ["habits", "streaks", id],
    queryFn: () => habitStreaks(id),
  });
  const { data: cells = [] } = useQuery({
    queryKey: ["habits", "heatmap", id],
    queryFn: () => habitHeatmap(id, 365),
  });
  const { data: weekdays = [] } = useQuery({
    queryKey: ["habits", "weekdays", id],
    queryFn: () => habitWeekdayStats(id, 180),
  });

  const worst = weekdays
    .filter((w) => w.total >= MIN_SAMPLE)
    .reduce<(typeof weekdays)[number] | null>(
      (acc, w) => (!acc || w.failureRate > acc.failureRate ? w : acc),
      null,
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={habit?.title ?? "Hábito"}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="max-h-full w-[720px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--bg-raised)] p-6"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
              {habit?.title ?? "…"}
            </h2>
            {habit && (
              <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
                {describeSchedule(habit.schedule)}
                {habit.targetValue != null &&
                  ` · meta ${habit.targetValue}${habit.unit ?? ""}`}
                {habit.reminderTime && ` · lembrete ${habit.reminderTime}`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <p className="mt-4 text-[13px] text-[var(--danger)]">
            {toNexusError(error).message}
          </p>
        )}

        <div className="mt-5 flex gap-3">
          <Stat
            icon={Flame}
            label="Sequência atual"
            value={streaks?.current ?? 0}
            accent={streaks?.isRecord}
          />
          <Stat icon={Trophy} label="Recorde" value={streaks?.record ?? 0} />
        </div>

        <section className="mt-6">
          <h3 className="mb-3 text-[11px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Último ano
          </h3>
          <Heatmap cells={cells} unit={habit?.unit} />
        </section>

        <section className="mt-6">
          <h3 className="mb-3 text-[11px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Por dia da semana
          </h3>

          {weekdays.length === 0 ? (
            <p className="text-[12px] text-[var(--text-tertiary)]">
              Sem registros ainda.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-2">
                {weekdays.map((w) => (
                  <div key={w.weekday} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex h-16 w-full items-end">
                      <div
                        className="w-full rounded-[3px] transition-[height] duration-[var(--dur-base)]"
                        style={{
                          height: `${Math.max((1 - w.failureRate) * 100, 3)}%`,
                          background:
                            w.total < MIN_SAMPLE
                              ? "var(--border-subtle)"
                              : w.failureRate > 0.5
                                ? "var(--danger)"
                                : "var(--success)",
                        }}
                        title={`${w.done}/${w.total} cumpridos`}
                      />
                    </div>
                    <span className="text-[10px] text-[var(--text-tertiary)]">
                      {w.label.slice(0, 3)}
                    </span>
                  </div>
                ))}
              </div>

              {/* Só afirma um padrão quando há amostra para tanto. Um insight
                  com n=2 é chute com cara de estatística. */}
              {worst && worst.failureRate > 0.4 ? (
                <p className="mt-3 text-[12px] text-[var(--text-secondary)]">
                  Seu pior dia é <strong>{worst.label}</strong>: você cumpre{" "}
                  {Math.round((1 - worst.failureRate) * 100)}% das vezes ({worst.done} de{" "}
                  {worst.total}).
                </p>
              ) : (
                <p className="mt-3 text-[12px] text-[var(--text-tertiary)]">
                  Ainda sem um padrão claro por dia da semana (amostra mínima:{" "}
                  {MIN_SAMPLE} registros por dia).
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Flame;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div
        className={cx(
          "flex items-center gap-1.5 text-[10px] tracking-[0.06em] uppercase",
          accent ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]",
        )}
      >
        <Icon size={11} />
        {label}
      </div>
      <div className="tabular mt-1 text-[20px] font-medium">{value}</div>
    </div>
  );
}
