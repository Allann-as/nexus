/**
 * As Temporadas na tela de Gamificação: o placar, o estado e o ciclo de vida.
 *
 * "Vencida" é derivada no backend (ADR-0036) — aqui só se pinta. Uma temporada
 * manual ganha +/- para marcar o dia; uma de hábito conta os ticks sozinha.
 *
 * O fim de uma temporada tem DOIS gestos, e eles não são sinônimos:
 *
 *   * **Abandonar** é um resultado. Você tentou e largou; a temporada continua
 *     na lista, marcada como "Abandonada". É história, e história se guarda.
 *   * **Excluir** é uma correção. A temporada nunca deveria ter existido —
 *     duplicata, erro de digitação — e some da lista.
 *
 * Por isso "Abandonar" só aparece enquanto a temporada está ativa (só se
 * abandona o que ainda está de pé), e "Excluir" aparece em qualquer estado.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Minus, Plus, Trophy } from "lucide-react";

import {
  abandonChallenge,
  deleteChallenge,
  incrementChallenge,
  type Challenge,
  type ChallengeState,
} from "../../lib/ipc";
import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Button, Card, EmptyState } from "../../design-system/primitives";
import { ProgressBar } from "../../design-system/charts";
import { useToasts } from "../../stores/toasts";
import { NewChallengeModal } from "./NewChallengeModal";

const STATE: Record<ChallengeState, { label: string; color: string }> = {
  active: { label: "Ativa", color: "var(--accent)" },
  done: { label: "Vencida", color: "var(--success)" },
  expired: { label: "Encerrada", color: "var(--warning)" },
  dropped: { label: "Abandonada", color: "var(--text-tertiary)" },
};

export function ChallengesSection({
  challenges,
  loading,
}: {
  challenges: Challenge[];
  loading: boolean;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={15} aria-hidden />
          Nova temporada
        </Button>
      </div>

      {challenges.length === 0 && !loading ? (
        <Card className="p-0">
          <EmptyState
            icon={Trophy}
            title="Nenhuma temporada ainda"
            hint="Uma temporada é uma fase de jogo: um objetivo mensurável num ciclo de 30 ou 90 dias, ligado a um hábito ou marcado à mão."
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {challenges.map((c) => (
            <ChallengeCard key={c.id} challenge={c} />
          ))}
        </div>
      )}

      {creating && <NewChallengeModal onClose={() => setCreating(false)} />}
    </>
  );
}

function ChallengeCard({ challenge: c }: { challenge: Challenge }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const state = STATE[c.state];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["challenges"] });
    qc.invalidateQueries({ queryKey: ["gamification"] });
  };

  const bump = useMutation({
    mutationFn: (delta: number) => incrementChallenge(c.id, delta),
    onSuccess: invalidate,
    onError: pushError,
  });
  const drop = useMutation({
    mutationFn: () => abandonChallenge(c.id),
    onSuccess: invalidate,
    onError: pushError,
  });
  // Excluir usa as mesmas chaves do abandono: a lista muda e o placar geral da
  // gamificação também, porque uma temporada a menos é um denominador a menos.
  const remove = useMutation({
    mutationFn: () => deleteChallenge(c.id),
    onSuccess: () => {
      push("success", "Temporada excluída");
      invalidate();
    },
    onError: pushError,
  });

  const isManual = c.metric === "manual";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{c.title}</h3>
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {c.habitTitle ? `Hábito: ${c.habitTitle}` : "Contador manual"} ·{" "}
            {c.startsOn} → {c.endsOn}
          </p>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
          style={{
            background: `color-mix(in oklab, ${state.color} 16%, transparent)`,
            color: state.color,
          }}
        >
          {state.label}
        </span>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="tabular font-mono text-[20px] font-semibold text-[var(--text-primary)]">
          {c.progressCount}
          <span className="text-[13px] text-[var(--text-tertiary)]"> / {c.targetCount}</span>
        </span>
        {c.state === "active" && (
          <span className="tabular text-[11px] text-[var(--text-tertiary)]">
            {c.daysLeft >= 0 ? `${c.daysLeft} dias restantes` : "prazo encerrado"}
          </span>
        )}
      </div>
      <ProgressBar value={c.progressRatio} color={state.color} className="mt-2" />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {c.state === "active" && isManual && (
          <>
            <Button
              variant="ghost"
              onClick={() => bump.mutate(-1)}
              disabled={bump.isPending || c.progressCount <= 0}
              aria-label="Menos um"
            >
              <Minus size={15} aria-hidden />
            </Button>
            <Button
              variant="secondary"
              onClick={() => bump.mutate(1)}
              disabled={bump.isPending}
            >
              <Plus size={15} aria-hidden />
              Marcar dia
            </Button>
          </>
        )}

        {/* Os dois desfechos, juntos à direita mas nunca iguais: abandonar é
            âmbar e mantém a temporada na lista; excluir é vermelho e a tira de
            lá. O título de cada um diz em voz alta qual é qual. */}
        <div className="ml-auto flex items-center gap-2">
          {c.state === "active" && (
            <button
              onClick={() => drop.mutate()}
              disabled={drop.isPending}
              title="Marcar como abandonada — a temporada continua na lista, como história"
              className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--warning)]"
            >
              <Ban size={13} aria-hidden />
              Abandonar
            </button>
          )}
          <ArmedDelete
            label="Excluir"
            onConfirm={() => remove.mutate()}
            pending={remove.isPending}
            question="Excluir esta temporada?"
            ariaLabel={`Excluir a temporada ${c.title} — para uma que nunca deveria ter existido`}
          />
        </div>
      </div>
    </Card>
  );
}
