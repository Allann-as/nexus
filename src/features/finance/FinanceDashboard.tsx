/**
 * O painel das Finanças: patrimônio, alocação, bancos e a Saúde Financeira.
 *
 * Todo o dado vem de UMA chamada (`financeOverview`): a tela abre com sete
 * perguntas, e sete round-trips fariam o painel piscar seção por seção.
 *
 * Os gráficos seguem a fronteira do ADR-0018: a ÁREA acumulada e o DONUT são
 * análise densa (eixo, tooltip, fatias) e usam ECharts; as barras por banco são
 * seis retângulos decorativos e ficam em HTML puro — instanciar uma terceira
 * engine para elas seria pagar caro por uma forma simples.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, PiggyBank, Repeat, TrendingUp, Wallet } from "lucide-react";
import * as echarts from "echarts/core";

import { Chart } from "../../design-system/Chart";
import { CountUp, HeroCard, StatCard, SummaryCard, Val } from "../../design-system/cards";
import { Gauge } from "../../design-system/charts";
import { EmptyState } from "../../design-system/primitives";
import { Button } from "../../design-system/primitives";
import { areaGradient, glowLine } from "../../design-system/nexusTheme";
import { formatMoney, formatMoneyShort } from "../../lib/format";
import { financeOverview, type Bucket, type FinanceOverview } from "../../lib/ipc";

/**
 * As cores das classes de ativo — uma paleta categórica.
 *
 * Fixa e não a cor da Esfera: o donut PRECISA codificar por cor (é o que uma
 * fatia é), e por isso cada classe tem matiz próprio e a legenda traz o rótulo
 * junto — a exceção do ADR-0017 para dados que nascem para ser distinguidos por
 * cor. Escolhidas com matizes afastados para separar mesmo em tela pequena.
 */
const CLASS_COLOURS: Record<string, string> = {
  renda_fixa: "#4D8DFF",
  acoes: "#34D399",
  fiis: "#FBBF24",
  etf_exterior: "#A78BFA",
  cripto: "#FB7185",
  reserva: "#22D3EE",
  outros: "#94A3B8",
};

export function FinanceDashboard({ onAporte }: { onAporte: () => void }) {
  const [formula, setFormula] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["finance", "overview"],
    queryFn: financeOverview,
  });

  if (isLoading || !data) {
    return <div className="h-[420px] animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  if (data.monthly.length === 0 && data.byClass.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16">
        <EmptyState
          icon={PiggyBank}
          title="Nenhum aporte ainda"
          hint="Registre seu primeiro aporte — valor, banco, classe — e o painel ganha patrimônio, alocação e a sua Saúde Financeira."
          action={
            <Button variant="primary" size="sm" icon={PiggyBank} onClick={onAporte}>
              Registrar aporte
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ===== HeroCard: patrimônio + área acumulada ===== */}
      <HeroCard
        label={data.portfolioCents !== null ? "Patrimônio" : "Total aportado"}
        value={formatMoney(data.portfolioCents ?? data.totalContributedCents)}
        hint={
          data.portfolioCents !== null ? (
            <>
              informado à mão · <Val>{formatMoney(data.totalContributedCents)}</Val> aportados
            </>
          ) : (
            "soma de todos os aportes"
          )
        }
        aside={<AccumulatedArea monthly={data.monthly} />}
      />

      {/* ===== StatCards ===== */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="Aporte do mês"
          value={formatMoney(data.thisMonthCents)}
        />
        <StatCard
          icon={TrendingUp}
          label="Média 6 meses"
          value={formatMoney(data.avg6mCents)}
        />
        <StatCard
          icon={Repeat}
          label="Meses seguidos"
          value={<CountUp to={data.streakMonths} />}
          unit={data.streakMonths === 1 ? "mês" : "meses"}
        />
        <StatCard
          icon={PiggyBank}
          label="Classes"
          value={<CountUp to={data.byClass.length} />}
        />
      </div>

      {/* ===== Alocação + Saúde Financeira ===== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-3 text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Alocação por classe
          </h3>
          {data.byClass.length > 0 ? (
            <AllocationDonut buckets={data.byClass} />
          ) : (
            <p className="py-8 text-center text-[12px] text-[var(--text-tertiary)]">
              Sem aportes para alocar.
            </p>
          )}
        </section>

        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
              Saúde Financeira
            </h3>
            <button
              onClick={() => setFormula((f) => !f)}
              aria-label="Como calculamos"
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <Info size={13} />
            </button>
          </div>
          <FinancialHealthPanel data={data} showFormula={formula} />
        </section>
      </div>

      {/* ===== Barras por banco ===== */}
      {data.byAccount.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-3 text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Por banco
          </h3>
          <BankBars buckets={data.byAccount} />
        </section>
      )}

      <SummaryCard>
        Você aportou <Val>{formatMoney(data.thisMonthCents)}</Val> este mês, contra uma média de{" "}
        <Val>{formatMoney(data.avg6mCents)}</Val> nos últimos seis
        {data.streakMonths > 0 && (
          <>
            , e mantém <Val tone="accent">{data.streakMonths}</Val>{" "}
            {data.streakMonths === 1 ? "mês seguido" : "meses seguidos"} aportando
          </>
        )}
        .
      </SummaryCard>
    </div>
  );
}

