/**
 * O painel da Saúde: o dia em anel, os sinais em StatCards, o próximo exame.
 *
 * O HeroCard responde à pergunta da Esfera — "como está meu dia de saúde?" — com
 * os checkpoints feitos sobre o total, e o anel SVG ao lado (análise densa é o
 * treino; aqui o anel é uma forma, ADR-0018). O próximo exame acende quando está
 * a menos de 7 dias.
 */

import { useQuery } from "@tanstack/react-query";
import { Activity, CalendarClock, CheckSquare, Flame } from "lucide-react";

import type { Area, SphereCard } from "../../lib/ipc";
import { eventsByCategory } from "../../lib/ipc";
import { CountUp, HeroCard, StatCard, SummaryCard, Val } from "../../design-system/cards";
import { ProgressRing } from "../../design-system/charts";
import { EmptyState, cx } from "../../design-system/primitives";
import { fromDay, toDay } from "../calendar/grid";

function daysUntil(day: string): number {
  const today = fromDay(toDay(new Date()));
  return Math.round((fromDay(day).getTime() - today.getTime()) / 86_400_000);
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

  return (
    <div className="flex flex-col gap-4">
      <HeroCard
        label="Dia de saúde"
        value={
          <>
            <CountUp to={done} />
            <span className="text-[var(--text-tertiary)]">/{total}</span>
          </>
        }
        hint={`${Math.round(ratio * 100)}% dos checkpoints de hoje`}
        aside={
          <ProgressRing value={ratio} size={104} thickness={9}>
            <span className="tabular text-[20px] font-semibold text-[var(--text-primary)]">
              {Math.round(ratio * 100)}%
            </span>
          </ProgressRing>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          icon={Flame}
          label="Maior streak"
          value={<CountUp to={card.bestStreak} />}
          unit="dias"
        />
        <StatCard
          icon={CheckSquare}
          label="Feitos hoje"
          value={
            <>
              <CountUp to={done} />
              <span className="text-[var(--text-tertiary)]">/{total}</span>
            </>
          }
        />
        <StatCard
          icon={Activity}
          label="Média 30 dias"
          value={<CountUp to={avg30} suffix="%" />}
        />
        <StatCard
          icon={CalendarClock}
          label="Próximo exame"
          tone={examSoon ? "warning" : "sphere"}
          value={
            examDays === null
              ? "—"
              : examDays === 0
                ? "hoje"
                : examDays === 1
                  ? "amanhã"
                  : `${examDays}d`
          }
        />
      </div>

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
          <span className="tabular ml-auto text-[12px] text-[var(--text-tertiary)]">
            {new Date(nextExam.startsAt).toLocaleDateString("pt-BR")}
            {nextExam.location && ` · ${nextExam.location}`}
          </span>
        </div>
      )}

      <SummaryCard>
        Hoje você cumpriu <Val>{done}</Val> de <Val>{total}</Val> checkpoints
        {card.bestStreakTitle && (
          <>
            {" "}
            e <Val tone="accent">{card.bestStreakTitle}</Val> acumula{" "}
            <Val tone="accent">{card.bestStreak}</Val> dias seguidos
          </>
        )}
        .
      </SummaryCard>
    </div>
  );
}
