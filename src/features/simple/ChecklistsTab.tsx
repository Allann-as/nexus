/**
 * Checklists de uma Esfera 'simple' (§2.4): listas nomeadas de checkboxes.
 *
 * Reuso direto do core: uma checklist é um `project`, cada item é uma `task`
 * (cujo `completed` É o checkbox). Zero tabela nova — o padrão Node já dá busca,
 * timeline e ordenação de graça.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus } from "lucide-react";

import { Button, Card, EmptyState } from "../../design-system/primitives";
import { Checkbox } from "../../design-system/Checkbox";
import { useToasts } from "../../stores/toasts";
import {
  createProject,
  createTask,
  listNodes,
  listProjectTasks,
  setTaskCompleted,
} from "../../lib/ipc";

export function ChecklistsTab({ areaId }: { areaId: string }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const lists = useQuery({
    queryKey: ["checklists", areaId],
    queryFn: () => listNodes({ kind: "project", areaId, status: "active", limit: 200 }),
  });

  const create = async () => {
    if (!name.trim()) return;
    try {
      await createProject(name.trim(), areaId);
      push("success", "Checklist criada");
      setName("");
      setAdding(false);
      void client.invalidateQueries({ queryKey: ["checklists", areaId] });
    } catch (e) {
      pushError(e);
    }
  };

  const items = lists.data ?? [];

  return (
    <div className="nx-enter">
      <header className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">Checklists</h2>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdding((v) => !v)}>
          Nova checklist
        </Button>
      </header>

      {adding && (
        <div className="mb-4 flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="Nome da checklist (ex.: Mala da viagem)"
            className="h-9 flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <Button variant="primary" size="sm" onClick={create} disabled={!name.trim()}>
            Criar
          </Button>
        </div>
      )}

      {lists.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]" />
          ))}
        </div>
      ) : items.length === 0 && !adding ? (
        <EmptyState
          icon={ListChecks}
          title="Nenhuma checklist ainda"
          hint="Uma lista nomeada de itens para marcar: mala de viagem, compras, rotina de saída."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
              Nova checklist
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((list) => (
            <ChecklistCard key={list.id} id={list.id} title={list.title} areaId={areaId} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistCard({ id, title, areaId }: { id: string; title: string; areaId: string }) {
  const client = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [newItem, setNewItem] = useState("");

  const tasks = useQuery({
    queryKey: ["checklist", id],
    queryFn: () => listProjectTasks(id, true),
  });

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["checklist", id] });
  };

  const toggle = async (taskId: string, done: boolean) => {
    try {
      await setTaskCompleted(taskId, done);
      invalidate();
    } catch (e) {
      pushError(e);
    }
  };

  const add = async () => {
    if (!newItem.trim()) return;
    try {
      await createTask({ title: newItem.trim(), areaId, projectId: id });
      setNewItem("");
      invalidate();
    } catch (e) {
      pushError(e);
    }
  };

  const items = tasks.data ?? [];
  const done = items.filter((t) => t.completedAt != null).length;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">{title}</h3>
        {items.length > 0 && (
          <span className="tabular text-[11px] text-[var(--text-tertiary)]">
            {done}/{items.length}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1.5">
        {items.map((t) => {
          const isDone = t.completedAt != null;
          return (
            <li key={t.id} className="flex items-center gap-2.5">
              <Checkbox checked={isDone} onChange={() => toggle(t.id, !isDone)} size={18} />
              <span
                className={
                  isDone
                    ? "text-[13px] text-[var(--text-tertiary)] line-through"
                    : "text-[13px] text-[var(--text-primary)]"
                }
              >
                {t.title}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex items-center gap-1.5">
        <input
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="+ item"
          className="h-8 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-subtle)] placeholder:text-[var(--text-tertiary)]"
        />
      </div>
    </Card>
  );
}
