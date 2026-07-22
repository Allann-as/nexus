/**
 * A trilha de IDIOMAS dos Estudos (v1.2, fase D1).
 *
 * Antes, Idiomas/Faculdade/Cursos eram a MESMA lista de projetos — nada gravava
 * a que seção um item pertencia, e por isso o inglês criado em Idiomas aparecia
 * dentro de Faculdade. Agora cada seção é uma TRILHA (`track`) de matérias, e
 * esta lê só `track: "idioma"`.
 *
 * Um idioma não se mede em porcentagem: mede-se em NÍVEL. Por isso o painel de
 * cada língua é a escada — a meta 'staged' ligada por `levelGoalId` — mais as
 * horas vividas (das sessões) e a constância (o tracker plugável). Quem ainda
 * não tem escada ganha o convite de criar uma, com os degraus de sempre.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Clock, Languages, Plus, Route } from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Button, Card, EmptyState, cx } from "../../design-system/primitives";
import { ProgressBar } from "../../design-system/charts";
import { useToasts } from "../../stores/toasts";
import {
  addMilestone,
  archiveSubject,
  createGoal,
  createSubject,
  goalWithProgress,
  listSubjects,
  setMilestoneDone,
  setSubjectLevelGoal,
  subjectProgress,
  type MilestoneView,
  type Subject,
} from "../../lib/ipc";
import { toHours } from "./studyFormat";
import { LogSessionModal } from "./LogSessionModal";
import { SubjectChecklist } from "./SubjectChecklist";
import { HabitTracker } from "../habits/HabitTracker";

/** Os degraus sugeridos de uma língua. O usuário renomeia depois, no card da meta. */
const DEFAULT_STAGES = ["Básico", "Intermediário", "Avançado", "Fluente"];

