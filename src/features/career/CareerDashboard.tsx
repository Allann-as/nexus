/**
 * O painel da Carreira: os marcos profissionais em destaque + os números da
 * Esfera (§2.3). A análise de carga de trabalho vs. média chega no M4.5 (BI).
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, FolderKanban, Plus, Target } from "lucide-react";

import { HeroCard, StatCard } from "../../design-system/cards";
import { Button, EmptyState } from "../../design-system/primitives";
import {
  careerMilestones,
  listNodes,
  type CareerMilestoneKind,
  type LedgerEntry,
} from "../../lib/ipc";
import { CAREER_KIND_META } from "./careerKinds";
import { RecordMilestoneModal } from "./RecordMilestoneModal";

const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** '2026-07-12' → '12 de jul de 2026'. */
function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${Number(d)} de ${MONTHS[Number(m) - 1] ?? m} de ${y}`;
}

interface Milestone {
  entry: LedgerEntry;
  kind: CareerMilestoneKind;
  note: string | null;
}

function parseMilestone(entry: LedgerEntry): Milestone {
  let kind: CareerMilestoneKind = "other";
  let note: string | null = null;
  try {
    const p = JSON.parse(entry.payload) as { kind?: string; note?: string | null };
    if (p.kind && p.kind in CAREER_KIND_META) kind = p.kind as CareerMilestoneKind;
    note = p.note ?? null;
  } catch {
    // Um payload ilegível não pode derrubar o painel; cai no marco genérico.
  }
  return { entry, kind, note };
}

export function CareerDashboard({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const [recording, setRecording] = useState(false);

  const milestonesQ = useQuery({
    queryKey: ["career", "milestones"],
    queryFn: careerMilestones,
  });
  const projectsQ = useQuery({
    queryKey: ["nodes", "project", areaId],
    queryFn: () => listNodes({ kind: "project", areaId, status: "active", limit: 500 }),
  });
  const goalsQ = useQuery({
    queryKey: ["nodes", "goal", areaId],
    queryFn: () => listNodes({ kind: "goal", areaId, status: "active", limit: 500 }),
  });

  const milestones = useMemo(
    () => (milestonesQ.data ?? []).map(parseMilestone),
    [milestonesQ.data],
  );
  const latest = milestones[0];

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["career"] });
    void client.invalidateQueries({ queryKey: ["ledger"] });
    setRecording(false);
  };

  return (
    <div className="nx-enter flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Carreira</h2>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setRecording(true)}>
          Registrar marco
        </Button>
      </div>

      {latest ? (
        <HeroCard
          label={`${CAREER_KIND_META[latest.kind].emoji} ${CAREER_KIND_META[latest.kind].label} · marco mais recente`}
          value={latest.entry.titleSnapshot}
          hint={formatDay(latest.entry.day)}
        />
      ) : (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8">
          <EmptyState
            icon={Award}
            title="Sua história profissional começa aqui"
            hint="Registre promoções, certificações e conquistas — elas ficam para sempre na Timeline."
            action={
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setRecording(true)}>
                Registrar marco
              </Button>
            }
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard icon={Award} label="Marcos registrados" value={milestones.length} tone="sphere" />
        <StatCard icon={FolderKanban} label="Projetos ativos" value={projectsQ.data?.length ?? 0} />
        <StatCard icon={Target} label="Metas ativas" value={goalsQ.data?.length ?? 0} />
      </div>

      {milestones.length > 0 && (
        <section>
          <h3 className="mb-3 text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Linha da carreira
          </h3>
          <ol className="relative ml-2 border-l border-[var(--border-subtle)]">
            {milestones.map((m) => (
              <li key={m.entry.seq} className="relative py-3 pl-6">
                <span
                  className="absolute -left-[13px] top-3.5 grid size-6 place-items-center rounded-full bg-[var(--bg-surface)] text-[12px] ring-1 ring-[color-mix(in_srgb,var(--sphere)_45%,transparent)]"
                  aria-hidden
                >
                  {CAREER_KIND_META[m.kind].emoji}
                </span>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-[14px] font-medium text-[var(--text-primary)]">
                    {m.entry.titleSnapshot}
                  </span>
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    {formatDay(m.entry.day)}
                  </span>
                </div>
                <span className="text-[11px] text-[var(--sphere)]">
                  {CAREER_KIND_META[m.kind].label}
                </span>
                {m.note && (
                  <p className="mt-1 text-[12.5px] leading-[18px] text-[var(--text-secondary)]">
                    {m.note}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {recording && <RecordMilestoneModal onClose={() => setRecording(false)} onSaved={refresh} />}
    </div>
  );
}
