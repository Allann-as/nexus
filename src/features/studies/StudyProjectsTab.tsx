/**
 * As tabs de Idiomas / Faculdade / Cursos.
 *
 * São o conceito de projeto do núcleo, reusado: uma grade simples dos projetos
 * ativos desta Esfera + um botão de criar. Intencionalmente enxuto — a riqueza
 * mora na tela de projeto, não aqui.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, X } from "lucide-react";

import { Modal } from "../../design-system/Modal";
import { Button, EmptyState } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { createNode, listNodes } from "../../lib/ipc";

export function StudyProjectsTab({
  areaId,
  label,
}: {
  areaId: string;
  /** "Idiomas" | "Faculdade" | "Cursos" — muda só a cópia. */
  label: string;
}) {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);

  const projects = useQuery({
    queryKey: ["nodes", "project", areaId],
    queryFn: () => listNodes({ kind: "project", areaId, status: "active", limit: 200 }),
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["nodes"] });
  };

  const items = projects.data ?? [];

  return (
    <div className="nx-enter">
      <header className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">{label}</h2>
          {items.length > 0 && (
            <p className="mt-0.5 text-[12.5px] text-[var(--text-tertiary)]">
              {items.length} {items.length === 1 ? "projeto ativo" : "projetos ativos"}
            </p>
          )}
        </div>
        <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
          Novo projeto
        </Button>
      </header>

      {projects.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={`Nenhum projeto de ${label.toLowerCase()} ainda`}
          hint="Crie um projeto para organizar as tarefas e o progresso deste tema."
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              Novo projeto
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)]">
                <FolderKanban size={17} style={{ color: "var(--sphere)" }} />
              </span>
              <h3 className="line-clamp-2 text-[14px] font-semibold leading-tight text-[var(--text-primary)]">
                {p.title}
              </h3>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <NewProjectModal
          areaId={areaId}
          label={label}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function NewProjectModal({
  areaId,
  label,
  onClose,
  onSaved,
}: {
  areaId: string;
  label: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await createNode("project", title.trim(), areaId);
      push("success", "Projeto criado");
      onSaved();
    } catch (e) {
      pushError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <div className="p-5">
          <header className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              Novo projeto · {label}
            </h2>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-4">
            <input
              ref={input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="Inglês C1, Cálculo II, Curso de React…"
              className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={submit} disabled={!title.trim() || saving}>
                Criar projeto
              </Button>
            </div>
          </div>
      </div>
    </Modal>
  );
}
