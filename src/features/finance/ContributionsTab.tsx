/**
 * A lista de aportes: o extrato dos lançamentos, com o botão de registrar.
 *
 * A alocação e os gráficos moram no Painel; aqui é a linha do tempo crua — o que
 * foi aportado, quando, onde e em que classe. Resgates aparecem em vermelho, com
 * o sinal, porque "tirei" é uma informação diferente de "botei".
 */

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button, EmptyState, cx } from "../../design-system/primitives";
import { formatMoney } from "../../lib/format";
import { fromDay } from "../calendar/grid";
import { listAccounts, recentContributions } from "../../lib/ipc";

const CLASS_LABEL: Record<string, string> = {
  renda_fixa: "Renda fixa",
  acoes: "Ações",
  fiis: "FIIs",
  etf_exterior: "ETF exterior",
  cripto: "Cripto",
  reserva: "Reserva",
  outros: "Outros",
};

export function ContributionsTab({ onAporte }: { onAporte: () => void }) {
  const { data: contributions = [], isLoading } = useQuery({
    queryKey: ["finance", "recent"],
    queryFn: () => recentContributions(100),
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: listAccounts,
  });

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const accountColour = (id: string) => accounts.find((a) => a.id === id)?.color ?? "var(--sphere)";

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-surface)]" />;
  }

  if (contributions.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-subtle)] py-16">
        <EmptyState
          icon={Plus}
          title="Nenhum aporte registrado"
          hint="Cada aporte que você lançar aparece aqui, do mais recente ao mais antigo."
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
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" icon={Plus} onClick={onAporte}>
          Novo aporte
        </Button>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {contributions.map((c, i) => {
          const isResgate = c.amountCents < 0;
          return (
            <div
              key={c.id}
              className={cx(
                "flex items-center gap-3 px-4 py-3",
                i > 0 && "border-t border-[var(--border-subtle)]",
              )}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: accountColour(c.accountId) }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-[var(--text-primary)]">
                  {CLASS_LABEL[c.assetClass] ?? c.assetClass}
                </div>
                <div className="text-[11px] text-[var(--text-tertiary)]">
                  {accountName(c.accountId)} ·{" "}
                  {fromDay(c.happenedOn).toLocaleDateString("pt-BR")}
                </div>
              </div>
              <span
                className={cx(
                  "tabular shrink-0 text-[14px] font-semibold",
                  isResgate ? "text-[var(--danger)]" : "text-[var(--text-primary)]",
                )}
              >
                {isResgate ? "−" : "+"}
                {formatMoney(Math.abs(c.amountCents))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
