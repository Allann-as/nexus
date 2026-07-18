/**
 * As Temporadas na tela de Gamificação: o placar, o estado e o ciclo de vida.
 *
 * "Vencida" é derivada no backend (ADR-0036) — aqui só se pinta. Uma temporada
 * manual ganha +/- para marcar o dia; uma de hábito conta os ticks sozinha.
 */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Minus, Plus, Trophy } from "lucide-react";

import {
  abandonChallenge,
  incrementChallenge,
  type Challenge,
  type ChallengeState,
} from "../../lib/ipc";
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

      {c.state === "active" && (
        <div className="mt-3 flex items-center gap-2">
          {isManual && (
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
          <button
            onClick={() => drop.mutate()}
            disabled={drop.isPending}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--warning)]"
          >
            <Ban size={13} aria-hidden />
            Abandonar
          </button>
        </div>
      )}
    </Card>
  );
}
