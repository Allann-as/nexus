/**
 * O Painel dos Estudos — a resposta a "como vão meus estudos e minha leitura?".
 *
 * Duas frentes: o RITMO de estudo (horas na semana, constância, horários — das
 * sessões, item 7) e a LEITURA (a meta anual, o que está em curso — dos livros,
 * M4). O HeroCard é a leitura; a faixa de estudo vem logo abaixo, com o botão de
 * registrar uma sessão sempre à mão.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Clock, Library, Trash2 } from "lucide-react";

import { CountUp, HeroCard, StatCard, SummaryCard, Val } from "../../design-system/cards";
import { ProgressBar, ProgressRing } from "../../design-system/charts";
import { Button, EmptyState } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import {
  deleteStudySession,
  recentStudySessions,
  studiesOverview,
  studyStats,
  type Book,
  type StudySession,
} from "../../lib/ipc";
import { coverStyle, bookInitials } from "./bookCover";
import { computePace, SetGoalInline } from "./readingGoal";
import { StudyStatsPanel } from "./StudyStatsPanel";
import { LogSessionModal } from "./LogSessionModal";
import { formatMinutes, shortDay } from "./studyFormat";

export function StudiesDashboard({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const [logging, setLogging] = useState(false);

  const overview = useQuery({
    queryKey: ["studies", areaId],
    queryFn: () => studiesOverview(areaId),
  });
  const stats = useQuery({
    queryKey: ["study-stats", areaId],
    queryFn: () => studyStats(areaId),
  });
  const recent = useQuery({
    queryKey: ["recent-sessions", areaId],
    queryFn: () => recentStudySessions(areaId),
  });

  const refreshAfterLog = () => {
    setLogging(false);
    void client.invalidateQueries({ queryKey: ["study-stats", areaId] });
    void client.invalidateQueries({ queryKey: ["recent-sessions", areaId] });
    void client.invalidateQueries({ queryKey: ["subjects", areaId] });
    void client.invalidateQueries({ queryKey: ["subject-progress"] });
    void client.invalidateQueries({ queryKey: ["gamification"] });
    void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
  };

  if (overview.isLoading) {
    return (
      <div className="nx-enter flex flex-col gap-4">
        <div className="h-36 animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            />
          ))}
        </div>
      </div>
    );
  }

  const ov = overview.data;
  if (!ov) return null;

  const goal = ov.readingGoal ?? null;
  const finished = ov.finishedThisYear;
  const readingNow = ov.readingNow;
  const pace = goal && goal > 0 ? computePace(finished, goal) : null;
  const paceColor =
    pace?.tone === "success"
      ? "var(--success)"
      : pace?.tone === "warning"
        ? "var(--warning)"
        : "var(--sphere)";

  const st = stats.data;
  const hasSessions = (st?.totalSessions ?? 0) > 0;
  const sessions = recent.data ?? [];

  return (
    <div className="nx-enter flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" icon={Clock} onClick={() => setLogging(true)}>
          Registrar sessão
        </Button>
      </div>

      {/* ===== O ritmo de estudo ===== */}
      {hasSessions && st ? (
        <StudyStatsPanel stats={st} />
      ) : (
        <EmptyState
          icon={Clock}
          title="Nenhuma sessão de estudo ainda"
          hint="Registre quanto tempo estudou de cada matéria e o NEXUS mostra suas horas na semana, sua constância e seus melhores horários."
          action={
            <Button variant="primary" size="sm" icon={Clock} onClick={() => setLogging(true)}>
              Registrar sessão
            </Button>
          }
        />
      )}

      {sessions.length > 0 && <RecentSessions sessions={sessions} onChanged={refreshAfterLog} />}

      {/* ===== A leitura ===== */}
      <HeroCard
        label={`Terminados em ${ov.year}`}
        value={<CountUp to={finished} />}
        unit={goal && goal > 0 ? `de ${goal}` : "livros"}
        hint={
          goal && goal > 0 ? (
            pace && (
              <>
                Você está{" "}
                <span className="font-semibold" style={{ color: paceColor }}>
                  {pace.label}
                </span>{" "}
                para a meta do ano.
              </>
            )
          ) : (
            <span className="mt-1 inline-block">
              <SetGoalInline onSaved={() => overview.refetch()} />
            </span>
          )
        }
        aside={
          goal && goal > 0 ? (
            <ProgressRing value={finished / goal} size={96} thickness={8}>
              <span className="tabular text-[13px] font-bold text-[var(--text-primary)]">
                {Math.round((finished / goal) * 100)}%
              </span>
            </ProgressRing>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={BookOpen} label="Lendo agora" value={<CountUp to={readingNow.length} />} />
        <StatCard icon={Library} label="Na estante" value={<CountUp to={ov.totalBooks} />} />
        <StatCard
          icon={CheckCircle2}
          label="Terminados no ano"
          value={<CountUp to={finished} />}
        />
      </div>

      <SummaryCard>
        {ov.totalBooks === 0 ? (
          "sua estante ainda está vazia — adicione um livro na Biblioteca para começar a acompanhar suas leituras."
        ) : (
          <>
            você terminou <Val tone="success">{finished}</Val>{" "}
            {finished === 1 ? "livro" : "livros"} em {ov.year}, está lendo{" "}
            <Val>{readingNow.length}</Val> agora e tem{" "}
            <Val tone="accent">{ov.totalBooks}</Val> na estante
            {pace ? (
              <>
                {" "}
                — <Val tone={pace.tone}>{pace.label}</Val> para a meta.
              </>
            ) : (
              "."
            )}
          </>
        )}
      </SummaryCard>

      {/* ===== Lendo agora ===== */}
      <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <h3 className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
          Lendo agora
        </h3>
        {readingNow.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="Nenhuma leitura em curso"
            hint="Marque um livro como 'lendo' na Biblioteca e ele aparece aqui, com o quanto já andou."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {readingNow.map((book) => (
              <ReadingRow key={book.id} book={book} />
            ))}
          </div>
        )}
      </section>

      {logging && (
        <LogSessionModal areaId={areaId} onClose={() => setLogging(false)} onSaved={refreshAfterLog} />
      )}
    </div>
  );
}

