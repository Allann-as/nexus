/**
 * A paleta de comandos — o centro do app.
 *
 * Duas fontes numa lista só: ações (fuzzy match local, instantâneo) e busca
 * FTS5 no banco (debounced). A montagem das linhas mora em `useCommandRows` —
 * o mesmo motor que o menu "O NEXO" (§3.3) consome, para as duas superfícies
 * nunca divergirem. Aqui fica só o overlay: o campo, a seleção por teclado e o
 * desenho da lista.
 */

import { useEffect, useRef, useState } from "react";
import { CornerDownLeft, Search as SearchIcon } from "lucide-react";

import { useCommandRows, type CommandRow } from "./useCommandRows";
import { cx, Kbd } from "../../design-system/primitives";

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { rows, actionCount, resultCount } = useCommandRows(query, open);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const commit = (row: CommandRow | undefined) => {
    if (!row) return;
    row.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % Math.max(1, rows.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + rows.length) % Math.max(1, rows.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(rows[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[color-mix(in_srgb,var(--bg-void)_55%,transparent)] pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="nx-glass nx-enter w-[560px] overflow-hidden rounded-[var(--radius-lg)]"
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-4">
          <SearchIcon size={14} className="shrink-0 text-[var(--text-tertiary)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ou executar…"
            aria-label="Buscar ou executar"
            className="w-full bg-transparent py-3.5 text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
        </div>

        <div ref={listRef} className="max-h-[340px] overflow-y-auto p-1.5">
          {rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
              {query.trim()
                ? `Nada encontrado para “${query}”.`
                : "Digite para buscar ações e conteúdo."}
            </p>
          ) : (
            rows.map((row, i) => (
              <div key={row.id}>
                {i === actionCount && actionCount > 0 && resultCount > 0 && (
                  <div className="px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-[0.08em] text-[var(--text-tertiary)] uppercase">
                    Resultados
                  </div>
                )}
                <button
                  data-index={i}
                  onMouseMove={() => setSelected(i)}
                  onClick={() => commit(row)}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left",
                    i === selected ? "bg-[var(--bg-hover)]" : "bg-transparent",
                  )}
                  style={{ height: "var(--row-list)" }}
                >
                  <row.icon
                    size={15}
                    strokeWidth={1.9}
                    className={
                      i === selected
                        ? "shrink-0 text-[var(--accent)]"
                        : "shrink-0 text-[var(--text-tertiary)]"
                    }
                  />
                  <span className="flex-1 truncate text-[13px] text-[var(--text-primary)]">
                    {row.label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--text-tertiary)]">
                    {row.hint}
                  </span>
                </button>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--text-tertiary)]">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navegar
          </span>
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft size={9} />
            </Kbd>
            abrir
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
}
