/**
 * A trilha de FACULDADE dos Estudos (v1.2, fase D2 — versão REDUZIDA).
 *
 * É a trilha de matérias de sempre, filtrada por `track: "faculdade"`: cada
 * matéria com as horas acumuladas, o progresso contra a meta e a constância do
 * hábito ligado. Nada aqui é gravado à mão — tudo vem das sessões.
 *
 * NOTA HONESTA sobre o que NÃO está aqui: datas de prova e de entrega, e as
 * listas de tarefas por matéria, foram DELIBERADAMENTE adiadas pelo dono do
 * projeto. Não é esquecimento nem trabalho pela metade — é escopo cortado de
 * propósito nesta fase. Quando voltarem, o lugar delas é esta trilha.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BookMarked, Clock, GraduationCap, Link2, Plus } from "lucide-react";

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

export function CollegeTrack({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [hours, setHours] = useState("");
  const [logFor, setLogFor] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);

  /* A chave carrega a TRILHA — chave compartilhada era metade do bug original. */
  const subjects = useQuery({
    queryKey: ["subjects", areaId, "faculdade"],
    queryFn: () => listSubjects(areaId, "faculdade"),
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["subjects", areaId, "faculdade"] });
    void client.invalidateQueries({ queryKey: ["subjects", areaId] });
    void client.invalidateQueries({ queryKey: ["nodes", "count"] });
  };

  const create = useMutation({
    mutationFn: () =>
      createSubject({
        title: title.trim(),
        areaId,
        // `category` é texto livre e pertence ao USUÁRIO ("Semestre 3", "optativa").
        // Quem discrimina a seção é o `track`, nunca ela.
        category: category.trim() || null,
        targetMinutes: hours.trim() ? Math.round(Number(hours) * 60) : null,
        track: "faculdade",
      }),
    onSuccess: () => {
      push("success", "Matéria criada");
      setTitle("");
      setCategory("");
      setHours("");
      setCreating(false);
      invalidate();
    },
    onError: pushError,
  });

  const archive = useMutation({
    mutationFn: (id: string) => archiveSubject(id),
    onSuccess: () => {
      push("success", "Matéria arquivada");
      invalidate();
      void client.invalidateQueries({ queryKey: ["subject-progress"] });
      void client.invalidateQueries({ queryKey: ["studies"] });
      void client.invalidateQueries({ queryKey: ["study-stats", areaId] });
      void client.invalidateQueries({ queryKey: ["gamification"] });
      void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
    },
    onError: pushError,
  });

  const refreshAfterLog = () => {
    setLogging(false);
    setLogFor(null);
    invalidate();
    void client.invalidateQueries({ queryKey: ["subject-progress"] });
    void client.invalidateQueries({ queryKey: ["studies"] });
    void client.invalidateQueries({ queryKey: ["study-stats", areaId] });
    void client.invalidateQueries({ queryKey: ["gamification"] });
    void client.invalidateQueries({ queryKey: ["spheres", "overview"] });
  };

  const items = subjects.data ?? [];
  const canCreate = title.trim().length > 0 && !create.isPending;

  return (
    <div className="nx-enter">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Faculdade</h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
            As matérias do curso, com as horas de cada sessão e a constância.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" icon={Clock} onClick={() => setLogging(true)}>
            Registrar sessão
          </Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating((v) => !v)}>
            Nova matéria
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
            placeholder="Período (opcional)"
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
          icon={GraduationCap}
          title="Nenhuma matéria da faculdade ainda"
          hint="Adicione as matérias do semestre. Registre sessões contra elas e as horas, a meta e a constância se acumulam aqui."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Nova matéria
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((s) => (
            <CollegeCard
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

function CollegeCard({
  subject,
  onLog,
  onArchive,
  archiving,
}: {
  subject: Subject;
  onLog: () => void;
  onArchive: () => void;
  archiving: boolean;
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
          <GraduationCap size={16} style={{ color: "var(--sphere)" }} />
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
            <div key={r.id} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate text-[var(--text-secondary)]">{r.topic ?? "sessão"}</span>
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

      <HabitTracker nodeId={subject.id} year={new Date().getFullYear()} color="var(--sphere)" />
    </Card>
  );
}