/** A área acumulada dentro do HeroCard — a curva do patrimônio subindo. */
function AccumulatedArea({ monthly }: { monthly: FinanceOverview["monthly"] }) {
  const option = useMemo<echarts.EChartsCoreOption>(() => {
    // Acumulada: cada ponto é a soma de tudo até ali. `monthly` é o aporte do
    // mês; a curva do patrimônio é a soma corrida.
    let running = 0;
    const points = monthly.map((m) => {
      running += m.cents;
      return { month: m.month, cents: running };
    });
    const colour = "#4D8DFF";

    return {
      grid: { top: 8, right: 8, bottom: 20, left: 8, containLabel: false },
      xAxis: {
        type: "category",
        data: points.map((p) => p.month.slice(5)),
        axisLabel: { fontSize: 9 },
        boundaryGap: false,
      },
      yAxis: { type: "value", show: false },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v: number) => formatMoney(v),
      },
      series: [
        {
          type: "line",
          smooth: true,
          symbol: "none",
          data: points.map((p) => p.cents),
          areaStyle: areaGradient(colour),
          ...glowLine(colour),
        },
      ],
    };
  }, [monthly]);

  return <Chart option={option} height={150} className="min-w-[280px]" />;
}

/** O donut de alocação — cada classe uma fatia, legenda com rótulo. */
function AllocationDonut({ buckets }: { buckets: Bucket[] }) {
  const option = useMemo<echarts.EChartsCoreOption>(
    () => ({
      tooltip: {
        trigger: "item",
        valueFormatter: (v: number) => formatMoney(v),
      },
      legend: {
        type: "scroll",
        bottom: 0,
        icon: "circle",
        textStyle: { fontSize: 11 },
      },
      series: [
        {
          type: "pie",
          radius: ["52%", "72%"],
          center: ["50%", "42%"],
          avoidLabelOverlap: true,
          label: { show: false },
          data: buckets.map((b) => ({
            name: b.label,
            value: b.cents,
            itemStyle: { color: CLASS_COLOURS[b.key] ?? "#94A3B8" },
          })),
        },
      ],
    }),
    [buckets],
  );

  return <Chart option={option} height={240} />;
}

/** Uma barra horizontal por banco — seis retângulos, HTML puro (ADR-0018). */
function BankBars({ buckets }: { buckets: Bucket[] }) {
  const max = Math.max(...buckets.map((b) => b.cents), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {buckets.map((b) => (
        <div key={b.key} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-[12px] text-[var(--text-secondary)]">
            {b.label}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-base)]">
            <div
              className="h-full rounded-full bg-[var(--sphere)]"
              style={{ width: `${(b.cents / max) * 100}%` }}
            />
          </div>
          <span className="tabular w-24 shrink-0 text-right text-[12px] text-[var(--text-primary)]">
            {formatMoneyShort(b.cents)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** O gauge da Saúde Financeira + o breakdown que o "ⓘ" abre. */
function FinancialHealthPanel({
  data,
  showFormula,
}: {
  data: FinanceOverview;
  showFormula: boolean;
}) {
  const { health } = data;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-5">
        <Gauge value={health.value} label={health.value !== null ? "de 100" : "sem dados"} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {health.components.map((c) => (
            <div key={c.label} className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-[11px] text-[var(--text-secondary)]">
                {c.label}
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-base)]">
                <div
                  className="h-full rounded-full bg-[var(--sphere)]"
                  style={{ width: `${Math.round(c.ratio * 100)}%` }}
                />
              </div>
              <span className="tabular w-8 shrink-0 text-right text-[10px] text-[var(--text-tertiary)]">
                {Math.round(c.ratio * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {showFormula && (
        <p className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-[11px] leading-[18px] text-[var(--text-tertiary)]">
          {health.formula}
        </p>
      )}
    </div>
  );
}