/** As últimas sessões registradas — a memória curta do estudo. */
function RecentSessions({
  sessions,
  onChanged,
}: {
  sessions: StudySession[];
  onChanged: () => void;
}) {
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  // Confirmação leve por linha: o primeiro clique arma, o segundo apaga.
  const [armed, setArmed] = useState<string | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => deleteStudySession(id),
    onSuccess: () => {
      push("success", "Sessão removida");
      setArmed(null);
      onChanged();
    },
    onError: (e) => {
      setArmed(null);
      pushError(e);
    },
  });

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
      <h3 className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
        Sessões recentes
      </h3>
      <div className="flex flex-col">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="group flex items-baseline justify-between gap-3 rounded-[var(--radius-sm)] py-1 text-[12.5px]"
          >
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-medium text-[var(--text-primary)]">
                {s.subjectTitle ?? s.topic ?? "Estudo"}
              </span>
              {s.subjectTitle && s.topic && (
                <span className="truncate text-[11px] text-[var(--text-tertiary)]">{s.topic}</span>
              )}
            </div>
            <div className="flex shrink-0 items-baseline gap-2">
              <span className="tabular text-[var(--text-tertiary)]">
                <span className="font-semibold text-[var(--sphere)]">
                  {formatMinutes(s.minutes)}
                </span>{" "}
                · {shortDay(s.day)}
              </span>
              {/* Corrigir um erro: apaga o estado; o ledger fica (ADR-0047). */}
              <button
                onClick={() => (armed === s.id ? del.mutate(s.id) : setArmed(s.id))}
                onBlur={() => armed === s.id && setArmed(null)}
                disabled={del.isPending}
                title={armed === s.id ? "Clique de novo para remover" : "Remover sessão"}
                className={
                  armed === s.id
                    ? "text-[11px] font-medium text-[var(--danger)]"
                    : "text-[var(--text-tertiary)] opacity-0 transition-opacity hover:text-[var(--danger)] group-hover:opacity-100"
                }
              >
                {armed === s.id ? "remover?" : <Trash2 size={13} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Uma linha de "lendo agora": capinha, título e a barra de páginas. */
function ReadingRow({ book }: { book: Book }) {
  const pct =
    book.totalPages && book.totalPages > 0 ? book.currentPage / book.totalPages : 0;
  const known = book.totalPages != null && book.totalPages > 0;

  return (
    <div className="flex items-center gap-3">
      <div
        className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[var(--radius-md)]"
        style={coverStyle(book.title)}
      >
        <span className="text-[15px] font-bold text-white/85">{bookInitials(book.title)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {book.title}
          </h4>
          {known && (
            <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
              {Math.round(pct * 100)}%
            </span>
          )}
        </div>
        {known ? (
          <div className="mt-1.5 flex flex-col gap-1">
            <ProgressBar value={pct} height={5} />
            <span className="tabular text-[10.5px] text-[var(--text-tertiary)]">
              {book.currentPage}/{book.totalPages} páginas
            </span>
          </div>
        ) : (
          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            {book.currentPage > 0 ? `página ${book.currentPage}` : "sem contagem de páginas"}
          </p>
        )}
      </div>
    </div>
  );
}
