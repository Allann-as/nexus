/**
 * A trilha de Matérias dos Estudos (M4.6, item 7).
 *
 * Uma matéria (`subject`) é a espinha do rastreio de estudo: o progresso é
 * COMPUTADO das sessões (horas, contagem, meta), nunca gravado. Cada card mostra
 * o total, a meta (anel), a última sessão e um botão que abre o modal de registro
 * já com a matéria escolhida. Criar é inline, como as competências da Carreira.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Brain, Plus, Clock, BookMarked, Link2 } from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Button, Card, EmptyState } from "../../design-system/primitives";
import { ProgressRing } from "../../design-system/charts";
import { useToasts } from "../../stores/toasts";
import {
  archiveSubject,
  createSubject,
  listSubjects,
  subjectProgress,
  type Subject,
} from "../../lib/ipc";
import { formatMinutes, toHours, shortDay } from "./studyFormat";
import { LogSessionModal } from "./LogSessionModal";
import { HabitTracker } from "../habits/HabitTracker";

export function SubjectsTrack({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [hours, setHours] = useState("");
  /** Qual matéria abriu o modal de sessão (ou "geral" quando sem preset). */
  const [logFor, setLogFor] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);

  const subjects = useQuery({
    queryKey: ["subjects", areaId],
    queryFn: () => listSubjects(areaId),
  });

  const create = useMutation({
    mutationFn: () =>
      createSubject({
        title: title.trim(),
        areaId,
        category: category.trim() || null,
        // A meta é em minutos; a UI pede em horas (mais natural para estudo).
        targetMinutes: hours.trim() ? Math.round(Number(hours) * 60) : null,
      }),
    onSuccess: () => {
      push("success", "Matéria criada");
      setTitle("");
      setCategory("");
      setHours("");
      setCreating(false);
      void client.invalidateQueries({ queryKey: ["subjects", areaId] });
      void client.invalidateQueries({ queryKey: ["nodes", "count"] });
    },
    onError: pushError,
  });

  /* Arquivar não é apagar. A matéria sai da trilha, mas as sessões continuam
     onde sempre estiveram — as horas já vividas não deixam de ter sido vividas.
     É a saída de quem terminou o semestre, ou de quem criou "Cálculo I" duas
     vezes: some da vista sem falsificar o passado (ADR-0056). */
  const archive = useMutation({
    mutationFn: (id: string) => archiveSubject(id),
    onSuccess: () => {
      push("success", "Matéria arquivada");
      void client.invalidateQueries({ queryKey: ["subjects", areaId] });
      void client.invalidateQueries({ queryKey: ["subject-progress"] });
      void client.invalidateQueries({ queryKey: ["studies"] });
      void client.invalidateQueries({ queryKey: ["study-stats", areaId] });
      void client.invalidateQueries({ queryKey: ["nodes", "count"] });
      void client.invalidateQueries({ queryKey: ["gamification"] });
      void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
    },
    onError: pushError,
  });

  const items = subjects.data ?? [];

  const refreshAfterLog = () => {
    setLogging(false);
    setLogFor(null);
    void client.invalidateQueries({ queryKey: ["subjects", areaId] });
    void client.invalidateQueries({ queryKey: ["subject-progress"] });
    void client.invalidateQueries({ queryKey: ["studies"] });
    void client.invalidateQueries({ queryKey: ["study-stats", areaId] });
    void client.invalidateQueries({ queryKey: ["gamification"] });
    void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
  };

  const canCreate = title.trim().length > 0 && !create.isPending;

  return (
    <div className="nx-enter">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Matérias</h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
            O que você estuda, com as horas acumuladas de cada sessão registrada.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" icon={Clock} onClick={() => setLogging(true)}>
            Registrar sessão
          </Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating((v) => !v)}>
            Nova
          </Button>
        </div>
      </header>

      {creating && (
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) create.mutate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Matéria (ex.: Cálculo I)…"
            className="h-9 min-w-[200px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) create.mutate();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="Categoria (opcional)"
            className="h-9 w-[150px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <input
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canCreate) create.mutate();
              if (e.key === "Escape") setCreating(false);
            }}
            inputMode="numeric"
            placeholder="Meta (h)"
            className="tabular h-9 w-[90px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <Button variant="primary" size="sm" onClick={() => create.mutate()} disabled={!canCreate}>
            Criar
          </Button>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <EmptyState
          icon={Brain}
          title="Nenhuma matéria ainda"
          hint="Uma matéria é o que você está estudando — Cálculo, inglês, um concurso. Registre sessões contra ela e as horas se acumulam aqui, com a meta e o histórico."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Nova matéria
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <SubjectCard
              key={s.id}
              subject={s}
              onLog={() => setLogFor(s.id)}
              onArchive={() => archive.mutate(s.id)}
              archiving={archive.isPending && archive.variables === s.id}
            />
          ))}
        </div>
      )}

      {(logging || logFor) && (
        <LogSessionModal
          areaId={areaId}
          presetSubjectId={logFor ?? undefined}
          onClose={() => {
            setLogging(false);
            setLogFor(null);
          }}
          onSaved={refreshAfterLog}
        />
      )}
    </div>
  );
}

