/**
 * As estatísticas de foco (M5): minutos na semana com tendência, constância e as
 * melhores horas de foco. Determinísticas, com "ⓘ como calculamos" — o padrão dos
 * insights (constituição §2). O front nunca recalcula: mostra o que o Rust somou.
 *
 * Omitido inteiro quando não há um bloco sequer — sem dado, nada de zeros
 * inventados (ADR-0044/0052).
 *
 * No idioma COCKPIT (v1.3): a constância vira medidor porque TEM denominador (30
 * dias); os minutos da semana e a melhor hora **não** viram medidor, porque não
 * têm — uma barra sem escala é enfeite com cara de instrumento (ADR-0088).
 */

import { CalendarClock, Flame, Sunrise } from "lucide-react";

import { Formula } from "../../design-system/Formula";
import { MonoLabel, SegBar, Terminal } from "../../design-system/instruments";
import { cx } from "../../design-system/primitives";
import type { FocusStats } from "../../lib/ipc";
import { toHours, hourLabel, formatMinutes } from "../studies/studyFormat";

export function FocusStatsPanel({ stats }: { stats: FocusStats }) {
  const weekH = toHours(stats.minutesLast7);
  const prevH = toHours(stats.minutesPrev7);
  const deltaH = Math.round((weekH - prevH) * 10) / 10;
  const best = stats.bestHours;

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Terminal title="Nesta semana" icon={CalendarClock} tone="phos">
          <div className="flex items-baseline gap-1.5">
            <span className="tabular text-[30px] leading-[32px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">
              {weekH.toLocaleString("pt-BR")}
            </span>
            <span className="text-[13px] text-[var(--text-tertiary)]">h</span>
          </div>
          {/* A comparação só existe se houve semana anterior. Sem base, "+4,5h"
              seria uma tendência medida contra nada. */}
          <p className="mt-1.5 text-[11.5px] text-[var(--text-tertiary)]">
            {stats.minutesPrev7 > 0 ? (
              <>
                <span
                  className={cx(
                    "tabular font-semibold",
                    deltaH > 0 && "text-[var(--success)]",
                    deltaH < 0 && "text-[var(--danger)]",
                  )}
                >
                  {deltaH > 0 ? "+" : ""}
                  {deltaH.toLocaleString("pt-BR")} h
                </span>{" "}
                vs. os 7 dias anteriores
              </>
            ) : (
              "primeira semana com foco registrado"
            )}
          </p>
        </Terminal>

        <Terminal title="Constância" icon={Flame} tone="amber">
          <div className="flex items-baseline gap-1.5">
            <span className="tabular text-[30px] leading-[32px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">
              {stats.activeDays30}
            </span>
            <span className="text-[13px] text-[var(--text-tertiary)]">de 30 dias</span>
          </div>
          {/* Aqui cabe medidor: a fração tem denominador fechado (ADR-0088). */}
          <SegBar
            value={stats.activeDays30 / 30}
            segments={30}
            height={8}
            gap={1}
            color="var(--warning)"
            className="mt-2.5"
          />
          <p className="mt-1.5 text-[11.5px] text-[var(--text-tertiary)]">
            dias distintos com ao menos um bloco
          </p>
        </Terminal>

        {/* Um EMPATE não é uma resposta. Quando duas horas somam o mesmo, a
            tela mostra as duas em vez de eleger uma pela ordem da varredura —
            que é o que o `max_by_key` do backend fazia em silêncio (ADR-0105).
            Blocos de 15/25/50 min empatam com facilidade. */}
        <Terminal
          title={best.length > 1 ? "Melhores horas" : "Melhor hora"}
          icon={Sunrise}
          tone="success"
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="tabular text-[30px] leading-[32px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">
              {best.length === 0
                ? "—"
                : best.length <= 3
                  ? best.map(hourLabel).join(" · ")
                  : `${best.length} horas`}
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] text-[var(--text-tertiary)]">
            {best.length === 0
              ? "sem blocos suficientes para apontar uma hora"
              : best.length === 1
                ? `${formatMinutes(stats.bestHourMinutes)} acumulados nesta hora`
                : `empatadas em ${formatMinutes(stats.bestHourMinutes)} cada`}
          </p>
        </Terminal>
      </div>

      {stats.byHour.length > 0 && (
        <Terminal
          title="Quando você foca"
          icon={Sunrise}
          tone="phos"
          right={
            <span className="text-[11px] text-[var(--text-tertiary)]">
              <span className="tabular">{stats.totalSessions}</span>{" "}
              {stats.totalSessions === 1 ? "bloco" : "blocos"} ·{" "}
              {formatMinutes(stats.totalMinutes)} de sempre
            </span>
          }
          bodyClassName="p-4"
        >
          <HourChart stats={stats} />
          <Formula>{stats.formula}</Formula>
        </Terminal>
      )}
    </section>
  );
}

/**
 * As 24 horas do dia em colunas.
 *
 * SVG puro (é a regra do ADR-0018 para ≤ ~100 pontos). O trilho de cada hora é
 * desenhado sempre: sem ele, uma hora de 5 min vira um risco indistinguível de
 * uma hora sem foco nenhum — a lição do `BarSpark` (a régua de nível da
 * Carreira). Zero não desenha coluna: zero é ausência, não um valor pequeno.
 */
function HourChart({ stats }: { stats: FocusStats }) {
  const byHour = new Map(stats.byHour.map((b) => [b.hour, b.minutes]));
  const max = Math.max(1, ...stats.byHour.map((b) => b.minutes));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  // Todas as horas do topo acendem. Destacar UMA de um empate seria a mesma
  // afirmação sem lastro do card, desenhada.
  const best = new Set(stats.bestHours);

  return (
    <div>
      <div className="flex items-end gap-[3px]" style={{ height: 84 }}>
        {hours.map((h) => {
          const mins = byHour.get(h) ?? 0;
          const isBest = best.has(h) && mins > 0;
          return (
            <div
              key={h}
              className="relative flex-1"
              style={{ height: "100%" }}
              title={
                mins > 0
                  ? `${hourLabel(h)}: ${formatMinutes(mins)}`
                  : `${hourLabel(h)}: sem foco`
              }
            >
              {/* O trilho — a hora existe mesmo quando está vazia. */}
              <div className="absolute inset-0 rounded-[2px] bg-[var(--bg-base)]" />
              {mins > 0 && (
                <div
                  className="absolute inset-x-0 bottom-0 rounded-[2px]"
                  style={{
                    height: `${Math.max((mins / max) * 100, 4)}%`,
                    background: isBest
                      ? "var(--accent)"
                      : "color-mix(in srgb, var(--accent) 45%, transparent)",
                    boxShadow: isBest
                      ? "0 0 8px color-mix(in srgb, var(--accent) 45%, transparent)"
                      : undefined,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="tabular mt-1.5 flex justify-between text-[9px] text-[var(--text-tertiary)]">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
      {/* A escala é COMPARTILHADA entre as 24 colunas e não é absoluta — sem o
          denominador escrito, a coluna cheia não diz quanto vale. */}
      <p className="mt-2">
        <MonoLabel>
          coluna cheia = {formatMinutes(max)}, a hora mais focada
        </MonoLabel>
      </p>
    </div>
  );
}
