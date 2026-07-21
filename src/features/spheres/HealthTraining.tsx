/**
 * O painel de treino (§3.1) — recomposto na v1.3 (fase 4).
 *
 * ===== O que mudou, e por quê =====
 *
 * **O heatmap deixa de ser ECharts.** O ADR-0018 põe a fronteira em "análise
 * densa vai para o ECharts", e um heatmap de calendário com eixo, tooltip e
 * escala de cor parecia estar do lado de lá. Duas coisas mudaram desde então:
 *
 *   1. a fase 3b desenhou o heatmap da CONSTÂNCIA com o instrumento `Heatmap`
 *      do Cockpit, e ele dá conta — célula, intensidade e `title` nativo;
 *   2. ter dois heatmaps no mesmo app com desenhos diferentes é o problema dos
 *      "dois idiomas" outra vez. O usuário não sabe que um é canvas e o outro é
 *      div; ele vê duas grades que deveriam ser a mesma e não são.
 *
 * O que se perde: o tooltip rico do ECharts (vira o `title` do navegador). O que
 * se ganha: a grade fala a língua do resto, e os MESES ficam legíveis — que era
 * o defeito concreto da versão anterior, onde o eixo mostrava "12/05" a cada
 * quatro semanas e ninguém conseguia dizer onde junho começava.
 *
 * A orientação também muda, e é ela que torna o mês legível: as colunas passam a
 * ser SEMANAS e as linhas, dias da semana. Só assim um rótulo de mês tem onde
 * pousar — na versão anterior, com uma semana por linha, "junho" não tinha
 * coluna a que pertencer.
 *
 * "O hábito de treino" continua sendo encontrado por nome (treino/academia); se
 * a Esfera tem vários, o primeiro que casar. Um seletor de qual hábito analisar
 * segue no backlog.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Dumbbell, Percent, TrendingUp } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { CountUp, StatTile } from "../../design-system/cards";
import {
  Heatmap,
  MonoLabel,
  StatusList,
  type HeatCell,
  type StatusRow,
} from "../../design-system/instruments";
import { Button, EmptyState } from "../../design-system/primitives";
import {
  habitHeatmap,
  habitWeekdayStats,
  listHabits,
  type HeatmapCell,
  type WeekdayStat,
} from "../../lib/ipc";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** A janela do heatmap, em dias. 112 = 16 semanas cheias. */
const WINDOW_DAYS = 112;

/** Tamanho de uma célula e o vão entre elas — o passo de uma coluna é a soma. */
const CELL = 13;
const GAP = 3;

