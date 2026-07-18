/**
 * O painel da Carreira (M4.6, item 6b): compõe tudo — tempo no cargo, marcos do
 * ano, competências em evolução, próxima meta — mais a linha do tempo de cargos
 * com a DURAÇÃO de cada período (não só os pontos). Cada número é real e some
 * quando não há dado (o padrão do 3+4).
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Briefcase, CalendarClock, Plus, Target, TrendingUp } from "lucide-react";

import { Button, EmptyState, cx } from "../../design-system/primitives";
import {
  careerMilestones,
  listGoals,
  skillsEvolving,
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

const pad = (n: number) => String(n).padStart(2, "0");
/** O dia LOCAL de hoje como 'YYYY-MM-DD' — a mesma convenção do backend. */
function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

/** Dias entre dois 'YYYY-MM-DD' (UTC para não tropeçar em horário de verão). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Uma duração em dias, em português curto: "2 anos 3 meses", "5 meses", "12 dias". */
function humanize(days: number): string {
  if (days <= 0) return "hoje";
  if (days < 45) return `${days} ${days === 1 ? "dia" : "dias"}`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
  const years = Math.floor(days / 365.25);
  const rem = Math.floor((days - years * 365.25) / 30.44);
  const y = `${years} ${years === 1 ? "ano" : "anos"}`;
  return rem > 0 ? `${y} ${rem} ${rem === 1 ? "mês" : "meses"}` : y;
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
  const evolvingQ = useQuery({
    queryKey: ["skills-evolving", areaId],
    queryFn: () => skillsEvolving(areaId),
  });
  const goalsQ = useQuery({
    queryKey: ["goals", areaId],
    queryFn: () => listGoals(areaId),
  });

  // Os marcos vêm do mais recente ao mais antigo (o ledger por entity_kind).
  const milestones = useMemo(
    () => (milestonesQ.data ?? []).map(parseMilestone),
    [milestonesQ.data],
  );
  const latest = milestones[0];
  const today = todayLocal();
  const year = today.slice(0, 4);

  // Próxima meta: a de prazo mais próximo AINDA no futuro.
  const nextGoal = useMemo(() => {
    const now = Date.now();
    return (goalsQ.data ?? [])
      .filter((g) => g.deadline != null && g.deadline > now)
      .sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0))[0];
  }, [goalsQ.data]);

  const marcosNoAno = milestones.filter((m) => m.entry.day.startsWith(year)).length;
  const evolving = evolvingQ.data ?? [];

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

      {!latest && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8">
          <EmptyState
            icon={Award}
            title="Sua história profissional começa aqui"
            hint="Registre promoções, certificações e conquistas — elas ficam para sempre na Timeline, e a linha do tempo mostra quanto durou cada fase."
            action={
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setRecording(true)}>
                Registrar marco
              </Button>
            }
          />
        </div>
      )}

      {/* ===== O painel: só os tiles com dado real ===== */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {latest && (
          <PanelTile
            icon={Briefcase}
            label="No marco atual"
            value={humanize(daysBetween(latest.entry.day, today))}
            sub={latest.entry.titleSnapshot}
            tone
          />
        )}
        {milestones.length > 0 && (
          <PanelTile
            icon={Award}
            label={`Marcos em ${year}`}
            value={String(marcosNoAno)}
            sub={`${milestones.length} no total`}
          />
        )}
        {evolving.length > 0 && (
          <PanelTile
            icon={TrendingUp}
            label="Em evolução (90d)"
            value={String(evolving.length)}
            sub={evolving
              .slice(0, 2)
              .map((s) => s.title)
              .join(", ")}
          />
        )}
        {nextGoal && (
          <PanelTile
            icon={Target}
            label="Próxima meta"
            value={nextGoal.title}
            sub={`prazo em ${humanize(daysBetween(today, isoDay(nextGoal.deadline!)))}`}
            small
          />
        )}
      </div>

      {/* ===== A linha do tempo de cargos, com duração de cada fase ===== */}
      {milestones.length > 0 && (
        <section>
          <h3 className="mb-3 text-[12px] font-semibold tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
            Linha da carreira
          </h3>
          <ol className="relative ml-2 border-l border-[var(--border-subtle)]">
            {milestones.map((m, i) => {
              // A fase deste marco durou dele até o PRÓXIMO mais recente (o de
              // índice i-1); o mais recente de todos corre até hoje ("atual").
              const isCurrent = i === 0;
              const spanDays = isCurrent
                ? daysBetween(m.entry.day, today)
                : daysBetween(m.entry.day, milestones[i - 1].entry.day);
              const Icon = CAREER_KIND_META[m.kind].icon;
              return (
                <li key={m.entry.seq} className="relative py-3 pl-6">
                  <span
                    className={cx(
                      "absolute -left-[13px] top-3.5 grid size-6 place-items-center rounded-full text-[var(--sphere)]",
                      isCurrent
                        ? "bg-[color-mix(in_srgb,var(--sphere)_18%,var(--bg-surface))] ring-2 ring-[color-mix(in_srgb,var(--sphere)_55%,transparent)]"
                        : "bg-[var(--bg-surface)] ring-1 ring-[color-mix(in_srgb,var(--sphere)_45%,transparent)]",
                    )}
                    aria-hidden
                  >
                    <Icon size={12} />
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[14px] font-medium text-[var(--text-primary)]">
                      {m.entry.titleSnapshot}
                    </span>
                    <span className="text-[11px] text-[var(--text-tertiary)]">
                      {formatDay(m.entry.day)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-[11px] text-[var(--sphere)]">
                      {CAREER_KIND_META[m.kind].label}
                    </span>
                    <span
                      className={cx(
                        "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                        isCurrent
                          ? "border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] text-[var(--sphere)]"
                          : "border-[var(--border-subtle)] text-[var(--text-tertiary)]",
                      )}
                    >
                      <CalendarClock size={10} />
                      {isCurrent ? `atual · há ${humanize(spanDays)}` : `durou ${humanize(spanDays)}`}
                    </span>
                  </div>
                  {m.note && (
                    <p className="mt-1 text-[12.5px] leading-[18px] text-[var(--text-secondary)]">
                      {m.note}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {recording && <RecordMilestoneModal onClose={() => setRecording(false)} onSaved={refresh} />}
    </div>
  );
}

/** '2026-07-12' de um epoch-ms LOCAL — para a meta com prazo (o deadline é ms). */
function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Um tile do painel: número/valor grande + rótulo + subtítulo opcional. */
function PanelTile({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  small,
}: {
  icon: typeof Award;
  label: string;
  value: string;
  sub?: string;
  tone?: boolean;
  small?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-1.5 rounded-[var(--radius-lg)] border p-4",
        tone
          ? "border-[color-mix(in_srgb,var(--sphere)_30%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_8%,transparent)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-surface)]",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
        <Icon size={13} style={{ color: tone ? "var(--sphere)" : undefined }} />
        {label}
      </div>
      <span
        className={cx(
          "font-semibold tracking-[-0.02em] text-[var(--text-primary)]",
          small ? "truncate text-[15px]" : "text-[20px] tabular-nums",
        )}
        title={value}
      >
        {value}
      </span>
      {sub && <span className="truncate text-[11px] text-[var(--text-tertiary)]" title={sub}>{sub}</span>}
    </div>
  );
}
