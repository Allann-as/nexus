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
  Repeat,
  Sparkles,
  Target,
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
import { StatTile } from "../../design-system/cards";
import { MonoLabel } from "../../design-system/instruments";
import { Formula } from "../../design-system/Formula";
import { formatMoneyShort } from "../../lib/format";
import { useToasts } from "../../stores/toasts";
import { fromDay } from "../calendar/grid";

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
  /* Ano em andamento: o backend corta em `min(31/12, hoje)` e manda até onde
     foi. Comparar com 31/12 é mais honesto que comparar `year` com o ano atual
     — quem decide o corte é quem fez a conta. */
  const partial = !!r && r.through !== `${r.year}-12-31`;

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
              {/* O ano corrente para HOJE, e a tela tem que dizer isso: "Estudo
                  120h em 2026" lido em julho é meio ano chamado de ano inteiro.
                  O backend manda o último dia coberto justamente para isto. */}
              {partial && (
                <div className="flex items-center gap-2">
                  <MonoLabel>ano em andamento</MonoLabel>
                  <span className="text-[12px] text-[var(--text-tertiary)]">
                    os números vão de 1º de janeiro até {niceDay(r.through)}
                  </span>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <StatTile icon={BookOpen} label="Estudo" value={hours(r.studyMinutes)} tone="sphere" />
                <StatTile icon={Timer} label="Foco" value={hours(r.focusMinutes)} tone="accent" />
                <StatTile
                  icon={PiggyBank}
                  label="Aportes"
                  value={formatMoneyShort(r.contributionCents)}
                  tone="success"
                />
                <StatTile
                  icon={CheckSquare}
                  label="Tarefas concluídas"
                  value={String(r.tasksCompleted)}
                  tone="accent"
                />
                {/* A métrica que faltava num app centrado em hábitos — a mesma
                    que entrou no Comparativo (ADR-0101). Simetria: dado que
                    aparece numa tela aparece nas irmãs. */}
                <StatTile
                  icon={Repeat}
                  label="Hábitos cumpridos"
                  value={String(r.habitsDone)}
                  tone="cyan"
                />
                {/* Só o score tem medidor: 0–100 é uma escala de verdade. Os
                    outros não têm teto nenhum (ADR-0088/0098). */}
                <StatTile
                  icon={Sparkles}
                  label="Score médio"
                  value={r.scoreAvg != null ? String(Math.round(r.scoreAvg)) : "—"}
                  unit={r.scoreBest != null ? `pico ${r.scoreBest}` : undefined}
                  seg={r.scoreAvg != null ? r.scoreAvg / 100 : undefined}
                  tone="sphere"
                />
              </div>

              <Card className="p-5">
                <h2 className="mb-3 text-[13px] font-semibold text-[var(--text-primary)]">
                  Conquistas do ano
                </h2>
                {/* Seis contagens em duas linhas de três — e "Semanas perfeitas"
                    mora AQUI, não entre os tiles. Os tiles medem VOLUME (quanto
                    tempo, quanto dinheiro, quantas marcações); estas são os
                    marcos do ano. A divisão não é só arrumação: com sete tiles a
                    última linha da grade ficava com um e dois buracos do lado. */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-3">
                  <Tally icon={CalendarHeart} label="Semanas perfeitas" value={r.perfectWeeks} />
                  <Tally icon={Trophy} label="Conquistas" value={r.achievements} />
                  <Tally icon={Medal} label="Recordes batidos" value={r.records} />
                  <Tally icon={BookOpen} label="Livros terminados" value={r.booksFinished} />
                  <Tally icon={Flag} label="Temporadas vencidas" value={r.challengesWon} />
                  <Tally icon={Target} label="Metas anuais" value={r.annualGoalsDone} />
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

              <Formula>
                Os números vão de 1º de janeiro até {niceDay(r.through)}
                {partial
                  ? " — o ano ainda não acabou, então nada aqui é o total dele."
                  : " — o ano fechado por inteiro."}{" "}
                Tudo é DERIVADO do estado e do ledger, nada é gravado por esta tela.
                Os destaques são as conquistas desbloqueadas e os recordes batidos no
                período, em ordem de data. O botão Exportar grava um Markdown legível
                para sempre; os arquivos são podados depois de 2 anos, porque o
                dado-fonte é eterno e o arquivo é só uma conveniência regenerável.
              </Formula>
            </>
          )
        )}
      </div>
    </div>
  );
}

/** `'AAAA-MM-DD'` → "22 de julho". `fromDay` e não `new Date(string)` (ADR-0097). */
function niceDay(day: string): string {
  return fromDay(day).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
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
    // Sem isto, um ano em que a pessoa SÓ marcou hábitos é chamado de vazio.
    r.habitsDone === 0 &&
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
