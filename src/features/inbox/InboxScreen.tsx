/**
 * Inbox — captura e triagem.
 *
 * A triagem é teclado-primeiro por desenho: T vira tarefa, H nota, P projeto,
 * Backspace descarta, ↑/↓ navegam. Triar 30 itens com o mouse é trabalho; com
 * o teclado é um ritual de dois minutos.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, Clock } from "lucide-react";

import {
  listNodes,
  triageInboxItem,
  deleteNode,
  listAreas,
  type Kind,
  type Node,
} from "../../lib/ipc";
import {
  EmptyState,
  PageHeader,
  Kbd,
  cx,
} from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";

/** Depois disto um item parado vira dívida, e o Inbox deixa isso visível. */
const AGEING_DAYS = 7;
const DAY_MS = 86_400_000;

export function InboxScreen() {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: items = [], isPending } = useQuery({
    queryKey: ["nodes", { kind: "inbox_item", status: "active" }],
    queryFn: () =>
      listNodes({ kind: "inbox_item", status: "active", limit: 200 }),
  });

  const { data: areas = [] } = useQuery({
    queryKey: ["areas"],
    queryFn: () => listAreas(false),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["nodes"] });
    qc.invalidateQueries({ queryKey: ["system-info"] });
  };

  const triage = useMutation({
    mutationFn: ({ id, into }: { id: string; into: Kind }) =>
      // Área fica nula aqui de propósito: T/H/P decidem o TIPO num toque. Pedir
      // a área no mesmo gesto reintroduz a fricção que a captura removeu; ela
      // se define na tela do item ou arrastando para a Área.
      triageInboxItem(id, into, null),
    onSuccess: (node) => {
      invalidate();
      push("success", `${node.title} → ${KIND_LABEL[node.kind]}`);
    },
    onError: pushError,
  });

  const discard = useMutation({
    mutationFn: deleteNode,
    onSuccess: () => {
      invalidate();
      // Sem "desfazer" no M1 — e por isso o toast não promete um. O item some,
      // mas o ledger guarda 'created' e 'deleted': a história sobrevive.
      push("success", "Item descartado");
    },
    onError: pushError,
  });

  // Clampa a seleção conforme a lista encolhe ao triar.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const busy = triage.isPending || discard.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      const current = items[selected];
      if (!current) return;

      const key = e.key.toLowerCase();
      const into = TRIAGE_KEYS[key];

      if (into) {
        e.preventDefault();
        if (!busy) triage.mutate({ id: current.id, into });
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (!busy) discard.mutate(current.id);
      } else if (e.key === "ArrowDown" || key === "j") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === "ArrowUp" || key === "k") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selected, busy, triage, discard]);

  const ageing = items.filter((i) => isAgeing(i)).length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Inbox"
        subtitle={
          isPending
            ? "Carregando…"
            : items.length === 0
              ? "Inbox zerada"
              : `${items.length} ${items.length === 1 ? "item" : "itens"} para triar`
        }
        actions={
          ageing > 0 ? (
            <span className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--warning)] px-2.5 py-1 text-[11px] text-[var(--warning)]">
              <Clock size={12} />
              {ageing} há mais de {AGEING_DAYS} dias
            </span>
          ) : undefined
        }
      />

      {items.length === 0 && !isPending ? (
        <div className="min-h-0 flex-1 pb-16">
          <EmptyState
            icon={InboxIcon}
            title="Inbox zerada"
            hint="Nada esperando decisão. Ctrl+Shift+N captura qualquer coisa, de qualquer tela."
          />
        </div>
      ) : (
        <>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-8">
            {items.map((item, i) => (
              <Row
                key={item.id}
                item={item}
                index={i}
                selected={i === selected}
                areaCount={areas.length}
                onHover={() => setSelected(i)}
                onTriage={(into) => !busy && triage.mutate({ id: item.id, into })}
                onDiscard={() => !busy && discard.mutate(item.id)}
              />
            ))}
          </div>
          <Legend />
        </>
      )}
    </div>
  );
}

const TRIAGE_KEYS: Record<string, Kind | undefined> = {
  t: "task",
  h: "note",
  p: "project",
};

const KIND_LABEL: Record<Kind, string> = {
  task: "Tarefa",
  note: "Nota",
  project: "Projeto",
  goal: "Meta",
  habit: "Hábito",
  routine: "Rotina",
  event: "Evento",
  file: "Arquivo",
  inbox_item: "Inbox",
};

function isAgeing(item: Node): boolean {
  return Date.now() - item.createdAt > AGEING_DAYS * DAY_MS;
}

function relativeAge(ms: number): string {
  const days = Math.floor((Date.now() - ms) / DAY_MS);
  if (days === 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? "há 1 mês" : `há ${months} meses`;
}

function Row({
  item,
  index,
  selected,
  areaCount,
  onHover,
  onTriage,
  onDiscard,
}: {
  item: Node;
  index: number;
  selected: boolean;
  areaCount: number;
  onHover: () => void;
  onTriage: (into: Kind) => void;
  onDiscard: () => void;
}) {
  const ageing = isAgeing(item);

  return (
    <div
      data-index={index}
      onMouseMove={onHover}
      className={cx(
        "group flex items-center gap-3 rounded-[var(--radius-md)] border-l-2 px-3",
        "transition-colors duration-[var(--dur-fast)]",
        selected
          ? "border-l-[var(--accent)] bg-[var(--bg-hover)]"
          : "border-l-transparent hover:bg-[var(--bg-surface)]",
      )}
      style={{ minHeight: "var(--row-list)" }}
    >
      <span className="flex-1 truncate text-[13px] text-[var(--text-primary)]">
        {item.title}
      </span>

      <span
        className={cx(
          "shrink-0 text-[11px]",
          ageing ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]",
        )}
      >
        {relativeAge(item.createdAt)}
      </span>

      <div
        className={cx(
          "flex shrink-0 items-center gap-1 transition-opacity",
          selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      >
        <TriageButton label="Tarefa" hint="T" onClick={() => onTriage("task")} />
        <TriageButton label="Nota" hint="H" onClick={() => onTriage("note")} />
        <TriageButton label="Projeto" hint="P" onClick={() => onTriage("project")} />
        <button
          onClick={onDiscard}
          title="Descartar (Backspace)"
          className="rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--danger)]"
        >
          Descartar
        </button>
      </div>

      {areaCount === 0 && selected && (
        <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
          crie Áreas para organizar
        </span>
      )}
    </div>
  );
}

function TriageButton({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`${label} (${hint})`}
      className="flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
    >
      {label}
      <span className="font-mono text-[9px] text-[var(--text-tertiary)]">{hint}</span>
    </button>
  );
}

function Legend() {
  return (
    <div className="flex shrink-0 items-center gap-4 border-t border-[var(--border-subtle)] px-8 py-2.5 text-[11px] text-[var(--text-tertiary)]">
      <span className="flex items-center gap-1.5">
        <Kbd>T</Kbd> tarefa
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>H</Kbd> nota
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>P</Kbd> projeto
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>⌫</Kbd> descartar
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> navegar
      </span>
    </div>
  );
}
