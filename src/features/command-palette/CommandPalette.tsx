/**
 * The command palette — the centre of the app.
 *
 * M0 scope: fuzzy-matched navigation actions, fully keyboard-driven. M1 adds
 * FTS5 search over nodes to the same list. The interaction model is settled
 * now so later work only widens the result source, never the shell.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, type LucideIcon } from "lucide-react";

import { NAV_ITEMS } from "../../app/navigation";
import { cx, Kbd } from "../../design-system/primitives";

interface Action {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
}

/**
 * Subsequence fuzzy match: "cal" matches "Calendário", "mp" matches
 * "Metas & Projetos". Returns a score where lower is better — consecutive
 * matches and early matches rank highest.
 */
function fuzzyScore(needle: string, haystack: string): number | null {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();

  let score = 0;
  let hi = 0;
  let lastHit = -1;

  for (const ch of n) {
    const hit = h.indexOf(ch, hi);
    if (hit === -1) return null;
    // Penalise gaps, so tighter runs sort first.
    score += hit - lastHit - 1;
    lastHit = hit;
    hi = hit + 1;
  }
  return score;
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const actions = useMemo<Action[]>(
    () =>
      NAV_ITEMS.map((item) => ({
        id: `nav:${item.path}`,
        label: `Ir para ${item.label}`,
        hint: `G ${item.jumpKey.toUpperCase()}`,
        icon: item.icon,
        run: () => navigate(item.path),
      })),
    [navigate],
  );

  const results = useMemo(() => {
    return actions
      .map((a) => ({ a, score: fuzzyScore(query, a.label) }))
      .filter((r): r is { a: Action; score: number } => r.score !== null)
      .sort((x, y) => x.score - y.score)
      .map((r) => r.a);
  }, [actions, query]);

  // Reset per open, so the palette never reopens mid-scroll on a stale query.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // Clamp rather than reset: as results narrow, keep the selection in range.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const commit = (action: Action | undefined) => {
    if (!action) return;
    action.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => (s + 1) % Math.max(1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => (s - 1 + results.length) % Math.max(1, results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(results[selected]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-[560px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--bg-raised)]"
        style={{ boxShadow: "var(--shadow-float)" }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar ou executar…"
          aria-label="Buscar ou executar"
          className="w-full border-b border-[var(--border-subtle)] bg-transparent px-4 py-3.5 text-[14px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />

        <div ref={listRef} className="max-h-[320px] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
              Nada encontrado para “{query}”.
            </p>
          ) : (
            results.map((a, i) => (
              <button
                key={a.id}
                data-index={i}
                onMouseMove={() => setSelected(i)}
                onClick={() => commit(a)}
                className={cx(
                  "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 text-left",
                  i === selected ? "bg-[var(--bg-hover)]" : "bg-transparent",
                )}
                style={{ height: "var(--row-list)" }}
              >
                <a.icon
                  size={15}
                  strokeWidth={1.9}
                  className={
                    i === selected
                      ? "text-[var(--accent)]"
                      : "text-[var(--text-tertiary)]"
                  }
                />
                <span className="flex-1 truncate text-[13px] text-[var(--text-primary)]">
                  {a.label}
                </span>
                <span className="font-mono text-[10px] text-[var(--text-tertiary)]">
                  {a.hint}
                </span>
              </button>
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
