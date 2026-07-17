/**
 * Metas & Projetos.
 *
 * M2 entrega Projetos com tarefas (virtualizadas, arrastáveis) e barra de
 * progresso. As Metas — métrica, checkpoints e projeção linear — chegam no M3,
 * junto do Calendário.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, FolderKanban, ListTodo, Plus, Target } from "lucide-react";

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
import { CountUp, HeroCard, StatCard } from "../../design-system/cards";
import { ProgressBar, ProgressRing } from "../../design-system/charts";
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
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] pb-12">
        <PageHeader
          title="Metas & Projetos"
          subtitle="Do objetivo à próxima ação"
          actions={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Novo projeto
            </Button>
          }
        />

        <div className="px-8">
          {creating && <CreateProjectForm onDone={() => setCreating(false)} />}

          {projects.length === 0 && !isPending && !creating ? (
            <div className="min-h-[420px]">
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
            <div className="grid grid-cols-[240px_1fr] items-start gap-4">
              <nav className="space-y-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p.id)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-[var(--radius-md)] border px-2.5 text-left text-[13px]",
                      "transition-[background-color,border-color,color] duration-[var(--dur-fast)] ease-[var(--ease)]",
                      current === p.id
                        ? "border-[color-mix(in_srgb,var(--sphere)_35%,transparent)] bg-[var(--accent-muted)] text-[var(--text-primary)]"
                        : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                    )}
                    style={{ height: "var(--row-list)" }}
                  >
                    <FolderKanban
                      size={14}
                      className={
                        current === p.id ? "text-[var(--sphere)]" : "text-[var(--text-tertiary)]"
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
    </div>
  );
}

function ProjectPanel({ projectId, title }: { projectId: string; title: string }) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [newTask, setNewTask] = useState("");

  // `includeDone` ligado: a tarefa concluída CONTINUA na lista, riscada. Sumir
  // ao marcar custa duas coisas — a linha seguinte pula para debaixo do cursor
  // e o clique seguinte acerta o item errado; e o risco no texto, que é a
  // prova de que você fez, nunca chega a ser visto.
  const { data: tasks = [] } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => listProjectTasks(projectId, true),
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

  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const open = total - done;
  const ratio = total > 0 ? done / total : 0;
  const pct = Math.round(ratio * 100);

  return (
    <div className="space-y-4">
      <HeroCard
        label={title}
        value={total > 0 ? `${done}/${total}` : "—"}
        hint={
          total > 0
            ? `${pct}% das tarefas deste projeto concluídas`
            : "Nenhuma tarefa neste projeto ainda"
        }
        aside={
          <ProgressRing value={ratio} size={72} thickness={6}>
            <span className="tabular text-[15px] font-semibold">{pct}%</span>
          </ProgressRing>
        }
      >
        <ProgressBar value={ratio} />
      </HeroCard>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={ListTodo}
          label="Em aberto"
          value={<CountUp to={open} />}
          tone={open > 0 ? "accent" : "sphere"}
        />
        <StatCard
          icon={CheckSquare}
          label="Concluídas"
          value={<CountUp to={done} />}
          tone="success"
        />
      </div>

      <Card className="overflow-hidden">
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
            Nenhuma tarefa ainda.
          </p>
        ) : (
          <TaskList
            tasks={tasks}
            onToggle={(t) => toggle.mutate(t)}
            onReorder={(id, toIndex) => reorder.mutate({ id, toIndex })}
          />
        )}
      </Card>
    </div>
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
          className="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-[12px] outline-none transition-colors duration-[var(--dur-fast)] hover:border-[var(--border-strong)]"
        >
          <option value="">sem Esfera</option>
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