function SubjectCard({
  subject,
  onLog,
  onArchive,
  archiving = false,
}: {
  subject: Subject;
  onLog: () => void;
  onArchive: () => void;
  /** O arquivamento desta matéria está em voo. */
  archiving?: boolean;
}) {
  const prog = useQuery({
    queryKey: ["subject-progress", subject.id],
    queryFn: () => subjectProgress(subject.id),
  });
  const p = prog.data;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)]">
          <Brain size={16} style={{ color: "var(--sphere)" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-[var(--text-primary)]">
            {subject.title}
          </p>
          {subject.category && (
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-tertiary)]">
              {subject.category}
            </p>
          )}
        </div>
        {/* O arquivo fica no cabeçalho, longe do botão de registrar sessão: a
            saída da matéria não pode dividir vizinhança com o gesto diário. */}
        <ArmedDelete
          onConfirm={onArchive}
          pending={archiving}
          question="Arquivar esta matéria?"
          confirmLabel="Sim, arquivar"
          ariaLabel="Arquivar matéria"
          icon={Archive}
        />
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[26px] leading-none font-semibold tabular-nums text-[var(--text-primary)]">
            {p ? toHours(p.totalMinutes) : "—"}
          </span>
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {subject.targetMinutes ? `de ${toHours(subject.targetMinutes)} h` : "horas"}
          </span>
        </div>
        {p && p.targetProgress != null && (
          <ProgressRing value={p.targetProgress} size={52} thickness={5}>
            <span className="tabular text-[10px] font-bold text-[var(--text-primary)]">
              {Math.round(p.targetProgress * 100)}%
            </span>
          </ProgressRing>
        )}
      </div>

      {/* Micro-metadados reais, omitidos sem dado (nunca um zero inventado). */}
      {p && (p.sessionCount > 0 || p.booksTouched > 0 || p.linkedCount > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
          {p.sessionCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} />
              {p.sessionCount} {p.sessionCount === 1 ? "sessão" : "sessões"}
            </span>
          )}
          {p.booksTouched > 0 && (
            <span className="inline-flex items-center gap-1">
              <BookMarked size={12} />
              {p.booksTouched} {p.booksTouched === 1 ? "livro" : "livros"}
            </span>
          )}
          {p.linkedCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Link2 size={12} />
              {p.linkedCount} {p.linkedCount === 1 ? "vínculo" : "vínculos"}
            </span>
          )}
        </div>
      )}

      {p && p.recent.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-[var(--border-subtle)] pt-2">
          {p.recent.slice(0, 3).map((r) => (
            <div
              key={r.id}
              className="flex items-baseline justify-between gap-2 text-[11px]"
            >
              <span className="truncate text-[var(--text-secondary)]">
                {r.topic ?? "sessão"}
              </span>
              <span className="tabular shrink-0 text-[var(--text-tertiary)]">
                {formatMinutes(r.minutes)} · {shortDay(r.day)}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        onClick={onLog}
        className="flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)] text-[12px] font-medium text-[var(--sphere)] transition-colors duration-[var(--dur-fast)] hover:bg-[color-mix(in_srgb,var(--sphere)_16%,transparent)]"
      >
        <Clock size={13} strokeWidth={2.2} />
        Registrar sessão
      </button>

      {/* O tracker plugável (ADR-0058): um hábito ligado desenha aqui os dias que
          alimentam esta matéria. Só exibição — a matéria não tem alvo de dias a
          contar sozinho como a Meta. */}
      <HabitTracker nodeId={subject.id} year={new Date().getFullYear()} color="var(--sphere)" />
    </Card>
  );
}
