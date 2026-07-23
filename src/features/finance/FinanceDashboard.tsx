/**
 * O painel das Finanças: patrimônio, alocação, bancos e a Saúde Financeira.
 *
 * Todo o dado vem de UMA chamada (`financeOverview`): a tela abre com sete
 * perguntas, e sete round-trips fariam o painel piscar seção por seção.
 *
 * A fronteira do ADR-0018 continua valendo, e a v1.3 (fase 4) a moveu num ponto:
 * a ÁREA acumulada segue no ECharts (eixo, tooltip, série longa — análise densa
 * de verdade), mas o DONUT de alocação saiu. Sete valores não pedem um canvas, e
 * o atraso da fatia ao hover era o preço de um. Ver `Allocation`.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, PiggyBank, Repeat, TrendingUp, Wallet } from "lucide-react";
import * as echarts from "echarts/core";

import { Chart } from "../../design-system/Chart";
import { CountUp, HeroCard, StatTile, SummaryCard, Val } from "../../design-system/cards";
import { Gauge } from "../../design-system/charts";
import { BankTile, SegBar } from "../../design-system/instruments";
import { EmptyState } from "../../design-system/primitives";
import { Button } from "../../design-system/primitives";
import { areaGradient, glowLine } from "../../design-system/nexusTheme";
import { formatMoney, formatMoneyShort } from "../../lib/format";
import { financeOverview, type Bucket, type FinanceOverview } from "../../lib/ipc";
import { CLASS_COLOURS } from "./classes";

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

  /* A série do tile "Aporte do mês" é o APORTE POR MÊS — a história do próprio
     número que ele mostra. Normalizada pelo maior mês, que é o que a sparkline
     espera (0..1). Com menos de dois pontos ela some: uma linha de um ponto só
     é um traço, não uma tendência. */
  const monthlySpark = (() => {
    if (data.monthly.length < 2) return undefined;
    const peak = Math.max(...data.monthly.map((m) => m.cents), 1);
    return data.monthly.map((m) => Math.max(0, m.cents) / peak);
  })();

  /* "Acima/abaixo da média" só se disser algo: uma diferença de menos de 5% é
     ruído de arredondamento de mês, e anunciá-la seria afirmar mais do que os
     dados sustentam. */
  const monthVsAvg = (() => {
    if (data.avg6mCents <= 0) return undefined;
    const ratio = data.thisMonthCents / data.avg6mCents;
    if (ratio >= 0.95 && ratio <= 1.05) return "na média dos 6 meses";
    const pct = Math.round(Math.abs(ratio - 1) * 100);
    return ratio > 1 ? `${pct}% acima da média` : `${pct}% abaixo da média`;
  })();

  /* A maior classe, e SÓ quando ela é de fato a maior: com empate no topo, a
     frase não é dita. É a lição do "melhor dia" da Saúde (ADR-0083) — o
     desempate de um sort não vira afirmação sobre o dinheiro de ninguém. */
  const topClass = (() => {
    if (data.byClass.length === 0) return undefined;
    const sorted = [...data.byClass].sort((a, b) => b.cents - a.cents);
    if (sorted.length > 1 && sorted[0].cents === sorted[1].cents) return undefined;
    const total = sorted.reduce((sum, b) => sum + b.cents, 0);
    if (total <= 0) return undefined;
    return `${sorted[0].label} concentra ${Math.round((sorted[0].cents / total) * 100)}%`;
  })();

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

      {/* ===== os sinais, cada um com o seu vivo =====
          `spark` só onde a SÉRIE é do próprio número (o aporte mensal), e `seg`
          só onde há uma razão real a medir. O "Classes" fica sem vivo de
          propósito: uma contagem de sete categorias não tem série nem fração —
          pendurar uma barra ali seria decoração, que foi o erro que a Saúde
          cometeu e a dirigida pegou. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          icon={Wallet}
          label="Aporte do mês"
          value={formatMoney(data.thisMonthCents)}
          spark={monthlySpark}
          hint={monthVsAvg}
        />
        <StatTile
          icon={TrendingUp}
          label="Média 6 meses"
          value={formatMoney(data.avg6mCents)}
        />
        <StatTile
          icon={Repeat}
          label="Meses seguidos"
          value={<CountUp to={data.streakMonths} />}
          unit={data.streakMonths === 1 ? "mês" : "meses"}
          tone="warning"
        />
        <StatTile
          icon={PiggyBank}
          label="Classes"
          value={<CountUp to={data.byClass.length} />}
          hint={topClass}
        />
      </div>

      {/* ===== Alocação + Saúde Financeira ===== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-3 text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Alocação por classe
          </h3>
          {data.byClass.length > 0 ? (
            <Allocation buckets={data.byClass} />
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

      {/* ===== Saldo por conta =====
          O objetivo do dono é modesto e explícito: "registrar valores que eu
          tenho, aportes em qual conta". A conta já era registrada em todo aporte
          desde a 0010 — o que faltava era a tela somar por ela e MOSTRAR O
          NÚMERO. Antes isto era um gráfico de barras relativas: dava para ver
          qual banco tem mais, não quanto cada um tem. */}
      {data.byAccount.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
              Saldo por conta
            </h3>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              total aportado{" "}
              <span className="tabular font-medium text-[var(--text-primary)]">
                {formatMoney(data.totalContributedCents)}
              </span>
            </span>
          </div>
          <BankBalances buckets={data.byAccount} />
          {/* Honestidade: isto é o LÍQUIDO APORTADO por conta, não o saldo que o
              banco mostra. O NEXUS sabe o que entrou e o que saiu; o que rendeu
              sozinho ele não tem como saber (sem cotação, sem rede — §1 da
              constituição). O patrimônio real continua sendo o do herói, que o
              usuário informa à mão. Dizer "saldo" sem esta linha seria deixar a
              tela afirmar mais do que ela sabe. */}
          <p className="mt-3 border-t border-[var(--border-subtle)] pt-2.5 text-[11px] leading-[17px] text-[var(--text-tertiary)]">
            Soma dos aportes menos os resgates de cada conta. Não inclui
            rendimento — o NEXUS não consulta cotação.
          </p>
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
    const colour = "#38C6E0"; // ciano das Finanças (fase 10, item 1)

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

/**
 * A alocação por classe — em barras, e não mais num donut.
 *
 * ===== Por que o donut saiu =====
 *
 * Ele era ECharts com `emphasis` animado, e a fatia respondia ao mouse com um
 * atraso perceptível — o "donut com lag" que o dono apontou. Já houve uma
 * tentativa de consertar (`transitionDuration: 0`, `animationDurationUpdate`
 * curto) e o atraso continuou, porque parte dele é o custo de instanciar e
 * redesenhar um canvas para SETE valores.
 *
 * Sete valores não pedem um canvas. Eles pedem sete linhas: a cor identifica (a
 * MESMA do chip do Terminal e do extrato), a barra compara, e o número diz
 * quanto — que era exatamente o que o donut NÃO dizia sem hover. Um donut
 * responde "qual é a maior?"; a lista responde "quanto tem em cada uma?", que é
 * a pergunta de quem olha a própria alocação.
 *
 * A porcentagem vem primeiro em leitura porque alocação é uma pergunta de
 * proporção; o valor absoluto fica à direita, na coluna tabular.
 */
function Allocation({ buckets }: { buckets: Bucket[] }) {
  const total = useMemo(() => buckets.reduce((s, b) => s + b.cents, 0), [buckets]);
  const ordered = useMemo(() => [...buckets].sort((a, b) => b.cents - a.cents), [buckets]);

  return (
    <div className="flex flex-col gap-2.5">
      {ordered.map((b) => {
        const share = total > 0 ? b.cents / total : 0;
        const colour = CLASS_COLOURS[b.key] ?? "var(--text-tertiary)";
        return (
          <div key={b.key} className="flex items-center gap-3">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: colour }}
            />
            <span className="w-28 shrink-0 truncate text-[12px] text-[var(--text-secondary)]">
              {b.label}
            </span>
            <SegBar value={share} segments={20} color={colour} height={9} className="flex-1" />
            <span className="tabular w-11 shrink-0 text-right text-[12px] font-semibold text-[var(--text-primary)]">
              {Math.round(share * 100)}%
            </span>
            <span className="tabular w-20 shrink-0 text-right text-[11px] text-[var(--text-tertiary)]">
              {formatMoneyShort(b.cents)}
            </span>
          </div>
        );
      })}
      <p className="mt-1 border-t border-[var(--border-subtle)] pt-2.5 text-[11px] text-[var(--text-tertiary)]">
        Sobre <span className="tabular text-[var(--text-secondary)]">{formatMoney(total)}</span>{" "}
        aportados.
      </p>
    </div>
  );
}

/**
 * O saldo de cada conta, em ladrilhos com a marca do banco.
 *
 * Eram barras relativas: dava para ver qual banco tem mais, não quanto cada um
 * tem — e "quanto tem em cada" é a pergunta. O `BankTile` é o MESMO componente
 * que o Terminal de aporte usa para escolher a conta, com a mesma logo na cor
 * da marca: o banco se reconhece pela mesma forma nas duas telas.
 *
 * `b.key` é o `accounts.id` (o backend agrupa por conta) — por isso serve de
 * `bankId` e a logo sobrevive a um `name` renomeado.
 *
 * A ordem é por saldo, do maior para o menor. Sem barra: aqui não há proporção a
 * comunicar (a alocação por classe já faz isso, e é ela que responde "onde meu
 * dinheiro está"); aqui o dado é o NÚMERO.
 */
function BankBalances({ buckets }: { buckets: Bucket[] }) {
  const ordered = [...buckets].sort((a, b) => b.cents - a.cents);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {ordered.map((b) => (
        <BankTile key={b.key} name={b.label} bankId={b.key} balance={formatMoney(b.cents)} />
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
