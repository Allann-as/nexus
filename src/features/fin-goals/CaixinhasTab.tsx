/**
 * A grade de caixinhas dos Objetivos Financeiros (§2.1).
 *
 * Cada card é uma meta de dinheiro guardado; depositar é um clique. Fechar uma
 * caixinha dispara a celebração dourada e grava a conquista no ledger — que a
 * Timeline (§2.6) desenha para sempre.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, PiggyBank } from "lucide-react";

import { Button, EmptyState } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { formatMoney } from "../../lib/format";
import { deleteFinGoal, listAccounts, listFinGoals, type FinGoalCard } from "../../lib/ipc";
import { CaixinhaCard } from "./CaixinhaCard";
import { DepositModal } from "./DepositModal";
import { NewCaixinhaModal } from "./NewCaixinhaModal";
import { Celebration } from "./Celebration";

export function CaixinhasTab({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [depositFor, setDepositFor] = useState<FinGoalCard | null>(null);
  const [creating, setCreating] = useState(false);
  const [celebrating, setCelebrating] = useState<string | null>(null);

  const goals = useQuery({
    queryKey: ["fin-goals", areaId],
    queryFn: () => listFinGoals(areaId),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["fin-goals"] });
    // A Saúde Financeira e a Timeline mudam quando uma caixinha se move.
    void client.invalidateQueries({ queryKey: ["finance"] });
    void client.invalidateQueries({ queryKey: ["ledger"] });
  };

  /* Uma caixinha criada por engano tinha virado moradia permanente da tela: dava
     para depositar, nunca para desfazer. Excluir leva junto os aportes dela — o
     ESTADO se corrige, e é só o estado; o ledger continua guardando a história de
     cada depósito (ADR-0056), e nada do passado é reescrito. */
  const remove = useMutation({
    mutationFn: (id: string) => deleteFinGoal(id),
    onSuccess: () => {
      push("success", "Caixinha excluída");
      refresh();
    },
    onError: pushError,
  });

  const cards = goals.data ?? [];
  const totalSaved = cards.reduce((s, c) => s + Math.max(0, c.savedCents), 0);
  const totalTarget = cards.reduce((s, c) => s + c.targetCents, 0);

  return (
    <div className="nx-enter">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Caixinhas</h2>
          {cards.length > 0 && (
            <p className="mt-0.5 text-[12.5px] text-[var(--text-tertiary)]">
              <span className="tabular font-medium text-[var(--text-secondary)]">
                {formatMoney(totalSaved)}
              </span>{" "}
              guardados de{" "}
              <span className="tabular">{formatMoney(totalTarget)}</span> ·{" "}
              {cards.length} {cards.length === 1 ? "objetivo" : "objetivos"}
            </p>
          )}
        </div>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
          Nova caixinha
        </Button>
      </header>

      {goals.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <EmptyState
          icon={PiggyBank}
          title="Nenhuma caixinha ainda"
          hint="Crie um objetivo — um PS5, uma viagem — e guarde para ele aos poucos."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Nova caixinha
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <CaixinhaCard
              key={card.id}
              card={card}
              onDeposit={() => setDepositFor(card)}
              onDelete={() => remove.mutate(card.id)}
              onChanged={refresh}
              deleting={remove.isPending && remove.variables === card.id}
            />
          ))}
        </div>
      )}

      {depositFor && (
        <DepositModal
          goal={depositFor}
          onClose={() => setDepositFor(null)}
          onSaved={(completed) => {
            const title = depositFor.title;
            setDepositFor(null);
            refresh();
            if (completed) setCelebrating(title);
          }}
        />
      )}

      {creating && (
        <NewCaixinhaModal
          areaId={areaId}
          accounts={accounts}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}

      {celebrating && (
        <Celebration title={celebrating} onDone={() => setCelebrating(null)} />
      )}
    </div>
  );
}
