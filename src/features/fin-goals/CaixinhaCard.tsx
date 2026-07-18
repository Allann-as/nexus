/**
 * Um card-caixinha: ícone, nome, barra grossa com glow, R$ guardado / R$ alvo,
 * badge do banco e a projeção determinística (§2.1).
 *
 * A barra é a herói visual — grossa, na cor da Esfera (o dourado dos Objetivos),
 * com o glow que o `ProgressBar` já desenha. O dinheiro conta até o valor na
 * montagem, como todo número do Midnight.
 */

import { PiggyBank, Plus, Trophy } from "lucide-react";

import { GoalIcon } from "./GoalIcon";

import { ProgressBar } from "../../design-system/charts";
import { useCountUp } from "../../design-system/useCountUp";
import { cx } from "../../design-system/primitives";
import { formatMoney } from "../../lib/format";
import type { FinGoalCard } from "../../lib/ipc";

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
}: {
  card: FinGoalCard;
  onDeposit: () => void;
}) {
  const pct = card.targetCents > 0 ? card.savedCents / card.targetCents : 0;
  const done = card.status === "done" || pct >= 1;
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
        {done && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--sphere)_22%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sphere)]">
            <Trophy size={11} aria-hidden />
            Concluído
          </span>
        )}
      </header>

      <div className="flex items-baseline justify-between gap-2">
        <span className="tabular text-[22px] font-bold tracking-[-0.02em] text-[var(--text-primary)]">
          {formatMoney(Math.round(animatedSaved))}
        </span>
        <span className="tabular text-[12px] text-[var(--text-tertiary)]">
          de {formatMoney(card.targetCents)}
        </span>
      </div>

      <ProgressBar value={pct} height={10} />

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
