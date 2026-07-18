/**
 * As estatísticas de foco (M5): minutos na semana com tendência, constância e as
 * melhores horas de foco. Determinísticas, com "ⓘ como calculamos" — o padrão dos
 * insights (constituição §2). O front nunca recalcula: mostra o que o Rust somou.
 *
 * Omitido inteiro quando não há um bloco sequer — sem dado, nada de zeros
 * inventados (ADR-0044/0052).
 */

import { CalendarClock, Flame, Sunrise } from "lucide-react";

import { StatCard } from "../../design-system/cards";
import { Formula } from "../../design-system/Formula";
import type { FocusStats } from "../../lib/ipc";
import { toHours, hourLabel, formatMinutes } from "../studies/studyFormat";

export function FocusStatsPanel({ stats }: { stats: FocusStats }) {
  const weekH = toHours(stats.minutesLast7);
  const prevH = toHours(stats.minutesPrev7);
  const deltaH = Math.round((weekH - prevH) * 10) / 10;

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={CalendarClock}
          label="Nesta semana"
          value={weekH}
          unit="h"
          delta={stats.minutesPrev7 > 0 ? { value: deltaH, suffix: "h" } : undefined}
        />
        <StatCard
          icon={Flame}
          label="Constância (30d)"
          value={stats.activeDays30}
          unit="dias"
          tone="accent"
        />
        <StatCard
          icon={Sunrise}
          label="Melhor hora de foco"
          value={stats.bestHour != null ? hourLabel(stats.bestHour) : "—"}
          tone="success"
        />
      </div>

      {stats.byHour.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
              Quando você foca
            </h3>
            {stats.bestHour != null && (
              <span className="text-[11px] text-[var(--text-tertiary)]">
                pico às{" "}
                <span className="font-semibold text-[var(--sphere)]">
                  {hourLabel(stats.bestHour)}
                </span>{" "}
                · {formatMinutes(stats.bestHourMinutes)}
              </span>
            )}
          </div>
          <HourChart stats={stats} />
          <Formula>{stats.formula}</Formula>
        </div>
      )}
    </section>
  );
}

/** Um gráfico de barras por hora do dia (0–23). SVG puro — é o Hub/Esfera. */
function HourChart({ stats }: { stats: FocusStats }) {
  const byHour = new Map(stats.byHour.map((b) => [b.hour, b.minutes]));
  const max = Math.max(1, ...stats.byHour.map((b) => b.minutes));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: 72 }}>
        {hours.map((h) => {
          const mins = byHour.get(h) ?? 0;
          const pct = mins / max;
          const isBest = h === stats.bestHour && mins > 0;
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
