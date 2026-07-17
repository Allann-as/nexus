/**
 * Lista de tarefas: virtualizada e arrastável.
 *
 * Virtualização é obrigatória por regra da constituição (60fps em 10k itens).
 * dnd-kit e TanStack Virtual convivem porque o dnd-kit trabalha por
 * transformações de CSS sobre os nós que existem — e o virtualizador garante
 * que o nó arrastado esteja entre eles enquanto estiver visível.
 */

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Check } from "lucide-react";

import { cx } from "../../design-system/primitives";
import type { Task } from "../../lib/ipc";

const ROW_H = 40;

export function TaskList({
  tasks,
  onToggle,
  onReorder,
}: {
  tasks: Task[];
  onToggle: (task: Task) => void;
  onReorder: (id: string, toIndex: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const ids = useMemo(() => tasks.map((t) => t.id), [tasks]);

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Sem esta distância, um clique na checkbox vira micro-arrasto e a
      // tarefa nunca é concluída.
      activationConstraint: { distance: 5 },
    }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const toIndex = tasks.findIndex((t) => t.id === over.id);
    if (toIndex >= 0) onReorder(String(active.id), toIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={parentRef} className="max-h-[520px] overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const task = tasks[v.index];
              return (
                <Row
                  key={task.id}
                  task={task}
                  top={v.start}
                  onToggle={() => onToggle(task)}
                />
              );
            })}
          </div>
        </div>
      </SortableContext>
    </DndContext>
  );
}

const PRIORITY: Record<number, { label: string; colour: string }> = {
  1: { label: "alta", colour: "var(--danger)" },
  2: { label: "média", colour: "var(--warning)" },
  3: { label: "baixa", colour: "var(--text-tertiary)" },
};

function Row({
  task,
  top,
  onToggle,
}: {
  task: Task;
  top: number;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const done = task.completedAt != null;
  const priority = PRIORITY[task.priority] ?? PRIORITY[2];

  return (
    <div
      ref={setNodeRef}
      className={cx(
        // `group` é o que faz a alça aparecer no hover — sem ela, o
        // `group-hover:` abaixo nunca casa e a alça fica invisível.
        "group absolute inset-x-0 flex items-center gap-2.5 px-2",
        isDragging && "z-10",
      )}
      style={{
        top,
        height: ROW_H,
        // O virtualizador posiciona pelo `top`; o dnd-kit anima pelo transform.
        // Combinar os dois é o que faz o arrasto funcionar numa lista virtual.
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.85 : 1,
      }}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`Reordenar ${task.title}`}
        // touch-none: sem isso o navegador interpreta o gesto como scroll e
        // engole o arrasto antes do dnd-kit ver.
        className="cursor-grab touch-none text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--text-secondary)] active:cursor-grabbing"
      >
        <GripVertical size={13} />
      </button>

      <button
        onClick={onToggle}
        aria-label={done ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
        className={cx(
          "flex size-[16px] shrink-0 items-center justify-center rounded-[4px] border transition-colors duration-[var(--dur-fast)]",
          done
            ? "border-[var(--success)] bg-[var(--success)]"
            : "border-[var(--border-strong)] hover:border-[var(--accent)]",
        )}
      >
        {done && <Check size={11} strokeWidth={3} className="text-black/80" />}
      </button>

      <span
        className={cx(
          "min-w-0 flex-1 truncate text-[13px]",
          done ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]",
        )}
      >
        {task.title}
      </span>

      {task.durationMin != null && (
        <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
          {task.durationMin}min
        </span>
      )}

      {!done && task.priority !== 2 && (
        <span
          className="shrink-0 text-[10px]"
          style={{ color: priority.colour }}
          title={`Prioridade ${priority.label}`}
        >
          {priority.label}
        </span>
      )}
    </div>
  );
}
