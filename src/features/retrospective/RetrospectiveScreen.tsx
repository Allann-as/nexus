/**
 * Retrospectiva Anual (ARSENAL) — o ano inteiro num quadro sério, e o export.
 *
 * Para um ano fechado (ou o corrente, sob demanda): os totais, o score, as
 * semanas perfeitas e os destaques (conquistas + recordes). Tudo DERIVADO do
 * estado; o botão Exportar gera um Markdown legível para sempre (podado a 2 anos,
 * o dado-fonte é eterno).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarHeart,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  Medal,
  PiggyBank,
  Sparkles,
  Timer,
  Trophy,
} from "lucide-react";

import {
  annualRetrospective,
  exportRetrospective,
  type Retrospective,
  type RetroHighlight,
} from "../../lib/ipc";
import { PageHeader, PAGE_CONTAINER, Card, Button, EmptyState, cx } from "../../design-system/primitives";
import { StatCard } from "../../design-system/cards";
import { formatMoneyShort } from "../../lib/format";
import { useToasts } from "../../stores/toasts";

export function RetrospectiveScreen() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [exporting, setExporting] = useState(false);

  const q = useQuery({
    queryKey: ["retrospective", year],
    queryFn: () => annualRetrospective(year),
  });
  const r = q.data;

  const doExport = async () => {
    setExporting(true);
    try {
      const file = await exportRetrospective(year);
      push("success", `Retrospectiva salva: ${file.name}`);
    } catch (e) {
      pushError(e);
    } finally {
      setExporting(false);
    }
  };

  const empty = !!r && isEmpty(r);

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Retrospectiva"
        subtitle="O seu ano inteiro num quadro — e um arquivo para guardar"
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setYear((y) => y - 1)}
                aria-label="Ano anterior"
                className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-glow)] hover:text-[var(--text-primary)]"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="tabular w-14 text-center text-[14px] font-semibold text-[var(--text-primary)]">
                {year}
              </span>
              <button
                onClick={() => setYear((y) => Math.min(currentYear, y + 1))}
                disabled={year >= currentYear}
                aria-label="Próximo ano"
                className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-glow)] hover:text-[var(--text-primary)] disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <Button variant="secondary" onClick={doExport} disabled={exporting || empty}>
              <Download size={15} aria-hidden />
              Exportar
            </Button>
          </div>
        }
      />

      <div className={cx(PAGE_CONTAINER, "flex flex-col gap-4 pb-10")}>
        {empty ? (
          <Card className="p-0">
            <EmptyState
              icon={CalendarHeart}
              title={`Pouca coisa em ${year}`}
              hint="A retrospectiva reúne o que você fez no ano — estudo, foco, aportes, semanas perfeitas, conquistas. Use o app ao longo do ano e volte aqui para o retrato completo."
            />
          </Card>
        ) : (
          r && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <StatCard icon={BookOpen} label="Estudo" value={hours(r.studyMinutes)} tone="sphere" />
                <StatCard icon={Timer} label="Foco" value={hours(r.focusMinutes)} tone="accent" />
                <StatCard
                  icon={PiggyBank}
                  label="Aportes"
                  value={formatMoneyShort(r.contributionCents)}
                  tone="success"
                />
                <StatCard
                  icon={CheckSquare}
                  label="Tarefas concluídas"
                  value={String(r.tasksCompleted)}
                  tone="accent"
                />
                <StatCard
                  icon={Sparkles}
                  label="Score médio"
                  value={r.scoreAvg != null ? String(Math.round(r.scoreAvg)) : "—"}
                  unit={r.scoreBest != null ? `pico ${r.scoreBest}` : undefined}
                  tone="sphere"
                />
                <StatCard
                  icon={CalendarHeart}
                  label="Semanas perfeitas"
                  value={String(r.perfectWeeks)}
                  tone="success"
                />
              </div>

              <Card className="p-5">
                <h2 className="mb-3 text-[13px] font-semibold text-[var(--text-primary)]">
                  Conquistas do ano
                </h2>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                  <Tally icon={Trophy} label="Conquistas" value={r.achievements} />
                  <Tally icon={Medal} label="Recordes batidos" value={r.records} />
                  <Tally icon={BookOpen} label="Livros terminados" value={r.booksFinished} />
                  <Tally icon={Flag} label="Temporadas vencidas" value={r.challengesWon} />
                  <Tally icon={CalendarHeart} label="Metas anuais" value={r.annualGoalsDone} />
                </div>
              </Card>

              {r.highlights.length > 0 && (
                <Card className="p-5">
                  <h2 className="mb-3 text-[13px] font-semibold text-[var(--text-primary)]">
                    Destaques
                  </h2>
                  <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
                    {r.highlights.map((h, i) => (
                      <HighlightRow key={i} h={h} />
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}

function Tally({ icon: Icon, label, value }: { icon: typeof Trophy; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={16} className="shrink-0 text-[var(--accent)]" />
      <span className="font-mono text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">
        {value}
      </span>
      <span className="text-[12px] text-[var(--text-tertiary)]">{label}</span>
    </div>
  );
}

function HighlightRow({ h }: { h: RetroHighlight }) {
  const Icon = h.kind === "record" ? Medal : Trophy;
  const [, m, d] = h.day.split("-");
  return (
    <li className="flex items-center gap-3 py-2">
      <Icon size={14} className="shrink-0 text-[var(--warning)]" />
      <span className="flex-1 truncate text-[13px] text-[var(--text-secondary)]">{h.title}</span>
      <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
        {d}/{m}
      </span>
    </li>
  );
}

function isEmpty(r: Retrospective): boolean {
  return (
    r.studyMinutes === 0 &&
    r.focusMinutes === 0 &&
    r.contributionCents === 0 &&
    r.tasksCompleted === 0 &&
    r.perfectWeeks === 0 &&
    r.achievements === 0 &&
    r.records === 0 &&
    r.booksFinished === 0 &&
    r.challengesWon === 0 &&
    r.annualGoalsDone === 0 &&
    r.highlights.length === 0
  );
}

function hours(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}
