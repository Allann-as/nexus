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
  listAreas,
  toNexusError,
} from "../../lib/ipc";
import { CountUp, StatCard } from "../../design-system/cards";
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

  // Um hábito pertence a uma Esfera, e este diálogo é sobre UM hábito: dá para
  // tingir tudo aqui dentro com uma variável só. Mesma query (e mesmo cache)
  // que a lista de hábitos já usa.
  const { data: areas = [] } = useQuery({ queryKey: ["areas"], queryFn: () => listAreas(false) });
  const sphere = areas.find((a) => a.id === habit?.areaId)?.color;

  const worst = weekdays
    .filter((w) => w.total >= MIN_SAMPLE)
    .reduce<(typeof weekdays)[number] | null>(
      (acc, w) => (!acc || w.failureRate > acc.failureRate ? w : acc),
      null,
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--bg-void)_72%,transparent)] p-8"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={habit?.title ?? "Hábito"}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="max-h-full w-[720px] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--bg-raised)] p-6"
        // Uma variável, e o diálogo inteiro se tinge: os StatCards, o heatmap,
        // as barras. Nenhum deles sabe que Esferas existem.
        style={
          {
            boxShadow: "var(--shadow-float)",
            ...(sphere ? { "--sphere": sphere } : {}),
          } as React.CSSProperties
        }
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

        <div className="mt-5 grid grid-cols-2 gap-3">
          <StatCard
            icon={Flame}
            label="Sequência atual"
            value={<CountUp to={streaks?.current ?? 0} />}
            unit="dias"
            tone={streaks?.isRecord ? "warning" : "sphere"}
          />
          <StatCard
            icon={Trophy}
            label="Recorde"
            value={<CountUp to={streaks?.record ?? 0} />}
            unit="dias"
            tone="sphere"
          />
        </div>

        <section className="mt-6">
          <h3 className="mb-3 text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
            Último ano
          </h3>
          <Heatmap cells={cells} unit={habit?.unit} />
        </section>

        <section className="mt-6">
          <h3 className="mb-3 text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
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
                      {/* A barra tem altura cheia e é ESCALADA em Y, em vez de
                          ter a altura animada: `height` refaz layout a cada
                          frame; `transform` o compositor resolve sozinho. */}
                      <div
                        className="h-full w-full origin-bottom rounded-[3px] transition-transform duration-[var(--dur-base)] ease-[var(--ease)]"
                        style={{
                          transform: `scaleY(${Math.max(1 - w.failureRate, 0.03)})`,
                          background:
                            w.total < MIN_SAMPLE
                              ? "var(--border-subtle)"
                              : w.failureRate > 0.5
                                ? "var(--danger)"
                                : "var(--sphere)",
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
