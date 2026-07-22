/**
 * A tela de Insights — estatística determinística, zero IA.
 *
 * Tudo vem pronto do `bi_engine`: correlações entre hábitos (sobre os dias em que
 * ambos estavam agendados), a guarda anti-burnout e a evolução do Nexus Score
 * congelado. Cada número traz "como calculamos" — a explicabilidade É o produto.
 *
 * O card de correlação mostra a AFIRMAÇÃO e a EVIDÊNCIA lado a lado: a frase diz
 * o que aconteceu, as duas barras mostram de quanto para quanto. As duas dividem
 * a escala absoluta de 0 a 100% — probabilidades têm régua comum, então aqui não
 * cabe a normalização por linha que o Comparativo precisou usar (ADR-0101).
 */

import { useQuery } from "@tanstack/react-query";
import { Activity, Flame, Link2, TrendingDown, TrendingUp } from "lucide-react";

import {
  freezeDailyScores,
  recomputeInsights,
  scoreHistory,
  type CorrelationCard,
  type ScorePoint,
  type Workload,
} from "../../lib/ipc";
import { Card, EmptyState, PageHeader, PAGE_CONTAINER, cx } from "../../design-system/primitives";
import { Sparkline } from "../../design-system/charts";
import { SegBar, MonoLabel } from "../../design-system/instruments";
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

/* ---------- Nexus Score ---------- */

