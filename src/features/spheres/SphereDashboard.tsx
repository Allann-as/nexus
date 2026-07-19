/**
 * O painel de uma Esfera: HeroCard + StatCards + SummaryCard.
 *
 * Esta é a forma que TODA Esfera tem, independente do template (§2.2). O que
 * muda por template é o que entra em cada slot — e isso chega no M3.5/M4, quando
 * existirem aportes, exames e livros para pôr neles. Hoje o painel mostra o que
 * o NEXUS realmente sabe sobre a Esfera: hábitos, streak e trabalho em aberto.
 *
 * Todo número aqui vem do mesmo `sphere_overview` que alimenta o card do Hub.
 * Duas telas divergindo sobre o mesmo dado seria pior que uma tela a menos.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckSquare, Flame, FolderKanban, Plus, Repeat } from "lucide-react";

import type { Area, SphereCard } from "../../lib/ipc";
import { CountUp, HeroCard, StatCard, SummaryCard, Val } from "../../design-system/cards";
import { ProgressRing, Sparkline } from "../../design-system/charts";
import { Button, EmptyState } from "../../design-system/primitives";
import { HabitCreateForm } from "../habits/HabitsScreen";

export function SphereDashboard({
  sphere,
  card,
}: {
  sphere: Area;
  card: SphereCard | undefined;
}) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  if (!card) {
    return <div className="h-[420px] animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  // Uma Esfera vazia (Casa, nota 2) NÃO pode ser um deserto que chuta o usuário
  // para a tela global de Hábitos (C7). Ela nasce digna: a criação é CONTEXTUAL
  // aqui mesmo (a Esfera já vem escolhida), e o texto aponta as abas que já são
  // dela — Metas, Agenda, Checklists. O primeiro hábito acende o painel inteiro.
  if (card.isEmpty) {
    return (
      <div className="flex flex-col gap-4">
        {adding ? (
          <HabitCreateForm presetAreaId={sphere.id} onDone={() => setAdding(false)} />
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-14">
            <EmptyState
              icon={Repeat}
              title={`${sphere.name} começa aqui`}
              hint="Um hábito é o primeiro batimento de uma Esfera: crie um agendado para hoje e o painel — anel do dia, streak, tendência de 30 dias — ganha vida. Metas, Agenda e Checklists também são desta Esfera, nas abas acima."
              action={
                <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
                  Adicionar hábito
                </Button>
              }
            />
          </div>
        )}
      </div>
    );
  }

  const { habitsTodayDone: done, habitsTodayTotal: total } = card;
  const ratio = total > 0 ? done / total : 0;

  // A média dos últimos 30 dias — o mesmo array que desenha o sparkline, então
  // o número e a forma nunca discordam.
  const avg30 = card.spark.length
    ? card.spark.reduce((a, b) => a + b, 0) / card.spark.length
    : 0;

  return (
    <div className="space-y-4">
      <HeroCard
        label={`Hoje em ${sphere.name}`}
        value={total > 0 ? `${done}/${total}` : "—"}
        hint={
          total > 0
            ? `${Math.round(ratio * 100)}% dos hábitos de hoje desta Esfera`
            : "Nenhum hábito desta Esfera é agendado para hoje"
        }
        aside={
          <div className="flex items-center gap-5">
            <Sparkline data={card.spark} width={132} height={46} />
            <ProgressRing value={ratio} size={72} thickness={6}>
              <span className="tabular text-[15px] font-semibold">
                {Math.round(ratio * 100)}%
              </span>
            </ProgressRing>
          </div>
        }
      />

      <div className="grid grid-cols-4 gap-3">
        <StatCard
          icon={Flame}
          label="Streak vivo"
          value={<CountUp to={card.bestStreak} />}
          unit="dias"
          tone={card.bestStreak >= 7 ? "warning" : "sphere"}
        />
        <StatCard
          icon={Repeat}
          label="Média 30 dias"
          value={<CountUp to={Math.round(avg30 * 100)} />}
          unit="%"
          tone="sphere"
        />
        <StatCard
          icon={CheckSquare}
          label="Tarefas abertas"
          value={<CountUp to={card.openTasks} />}
          tone={card.openTasks > 0 ? "accent" : "sphere"}
          onClick={() => navigate("/goals")}
        />
        <StatCard
          icon={FolderKanban}
          label="Projetos"
          value={<CountUp to={card.openProjects} />}
          tone="sphere"
          onClick={() => navigate("/goals")}
        />
      </div>

      <SummaryCard>{summary(card)}</SummaryCard>
    </div>
  );
}

/**
 * A frase do SummaryCard, por template determinístico.
 *
 * Zero IA (constituição §2): isto é uma sequência de `if`s sobre os mesmos
 * números que os cards acima mostram. A frase não pode saber nada que a tela
 * não mostre — ela é uma leitura dos dados, não uma opinião sobre eles.
 */
function summary(card: SphereCard) {
  const { habitsTodayDone: done, habitsTodayTotal: total } = card;
  const open = card.openTasks + card.openProjects;

  // Cada parte é uma oração solta, sem conectivo: quem junta é o laço abaixo.
  // Embutir o "e" numa delas faria a frase depender de quais outras existem.
  const parts: React.ReactNode[] = [];

  if (total > 0) {
    parts.push(
      <>
        hoje você cumpriu <Val>{done}</Val> de <Val>{total}</Val>{" "}
        {total === 1 ? "hábito" : "hábitos"} desta Esfera
      </>,
    );
  }

  if (card.bestStreak > 0 && card.bestStreakTitle) {
    parts.push(
      <>
        <Val tone="warning">{card.bestStreakTitle}</Val> acumula{" "}
        <Val tone="warning">{card.bestStreak} dias</Val> seguidos
      </>,
    );
  }

  if (open > 0) {
    parts.push(
      <>
        há <Val tone="accent">{open}</Val> {open === 1 ? "item" : "itens"} em aberto
      </>,
    );
  }

  if (parts.length === 0) {
    return "Esta Esfera existe, mas ainda não tem sinal de vida — nada agendado para hoje e nada em aberto.";
  }

  // "A", "A e B", "A, B e C". Sem Intl.ListFormat porque as partes são JSX, não
  // string — ele formata texto, não nós.
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && (i === parts.length - 1 ? " e " : ", ")}
          {part}
        </span>
      ))}
      .
    </>
  );
}
