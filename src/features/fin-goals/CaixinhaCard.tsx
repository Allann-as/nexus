/**
 * Um card-caixinha: ícone, nome, barra grossa com glow, R$ guardado / R$ alvo,
 * badge do banco e a projeção determinística (§2.1).
 *
 * A barra é a herói visual — grossa, na cor da Esfera (o dourado dos Objetivos),
 * com o glow que o `ProgressBar` já desenha. O dinheiro conta até o valor na
 * montagem, como todo número do Midnight.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PiggyBank, Plus, Trophy } from "lucide-react";

import { GoalIcon } from "./GoalIcon";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { ProgressBar } from "../../design-system/charts";
import { useCountUp } from "../../design-system/useCountUp";
import { cx } from "../../design-system/primitives";
import { formatMoney } from "../../lib/format";
import { useToasts } from "../../stores/toasts";
import { deleteFinGoalDeposit, finGoalDeposits, type FinGoalCard } from "../../lib/ipc";

const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** '2026-11' → 'nov/2026'. */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = Number(m) - 1;
  return `${MONTHS[idx] ?? m}/${y}`;
}

export function CaixinhaCard({
  card,
  onDeposit,
  onDelete,
  onChanged,
  deleting = false,
}: {
  card: FinGoalCard;
  onDeposit: () => void;
  onDelete: () => void;
  /** Um depósito saiu do extrato: a lista de caixinhas precisa recarregar. */
  onChanged: () => void;
  /** A exclusão desta caixinha está em voo. */
  deleting?: boolean;
}) {
  const [statement, setStatement] = useState(false);
  // Clamp da % (fase 11, BUG 1): saldo negativo de dado legado (ou over-funding) não
  // pode virar "−247072%" nem estourar a barra. A barra e o texto usam o valor preso
  // em 0..100%; `done` ainda enxerga o over-funding real (>= alvo).
  const rawPct = card.targetCents > 0 ? card.savedCents / card.targetCents : 0;
  const pct = Math.min(1, Math.max(0, rawPct));
  const done = card.status === "done" || rawPct >= 1;
  const animatedSaved = useCountUp(Math.max(0, card.savedCents), 700);

  return (
    <div
      className={cx(
        "group relative flex flex-col gap-3.5 overflow-hidden rounded-[var(--radius-lg)] border p-5",
        "transition-[border-color,transform] duration-[var(--dur-fast)] ease-[var(--ease)]",
        "hover:-translate-y-0.5",
        done
          ? "border-[color-mix(in_srgb,var(--sphere)_45%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_9%,var(--bg-surface))]"
          : "border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-glow)]",
      )}
    >
      {/* O brilho de fundo quando fechada — dourado, discreto, estático. */}
      {done && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full opacity-70"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--sphere) 40%, transparent), transparent 70%)",
          }}
        />
      )}

      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] text-[var(--sphere)]">
            <GoalIcon name={card.emoji} size={20} />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold leading-tight text-[var(--text-primary)]">
              {card.title}
            </h3>
            {card.accountName && (
              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
                <PiggyBank size={11} />
                {card.accountName}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {done && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--sphere)_22%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sphere)]">
              <Trophy size={11} aria-hidden />
              Concluído
            </span>
          )}
          {/* A saída da caixinha mora no mesmo canto de onde ela se anuncia: um
              clique pergunta, o segundo apaga. Os aportes vão junto — o ledger é
              que guarda a história deles. */}
          <ArmedDelete
            onConfirm={onDelete}
            pending={deleting}
            question="Excluir esta caixinha? Os depósitos vão junto."
            ariaLabel="Excluir caixinha"
            overlay
          />
        </div>
      </header>

      {/* O número guardado abre o EXTRATO — a mesma ideia da sparkline da meta:
          o que mostra o total é o que revela as parcelas dele. Até a fase 3c os
          depósitos não tinham tela nenhuma: dava para lançar, nunca para ver nem
          para desfazer. Um R$ 5.000 onde eram R$ 500 ficava inflando o guardado
          e a projeção de quando a caixinha fecha. */}
      <button
        type="button"
        onClick={() => setStatement((s) => !s)}
        aria-expanded={statement}
        aria-label={statement ? "Fechar o extrato" : "Ver o extrato"}
        className="-mx-1 flex items-baseline justify-between gap-2 rounded-[var(--radius-md)] px-1 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)]"
      >
        <span className="tabular text-[22px] font-bold tracking-[-0.02em] text-[var(--text-primary)]">
          {formatMoney(Math.round(animatedSaved))}
        </span>
        <span className="tabular text-[12px] text-[var(--text-tertiary)]">
          de {formatMoney(card.targetCents)}
        </span>
      </button>

      <ProgressBar value={pct} height={10} />

      {statement && <Statement goalId={card.id} onChanged={onChanged} />}

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-[var(--text-secondary)]">
          {done ? (
            "Meta alcançada — parabéns!"
          ) : card.projection.etaMonth ? (
            <>
              No ritmo, conclui em{" "}
              <span className="font-semibold text-[var(--text-primary)]">
                {formatMonth(card.projection.etaMonth)}
              </span>
            </>
          ) : (
            <span className="text-[var(--text-tertiary)]">
              {Math.round(pct * 100)}% guardado
            </span>
          )}
        </span>
        {!done && (
          <button
            onClick={onDeposit}
            className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--sphere)_40%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] px-2.5 py-1 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-[color-mix(in_srgb,var(--sphere)_24%,transparent)]"
          >
            <Plus size={13} />
            Depositar
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * O extrato de uma caixinha, com a saída de cada depósito (v1.3, fase 3c).
 *
 * A query mora AQUI, e não no card, para ser preguiçosa: uma tela com doze
 * caixinhas não pode disparar doze `fin_goal_deposits` no carregamento por causa
 * de uma lista que ninguém abriu. O componente só monta quando o extrato abre.
 *
 * Apagar um depósito não recalcula nada do lado de cá: `savedCents` é a SOMA dos
 * depósitos, feita na leitura (0011). Recarregar a lista já corrige o número
 * grande, a barra e a projeção — a mesma propriedade do aporte excluído
 * (ADR-0056).
 */
