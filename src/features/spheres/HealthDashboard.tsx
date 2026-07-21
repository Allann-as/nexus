/**
 * O painel da Saúde — recomposto na v1.3 (fase 4) no vocabulário COCKPIT.
 *
 * A pergunta da Esfera não mudou: *"como está meu dia de saúde?"*. O que mudou é
 * a língua com que ela é respondida. Até aqui, as Esferas ainda falavam
 * `HeroCard`/`StatCard`/`SummaryCard` — o vocabulário do Midnight. A fase 1
 * construiu o do COCKPIT (`instruments.tsx`) e a fase 2 migrou a Home; as Esferas
 * ficaram para trás, e o app falava dois idiomas dependendo de onde se clicava.
 *
 * A diferença que se vê, e que não é cosmética:
 *
 *   * o `StatCard` era número + rótulo. **Três caixas com um número cada numa
 *     página larga é a esparsidão que o dono reprovou.** O `StatTile` exige um
 *     elemento VIVO — anel, série ou medidor segmentado —, então cada número
 *     passa a carregar a própria história.
 *   * o anel do dia ganha a **SegBar** ao lado: o anel dá a forma de relance, a
 *     barra segmentada dá a leitura precisa sem obrigar a ler o número (é a
 *     mesma decisão que matou o velocímetro na Home, ADR-0076).
 *   * o próximo exame deixa de ser um `StatCard` com "4d" e vira uma linha de
 *     agenda de verdade, com o nome, o dia e o lugar — o número sozinho não
 *     dizia QUAL exame, e era isso que o usuário precisava saber.
 */

import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarClock, CheckSquare, Flame, MapPin } from "lucide-react";

import type { Area, SphereCard } from "../../lib/ipc";
import { eventsByCategory } from "../../lib/ipc";
import { CountUp, StatTile } from "../../design-system/cards";
import { Sparkline } from "../../design-system/charts";
import { MonoLabel, Ring, SegBar } from "../../design-system/instruments";
import { EmptyState, cx } from "../../design-system/primitives";
import { fromDay, toDay } from "../calendar/grid";

function daysUntil(day: string): number {
  const today = fromDay(toDay(new Date()));
  return Math.round((fromDay(day).getTime() - today.getTime()) / 86_400_000);
}

/** "4d" / "hoje" / "amanhã" — e "—" quando não há exame nenhum. */
function countdown(days: number | null): string {
  if (days === null) return "—";
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  return `${days}d`;
}

