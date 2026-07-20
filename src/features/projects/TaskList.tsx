/**
 * Lista de tarefas: virtualizada e arrastável.
 *
 * Virtualização é obrigatória por regra da constituição (60fps em 10k itens).
 * dnd-kit e TanStack Virtual convivem porque o dnd-kit trabalha por
 * transformações de CSS sobre os nós que existem — e o virtualizador garante
 * que o nó arrastado esteja entre eles enquanto estiver visível.
 */

import { useMemo, useRef, type ReactNode } from "react";
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
import { GripVertical, Timer } from "lucide-react";

import { Checkbox } from "../../design-system/Checkbox";
import { ArmedDelete } from "../../design-system/ArmedDelete";
import { cx } from "../../design-system/primitives";
import { useFocus } from "../../stores/focus";
import type { Task } from "../../lib/ipc";

const ROW_H = 40;

export function TaskList({
  tasks,
  onToggle,
  onReorder,
  onDelete,
  deletingId,
}: {
  tasks: Task[];
  onToggle: (task: Task) => void;
  onReorder: (id: string, toIndex: number) => void;
  /**
   * Excluir a tarefa. Opcional: a lista continua servindo a quem só quer
   * mostrar tarefas — quem não passa isto simplesmente não ganha o gesto.
   */
  onDelete?: (task: Task) => void;
  /** Qual tarefa está em voo agora, para travar os botões da linha certa. */
  deletingId?: string | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Só as ABERTAS entram na ordenação. `sort_order` é uma propriedade de quem
  // ainda está em aberto: o backend resolve os vizinhos de um arrasto contra a
  // lista sem concluídas (`neighbours`, task_repo.rs). A concluída continua
  // aqui, no lugar e riscada — ela só não tem posição a negociar.
  const openIds = useMemo(
    () => tasks.filter((t) => t.completedAt == null).map((t) => t.id),
    [tasks],
  );

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
    // O índice é o da lista de ABERTAS, e não o da lista visível: é nessa
    // lista que o backend conta as posições. Passar o índice visível faria uma
    // concluída no meio deslocar o destino silenciosamente.
    const toIndex = openIds.indexOf(String(over.id));
    if (toIndex >= 0) onReorder(String(active.id), toIndex);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={openIds} strategy={verticalListSortingStrategy}>
        <div ref={parentRef} className="max-h-[520px] overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((v) => {
              const task = tasks[v.index];
              return task.completedAt != null ? (
                <DoneRow
                  key={task.id}
                  task={task}
                  top={v.start}
                  onToggle={() => onToggle(task)}
                  onDelete={onDelete && (() => onDelete(task))}
                  deleting={deletingId === task.id}
                />
              ) : (
                <SortableRow
                  key={task.id}
                  task={task}
                  top={v.start}
                  onToggle={() => onToggle(task)}
                  onDelete={onDelete && (() => onDelete(task))}
                  deleting={deletingId === task.id}
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

/** A tarefa em aberto: arrastável, com alça que aparece no hover. */
function SortableRow({
  task,
  top,
  onToggle,
  onDelete,
  deleting,
}: {
  task: Task;
  top: number;
  onToggle: () => void;
  onDelete?: () => void;
  deleting: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      className={cx(
        // `group` é o que faz a alça aparecer no hover — sem ela, o
        // `group-hover:` abaixo nunca casa e a alça fica invisível.
        "group absolute inset-x-0 flex items-center gap-2.5 px-2",
        "transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-hover)]",
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
      <RowBody
        task={task}
        onToggle={onToggle}
        onDelete={onDelete}
        deleting={deleting}
        handle={
          <button
            {...attributes}
            {...listeners}
            aria-label={`Reordenar ${task.title}`}
            // touch-none: sem isso o navegador interpreta o gesto como scroll e
            // engole o arrasto antes do dnd-kit ver.
            className="cursor-grab touch-none text-[var(--text-tertiary)] opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 hover:text-[var(--text-secondary)] active:cursor-grabbing"
          >
            <GripVertical size={13} />
          </button>
        }
      />
    </div>
  );
}

/**
 * A tarefa concluída: fica onde estava, apagada e riscada.
 *
 * Sem alça e fora do `SortableContext` — arrastar o que não tem posição no
 * banco moveria um item que a lista de ordenação nem enxerga.
 */
function DoneRow({
  task,
  top,
  onToggle,
  onDelete,
  deleting,
}: {
  task: Task;
  top: number;
  onToggle: () => void;
  onDelete?: () => void;
  deleting: boolean;
}) {
  return (
    <div
      className={cx(
        "group absolute inset-x-0 flex items-center gap-2.5 px-2 opacity-55",
        "transition-[opacity,background-color] duration-[var(--dur-fast)]",
        "hover:bg-[var(--bg-hover)] hover:opacity-100",
      )}
      style={{ top, height: ROW_H }}
    >
      <RowBody task={task} onToggle={onToggle} onDelete={onDelete} deleting={deleting} />
    </div>
  );
}

/** O miolo da linha — idêntico para a aberta e a concluída. */
function RowBody({
  task,
  onToggle,
  onDelete,
  deleting,
  handle,
}: {
  task: Task;
  onToggle: () => void;
  onDelete?: () => void;
  deleting: boolean;
  handle?: ReactNode;
}) {
  const done = task.completedAt != null;
  const priority = PRIORITY[task.priority] ?? PRIORITY[2];

  return (
    <>
      {/* A alça reserva o espaço mesmo quando não existe: sem isto, a linha da
          concluída desalinha das demais. */}
      <span className="grid size-[13px] shrink-0 place-items-center">{handle}</span>

      <Checkbox
        checked={done}
        onChange={onToggle}
        size={18}
        title={done ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
      />

      <Label done={done}>{task.title}</Label>

      {task.durationMin != null && (
        <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
          {task.durationMin}min
        </span>
      )}

      {!done && task.priority !== 2 && (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.1em] uppercase"
          style={{
            color: priority.colour,
            background: `color-mix(in srgb, ${priority.colour} 12%, transparent)`,
          }}
          title={`Prioridade ${priority.label}`}
        >
          {priority.label}
        </span>
      )}

      {/* Focar nesta tarefa: um pomodoro parte de qualquer tarefa aberta (M5). A
          aparição no hover mantém a linha limpa até o gesto ser convidado. */}
      {!done && (
        <button
          onClick={() =>
            useFocus.getState().start({ taskId: task.id, taskTitle: task.title })
          }
          aria-label={`Focar em ${task.title}`}
          title="Focar nesta tarefa"
          className="shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 hover:text-[var(--accent)]"
        >
          <Timer size={14} />
        </button>
      )}

      {/* Excluir esta tarefa. Segue a mesma regra da alça e do pomodoro: some
          em repouso, aparece no hover — a linha continua sendo só a tarefa até
          alguém pedir o contrário. O `focus-within` é o que segura o botão em
          cena depois de armado: o "Sim, excluir" recebe foco sozinho, e sem
          isto a pergunta desapareceria no instante em que o cursor saísse. */}
      {onDelete && (
        <ArmedDelete
          onConfirm={onDelete}
          pending={deleting}
          question="Excluir esta tarefa?"
          ariaLabel={`Excluir ${task.title}`}
          className="opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 focus-within:opacity-100"
        />
      )}
    </>
  );
}

/**
 * O texto da tarefa, com o risco animado.
 *
 * O risco é um pseudo-elemento escalado em X, e não `line-through`: um
 * `text-decoration` aparece pronto, de uma vez, e o gesto perde a resposta. Com
 * `transform: scaleX` o traço é RISCADO da esquerda para a direita em 200ms —
 * e, sendo transform, sai de graça no compositor.
 */
function Label({ children, done }: { children: ReactNode; done: boolean }) {
  return (
    <span className="relative min-w-0 flex-1 truncate">
      <span
        className={cx(
          "text-[13px] transition-colors duration-[var(--dur-base)]",
          done ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]",
        )}
      >
        {children}
      </span>
      <span
        aria-hidden
        className={cx(
          "absolute top-1/2 left-0 h-[1.5px] w-full origin-left rounded-full bg-[var(--text-tertiary)]",
          "transition-transform duration-[var(--dur-base)] ease-[var(--ease)]",
          done ? "scale-x-100" : "scale-x-0",
        )}
      />
    </span>
  );
}