export function LanguagesTrack({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [logFor, setLogFor] = useState<string | null>(null);

  /* A chave carrega a TRILHA. Era o cache compartilhado que fazia as três abas
     mostrarem a mesma lista — separar as chaves é metade da correção. */
  const subjects = useQuery({
    queryKey: ["subjects", areaId, "idioma"],
    queryFn: () => listSubjects(areaId, "idioma"),
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["subjects", areaId, "idioma"] });
    void client.invalidateQueries({ queryKey: ["subjects", areaId] });
    void client.invalidateQueries({ queryKey: ["nodes", "count"] });
  };

  // Criar uma língua é UM campo: o nome. Nível, horas e constância nascem do uso.
  const create = useMutation({
    mutationFn: () => createSubject({ title: title.trim(), areaId, track: "idioma" }),
    onSuccess: () => {
      push("success", "Idioma criado");
      setTitle("");
      setCreating(false);
      invalidate();
    },
    onError: pushError,
  });

  const archive = useMutation({
    mutationFn: (id: string) => archiveSubject(id),
    onSuccess: () => {
      push("success", "Idioma arquivado");
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
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Idiomas</h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">
            Cada língua com o nível em que você está, as horas acumuladas e a constância.
          </p>
        </div>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating((v) => !v)}>
          Novo idioma
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
            placeholder="Idioma (ex.: Inglês)…"
            className="h-9 min-w-[200px] flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <Button variant="primary" size="sm" onClick={() => create.mutate()} disabled={!canCreate}>
            Criar
          </Button>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <EmptyState
          icon={Languages}
          title="Nenhum idioma ainda"
          hint="Adicione uma língua que você estuda. Depois defina a escada de níveis, registre sessões e o nível, as horas e a constância aparecem aqui."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Novo idioma
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {items.map((s) => (
            <LanguagePanel
              key={s.id}
              subject={s}
              onLog={() => setLogFor(s.id)}
              onArchive={() => archive.mutate(s.id)}
              archiving={archive.isPending && archive.variables === s.id}
              onLadderChanged={invalidate}
            />
          ))}
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

function LanguagePanel({
  subject,
  onLog,
  onArchive,
  archiving,
  onLadderChanged,
}: {
  subject: Subject;
  onLog: () => void;
  onArchive: () => void;
  archiving: boolean;
  onLadderChanged: () => void;
}) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const prog = useQuery({
    queryKey: ["subject-progress", subject.id],
    queryFn: () => subjectProgress(subject.id),
  });

  const ladder = useQuery({
    queryKey: ["goal", subject.levelGoalId],
    queryFn: () => goalWithProgress(subject.levelGoalId as string),
    enabled: subject.levelGoalId != null,
  });

  /* A escada em duas etapas: a meta e, em seguida, os degraus EM ORDEM
     (sequencial — `sort_order` sai da ordem de chegada). Se um degrau falhar, a
     meta criada NÃO é descartada: ela já é válida sem eles, e já fica ligada ao
     idioma. O usuário completa a escada no card da meta. */
  const createLadder = useMutation({
    mutationFn: async () => {
      const goal = await createGoal({
        title: `Nível de ${subject.title}`,
        areaId: subject.areaId,
        goalKind: "staged",
        progressSource: "milestones",
        metricName: null,
        startValue: null,
        targetValue: null,
        unit: null,
      });
      let partial = false;
      try {
        for (const label of DEFAULT_STAGES) {
          await addMilestone({ goalId: goal.id, title: label });
        }
      } catch (e) {
        partial = true;
        pushError(e);
      }
      await setSubjectLevelGoal(subject.id, goal.id);
      return partial;
    },
    onSuccess: (partial) => {
      push(
        "success",
        partial
          ? "A escada foi criada; complete os degraus que faltaram na aba Metas."
          : "Escada de níveis criada",
      );
      onLadderChanged();
      void client.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: pushError,
  });

  const toggleStage = useMutation({
    mutationFn: (m: MilestoneView) => setMilestoneDone(m.id, m.status !== "done"),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["goal", subject.levelGoalId] });
      void client.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: pushError,
  });

  const p = prog.data;
  const g = ladder.data;

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)]">
          <Languages size={16} style={{ color: "var(--sphere)" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-[var(--text-primary)]">
            {subject.title}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
            {g?.progress.stageLabel ?? "sem nível registrado ainda"}
          </p>
        </div>
        <ArmedDelete
          onConfirm={onArchive}
          pending={archiving}
          question="Arquivar este idioma?"
          confirmLabel="Sim, arquivar"
          ariaLabel="Arquivar idioma"
          icon={Archive}
        />
      </div>

      {/* ===== o nível, por degraus ===== */}
      {subject.levelGoalId == null ? (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-subtle)] p-3">
          <p className="text-[12px] text-[var(--text-secondary)]">
            Este idioma ainda não tem uma escada de níveis. Crie uma com os degraus{" "}
            {DEFAULT_STAGES.join(", ")} — depois é só renomear o que não servir.
          </p>
          <Button
            variant="ghost"
            size="sm"
            icon={Route}
            className="mt-2"
            onClick={() => createLadder.mutate()}
            disabled={createLadder.isPending}
          >
            Criar escada de níveis
          </Button>
        </div>
      ) : (
        g && (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="tabular text-[26px] leading-none font-semibold text-[var(--text-primary)]">
                  {g.progress.stageCurrent ?? 0}
                </span>
                <span className="tabular text-[12px] text-[var(--text-tertiary)]">
                  / {g.progress.stageTotal ?? g.milestones.length} degraus
                </span>
              </div>
              <span className="tabular text-[11px] text-[var(--text-tertiary)]">
                {Math.round(g.progress.ratio * 100)}%
              </span>
            </div>
            <ProgressBar value={g.progress.ratio} height={8} />
            <div className="flex flex-col gap-0.5">
              {g.milestones.map((m) => {
                const done = m.status === "done";
                return (
                  <button
                    key={m.id}
                    onClick={() => toggleStage.mutate(m)}
                    disabled={toggleStage.isPending}
                    className={cx(
                      "flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-[12.5px]",
                      "transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-base)]",
                      done ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]",
                    )}
                  >
                    <span
                      className={cx(
                        "grid size-4 shrink-0 place-items-center rounded-full border",
                        done
                          ? "border-[var(--sphere)] bg-[var(--sphere)] text-white"
                          : "border-[var(--border-subtle)]",
                      )}
                    >
                      {done && <Check size={10} strokeWidth={3} />}
                    </span>
                    <span className="truncate">{m.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* ===== as horas vividas ===== */}
      <div className="flex items-baseline gap-1.5 border-t border-[var(--border-subtle)] pt-3">
        <span className="font-mono text-[22px] leading-none font-semibold tabular-nums text-[var(--text-primary)]">
          {p ? toHours(p.totalMinutes) : "—"}
        </span>
        <span className="text-[11px] text-[var(--text-tertiary)]">
          horas estudadas
          {p && p.sessionCount > 0
            ? ` · ${p.sessionCount} ${p.sessionCount === 1 ? "sessão" : "sessões"}`
            : ""}
        </span>
      </div>

      {/* Os TEMAS (0020) — aqui, o que ainda não sai na fala. A aba "Matérias"
          lista todas as trilhas e já desenhava esta lista para um idioma; sem
          ela aqui, a MESMA língua tinha temas numa tela e não tinha na outra. */}
      <SubjectChecklist subjectId={subject.id} track={subject.track} />

      <button
        onClick={onLog}
        className="flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)] text-[12px] font-medium text-[var(--sphere)] transition-colors duration-[var(--dur-fast)] hover:bg-[color-mix(in_srgb,var(--sphere)_16%,transparent)]"
      >
        <Clock size={13} strokeWidth={2.2} />
        Registrar sessão
      </button>

      {/* A constância: o tracker plugável (ADR-0058) desenha os dias do hábito
          ligado a esta língua. Idioma é o caso onde o dia a dia manda. */}
      <HabitTracker nodeId={subject.id} year={new Date().getFullYear()} color="var(--sphere)" />
    </Card>
  );
}
