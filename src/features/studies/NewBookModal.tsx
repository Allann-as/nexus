/**
 * Adicionar um livro à estante.
 *
 * O título é o essencial; autor, páginas e estante têm padrão. Um livro nasce
 * na fila em segundos — a estante visual quer ser fácil de encher.
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { Modal } from "../../design-system/Modal";
import { Button, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { createBook } from "../../lib/ipc";

export function NewBookModal({
  areaId,
  shelves,
  onClose,
  onSaved,
}: {
  areaId: string;
  /** As estantes existentes, como atalho de pills. */
  shelves: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [pages, setPages] = useState("");
  const [shelf, setShelf] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const valid = title.trim().length > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const total = Number(pages);
      await createBook({
        title: title.trim(),
        areaId,
        author: author.trim() || null,
        totalPages: Number.isFinite(total) && total > 0 ? Math.round(total) : null,
        shelf: shelf.trim() || null,
      });
      push("success", "Livro adicionado");
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
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Novo livro</h2>
            <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Fechar" />
          </header>

          <div className="flex flex-col gap-4">
            <Field label="Título">
              <input
                ref={input}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="O Nome do Vento…"
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
              />
            </Field>

            <Field label="Autor (opcional)">
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="Patrick Rothfuss…"
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[14px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
              />
            </Field>

            <Field label="Total de páginas (opcional)">
              <input
                value={pages}
                onChange={(e) => setPages(e.target.value.replace(/[^\d]/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                inputMode="numeric"
                placeholder="656"
                className="tabular h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[14px] font-semibold text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
              />
            </Field>

            <Field label="Estante (opcional)">
              {shelves.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {shelves.map((s) => (
                    <button
                      key={s}
                      onClick={() => setShelf(shelf === s ? "" : s)}
                      className={cx(
                        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-[var(--dur-fast)]",
                        shelf === s
                          ? "border-[var(--sphere)] bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] text-[var(--text-primary)]"
                          : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <input
                value={shelf}
                onChange={(e) => setShelf(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="Ficção, Técnicos…"
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
              />
            </Field>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button variant="primary" onClick={submit} disabled={!valid || saving}>
                Adicionar livro
              </Button>
            </div>
          </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}
