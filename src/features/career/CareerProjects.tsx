/**
 * Projetos profissionais (e "habilidades em desenvolvimento", que são projetos
 * com checklists — §2.3). Reuso direto do kind 'project' do core.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FolderKanban, Plus } from "lucide-react";

import { Button, Card, EmptyState, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { createProject, listNodes } from "../../lib/ipc";

export function CareerProjects({
  areaId,
  label,
  hint,
}: {
  areaId: string;
  label: string;
  hint: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");

  const projects = useQuery({
    queryKey: ["nodes", "project", areaId],
    queryFn: () => listNodes({ kind: "project", areaId, status: "active", limit: 500 }),
  });

  const create = async () => {
    if (!title.trim()) return;
    try {
      await createProject(title.trim(), areaId);
      push("success", `${label} criado`);
      setTitle("");
      setCreating(false);
      void client.invalidateQueries({ queryKey: ["nodes", "project", areaId] });
    } catch (e) {
      pushError(e);
    }
  };

  const items = projects.data ?? [];

  return (
    <div className="nx-enter">
      <header className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">{label}</h2>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating((v) => !v)}>
          Novo
        </Button>
      </header>

      {creating && (
        <div className="mb-4 flex gap-2">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder={`Nome do ${label.toLowerCase()}…`}
            className="h-9 flex-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
          />
          <Button variant="primary" size="sm" onClick={create} disabled={!title.trim()}>
            Criar
          </Button>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <EmptyState
          icon={FolderKanban}
          title={`Nenhum ${label.toLowerCase()} ainda`}
          hint={hint}
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Novo
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <Card
              key={p.id}
              hover
              className={cx("cursor-pointer p-4")}
            >
              <button onClick={() => navigate("/projects")} className="w-full text-left">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-9 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)]">
                    <FolderKanban size={16} style={{ color: "var(--sphere)" }} />
                  </span>
                  <span className="truncate text-[14px] font-medium text-[var(--text-primary)]">
                    {p.title}
                  </span>
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