export function HealthTraining({ areaId, colour }: { areaId: string; colour: string }) {
  const navigate = useNavigate();
  const { data: habits = [], isLoading } = useQuery({
    queryKey: ["habits", "list", areaId],
    queryFn: () => listHabits(areaId),
  });

  // O hábito de treino: o primeiro cujo título fala de treino/academia.
  const training = habits.find((h) => /trein|academia|muscula|corr/i.test(h.title));

  const { data: cells = [] } = useQuery({
    queryKey: ["habit", training?.id, "heatmap", WINDOW_DAYS],
    queryFn: () => habitHeatmap(training!.id, WINDOW_DAYS),
    enabled: !!training,
  });
  const { data: weekdays = [] } = useQuery({
    queryKey: ["habit", training?.id, "weekday"],
    queryFn: () => habitWeekdayStats(training!.id, 180),
    enabled: !!training,
  });

  const grid = useMemo(() => buildGrid(cells), [cells]);

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
  const rate = cells.length > 0 ? trained / cells.length : 0;

  const { best, hint: bestHint } = rankWeekdays(weekdays);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile
          icon={CalendarCheck}
          label="Dias treinados"
          value={<CountUp to={trained} />}
          unit={`de ${cells.length}`}
          seg={rate}
        />
        <StatTile
          icon={Percent}
          label="Taxa no período"
          value={<CountUp to={Math.round(rate * 100)} suffix="%" />}
          ring={rate}
        />
        <StatTile
          icon={TrendingUp}
          label="Melhor dia"
          value={best ? WEEKDAYS[best.weekday] : "—"}
          hint={bestHint}
          seg={best ? best.done / best.total : undefined}
        />
      </div>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <MonoLabel>Dias treinados</MonoLabel>
          <span className="tabular text-[12px] text-[var(--text-secondary)]">
            últimas {grid.weeks} semanas
          </span>
        </div>

        {/* A grade rola no eixo X dentro do próprio card, e nunca empurra a
            página: 16 semanas cabem em telas normais, e numa janela estreita o
            que se move é a grade, não o layout (regra do container central). */}
        <div className="overflow-x-auto">
          <div className="w-max">
            {/* Os rótulos de mês, alinhados às colunas de semana. É este trilho
                que a versão ECharts não tinha — ela numerava semanas. */}
            <div className="mb-1 flex" style={{ marginLeft: 34, gap: GAP }}>
              {grid.months.map((label, i) => (
                <span
                  key={i}
                  className="shrink-0 text-[10px] leading-[12px] text-[var(--text-tertiary)]"
                  style={{ width: CELL }}
                >
                  {label}
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <div
                className="flex shrink-0 flex-col justify-between"
                style={{ width: 26, height: 7 * CELL + 6 * GAP }}
              >
                {/* Segunda, quarta e sexta só: sete rótulos de 13px se tocariam. */}
                {WEEKDAYS.map((d, i) => (
                  <span
                    key={d}
                    className="text-[10px] leading-[13px] text-[var(--text-tertiary)]"
                    style={{ height: CELL, visibility: i % 2 === 1 ? "visible" : "hidden" }}
                  >
                    {d}
                  </span>
                ))}
              </div>
              <Heatmap
                cells={grid.cells}
                columns={grid.weeks}
                color={colour}
                cell={CELL}
                gap={GAP}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <MonoLabel className="mb-3 block">Taxa por dia da semana</MonoLabel>
        <StatusList rows={weekdayRows(weekdays)} />
      </section>
    </div>
  );
}

/**
 * O melhor dia da semana — e a frase honesta sobre ele.
 *
 * Duas armadilhas, e a dirigida da fase 4 caiu na segunda:
 *
 * 1. **Amostra.** Um domingo que apareceu duas vezes e teve um treino não é
 *    "100% aos domingos", é ruído. O piso de `MIN_SAMPLE` é o mínimo para a
 *    razão dizer alguma coisa.
 * 2. **Empate.** A primeira versão pegava o último da lista ordenada e o
 *    chamava de "o mais fraco". Com Seg, Qua e Sáb todos em 17/17, a tela
 *    anunciou *"o mais fraco é sáb"* sobre um dia de 100% — o desempate de um
 *    `sort` virou uma afirmação sobre a vida do usuário. Agora o pior só é
 *    citado quando ele é, de fato, PIOR; e quando há empate no topo, a frase diz
 *    isso, que é a informação verdadeira.
 */
const MIN_SAMPLE = 3;

function rankWeekdays(weekdays: WeekdayStat[]): {
  best: WeekdayStat | undefined;
  hint: string;
} {
  const rate = (w: WeekdayStat) => w.done / w.total;
  const ranked = [...weekdays]
    .filter((w) => w.total >= MIN_SAMPLE)
    .sort((a, b) => rate(b) - rate(a));

  const best = ranked[0];
  if (!best) return { best: undefined, hint: "sem dias suficientes para comparar" };

  const pct = Math.round(rate(best) * 100);
  const name = (w: WeekdayStat) => WEEKDAYS[w.weekday].toLowerCase();
  const tied = ranked.filter((w) => Math.abs(rate(w) - rate(best)) < 1e-9);

  if (tied.length > 1) {
    const others = tied.slice(1).map(name);
    const list =
      others.length === 1
        ? others[0]
        : `${others.slice(0, -1).join(", ")} e ${others[others.length - 1]}`;
    return { best, hint: `${pct}% — empatado com ${list}` };
  }

  const worst = ranked[ranked.length - 1];
  if (rate(worst) < rate(best)) {
    return { best, hint: `${pct}% dos ${name(best)}s · o mais fraco é ${name(worst)}` };
  }
  return { best, hint: `${pct}% dos ${name(best)}s` };
}

/** Uma linha por dia da semana: o LED tinge, a SegBar mede, o valor conta. */
function weekdayRows(weekdays: WeekdayStat[]): StatusRow[] {
  return weekdays.map((w) => {
    const rate = w.total > 0 ? w.done / w.total : 0;
    return {
      id: String(w.weekday),
      label: WEEKDAYS[w.weekday],
      value: (
        <span className="tabular">
          {w.done}
          <span className="text-[var(--text-tertiary)]">/{w.total}</span>
        </span>
      ),
      // O tom acompanha a taxa, mas o número está SEMPRE lá: a cor tinge, não
      // codifica (ADR-0017). Sem amostra, o LED fica apagado em vez de vermelho —
      // "não sei" não é "ruim".
      tone: w.total === 0 ? "muted" : rate >= 0.6 ? "sphere" : rate >= 0.3 ? "warning" : "danger",
      progress: rate,
    };
  });
}

/**
 * A grade do heatmap: colunas = semanas, linhas = dias da semana.
 *
 * O `Heatmap` desenha linha a linha, então as células saem em ordem
 * **weekday-major**: os sete domingos da janela, depois as sete segundas, e
 * assim por diante. É a transposição do que o backend devolve (uma lista de dias
 * em ordem cronológica), e ela é o motivo de o mês ganhar uma coluna a que
 * pertencer.
 *
 * As bordas ficam vazias de propósito: a primeira semana começa no domingo
 * anterior ao primeiro dia com dado, e os dias que não existem na janela viram
 * células nulas. Sem esse alinhamento, cada período desenharia as linhas numa
 * fase diferente e "as segundas-feiras" deixaria de ser uma linha.
 */
function buildGrid(cells: HeatmapCell[]): {
  cells: HeatCell[];
  weeks: number;
  months: string[];
} {
  if (cells.length === 0) return { cells: [], weeks: 0, months: [] };

  const byDay = new Map(cells.map((c) => [c.day, c]));
  const first = new Date(`${cells[0].day}T12:00:00`);
  const last = new Date(`${cells[cells.length - 1].day}T12:00:00`);

  // O domingo da primeira semana, para as colunas alinharem.
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());

  const days: Date[] = [];
  for (const d = new Date(start); d <= last; d.setDate(d.getDate() + 1)) {
    days.push(new Date(d));
  }
  const weeks = Math.ceil(days.length / 7);

  // weekday-major: para cada linha (dia da semana), uma célula por semana.
  const grid: HeatCell[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let week = 0; week < weeks; week++) {
      const d = days[week * 7 + weekday];
      if (!d) {
        grid.push({ value: null });
        continue;
      }
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
      const cell = byDay.get(key);
      const label = d.toLocaleDateString("pt-BR");
      if (!cell) {
        grid.push({ value: null });
      } else if (cell.status === "done") {
        grid.push({ value: 1, title: `${label} — treinou` });
      } else {
        grid.push({ value: 0, title: `${label} — não treinou` });
      }
    }
  }

  return { cells: grid, weeks, months: monthLabels(days, weeks) };
}