function Statement({ goalId, onChanged }: { goalId: string; onChanged: () => void }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const { data: deposits = [], isLoading } = useQuery({
    queryKey: ["fin-goal-deposits", goalId],
    queryFn: () => finGoalDeposits(goalId),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFinGoalDeposit(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["fin-goal-deposits", goalId] });
      onChanged();
      push("success", "Depósito excluído");
    },
    onError: pushError,
  });

  if (isLoading) return null;

  if (deposits.length === 0) {
    return (
      <p className="text-[11.5px] text-[var(--text-tertiary)]">
        Nenhum depósito ainda — o primeiro abre o extrato.
      </p>
    );
  }

  /* `group/linha` NOMEADO, e não `group` solto: o card inteiro já é um `group`,
     e um `group-hover` anônimo casa com QUALQUER ancestral que o tenha — passar
     o mouse no card armava a lixeira de todas as linhas de uma vez. Visto na
     dirigida da fase 3c, corrigido antes de virar hábito. */
  return (
    <ul className="divide-y divide-[var(--border-subtle)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)]">
      {deposits.map((d) => (
        <li
          key={d.id}
          className="group/linha flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5"
        >
          <span className="tabular w-20 shrink-0 text-[11px] text-[var(--text-tertiary)]">
            {formatDay(d.happenedOn)}
          </span>
          {/* Um saque é um depósito NEGATIVO (0010/0011) — o sinal é a única
              diferença, e a cor é o que a torna legível de relance. */}
          <span
            className={cx(
              "tabular shrink-0 text-[12px] font-semibold",
              d.amountCents < 0 ? "text-[var(--danger)]" : "text-[var(--text-primary)]",
            )}
          >
            {d.amountCents < 0 ? "−" : "+"}
            {formatMoney(Math.abs(d.amountCents))}
          </span>
          {d.note && (
            <span className="truncate text-[11px] text-[var(--text-tertiary)]">{d.note}</span>
          )}
          {/* A pergunta é CURTA e a linha QUEBRA: a caixinha é um card estreito
              numa grade de três colunas, e o `shrink-0` da exclusão armada não
              cede. Com "Excluir este lançamento?" por extenso e sem quebra, a
              linha ficava mais larga que o card e empurrava o título e o valor
              para fora da borda — visto na dirigida da fase 3c. */}
          <ArmedDelete
            onConfirm={() => remove.mutate(d.id)}
            pending={remove.isPending && remove.variables === d.id}
            question="Excluir?"
            ariaLabel="Excluir lançamento"
            className="ml-auto opacity-0 transition-opacity focus-within:opacity-100 group-hover/linha:opacity-100"
          />
        </li>
      ))}
    </ul>
  );
}

/** 'AAAA-MM-DD' → '01/07'. O ano fica de fora: o extrato é curto e recente. */
function formatDay(day: string): string {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}
