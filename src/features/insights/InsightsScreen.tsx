/**
 * A tela de Insights — estatística determinística, zero IA.
 *
 * Tudo vem pronto do `bi_engine`: correlações entre hábitos (sobre os dias em que
 * ambos estavam agendados), a guarda anti-burnout e a evolução do Nexus Score
 * congelado. Cada número traz "como calculamos" — a explicabilidade É o produto.
 */

import { useQuery } from "@tanstack/react-query";
import { Activity, Flame, Link2, TrendingDown, TrendingUp } from "lucide-react";

import {
  freezeDailyScores,
  recomputeInsights,
  scoreHistory,
  type CorrelationCard,
  type Workload,
} from "../../lib/ipc";
import { Card, EmptyState, PageHeader, PAGE_CONTAINER } from "../../design-system/primitives";
import { Sparkline } from "../../design-system/charts";
import { Formula } from "../../design-system/Formula";

export function InsightsScreen() {
  const insights = useQuery({
    queryKey: ["insights"],
    // recompute é barato quando nada mudou (input_hash bate) e garante dado fresco.
    queryFn: recomputeInsights,
  });

  const scores = useQuery({
    queryKey: ["score-history"],
    queryFn: async () => {
      await freezeDailyScores();
      return scoreHistory(30);
    },
  });

  const correlations = insights.data?.correlations ?? [];
  const burnout = insights.data?.burnout ?? null;
  const points = scores.data ?? [];
  const hasAnything = correlations.length > 0 || burnout !== null || points.length >= 2;

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Insights"
        subtitle="Estatística determinística — zero IA, tudo explicável"
      />

      <div className={`${PAGE_CONTAINER} min-h-0 flex-1 space-y-6 pb-16`}>
        {!hasAnything && !insights.isLoading ? (
          <EmptyState
            icon={Activity}
            title="Ainda sem sinal suficiente"
            hint="Correlações exigem ao menos 30 dias com os dois hábitos agendados; o alerta de carga precisa de algumas semanas; o gráfico do score começa a se desenhar conforme os dias fecham. Volte em breve."
          />
        ) : (
          <>
            <ScoreTrend points={points} />
            {burnout && <BurnoutCard workload={burnout} />}
            <Correlations cards={correlations} />
          </>
        )}
      </div>
    </div>
  );
}

function ScoreTrend({ points }: { points: { day: string; value: number }[] }) {
  const latest = points.length > 0 ? points[points.length - 1].value : null;
  const series = points.map((p) => p.value / 100);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Nexus Score
          </h2>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            Últimos {points.length} dias congelados
          </p>
        </div>
        {latest !== null && (
          <div className="text-right">
            <span className="tabular font-mono text-[32px] leading-none font-semibold text-[var(--text-primary)]">
              {latest}
            </span>
            <span className="ml-1 text-[13px] text-[var(--text-tertiary)]">/100</span>
          </div>
        )}
      </div>

      {series.length >= 2 ? (
        <Sparkline data={series} width={640} height={64} className="mt-4 w-full" />
      ) : (
        <p className="mt-4 text-[12px] text-[var(--text-tertiary)]">
          O gráfico aparece quando houver ao menos dois dias fechados com atividade.
        </p>
      )}

      <Formula>
        O score congelado de cada dia é comportamental: hábitos (40%) e tarefas (30%)
        cumpridos, pesos redistribuídos entre o que se aplica. A história nunca é
        recomputada — é o que você viu na época.
      </Formula>
    </Card>
  );
}

function BurnoutCard({ workload }: { workload: Workload }) {
  const alert = workload.alert;
  return (
    <div
      className="rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-5"
      style={{ borderColor: alert ? "var(--warning)" : "var(--border-subtle)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex size-9 items-center justify-center rounded-full"
          style={{
            background: alert ? "color-mix(in oklab, var(--warning) 18%, transparent)" : "var(--bg-base)",
            color: alert ? "var(--warning)" : "var(--text-tertiary)",
          }}
        >
          <Flame size={18} aria-hidden />
        </div>
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--text-primary)]">
            {alert ? "Carga acima do seu normal" : "Carga sob controle"}
          </h2>
          <p className="text-[12px] text-[var(--text-secondary)]">
            Esta semana está em{" "}
            <strong className="tabular text-[var(--text-primary)]">
              {workload.ratio.toFixed(2)}×
            </strong>{" "}
            a média das últimas {workload.baselineWeeks} semanas.
          </p>
        </div>
      </div>
      <Formula>{workload.formula}</Formula>
    </div>
  );
}

function Correlations({ cards }: { cards: CorrelationCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Link2 size={14} className="text-[var(--text-tertiary)]" aria-hidden />
        <h2 className="text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
          Correlações entre hábitos
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((c) => (
          <Card key={`${c.habitA.id}-${c.habitB.id}`} className="p-4">
            <div className="flex items-start gap-3">
              <div
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
                style={{
                  background:
                    c.direction === "helps"
                      ? "color-mix(in oklab, var(--success) 18%, transparent)"
                      : "color-mix(in oklab, var(--warning) 18%, transparent)",
                  color: c.direction === "helps" ? "var(--success)" : "var(--warning)",
                }}
              >
                {c.direction === "helps" ? (
                  <TrendingUp size={15} aria-hidden />
                ) : (
                  <TrendingDown size={15} aria-hidden />
                )}
              </div>
              <p className="text-[13px] leading-[19px] text-[var(--text-primary)]">
                {c.sentence}
              </p>
            </div>
            <Formula>{c.formula}</Formula>
          </Card>
        ))}
      </div>
    </section>
  );
}
