/**
 * A lista de metas de uma Esfera — ou de todas.
 *
 * Um componente e dois donos: a tab "Metas" da tela de Esfera (`areaId` = a
 * Esfera) e a visão agregada em `/goals` (`areaId` = null). São a mesma
 * pergunta com escopos diferentes, e duas implementações divergiriam no dia em
 * que só uma ganhasse um campo.
 */

import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";

import { EmptyState } from "../../design-system/primitives";
import { Button } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import {
  addGoalCheckpoint,
  addMilestone,
  createHabit,
  deleteNode,
  goalWithProgress,
  listAreas,
  listGoals,
  moveMilestone,
  setGoalHabit,
  setGoalProgressSource,
  setMilestoneDone,
  type MilestoneView,
  type ProgressSource,
} from "../../lib/ipc";
import { GoalCard } from "./GoalCard";
import { NewGoalModal } from "./NewGoalModal";

export function GoalsList({ areaId }: { areaId: string | null }) {
  const client = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  const [creating, setCreating] = useState(false);

  const { data: goals = [] } = useQuery({
    queryKey: ["goals", areaId ?? "all"],
    queryFn: () => listGoals(areaId),
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", "all"],
    queryFn: () => listAreas(true),
    staleTime: 5 * 60_000,
  });

  // Uma query por meta: `goal_with_progress` já traz barra, série, árvore e
  // projeção numa chamada, então "N metas" são N chamadas e não 4N. Uma rota
  // que trouxesse tudo de uma vez existiria só para esta tela e teria que ser
  // mantida em paralelo à que a tela de UMA meta usa.
  const details = useQueries({
    queries: goals.map((g) => ({
      queryKey: ["goal", g.id],
      queryFn: () => goalWithProgress(g.id),
    })),
  });

  const refresh = (goalId: string) => {
    void client.invalidateQueries({ queryKey: ["goal", goalId] });
    void client.invalidateQueries({ queryKey: ["goals"] });
  };

  const toggle = useMutation({
    mutationFn: ({ m, done }: { m: MilestoneView; done: boolean }) =>
      setMilestoneDone(m.id, done),
    onSuccess: (_r, { m, done }) => {
      refresh(m.goalId);
      // A micro-celebração: concluir um sub-desafio é um acontecimento pequeno,
      // e o toast é do tamanho dele. A conquista dourada da META inteira é do
      // ledger, e ela aparece na Timeline (M4).
      if (done) push("success", "Sub-desafio concluído");
    },
    onError: pushError,
  });

  const add = useMutation({
    mutationFn: ({ goalId, title }: { goalId: string; title: string }) =>
      addMilestone({ goalId, title }),
    onSuccess: (_r, { goalId }) => refresh(goalId),
    onError: pushError,
  });

  /* O sub-desafio que RENOVA TODO DIA: um hábito diário mais o 'counter' que ele
     alimenta (§4 da 0007). Duas chamadas e não uma transação porque são dois
     nodes de espécies diferentes, e o desfecho parcial é benigno: se a segunda
     falhar, sobra um hábito diário — uma coisa útil e deletável. A ordem
     inversa deixaria um contador sem quem o contasse, que é o estado inútil.

     `areaId` do hábito é o da META, não o filtro da tela: um sub-desafio de uma
     meta de Saúde tem que aparecer nos Checkpoints de Saúde mesmo que a lista
     esteja em "Todas". */
  const addDaily = useMutation({
    mutationFn: async ({
      goalId,
      goalAreaId,
      title,
      targetCount,
    }: {
      goalId: string;
      goalAreaId: string | null;
      title: string;
      targetCount: number;
    }) => {
      const habit = await createHabit({
        title,
        areaId: goalAreaId,
        schedule: { type: "daily" },
      });
      return addMilestone({
        goalId,
        title,
        kind: "counter",
        habitId: habit.id,
        targetCount,
      });
    },
    onSuccess: (_r, { goalId }) => {
      refresh(goalId);
      // O hábito novo entra no checklist de hoje da Esfera e no Hub — as duas
      // telas que ninguém recarrega a partir daqui.
      void client.invalidateQueries({ queryKey: ["habits"] });
      void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
      push("success", "Hábito diário criado e ligado à meta");
    },
    onError: pushError,
  });

  /* Religar o hábito de uma constância que ficou sem um — porque o hábito foi
     excluído (a 0018 zera o vínculo, ADR-0078) ou porque a meta foi criada sem.
     Criar um novo é o caminho de um clique; escolher entre os que já existem
     seria uma lista dentro de um card, e o card não é o lugar disso. */
  const linkHabit = useMutation({
    mutationFn: async ({
      goalId,
      goalAreaId,
      title,
    }: {
      goalId: string;
      goalAreaId: string | null;
      title: string;
    }) => {
      const habit = await createHabit({
        title,
        areaId: goalAreaId,
        schedule: { type: "daily" },
      });
      return setGoalHabit(goalId, habit.id);
    },
    onSuccess: (_r, { goalId }) => {
      refresh(goalId);
      void client.invalidateQueries({ queryKey: ["habits"] });
      void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
      push("success", "Hábito ligado — marque o dia para a meta andar");
    },
    onError: pushError,
  });

  const move = useMutation({
    mutationFn: ({ m, toIndex }: { m: MilestoneView; toIndex: number }) =>
      moveMilestone(m.id, toIndex),
    onSuccess: (_r, { m }) => refresh(m.goalId),
    onError: pushError,
  });

  const checkpoint = useMutation({
    mutationFn: ({ goalId, value }: { goalId: string; value: number }) =>
      addGoalCheckpoint(goalId, value),
    onSuccess: (_r, { goalId }) => refresh(goalId),
    onError: pushError,
  });

  /* Apagar um degrau. O `refresh` da meta basta: um sub-desafio não sai do card
     dela para lugar nenhum, e a barra que ele movia já é recalculada pelo
     `goal_with_progress` que volta. Quem apaga aqui costuma apagar um erro de
     digitação, então o toast é curto — a história de que ele existiu fica no
     ledger (ADR-0056). */
  const removeMilestone = useMutation({
    mutationFn: ({ m }: { m: MilestoneView }) => deleteNode(m.id),
    onSuccess: (_r, { m }) => {
      refresh(m.goalId);
      push("success", "Sub-desafio excluído");
    },
    onError: pushError,
  });

  /* Apagar a meta inteira. Aqui o `refresh` NÃO basta: uma meta a menos muda o
     que a Esfera mostra no Hub e o que a gamificação conta, e essas duas telas
     não são recarregadas por ninguém nesta rota. A chave da meta some junto —
     invalidar ["goal", id] deixaria o React Query buscando um nó que não existe
     mais; o que se remove é o cache dela. */
  const remove = useMutation({
    mutationFn: ({ goalId }: { goalId: string }) => deleteNode(goalId),
    onSuccess: (_r, { goalId }) => {
      client.removeQueries({ queryKey: ["goal", goalId] });
      void client.invalidateQueries({ queryKey: ["goals"] });
      void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
      void client.invalidateQueries({ queryKey: ["gamification"] });
      push("success", "Meta excluída");
    },
    onError: pushError,
  });

  const source = useMutation({
    mutationFn: ({ goalId, src }: { goalId: string; src: ProgressSource }) =>
      setGoalProgressSource(goalId, src),
    onSuccess: (_r, { goalId }) => refresh(goalId),
    onError: pushError,
  });

  const colourOf = (id: string | null) =>
    (id && areas.find((a) => a.id === id)?.color) || "var(--accent)";

  const loaded = details.filter((d) => d.data).map((d) => d.data!);

  if (goals.length === 0) {
    return (
      <>
        <EmptyState
          icon={Target}
          title="Nenhuma meta ainda"
          hint="Uma meta tem uma métrica, um alvo e um prazo — e sub-desafios que você marca no caminho. Registre dois checkpoints e o NEXUS projeta quando você chega lá."
        />
        <div className="mt-4 flex justify-center">
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Nova meta
          </Button>
        </div>
        {creating && (
          <NewGoalModal
            areas={areas.filter((a) => !a.archivedAt)}
            defaultAreaId={areaId}
            onClose={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              void client.invalidateQueries({ queryKey: ["goals"] });
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
          Nova meta
        </Button>
      </div>

      {loaded.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          colour={colourOf(goal.areaId)}
          onToggleMilestone={(m, done) => toggle.mutate({ m, done })}
          onAddMilestone={(title) => add.mutate({ goalId: goal.id, title })}
          onMoveMilestone={(m, toIndex) => move.mutate({ m, toIndex })}
          onCheckpoint={(value) => checkpoint.mutate({ goalId: goal.id, value })}
          onSetSource={(src) => source.mutate({ goalId: goal.id, src })}
          onDelete={() => remove.mutate({ goalId: goal.id })}
          deleting={remove.isPending && remove.variables?.goalId === goal.id}
          onDeleteMilestone={(m) => removeMilestone.mutate({ m })}
          deletingMilestoneId={
            removeMilestone.isPending ? (removeMilestone.variables?.m.id ?? null) : null
          }
          onAddDailyMilestone={(title, targetCount) =>
            addDaily.mutate({ goalId: goal.id, goalAreaId: goal.areaId, title, targetCount })
          }
          onLinkHabit={() =>
            linkHabit.mutate({ goalId: goal.id, goalAreaId: goal.areaId, title: goal.title })
          }
        />
      ))}

      {creating && (
        <NewGoalModal
          areas={areas.filter((a) => !a.archivedAt)}
          defaultAreaId={areaId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void client.invalidateQueries({ queryKey: ["goals"] });
          }}
        />
      )}
    </div>
  );
}
