/**
 * Comparativo de Períodos (ARSENAL) — mês vs anterior, ano vs anterior.
 *
 * A comparação é ATÉ-A-DATA: este mês até hoje contra o mesmo trecho do mês
 * passado (e igual para o ano). Um mês cheio contra um pela metade mentiria a
 * seta. Cinco métricas lado a lado, com a variação vs. o mesmo ponto do período
 * anterior. Ver ADR-0062.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  CheckSquare,
  Minus,
  PiggyBank,
  Sparkles,
  Timer,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { periodComparison, type Comparison, type PeriodStats } from "../../lib/ipc";
import { PageHeader, PAGE_CONTAINER, Card, cx } from "../../design-system/primitives";
import { formatMoneyShort } from "../../lib/format";

type Mode = "month" | "year";

interface MetricDef {
  key: keyof PeriodStats;
  label: string;
  icon: LucideIcon;
  format: (v: number) => string;
}

const METRICS: MetricDef[] = [
  { key: "studyMinutes", label: "Estudo", icon: BookOpen, format: hours },
  { key: "focusMinutes", label: "Foco", icon: Timer, format: hours },
  { key: "contributionCents", label: "Aportes", icon: PiggyBank, format: formatMoneyShort },
  { key: "tasksCompleted", label: "Tarefas concluídas", icon: CheckSquare, format: (v) => String(v) },
  { key: "scoreAvg", label: "Score médio", icon: Sparkles, format: (v) => String(Math.round(v)) },
];

export function CompareScreen() {
  const [mode, setMode] = useState<Mode>("month");
  const q = useQuery({ queryKey: ["period-comparison", mode], queryFn: () => periodComparison(mode) });
  const data = q.data;

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Comparativo"
        subtitle="Este período contra o anterior — sempre até a mesma data, para a seta ser honesta"
        actions={
          <div className="flex rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-0.5">
            {(["month", "year"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cx(
                  "rounded-[var(--radius-sm)] px-3 py-1 text-[12px] font-medium transition-colors",
                  mode === m
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {m === "month" ? "Mês" : "Ano"}
              </button>
            ))}
          </div>
        }
      />

      <div className={cx(PAGE_CONTAINER, "pb-10")}>
        {data && (
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-center gap-3 text-[13px]">
              <span className="font-semibold text-[var(--text-primary)]">{data.currentLabel}</span>
              <ArrowRight size={14} className="text-[var(--text-tertiary)]" />
              <span className="text-[var(--text-tertiary)]">vs {data.previousLabel}</span>
            </div>

            <div className="flex flex-col divide-y divide-[var(--border-subtle)]">
              {METRICS.map((m) => (
                <MetricRow key={m.key} def={m} data={data} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function MetricRow({ def, data }: { def: MetricDef; data: Comparison }) {
  const cur = numberOf(data.current[def.key]);
  const prev = numberOf(data.previous[def.key]);
  const Icon = def.icon;

  return (
    <div className="flex items-center gap-3 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]">
        <Icon size={15} style={{ color: "var(--accent)" }} />
      </span>
      <span className="flex-1 text-[13px] text-[var(--text-secondary)]">{def.label}</span>

      <div className="flex items-baseline gap-2 text-right">
        <span className="font-mono text-[17px] font-semibold tabular-nums text-[var(--text-primary)]">
          {cur != null ? def.format(cur) : "—"}
        </span>
        <span className="w-20 text-[11px] tabular-nums text-[var(--text-tertiary)]">
          antes {prev != null ? def.format(prev) : "—"}
        </span>
        <Delta cur={cur} prev={prev} />
      </div>
    </div>
  );
}

function Delta({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) {
    return <span className="w-16 text-right text-[11px] text-[var(--text-tertiary)]">—</span>;
  }
  if (prev === 0) {
    const up = cur > 0;
    return (
      <span
        className={cx(
          "inline-flex w-16 items-center justify-end gap-1 text-[11px] font-semibold",
          up ? "text-[var(--success)]" : "text-[var(--text-tertiary)]",
        )}
      >
        {up ? <TrendingUp size={12} /> : <Minus size={12} />}
        {up ? "novo" : "—"}
      </span>
    );
  }
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const flat = pct === 0;
  const up = pct > 0;
  const Ic = flat ? Minus : up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cx(
        "inline-flex w-16 items-center justify-end gap-1 text-[11px] font-semibold tabular-nums",
        flat
          ? "text-[var(--text-tertiary)]"
          : up
            ? "text-[var(--success)]"
            : "text-[var(--danger)]",
      )}
    >
      <Ic size={12} />
      {flat ? "0%" : `${up ? "+" : ""}${pct}%`}
    </span>
  );
}

function numberOf(v: number | null): number | null {
  return typeof v === "number" ? v : null;
}

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
