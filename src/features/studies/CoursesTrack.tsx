/**
 * A trilha de CURSOS dos Estudos (v1.2, fase D3).
 *
 * Um catálogo honesto: o que você quer fazer, o que está fazendo e o que já
 * concluiu. O estágio (`courseStage`) é uma coluna fechada do backend — só a
 * trilha `curso` a aceita —, e a lista vem AGRUPADA por ele, para a fila de
 * "quero fazer" (que sempre cresce mais rápido) não afogar o que está em curso.
 *
 * A previsão de conclusão é opcional e sempre editável: é uma intenção, não uma
 * promessa. As horas continuam vindo das sessões, como em toda matéria.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, CheckCircle2, Clock, MonitorPlay, Pencil, Plus } from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { DatePicker } from "../../design-system/DatePicker";
import { Button, Card, EmptyState, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import {
  archiveSubject,
  createSubject,
  listSubjects,
  setCourseStage,
  setSubjectExpectedEnd,
  setSubjectSummary,
  subjectProgress,
  type CourseStage,
  type Subject,
} from "../../lib/ipc";
import { toHours } from "./studyFormat";
import { LogSessionModal } from "./LogSessionModal";
import { SubjectChecklist } from "./SubjectChecklist";

const STAGES: Array<{ key: CourseStage; label: string; hint: string }> = [
  { key: "fazendo", label: "Fazendo", hint: "o que está em curso agora" },
  { key: "quero_fazer", label: "Quero fazer", hint: "a fila — ainda não começou" },
  { key: "concluido", label: "Concluídos", hint: "terminados" },
];

const STAGE_LABEL: Record<CourseStage, string> = {
  quero_fazer: "Quero fazer",
  fazendo: "Fazendo",
  concluido: "Concluído",
};

export function CoursesTrack({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [logFor, setLogFor] = useState<string | null>(null);

  const subjects = useQuery({
    queryKey: ["subjects", areaId, "curso"],
    queryFn: () => listSubjects(areaId, "curso"),
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["subjects", areaId, "curso"] });
    void client.invalidateQueries({ queryKey: ["subjects", areaId] });
    void client.invalidateQueries({ queryKey: ["nodes", "count"] });
  };

  // Todo curso nasce na fila: "quero fazer" é o estado honesto de quem acabou
  // de anotar um curso que ainda não abriu.
  const create = useMutation({
    mutationFn: () =>
      createSubject({
        title: title.trim(),
        areaId,
        track: "curso",
        courseStage: "quero_fazer",
      }),
    onSuccess: () => {
      push("success", "Curso adicionado");
      setTitle("");
      setCreating(false);
      invalidate();
    },
    onError: pushError,
  });

  const stage = useMutation({
    mutationFn: (v: { id: string; stage: CourseStage }) => setCourseStage(v.id, v.stage),
    onSuccess: () => invalidate(),
    onError: pushError,
  });

  const expected = useMutation({
    mutationFn: (v: { id: string; day: string | null }) => setSubjectExpectedEnd(v.id, v.day),
    onSuccess: () => invalidate(),
    onError: pushError,
  });

  const summarize = useMutation({
    mutationFn: (v: { id: string; summary: string | null }) => setSubjectSummary(v.id, v.summary),
    onSuccess: () => invalidate(),
    onError: pushError,
  });

  const archive = useMutation({
    mutationFn: (id: string) => archiveSubject(id),
    onSuccess: () => {
      push("success", "Curso arquivado");
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
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Cursos</h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
            O que você quer fazer, o que está fazendo e o que já concluiu.
          </p>
        </div>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating((v) => !v)}>
          Novo curso
        </Button>
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
            placeholder="Curso (ex.: React avançado)…"
            className="h-9 min-w-[200px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <Button variant="primary" size="sm" onClick={() => create.mutate()} disabled={!canCreate}>
            Adicionar
          </Button>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <EmptyState
          icon={MonitorPlay}
          title="Nenhum curso ainda"
          hint="Anote um curso que você quer fazer. Ele entra na fila; quando começar, mova para 'fazendo' e registre as sessões."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Novo curso
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {STAGES.map((s) => {
            /* `courseStage` pode vir null num curso criado por caminho antigo
               (a classificação do legado, por exemplo) — ele cai na fila, que é
               a leitura menos presunçosa. */
            const group = items.filter((i) => (i.courseStage ?? "quero_fazer") === s.key);
            if (group.length === 0) return null;
            return (
              <section key={s.key}>
                <h3 className="mb-2 flex items-baseline gap-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
                  {s.label}
                  <span className="tabular text-[10px] tracking-normal normal-case">
                    {group.length}
                  </span>
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.map((c) => (
                    <CourseCard
                      key={c.id}
                      subject={c}
                      onStage={(st) => stage.mutate({ id: c.id, stage: st })}
                      onExpectedEnd={(day) => expected.mutate({ id: c.id, day })}
                      onSummary={(summary) => summarize.mutate({ id: c.id, summary })}
                      onLog={() => setLogFor(c.id)}
                      onArchive={() => archive.mutate(c.id)}
                      archiving={archive.isPending && archive.variables === c.id}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {logFor && (
        <LogSessionModal
          areaId={areaId}
          presetSubjectId={logFor}
          onClose={() => setLogFor(null)}
          onSaved={refreshAfterLog}
        />
      )}
    </div>
  );
}

/**
 * O texto curto do que o curso ensina — editável no lugar onde é lido.
 *
 * Sem descrição, o card oferece o gesto ("Descrever o que ensina") em vez de uma
 * linha vazia: um campo em branco permanente seria enfeite; um convite é função.
 */
function CourseSummary({
  subject,
  onSave,
}: {
  subject: Subject;
  onSave: (summary: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(subject.summary ?? "");

  const commit = () => {
    setEditing(false);
    const next = text.trim();
    // Nada mudou? Não gasta uma escrita — e o card não pisca à toa.
    if (next === (subject.summary ?? "")) return;
    onSave(next || null);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setText(subject.summary ?? "");
            setEditing(false);
          }
        }}
        placeholder="O que este curso ensina…"
        aria-label={`O que ${subject.title} ensina`}
        className="h-7 w-full rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setText(subject.summary ?? "");
        setEditing(true);
      }}
      className="text-left text-[12px] text-[var(--text-secondary)] transition-colors duration-[var(--dur-fast)] hover:text-[var(--text-primary)]"
    >
      {subject.summary ?? (
        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
          <Pencil size={11} strokeWidth={2.2} />
          Descrever o que ensina
        </span>
      )}
    </button>
  );
}

