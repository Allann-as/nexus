/**
 * A paleta de comandos — o centro do app.
 *
 * Duas fontes numa lista só: ações (fuzzy match local, instantâneo) e busca
 * FTS5 no banco (debounced). Ações primeiro: quem digita 'cal' quer ir para o
 * Calendário, não achar uma nota que menciona "calendário".
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CornerDownLeft,
  FileText,
  CheckSquare,
  FolderKanban,
  Target,
  Repeat,
  Calendar as CalendarIcon,
  Flag,
  Paperclip,
  Inbox as InboxIcon,
  Search as SearchIcon,
  type LucideIcon,
} from "lucide-react";

import { NAV_ITEMS, SECONDARY_ROUTES } from "../../app/navigation";
import { listAreas, search, type Kind } from "../../lib/ipc";
import { sphereIcon } from "../hub/SphereIcon";
import { fuzzyScore } from "./fuzzy";
import { cx, Kbd } from "../../design-system/primitives";

/** Espera o suficiente para não consultar a cada tecla, curto o bastante para
 *  a busca ainda parecer instantânea. */
const DEBOUNCE_MS = 120;

interface Row {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
}

const KIND_ICON: Record<Kind, LucideIcon> = {
  note: FileText,
  task: CheckSquare,
  project: FolderKanban,
  goal: Target,
  habit: Repeat,
  routine: Repeat,
  event: CalendarIcon,
  file: Paperclip,
  inbox_item: InboxIcon,
  milestone: Flag,
};

const KIND_LABEL: Record<Kind, string> = {
  note: "Nota",
  task: "Tarefa",
  project: "Projeto",
  goal: "Meta",
  habit: "Hábito",
  routine: "Rotina",
  event: "Evento",
  file: "Arquivo",
  inbox_item: "Inbox",
  milestone: "Sub-desafio",
};

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  const { data: hits = [] } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => search(debounced, 8),
    // Só consulta com algo digitado; o backend também devolve [] para vazio,
    // mas não vale a viagem de IPC.
    enabled: open && debounced.trim().length > 0,
    staleTime: 5_000,
  });

  // As Esferas saíram da sidebar e agora moram no Hub. Isso deixaria o teclado
  // sem caminho até elas: `G+<tecla>` só alcança rota fixa, e as Esferas vêm do
  // banco (o usuário cria as dele). A paleta é o caminho — e "teclado-primeiro"
  // é regra da constituição, não preferência.
  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    queryFn: () => listAreas(false),
    enabled: open,
  });

  const actions = useMemo<Row[]>(
    () => [
      ...NAV_ITEMS.map((item) => ({
        id: `nav:${item.path}`,
        label: `Ir para ${item.label}`,
        hint: `G ${item.jumpKey.toUpperCase()}`,
        icon: item.icon,
        run: () => navigate(item.path),
      })),
      ...SECONDARY_ROUTES.map((item) => ({
        id: `nav:${item.path}`,
        label: `Ir para ${item.label}`,
        hint: `G ${item.jumpKey.toUpperCase()}`,
        icon: item.icon,
        run: () => navigate(item.path),
      })),
      ...areas.map((area) => ({
        id: `sphere:${area.id}`,
        label: `Ir para ${area.name}`,
        hint: "Esfera",
        icon: sphereIcon(area.icon),
        run: () => navigate(`/sphere/${area.id}`),
      })),
    ],
    [areas, navigate],
  );

  const matchedActions = useMemo(() => {
    return actions
      .map((a) => ({ a, score: fuzzyScore(query, a.label) }))
      .filter((r): r is { a: Row; score: number } => r.score !== null)
      .sort((x, y) => x.score - y.score)
      .slice(0, 6)
      .map((r) => r.a);
  }, [actions, query]);

  const resultRows = useMemo<Row[]>(
    () =>
      hits.map((h) => ({
        id: `node:${h.nodeId}`,
        label: h.title,
        hint: KIND_LABEL[h.kind] ?? h.kind,
        icon: KIND_ICON[h.kind] ?? FileText,
        // M1 não tem tela de detalhe do node ainda. Navegar para um lugar que
        // não existe seria pior que não navegar, então por ora a paleta leva ao
        // módulo do tipo. A tela de detalhe chega com o M2/M4.
        run: () => navigate(pathForKind(h.kind)),
      })),
    [hits, navigate],
  );

  const rows = useMemo(
    () => [...matchedActions, ...resultRows],
    [matchedActions, resultRows],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setDebounced("");
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

  const commit = (row: Row | undefined) => {
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

  const actionCount = matchedActions.length;

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
                {i === actionCount && actionCount > 0 && resultRows.length > 0 && (
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

function pathForKind(kind: Kind): string {
  switch (kind) {
    case "inbox_item":
      return "/inbox";
    case "task":
    case "project":
    case "goal":
      return "/goals";
    case "habit":
    case "routine":
      return "/habits";
    case "event":
      return "/calendar";
    default:
      return "/notes";
  }
}