/**
 * Quantas colunas dois rótulos de mês precisam ter entre si para não colidirem.
 *
 * Uma coluna tem 16px (célula + vão) e "mar" ocupa ~20px, então rótulos em
 * colunas vizinhas se sobrepõem — foi o que a dirigida da fase 4 mostrou, com
 * "mar" e "abr" saindo na tela como **"maabr"**. Três colunas dão 48px, folga
 * suficiente para qualquer abreviação de três letras.
 */
const MONTH_LABEL_GAP = 3;

/**
 * O rótulo de mês entra na coluna em que o mês MUDA, e só nela — repetir "jul"
 * em dezesseis colunas é ruído.
 *
 * A regra de colisão não é "esconda o segundo": é **não nomear um mês que mal
 * aparece**. A janela quase sempre começa no meio de um mês, e essa ponta de uma
 * ou duas semanas não merece um rótulo que vai empurrar o do mês seguinte. Então
 * a coluna 0 só se nomeia se o primeiro mês tiver largura para isso; senão a
 * grade começa anônima e o primeiro nome é o do primeiro mês INTEIRO, que é o
 * que alguém procura ao ler "onde junho começa".
 */
function monthLabels(days: Date[], weeks: number): string[] {
  const changes: Array<{ column: number; month: number }> = [];
  for (let week = 0; week < weeks; week++) {
    const d = days[week * 7];
    if (!d) continue;
    const previous = week > 0 ? days[(week - 1) * 7] : undefined;
    if (!previous || previous.getMonth() !== d.getMonth()) {
      changes.push({ column: week, month: d.getMonth() });
    }
  }

  const labels = Array.from({ length: weeks }, () => "");
  let lastLabelled = -MONTH_LABEL_GAP;
  changes.forEach(({ column, month }, i) => {
    // A ponta inicial: só se nomeia se o mês seguinte não estiver colado nela.
    if (i === 0) {
      const next = changes[1];
      if (next && next.column < MONTH_LABEL_GAP) return;
    }
    if (column - lastLabelled < MONTH_LABEL_GAP) return;
    labels[column] = MONTHS[month];
    lastLabelled = column;
  });
  return labels;
}
