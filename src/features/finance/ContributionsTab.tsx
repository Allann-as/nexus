/**
 * O extrato de aportes — agrupado por mês, com subtotal, chip de classe e o
 * lançamento excluível (REFINO R6).
 *
 * A alocação e os gráficos moram no Painel; aqui é a linha do tempo dos
 * lançamentos, com densidade de extrato: cada mês é um bloco com o líquido do
 * período no cabeçalho, e cada linha traz a classe (chip de cor + rótulo), o
 * banco discreto, a data e o valor numa coluna tabular alinhada. Resgates em
 * vermelho com o sinal — "tirei" é informação diferente de "botei".
 *
 * Excluir um aporte lançado por engano corrige o ESTADO (saldos, médias, meses
 * seguidos recalculam); o evento fica no ledger e ganha uma correção (ADR-0056).
 * A exclusão é ARMADA (o padrão do app): um clique pergunta, o segundo confirma.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

import { Button, EmptyState, cx } from "../../design-system/primitives";
import { formatMoney } from "../../lib/format";
import { fromDay } from "../calendar/grid";
import {
  deleteContribution,
  listAccounts,
  recentContributions,
  type Contribution,
} from "../../lib/ipc";
import { useToasts } from "../../stores/toasts";
import { classColour, classLabel } from "./classes";

interface MonthGroup {
  key: string;
  label: string;
  net: number;
  items: Contribution[];
}

export function ContributionsTab({ onAporte }: { onAporte: () => void }) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [confirming, setConfirming] = useState<string | null>(null);

  const { data: contributions = [], isLoading } = useQuery({
    queryKey: ["finance", "recent"],
    queryFn: () => recentContributions(100),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
  });

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const remove = useMutation({
    mutationFn: deleteContribution,
    onSuccess: () => {
      push("success", "Aporte excluído — saldos recalculados");
      setConfirming(null);
      // O extrato, o painel (alocação, patrimônio, Saúde) e a Timeline mudam.
      qc.invalidateQueries({ queryKey: ["finance"] });
      qc.invalidateQueries({ queryKey: ["timeline"] });
    },
    onError: pushError,
  });

  const groups = useMemo<MonthGroup[]>(() => {
    const map = new Map<string, MonthGroup>();
    for (const c of contributions) {
      const key = c.happenedOn.slice(0, 7); // 'YYYY-MM'
      let g = map.get(key);
      if (!g) {
        g = { key, label: monthLabel(key), net: 0, items: [] };
        map.set(key, g);
      }
      g.items.push(c);
      g.net += c.amountCents;
    }
    return [...map.values()]; // já vem do mais recente (recent ordena DESC)
  }, [contributions]);

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  if (contributions.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16">
        <EmptyState
          icon={Plus}
          title="Nenhum aporte registrado"
          hint="Cada aporte que você lançar aparece aqui, agrupado por mês, do mais recente ao mais antigo."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={onAporte}>
              Registrar aporte
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" icon={Plus} onClick={onAporte}>
          Novo aporte
        </Button>
      </div>

      {groups.map((g) => (
        <section key={g.key}>
          {/* cabeçalho do mês: nome + líquido do período */}
          <div className="mb-1.5 flex items-baseline justify-between px-1">
            <h3 className="text-[11px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
              {g.label}
            </h3>
            <span className="tabular text-[12px] text-[var(--text-secondary)]">
              líquido{" "}
              <strong className={cx(g.net < 0 ? "text-[var(--danger)]" : "text-[var(--text-primary)]")}>
                {g.net < 0 ? "−" : "+"}
                {formatMoney(Math.abs(g.net))}
              </strong>
            </span>
          </div>

          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {g.items.map((c, i) => (
              <Row
                key={c.id}
                c={c}
                first={i === 0}
                accountName={accountName(c.accountId)}
                confirming={confirming === c.id}
                pending={remove.isPending}
                onAsk={() => setConfirming(c.id)}
                onCancel={() => setConfirming(null)}
                onConfirm={() => remove.mutate(c.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Row({
  c,
  first,
  accountName,
  confirming,
  pending,
  onAsk,
  onCancel,
  onConfirm,
}: {
  c: Contribution;
  first: boolean;
  accountName: string;
  confirming: boolean;
  pending: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isResgate = c.amountCents < 0;
  return (
    <div
      className={cx(
        "group flex items-center gap-3 px-4",
        !first && "border-t border-[var(--border-subtle)]",
      )}
      style={{ minHeight: "48px" }}
    >
      {/* chip de classe: cor + rótulo (a cor identifica, o rótulo nomeia) */}
      <span className="flex w-32 shrink-0 items-center gap-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-[3px]"
          style={{ background: classColour(c.assetClass) }}
        />
        <span className="truncate text-[13px] text-[var(--text-primary)]">
          {classLabel(c.assetClass)}
        </span>
      </span>

      {/* banco, discreto */}
      <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-tertiary)]">
        {accountName}
      </span>

      {confirming ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11.5px] text-[var(--text-secondary)]">Excluir este aporte?</span>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={pending}>
            {pending ? "…" : "Sim, excluir"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Não
          </Button>
        </div>
      ) : (
        <>
          {/* data */}
          <span className="tabular w-20 shrink-0 text-right text-[11px] text-[var(--text-tertiary)]">
            {fromDay(c.happenedOn).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
          </span>
          {/* valor, coluna tabular alinhada */}
          <span
            className={cx(
              "tabular w-28 shrink-0 text-right text-[14px] font-semibold",
              isResgate ? "text-[var(--danger)]" : "text-[var(--text-primary)]",
            )}
          >
            {isResgate ? "−" : "+"}
            {formatMoney(Math.abs(c.amountCents))}
          </span>
          {/* excluir: silencioso até o hover */}
          <button
            onClick={onAsk}
            aria-label="Excluir aporte"
            className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--text-tertiary)] opacity-0 transition-[opacity,color,background-color] duration-[var(--dur-fast)] group-hover:opacity-100 hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] hover:text-[var(--danger)] focus-visible:opacity-100"
          >
            <Trash2 size={14} />
          </button>
        </>
      )}
    </div>
  );
}

/** 'YYYY-MM' → "Julho de 2026", capitalizado. */
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
