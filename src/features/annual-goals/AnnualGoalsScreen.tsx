/**
 * A seção Metas Anuais — metas organizadas por ANO.
 *
 * A visão do ano cruza o quanto do ano já passou com o quanto das metas foi
 * cumprido ("54% do ano, 40% das metas"). Cria para o ano corrente e futuros; o
 * passado é recusado pelo backend. Tudo entra no ledger.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target, Trash2 } from "lucide-react";

import {
  abandonAnnualGoal,
  annualGoalYear,
  annualGoalYears,
  archiveAnnualGoal,
  completeAnnualGoal,
  deleteAnnualGoal,
  listAreas,
  updateAnnualGoalProgress,
  type AnnualGoal,
  type Area,
  type YearOverview,
} from "../../lib/ipc";
import { Button, Card, EmptyState, PageHeader, PAGE_CONTAINER, cx } from "../../design-system/primitives";
import { ProgressBar } from "../../design-system/charts";
import { useToasts } from "../../stores/toasts";
import { NodeLinkSection } from "../links/NodeLinkSection";
import { NewAnnualGoalModal } from "./NewAnnualGoalModal";

const pct = (r: number) => Math.round(r * 100);

export function AnnualGoalsScreen() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [creating, setCreating] = useState(false);

  const years = useQuery({ queryKey: ["annual-goal-years"], queryFn: annualGoalYears });
  const overview = useQuery({
    queryKey: ["annual-goal-year", year],
    queryFn: () => annualGoalYear(year),
  });
  const areas = useQuery({ queryKey: ["areas", "all"], queryFn: () => listAreas(true) });

  const areaById = useMemo(() => {
    const map = new Map<string, Area>();
    for (const a of areas.data ?? []) map.set(a.id, a);
    return map;
  }, [areas.data]);

  const yearTabs = years.data ?? [currentYear];
  const data = overview.data;

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Metas Anuais"
        subtitle="O ano inteiro, de uma vez — planeje o presente e o futuro"
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden />
            Nova meta
          </Button>
        }
      />

      <div className={`${PAGE_CONTAINER} min-h-0 flex-1 space-y-6 pb-16`}>
        <div className="flex flex-wrap gap-2">
          {yearTabs.map((y) => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={cx(
                "tabular rounded-full border px-4 py-1.5 text-[13px] font-medium transition-colors",
                y === year
                  ? "border-[var(--border-glow)] bg-[var(--bg-raised)] text-[var(--text-primary)]"
                  : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
              )}
            >
              {y}
            </button>
          ))}
        </div>

        {data && <YearHeader overview={data} />}

        {data && data.goals.length === 0 ? (
          <Card className="p-0">
            <EmptyState
              icon={Target}
              title={`Nenhuma meta para ${year}`}
              hint="Uma meta anual pode ser binária (“fazer X”) ou quantitativa (“ler 12 livros”). Crie a primeira e acompanhe o progresso ao longo do ano."
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {(data?.goals ?? []).map((g) => (
              <GoalCard key={g.id} goal={g} area={g.areaId ? areaById.get(g.areaId) : undefined} year={year} />
            ))}
          </div>
        )}
      </div>

      {creating && (
        <NewAnnualGoalModal
          year={year}
          areas={areas.data ?? []}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function YearHeader({ overview }: { overview: YearOverview }) {
  const elapsed = pct(overview.yearElapsedRatio);
  const progress = pct(overview.aggregateProgress);
  return (
    <Card className="p-5">
      <p className="text-[14px] text-[var(--text-secondary)]">
        Você está em{" "}
        <strong className="tabular text-[var(--text-primary)]">{elapsed}%</strong> do ano com{" "}
        <strong className="tabular text-[var(--text-primary)]">{progress}%</strong> das metas —{" "}
        {overview.doneCount} concluída{overview.doneCount === 1 ? "" : "s"}, {overview.activeCount}{" "}
        ativa{overview.activeCount === 1 ? "" : "s"}.
      </p>
      <div className="mt-4 space-y-3">
        <Meter label="Ano decorrido" value={overview.yearElapsedRatio} color="var(--text-tertiary)" />
        <Meter label="Progresso das metas" value={overview.aggregateProgress} color="var(--accent)" />
      </div>
    </Card>
  );
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-[var(--text-tertiary)]">
        <span>{label}</span>
        <span className="tabular">{pct(value)}%</span>
      </div>
      <ProgressBar value={value} color={color} />
    </div>
  );
}

function GoalCard({
  goal,
  area,
  year,
}: {
  goal: AnnualGoal;
  area: Area | undefined;
  year: number;
}) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [value, setValue] = useState(goal.currentValue);
  // Excluir arma antes de agir — uma confirmação leve, sem modal (§3.1).
  const [confirmDel, setConfirmDel] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["annual-goal-year", year] });
    qc.invalidateQueries({ queryKey: ["annual-goal-years"] });
    qc.invalidateQueries({ queryKey: ["gamification"] });
  };

  const save = useMutation({
    mutationFn: () => updateAnnualGoalProgress(goal.id, value),
    onSuccess: invalidate,
    onError: pushError,
  });
  const complete = useMutation({
    mutationFn: () => completeAnnualGoal(goal.id),
    onSuccess: invalidate,
    onError: pushError,
  });
  const abandon = useMutation({
    mutationFn: () => abandonAnnualGoal(goal.id),
    onSuccess: invalidate,
    onError: pushError,
  });
  const archive = useMutation({
    mutationFn: () => archiveAnnualGoal(goal.id),
    onSuccess: invalidate,
    onError: pushError,
  });
  const remove = useMutation({
    mutationFn: () => deleteAnnualGoal(goal.id),
    onSuccess: invalidate,
    onError: pushError,
  });

  const color = area?.color ?? "var(--accent)";
  const done = goal.status === "done";
  const active = goal.status === "active";
  const quantitative = goal.goalKind === "quantitative";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{goal.title}</h3>
        </div>
        <StatusBadge status={goal.status} />
      </div>

      {quantitative && (
        <p className="tabular mt-2 text-[12px] text-[var(--text-tertiary)]">
          {goal.currentValue} / {goal.targetValue} {goal.unit ?? goal.metricName}
        </p>
      )}
      <ProgressBar value={goal.progressRatio} color={color} className="mt-2" />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {active && quantitative && (
          <>
            <input
              type="number"
              min={0}
              value={value}
              onChange={(e) => setValue(Math.max(0, Number(e.target.value)))}
              className="tabular h-8 w-24 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-glow)]"
            />
            <Button size="sm" variant="secondary" onClick={() => save.mutate()} disabled={save.isPending}>
              Salvar progresso
            </Button>
          </>
        )}
        {active && !quantitative && (
          <Button size="sm" variant="primary" onClick={() => complete.mutate()} disabled={complete.isPending}>
            Concluir
          </Button>
        )}

        {/* As ações de gestão vivem à direita, separadas das primárias por um
            empurrão — hierarquia visível, não uma fileira de links iguais (§3.1). */}
        <div className="ml-auto flex items-center gap-1.5">
          {active && (
            <Button size="sm" variant="ghost" onClick={() => abandon.mutate()} disabled={abandon.isPending}>
              Abandonar
            </Button>
          )}
          {!done && (
            <Button size="sm" variant="ghost" onClick={() => archive.mutate()} disabled={archive.isPending}>
              Arquivar
            </Button>
          )}
          {confirmDel ? (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Confirmar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>
                Cancelar
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              onClick={() => setConfirmDel(true)}
              aria-label="Excluir meta"
            />
          )}
        </div>
      </div>

      {/* O backlink: as metas de carreira que contam para esta meta anual
          (ADR-0046). Só leitura — o vínculo se cria do lado da meta de carreira. */}
      <NodeLinkSection nodeId={goal.id} />
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    active: { label: "Ativa", color: "var(--accent)" },
    done: { label: "Concluída", color: "var(--success)" },
    dropped: { label: "Abandonada", color: "var(--text-tertiary)" },
    archived: { label: "Arquivada", color: "var(--text-tertiary)" },
  };
  const s = map[status] ?? map.active;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap"
      style={{ background: `color-mix(in oklab, ${s.color} 16%, transparent)`, color: s.color }}
    >
      {s.label}
    </span>
  );
}

