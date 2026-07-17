/**
 * Metas & Projetos.
 *
 * M2 entrega Projetos com tarefas (virtualizadas, arrastáveis) e barra de
 * progresso. As Metas — métrica, checkpoints e projeção linear — chegam no M3,
 * junto do Calendário.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, Target } from "lucide-react";

import {
  listNodes,
  createProject,
  createTask,
  listProjectTasks,
  projectProgress,
  setTaskCompleted,
  moveTask,
  listAreas,
  type Task,
} from "../../lib/ipc";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  cx,
} from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { TaskList } from "./TaskList";

export function ProjectsScreen() {
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: projects = [], isPending } = useQuery({
    queryKey: ["nodes", { kind: "project", status: "active" }],
    queryFn: () => listNodes({ kind: "project", status: "active", limit: 200 }),
  });

  const current = selected ?? projects[0]?.id ?? null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Metas & Projetos"
        subtitle="Do objetivo à próxima ação"
        actions={
          <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
            Novo projeto
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {creating && <CreateProjectForm onDone={() => setCreating(false)} />}

        {projects.length === 0 && !isPending && !creating ? (
          <div className="h-[60%]">
            <EmptyState
              icon={FolderKanban}
              title="Nenhum projeto ainda"
              hint="Um projeto é um resultado com várias tarefas. A barra de progresso é simplesmente quantas delas você concluiu."
              action={
                <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
                  Criar o primeiro
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid grid-cols-[240px_1fr] gap-4">
            <nav className="space-y-1">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 text-left text-[13px]",
                    "transition-colors duration-[var(--dur-fast)]",
                    current === p.id
                      ? "bg-[var(--accent-muted)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                  )}
                  style={{ height: "var(--row-list)" }}
                >
                  <FolderKanban
                    size={14}
                    className={
                      current === p.id ? "text-[var(--accent)]" : "text-[var(--text-tertiary)]"
                    }
                  />
                  <span className="truncate">{p.title}</span>
                </button>
              ))}
            </nav>

            {current ? (
              <ProjectPanel
                projectId={current}
                title={projects.find((p) => p.id === current)?.title ?? ""}
              />
            ) : (
              <Card className="p-8">
                <p className="text-center text-[13px] text-[var(--text-tertiary)]">
                  Escolha um projeto.
                </p>
              </Card>
            )}
          </div>
        )}

        <Card className="mt-4 p-4">
          <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
            <Target size={13} />
            <span className="text-[12px]">
              Metas com métrica, checkpoints e projeção linear chegam no M3.
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ProjectPanel({ projectId, title }: { projectId: string; title: string }) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [newTask, setNewTask] = useState("");

  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => listProjectTasks(projectId, false),
  });
  const { data: progress } = useQuery({
    queryKey: ["tasks", "progress", projectId],
    queryFn: () => projectProgress(projectId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const add = useMutation({
    mutationFn: (t: string) => createTask({ title: t, projectId }),
    onSuccess: () => {
      invalidate();
      setNewTask("");
    },
    onError: pushError,
  });

  const toggle = useMutation({
    mutationFn: (task: Task) => setTaskCompleted(task.id, task.completedAt == null),
    onSuccess: invalidate,
    onError: pushError,
  });

  const reorder = useMutation({
    mutationFn: ({ id, toIndex }: { id: string; toIndex: number }) =>
      moveTask(id, projectId, toIndex),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", projectId] }),
    onError: pushError,
  });

  const pct = progress && progress.total > 0
    ? Math.round((progress.done / progress.total) * 100)
    : 0;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--border-subtle)] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="truncate text-[15px] font-medium">{title}</h2>
          <span className="tabular shrink-0 text-[12px] text-[var(--text-tertiary)]">
            {progress ? `${progress.done}/${progress.total}` : "—"}
          </span>
        </div>

        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[var(--bg-base)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-[var(--dur-base)] ease-[var(--ease)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="border-b border-[var(--border-subtle)] px-3 py-2">
        <input
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newTask.trim() && !add.isPending) {
              add.mutate(newTask.trim());
            }
          }}
          placeholder="Nova tarefa — Enter para adicionar"
          className="w-full bg-transparent py-1 text-[13px] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </div>

      {tasks.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12px] text-[var(--text-tertiary)]">
          Nenhuma tarefa em aberto.
        </p>
      ) : (
        <TaskList
          tasks={tasks}
          onToggle={(t) => toggle.mutate(t)}
          onReorder={(id, toIndex) => reorder.mutate({ id, toIndex })}
        />
      )}
    </Card>
  );
}

function CreateProjectForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [title, setTitle] = useState("");
  const [areaId, setAreaId] = useState("");

  const { data: areas = [] } = useQuery({ queryKey: ["areas"], queryFn: () => listAreas(false) });

  const create = useMutation({
    mutationFn: () => createProject(title.trim(), areaId || null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nodes"] });
      onDone();
    },
    onError: pushError,
  });

  return (
    <Card className="mb-4 p-4">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim() && !create.isPending) create.mutate();
          if (e.key === "Escape") onDone();
        }}
        placeholder="Nome do projeto"
        className="w-full bg-transparent text-[14px] outline-none placeholder:text-[var(--text-tertiary)]"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <select
          value={areaId}
          onChange={(e) => setAreaId(e.target.value)}
          className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-[12px] outline-none"
        >
          <option value="">sem área</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancelar
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => create.mutate()}
            disabled={!title.trim() || create.isPending}
          >
            Criar
          </Button>
        </div>
      </div>
    </Card>
  );
}