function CourseCard({
  subject,
  onStage,
  onExpectedEnd,
  onSummary,
  onLog,
  onArchive,
  archiving,
}: {
  subject: Subject;
  onStage: (stage: CourseStage) => void;
  onExpectedEnd: (day: string | null) => void;
  onSummary: (summary: string | null) => void;
  onLog: () => void;
  onArchive: () => void;
  archiving: boolean;
}) {
  const prog = useQuery({
    queryKey: ["subject-progress", subject.id],
    queryFn: () => subjectProgress(subject.id),
  });
  const p = prog.data;
  const current = subject.courseStage ?? "quero_fazer";
  const done = current === "concluido";

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)]">
          {done ? (
            <CheckCircle2 size={16} style={{ color: "var(--sphere)" }} />
          ) : (
            <MonitorPlay size={16} style={{ color: "var(--sphere)" }} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cx(
              "truncate text-[14px] font-medium",
              done ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]",
            )}
          >
            {subject.title}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
            {STAGE_LABEL[current]}
            {p && p.totalMinutes > 0 ? ` · ${toHours(p.totalMinutes)} h` : ""}
          </p>
        </div>
        <ArmedDelete
          onConfirm={onArchive}
          pending={archiving}
          question="Arquivar este curso?"
          confirmLabel="Sim, arquivar"
          ariaLabel="Arquivar curso"
          icon={Archive}
        />
      </div>

      {/* O estágio como três pílulas: o estado atual fica LEGÍVEL, e mudar é um
          clique só — não um menu que esconde onde o curso está. */}
      <div className="flex items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5">
        {(["quero_fazer", "fazendo", "concluido"] as CourseStage[]).map((s) => (
          <button
            key={s}
            onClick={() => onStage(s)}
            className={cx(
              "flex-1 rounded-full px-2 py-1 text-[10.5px] font-medium",
              "transition-colors duration-[var(--dur-fast)]",
              current === s
                ? "bg-[color-mix(in_srgb,var(--sphere)_22%,transparent)] text-[var(--text-primary)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
            )}
          >
            {STAGE_LABEL[s]}
          </button>
        ))}
      </div>

      {/* O que o curso ENSINA (a coluna `summary`, viva no schema desde a 0017 e
          sem escritor até a 0020 — ADR-0092). Fica logo abaixo do título porque é
          identidade do curso, não progresso: "React avançado" sozinho não diz se
          é hooks ou renderização no servidor. */}
      <CourseSummary subject={subject} onSave={onSummary} />

      {/* A CHECKLIST de conteúdos — a mesma lista dos temas de uma matéria, e por
          isso o mesmo componente (ADR-0092). Some no curso concluído: uma lista
          de conteúdos a fazer num curso terminado é passado, não trabalho. */}
      {!done && <SubjectChecklist subjectId={subject.id} track={subject.track} />}

      {/* A previsão só faz sentido enquanto não terminou: num curso concluído,
          "previsão" já virou passado. */}
      {!done && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
            Previsão de conclusão
          </span>
          <DatePicker
            value={subject.expectedEnd}
            onChange={onExpectedEnd}
            clearable
            placeholder="Sem previsão"
            ariaLabel={`Previsão de conclusão de ${subject.title}`}
          />
        </div>
      )}

      {!done && (
        <button
          onClick={onLog}
          className="flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)] text-[12px] font-medium text-[var(--sphere)] transition-colors duration-[var(--dur-fast)] hover:bg-[color-mix(in_srgb,var(--sphere)_16%,transparent)]"
        >
          <Clock size={13} strokeWidth={2.2} />
          Registrar sessão
        </button>
      )}
    </Card>
  );
}