export function HealthDashboard({
  sphere,
  card,
}: {
  sphere: Area;
  card: SphereCard | undefined;
}) {
  const { data: exams = [] } = useQuery({
    queryKey: ["events", "category", "exame"],
    queryFn: () => eventsByCategory("exame", 1),
  });
  const nextExam = exams[0];

  if (!card) {
    return <div className="h-[420px] animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  if (card.isEmpty) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16">
        <EmptyState
          icon={Activity}
          title={`${sphere.name} está vazia`}
          hint="Os checkpoints da Saúde são hábitos: água, treino, sono, sol. Crie um hábito ligado a esta Esfera e o painel ganha vida."
        />
      </div>
    );
  }

  const { habitsTodayDone: done, habitsTodayTotal: total } = card;
  const ratio = total > 0 ? done / total : 0;
  const avg30 = card.spark.length
    ? Math.round((card.spark.reduce((a, b) => a + b, 0) / card.spark.length) * 100)
    : 0;
  const examDays = nextExam ? daysUntil(nextExam.day) : null;
  const examSoon = examDays !== null && examDays >= 0 && examDays < 7;

  /* A comparação honesta da tendência: a média dos últimos 7 dias contra a dos 7
     anteriores. Só existe com 14 dias de série — com menos, um "delta" seria
     ruído apresentado como sinal, e o NEXUS não chuta (ADR-0037). */
  const delta = (() => {
    if (card.spark.length < 14) return undefined;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const recent = mean(card.spark.slice(-7));
    const previous = mean(card.spark.slice(-14, -7));
    const points = Math.round((recent - previous) * 100);
    return points === 0 ? undefined : { value: points, suffix: "pp" };
  })();

  return (
    <div className="flex flex-col gap-4">
      {/* ===== o dia, em anel e em barra =====
          O anel responde "quanto do dia está fechado" de relance; a SegBar dá a
          precisão. Os dois lados do mesmo número, que é o padrão do Cockpit. */}
      <section
        className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] p-5"
        style={{
          background:
            "linear-gradient(135deg, var(--bg-surface) 0%, color-mix(in srgb, var(--sphere) 9%, var(--bg-surface)) 100%)",
        }}
      >
        <div className="flex items-center gap-6">
          <Ring value={ratio} size={104} thickness={9} label="do dia" />

          <div className="min-w-0 flex-1">
            <MonoLabel>Dia de saúde</MonoLabel>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="tabular text-[38px] leading-[42px] font-bold tracking-[-0.03em] text-[var(--text-primary)]">
                <CountUp to={done} />
                <span className="text-[var(--text-tertiary)]">/{total}</span>
              </span>
              <span className="text-[13px] text-[var(--text-secondary)]">checkpoints</span>
            </div>
            <SegBar value={ratio} segments={total > 0 ? Math.max(total, 12) : 12} className="mt-3" />
            <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
              {total === 0
                ? "Nenhum checkpoint hoje — a Saúde não pede nada de você."
                : done === total
                  ? "Dia fechado. Constância é isto — de novo amanhã."
                  : `${total - done} ${total - done === 1 ? "checkpoint" : "checkpoints"} para fechar o dia`}
            </p>
          </div>

          {/* A tendência de 30 dias como dado VIVO, e não só uma média num card
              (C6): a série já vem no `card.spark` — fração de checkpoints
              cumpridos por dia. */}
          {card.spark.length >= 2 && (
            <div className="hidden w-[280px] shrink-0 lg:block">
              <div className="mb-1.5 flex items-baseline justify-between">
                <MonoLabel>30 dias</MonoLabel>
                <span className="tabular text-[11px] text-[var(--text-secondary)]">
                  {avg30}% de média
                </span>
              </div>
              <Sparkline
                data={card.spark}
                color="var(--sphere)"
                width={280}
                height={46}
                className="w-full"
              />
            </div>
          )}
        </div>
      </section>

      {/* Cada tile carrega o próprio vivo: o streak em série, o dia em anel, a
          média em sparkline. Nenhum número sozinho numa caixa vazia. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* Este tile fica SEM elemento vivo, e é de propósito. A tentação era
            pendurar `card.spark` aqui para nenhuma caixa ficar "vazia" — mas
            aquela série é a conclusão dos checkpoints da Esfera INTEIRA, e não
            tem relação nenhuma com a história deste streak. Um gráfico bonito
            sob um rótulo que ele não descreve é pior que um número sozinho: ele
            é lido, e mente. O que salva o tile da esparsidão é o `hint`, que diz
            QUAL hábito acumula os dias — a informação que faltava. */}
        <StatTile
          icon={Flame}
          label="Maior streak"
          value={<CountUp to={card.bestStreak} />}
          unit="dias"
          tone="warning"
          hint={card.bestStreakTitle ?? undefined}
        />
        <StatTile
          icon={CheckSquare}
          label="Feitos hoje"
          value={
            <>
              <CountUp to={done} />
              <span className="text-[var(--text-tertiary)]">/{total}</span>
            </>
          }
          ring={ratio}
        />
        <StatTile
          icon={Activity}
          label="Média 30 dias"
          value={<CountUp to={avg30} suffix="%" />}
          seg={avg30 / 100}
          delta={delta}
          hint={delta ? "vs. os 7 dias anteriores" : undefined}
        />
        <StatTile
          icon={CalendarClock}
          label="Próximo exame"
          tone={examSoon ? "warning" : "sphere"}
          value={countdown(examDays)}
          hint={nextExam?.title}
        />
      </div>

      {/* O exame por extenso. Um "4d" no tile diz QUANDO; esta linha diz O QUÊ,
          onde e a que horas — que é o que faz alguém não perder a consulta. */}
      {nextExam && (
        <div
          className={cx(
            "flex items-center gap-3 rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] px-4 py-3",
            examSoon ? "border-[var(--warning)]" : "border-[var(--border-subtle)]",
          )}
        >
          <CalendarClock
            size={16}
            className={examSoon ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]"}
          />
          <span className="text-[13px] text-[var(--text-primary)]">{nextExam.title}</span>
          {nextExam.location && (
            <span className="flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
              <MapPin size={11} />
              {nextExam.location}
            </span>
          )}
          <span className="tabular ml-auto text-[12px] text-[var(--text-tertiary)]">
            {new Date(nextExam.startsAt).toLocaleDateString("pt-BR")} ·{" "}
            {new Date(nextExam.startsAt).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      )}
    </div>
  );
}