function ScoreTrend({ points }: { points: ScorePoint[] }) {
  const latest = points.length > 0 ? points[points.length - 1].value : null;
  const series = points.map((p) => p.value / 100);
  const trend = trendOf(points);

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
          {/* A tendência só aparece com 14 dias: comparar 7 contra 7 exige as duas
              metades cheias, e "ontem vs hoje" seria ruído com cara de virada. */}
          {trend != null && (
            <p className="mt-2 flex items-center gap-1.5 text-[12px]">
              <span
                className={cx(
                  "tabular inline-flex items-center gap-1 font-semibold",
                  trend.delta > 0
                    ? "text-[var(--success)]"
                    : trend.delta < 0
                      ? "text-[var(--danger)]"
                      : "text-[var(--text-tertiary)]",
                )}
              >
                {trend.delta > 0 ? (
                  <TrendingUp size={12} />
                ) : trend.delta < 0 ? (
                  <TrendingDown size={12} />
                ) : null}
                {/* "0" solto no meio da frase lê como um número truncado. Sem
                    variação, a palavra diz o que o dígito não dizia. */}
                {trend.delta === 0 ? "estável" : `${trend.delta > 0 ? "+" : ""}${trend.delta}`}
              </span>
              <span className="text-[var(--text-tertiary)]">
                média de 7 dias ({trend.recent}) contra os 7 anteriores ({trend.previous})
              </span>
            </p>
          )}
        </div>
        {latest !== null && (
          <div className="shrink-0 text-right">
            <span className="tabular font-mono text-[32px] leading-none font-semibold text-[var(--text-primary)]">
              {latest}
            </span>
            <span className="ml-1 text-[13px] text-[var(--text-tertiary)]">/100</span>
            {/* 0–100 é escala de verdade — dos poucos lugares onde o medidor tem
                denominador legítimo sem precisar inventar um teto. Dez segmentos,
                não os 22 do padrão: em 160px de largura os 22 viravam uma textura
                pontilhada, e um medidor que não se lê não é um medidor. */}
            <SegBar
              value={latest / 100}
              color="var(--accent)"
              height={8}
              segments={10}
              className="mt-2 w-40"
            />
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
        recomputada — é o que você viu na época. A tendência compara a média dos
        últimos 7 dias com a dos 7 anteriores, e só aparece quando existem os 14.
      </Formula>
    </Card>
  );
}

/** A variação da média de 7 dias contra os 7 anteriores. `null` sem os 14 dias. */
function trendOf(points: ScorePoint[]): { recent: number; previous: number; delta: number } | null {
  if (points.length < 14) return null;
  const mean = (xs: ScorePoint[]) =>
    Math.round(xs.reduce((s, p) => s + p.value, 0) / Math.max(1, xs.length));
  const recent = mean(points.slice(-7));
  const previous = mean(points.slice(-14, -7));
  return { recent, previous, delta: recent - previous };
}

/* ---------- guarda anti-burnout ---------- */

function BurnoutCard({ workload }: { workload: Workload }) {
  const alert = workload.alert;
  /* As duas cargas dividem a escala do maior — a mesma leitura do Comparativo.
     A razão sozinha ("1,42×") não diz se são 7 marcações contra 5 ou 140 contra
     98, e a diferença entre esses dois casos é toda a diferença. */
  const scale = Math.max(workload.current, workload.baseline);
  const frac = (v: number) => (scale > 0 ? v / scale : 0);
  const tone = alert ? "var(--warning)" : "var(--success)";

  return (
    <div
      className="rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-5"
      style={{ borderColor: alert ? "var(--warning)" : "var(--border-subtle)" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: alert
              ? "color-mix(in oklab, var(--warning) 18%, transparent)"
              : "var(--bg-base)",
            color: alert ? "var(--warning)" : "var(--text-tertiary)",
          }}
        >
          <Flame size={18} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
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

      <div className="mt-4 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
        <MonoLabel className="w-28 truncate">esta semana</MonoLabel>
        <SegBar value={frac(workload.current)} color={tone} height={9} />
        <span className="tabular w-12 text-right font-mono text-[13px] font-semibold text-[var(--text-primary)]">
          {Math.round(workload.current)}
        </span>

        <MonoLabel className="w-28 truncate">média de {workload.baselineWeeks}</MonoLabel>
        <SegBar value={frac(workload.baseline)} color="var(--text-tertiary)" height={9} />
        <span className="tabular w-12 text-right font-mono text-[13px] text-[var(--text-secondary)]">
          {Math.round(workload.baseline)}
        </span>
      </div>

      <Formula>
        {workload.formula} A comparação é ATÉ-A-DATA: cada semana da média conta
        só até o mesmo dia da semana que hoje. Comparar três dias corridos com
        semanas inteiras dividiria a razão por dois sozinho, e a guarda ficaria
        muda no começo da semana — que é quando o aviso ainda serve para algo.
      </Formula>
    </div>
  );
}

/* ---------- correlações ---------- */

function Correlations({ cards }: { cards: CorrelationCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Link2 size={14} className="text-[var(--text-tertiary)]" aria-hidden />
        <h2 className="text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
          Correlações entre hábitos
        </h2>
        <span className="text-[11px] text-[var(--text-tertiary)]">
          {cards.length} {cards.length === 1 ? "par com relação" : "pares com relação"}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {cards.map((c) => (
          <CorrelationTile key={`${c.habitA.id}-${c.habitB.id}`} c={c} />
        ))}
      </div>
    </section>
  );
}

function CorrelationTile({ c }: { c: CorrelationCard }) {
  const helps = c.direction === "helps";
  const tone = helps ? "var(--success)" : "var(--warning)";

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full"
          style={{ background: `color-mix(in oklab, ${tone} 18%, transparent)`, color: tone }}
        >
          {helps ? <TrendingUp size={15} aria-hidden /> : <TrendingDown size={15} aria-hidden />}
        </div>
        <p className="text-[13px] leading-[19px] text-[var(--text-primary)]">{c.sentence}</p>
      </div>

      {/* A evidência da frase, na escala ABSOLUTA de 0 a 100%: as duas barras são
          probabilidades, então elas já compartilham régua e não precisam ser
          normalizadas uma pela outra. */}
      <div className="mt-3.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
        {/* O sujeito das duas barras é o hábito A, nomeado na frase logo acima —
            repeti-lo aqui truncado seria pior que não repetir, e pendurá-lo num
            `title` seria informação que só existe para quem tem mouse. */}
        <MonoLabel className="w-32 truncate">quando cumpre</MonoLabel>
        <SegBar value={c.pBGivenA} color={tone} height={9} segments={20} />
        <span className="tabular w-10 text-right font-mono text-[12px] font-semibold text-[var(--text-primary)]">
          {Math.round(c.pBGivenA * 100)}%
        </span>

        <MonoLabel className="w-32 truncate">quando não cumpre</MonoLabel>
        <SegBar value={c.pBGivenNotA} color="var(--text-tertiary)" height={9} segments={20} />
        <span className="tabular w-10 text-right font-mono text-[12px] text-[var(--text-secondary)]">
          {Math.round(c.pBGivenNotA * 100)}%
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
        <Stat label="φ" value={c.phi.toFixed(2)} />
        <Stat label="lift" value={`${c.lift.toFixed(2)}×`} />
        <Stat label="base" value={`${c.sampleSize} dias`} />
      </div>

      <div className="mt-auto">
        <Formula>{c.formula}</Formula>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[var(--text-tertiary)]">{label}</span>
      <span className="tabular font-mono font-semibold text-[var(--text-secondary)]">{value}</span>
    </span>
  );
}
