/**
 * O painel de treino (§3.1): o heatmap dos dias treinados e a taxa por dia da
 * semana.
 *
 * Aqui o gráfico é ECharts, e não o SVG do resto: um heatmap de calendário com
 * eixo, tooltip e escala de cor é análise densa — a fronteira do ADR-0018. O
 * anel do dashboard continua SVG; a análise mora aqui.
 *
 * "O hábito de treino" é encontrado por nome (treino/academia); se a Esfera tem
 * vários, o primeiro que casar. Um seletor de qual hábito analisar é do backlog
 * — a maioria das Esferas de Saúde tem um treino só.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import * as echarts from "echarts/core";

import { Chart } from "../../design-system/Chart";
import { Button, EmptyState } from "../../design-system/primitives";
import {
  habitHeatmap,
  habitWeekdayStats,
  listHabits,
  type HeatmapCell,
} from "../../lib/ipc";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function HealthTraining({ areaId, colour }: { areaId: string; colour: string }) {
  const navigate = useNavigate();
  const { data: habits = [], isLoading } = useQuery({
    queryKey: ["habits", "list", areaId],
    queryFn: () => listHabits(areaId),
  });

  // O hábito de treino: o primeiro cujo título fala de treino/academia.
  const training = habits.find((h) => /trein|academia|muscula|corr/i.test(h.title));

  const { data: cells = [] } = useQuery({
    queryKey: ["habit", training?.id, "heatmap", 112],
    queryFn: () => habitHeatmap(training!.id, 112),
    enabled: !!training,
  });
  const { data: weekdays = [] } = useQuery({
    queryKey: ["habit", training?.id, "weekday"],
    queryFn: () => habitWeekdayStats(training!.id, 180),
    enabled: !!training,
  });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  if (!training) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16">
        <EmptyState
          icon={Dumbbell}
          title="Nenhum treino para analisar"
          hint="Crie um hábito de treino (academia, corrida, musculação) ligado a esta Esfera e este painel mostra os dias treinados e a taxa por dia da semana."
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate("/habits")}>
              Criar hábito de treino
            </Button>
          }
        />
      </div>
    );
  }

  const trained = cells.filter((c) => c.status === "done").length;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Dias treinados
          </h3>
          <span className="tabular text-[13px] text-[var(--text-secondary)]">
            {trained} nos últimos {cells.length} dias
          </span>
        </div>
        <TrainingHeatmap cells={cells} colour={colour} />
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h3 className="mb-3 text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
          Taxa por dia da semana
        </h3>
        <div className="flex flex-col gap-2">
          {weekdays.map((w) => {
            const rate = w.total > 0 ? w.done / w.total : 0;
            return (
              <div key={w.weekday} className="flex items-center gap-3">
                <span className="w-10 shrink-0 text-[12px] text-[var(--text-secondary)]">
                  {WEEKDAYS[w.weekday]}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-base)]">
                  <div
                    className="h-full rounded-full bg-[var(--sphere)]"
                    style={{ width: `${Math.round(rate * 100)}%` }}
                  />
                </div>
                <span className="tabular w-16 shrink-0 text-right text-[11px] text-[var(--text-tertiary)]">
                  {w.done}/{w.total}
                </span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** O heatmap de calendário: semana × dia da semana, cor pela intensidade.
 *
 * `colour` chega como hex e não `var(--sphere)`: o canvas do ECharts não resolve
 * variável CSS (a mesma razão de o `nexusTheme` resolver os tokens na
 * registração). O vazio é um cinza-ardósia de baixa opacidade, legível nos dois
 * temas sem depender de token. */
function TrainingHeatmap({ cells, colour }: { cells: HeatmapCell[]; colour: string }) {
  const EMPTY = "rgba(120, 130, 150, 0.12)";
  const option = useMemo<echarts.EChartsCoreOption>(() => {
    // Cada célula vira [semana, diaDaSemana, valor]. A semana é o índice desde
    // a primeira célula; o dia da semana, o `getDay`. Valor: 1 treinou, 0 não.
    let week = 0;
    const data: Array<[number, number, number]> = [];
    let weekLabels: string[] = [];
    cells.forEach((cell, i) => {
      const d = new Date(`${cell.day}T00:00:00`);
      const weekday = d.getDay();
      if (i > 0 && weekday === 0) week += 1;
      data.push([week, weekday, cell.status === "done" ? 1 : 0]);
      if (weekday === 0 || i === 0) {
        weekLabels[week] = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      }
    });
    weekLabels = Array.from({ length: week + 1 }, (_, i) => weekLabels[i] ?? "");

    return {
      grid: { top: 8, right: 8, bottom: 24, left: 34 },
      tooltip: {
        formatter: (p: { data: [number, number, number] }) =>
          p.data[2] === 1 ? "Treinou" : "Não treinou",
      },
      xAxis: {
        type: "category",
        data: weekLabels,
        splitArea: { show: false },
        axisLabel: { fontSize: 9, interval: 3 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: "category",
        data: WEEKDAYS,
        splitArea: { show: false },
        axisLabel: { fontSize: 9 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      visualMap: {
        min: 0,
        max: 1,
        show: false,
        inRange: {
          // 0 é o vazio apagado; 1 é a cor da Esfera cheia.
          color: [EMPTY, colour],
        },
      },
      series: [
        {
          type: "heatmap",
          data,
          itemStyle: { borderColor: "transparent", borderWidth: 2, borderRadius: 3 },
        },
      ],
    };
  }, [cells, colour]);

  return <Chart option={option} height={190} />;
}
