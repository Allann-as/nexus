/**
 * As estatísticas de estudo (M4.6, item 7): horas na semana com tendência,
 * constância e melhores horários. Determinísticas, com "ⓘ como calculamos" —
 * o padrão dos insights (constituição §2). O front nunca recalcula: mostra o que
 * o Rust já somou, e a fórmula vem pronta do backend.
 *
 * Omitido inteiro quando não há uma sessão sequer — sem dado, nada de zeros
 * inventados (a mesma regra dos micro-indicadores, ADR-0044).
 */

import { CalendarClock, Flame, Sunrise } from "lucide-react";

import { StatTile } from "../../design-system/cards";
import { Formula } from "../../design-system/Formula";
import { MonoLabel } from "../../design-system/instruments";
import type { StudyStats } from "../../lib/ipc";
import { toHours, hourLabel, formatMinutes } from "./studyFormat";

/** A janela da constância — os mesmos 30 dias que o backend conta. */
const JANELA_CONSTANCIA = 30;

export function StudyStatsPanel({ stats }: { stats: StudyStats }) {
  const weekH = toHours(stats.minutesLast7);
  const prevH = toHours(stats.minutesPrev7);
  const deltaH = Math.round((weekH - prevH) * 10) / 10;
  const best = stats.bestHours;

  // Um EMPATE não é uma resposta: quando duas horas somam o mesmo, mostramos as
  // duas em vez de eleger uma pela ordem de varredura — que é o que o `max_by_key`
  // do backend fazia calado (ADR-0105). Até três cabem no rótulo; acima disso, a
  // contagem, senão a célula estoura.
  const bestValue =
    best.length === 0
      ? "—"
      : best.length <= 3
        ? best.map(hourLabel).join(" · ")
        : `${best.length} horas`;
  const bestHint =
    best.length === 0
      ? undefined
      : best.length === 1
        ? `${formatMinutes(stats.bestHourMinutes)} acumulados`
        : `empatadas em ${formatMinutes(stats.bestHourMinutes)} cada`;
  const bestSet = new Set(best);

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/*
         * Só a constância ganha medidor, e por um motivo: ela é a ÚNICA das três
         * que tem denominador. "Dias ativos em 30" é uma fração de verdade; horas
         * na semana não têm teto (quantas horas seriam 100%?) e um horário do dia
         * não é quantidade nenhuma. Barra sem denominador é enfeite (ADR-0088).
         */}
        <StatTile
          icon={CalendarClock}
          label="Nesta semana"
          value={weekH}
          unit="h"
          // A tendência só aparece quando houve semana anterior para comparar.
          delta={stats.minutesPrev7 > 0 ? { value: deltaH, suffix: "h" } : undefined}
          hint={stats.minutesPrev7 > 0 ? `${prevH} h na semana anterior` : undefined}
        />
        <StatTile
          icon={Flame}
          label="Constância (30d)"
          value={stats.activeDays30}
          unit={`de ${JANELA_CONSTANCIA} dias`}
          tone="accent"
          seg={stats.activeDays30 / JANELA_CONSTANCIA}
        />
        <StatTile
          icon={Sunrise}
          label={best.length > 1 ? "Melhores horários" : "Melhor horário"}
          value={bestValue}
          hint={bestHint}
          tone="success"
        />
      </div>

      {stats.byHour.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <MonoLabel>Quando você estuda</MonoLabel>
            {best.length > 0 && (
              <span className="text-[11px] text-[var(--text-tertiary)]">
                {best.length > 1 ? "pico empatado às" : "pico às"}{" "}
                <span className="font-semibold text-[var(--sphere)]">
                  {best.length <= 3 ? best.map(hourLabel).join(" · ") : `${best.length} horas`}
                </span>{" "}
                · {formatMinutes(stats.bestHourMinutes)}
              </span>
            )}
          </div>
          <HourChart stats={stats} bestSet={bestSet} />
          <Formula>{stats.formula}</Formula>
        </div>
      )}
    </section>
  );
}

/** Um gráfico de barras por hora do dia (0–23). SVG puro — é o Hub/Esfera. */
function HourChart({ stats, bestSet }: { stats: StudyStats; bestSet: Set<number> }) {
  const byHour = new Map(stats.byHour.map((b) => [b.hour, b.minutes]));
  const max = Math.max(1, ...stats.byHour.map((b) => b.minutes));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: 72 }}>
        {hours.map((h) => {
          const mins = byHour.get(h) ?? 0;
          const pct = mins / max;
          // Todas as horas do topo acendem — destacar uma de um empate seria a
          // mesma afirmação sem lastro do card, desenhada.
          const isBest = bestSet.has(h) && mins > 0;
          return (
            <div
              key={h}
              className="group relative flex-1"
              style={{ height: "100%" }}
              title={`${hourLabel(h)}: ${formatMinutes(mins)}`}
            >
              <div className="absolute inset-x-0 bottom-0 flex flex-col justify-end" style={{ height: "100%" }}>
                <div
                  className="w-full rounded-[2px] transition-[height] duration-[var(--dur-base)]"
                  style={{
                    height: `${Math.max(pct * 100, mins > 0 ? 6 : 0)}%`,
                    background: isBest
                      ? "var(--sphere)"
                      : mins > 0
                        ? "color-mix(in srgb, var(--sphere) 42%, transparent)"
                        : "color-mix(in srgb, var(--text-tertiary) 12%, transparent)",
                    minHeight: mins > 0 ? 3 : 2,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {/* Eixo esparso: 0h, 6h, 12h, 18h, 23h — sem poluir com 24 rótulos. */}
      <div className="mt-1.5 flex justify-between text-[9px] tabular text-[var(--text-tertiary)]">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
    </div>
  );
}
