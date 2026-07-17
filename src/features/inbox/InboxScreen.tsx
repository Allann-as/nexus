/**
 * Inbox — captura e triagem.
 *
 * A triagem é teclado-primeiro por desenho: T vira tarefa, H nota, P projeto,
 * Backspace descarta, ↑/↓ navegam. Triar 30 itens com o mouse é trabalho; com
 * o teclado é um ritual de dois minutos.
 *
 * **O Inbox é a única tela que não se tinge.** Não é esquecimento: ele é o
 * lugar do que ainda NÃO tem Esfera, e o azul neutro comunica exatamente isso.
 * Pintá-lo de alguma cor seria afirmar uma decisão que o usuário ainda não
 * tomou — que é justamente o trabalho que o Inbox existe para adiar.
 *
 * A exceção é o preview: escolher a Esfera de destino (1–9) tinge AQUELE item,
 * ao vivo, antes de confirmar. Aí a cor não afirma nada — ela mostra o que vai
 * acontecer se você apertar T.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, Clock } from "lucide-react";

import {
  listNodes,
  triageInboxItem,
  deleteNode,
  listAreas,
  type Area,
  type Kind,
  type Node,
} from "../../lib/ipc";
import {
  EmptyState,
  PageHeader,
  Kbd,
  cx,
} from "../../design-system/primitives";
import { SphereIcon } from "../hub/SphereIcon";
import { useToasts } from "../../stores/toasts";

/** Depois disto um item parado vira dívida, e o Inbox deixa isso visível. */
const AGEING_DAYS = 7;
const DAY_MS = 86_400_000;

export function InboxScreen() {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);
  const [selected, setSelected] = useState(0);
  // A Esfera de destino do item em foco, quando o usuário escolheu uma.
  // `null` = não escolheu, e é o caminho rápido: T/H/P sozinho continua
  // triando sem Esfera, como sempre fez.
  const [pendingArea, setPendingArea] = useState<string | null>(null);
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
    mutationFn: ({ id, into, areaId }: { id: string; into: Kind; areaId: string | null }) =>
      // A Esfera é OPCIONAL e continua nula por padrão: T/H/P decidem o TIPO
      // num toque, e exigir a Esfera no mesmo gesto reintroduziria a fricção
      // que a captura removeu. Quem quiser decidir as duas coisas de uma vez
      // aperta 1–9 antes; quem não quiser, não paga nada por isso.
      triageInboxItem(id, into, areaId),
    onSuccess: (node) => {
      invalidate();
      const sphere = areas.find((a) => a.id === node.areaId);
      push(
        "success",
        sphere
          ? `${node.title} → ${KIND_LABEL[node.kind]} em ${sphere.name}`
          : `${node.title} → ${KIND_LABEL[node.kind]}`,
      );
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
      const digit = Number(e.key);

      if (into) {
        e.preventDefault();
        if (!busy) triage.mutate({ id: current.id, into, areaId: pendingArea });
      } else if (Number.isInteger(digit) && digit >= 1 && digit <= 9 && areas[digit - 1]) {
        // Escolhe a Esfera de destino. Só pinta — quem triaga continua sendo
        // T/H/P, então dá para trocar de ideia à vontade antes de confirmar.
        e.preventDefault();
        setPendingArea(areas[digit - 1].id);
      } else if (e.key === "0" || e.key === "Escape") {
        e.preventDefault();
        setPendingArea(null);
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
  }, [items, selected, busy, triage, discard, areas, pendingArea]);

  // Mudou o item em foco, a Esfera escolhida some: ela era daquele item. Sem
  // isto, descer a lista carregaria a escolha anterior e o item seguinte seria
  // triado para uma Esfera que ninguém pediu para ele.
  useEffect(() => setPendingArea(null), [selected]);

  const ageing = items.filter((i) => isAgeing(i)).length;

  return (
    <div className="nx-page nx-enter h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-[1100px] flex-col">
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
              <span
                className="tabular flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--warning)]"
                style={{
                  background: "color-mix(in srgb, var(--warning) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--warning) 35%, transparent)",
                }}
              >
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
            <div ref={listRef} className="flex-1 px-8 pb-4">
              {items.map((item, i) => (
                <Row
                  key={item.id}
                  item={item}
                  index={i}
                  selected={i === selected}
                  areaCount={areas.length}
                  // Só o item em foco previsualiza: a escolha é dele.
                  sphere={i === selected ? areas.find((a) => a.id === pendingArea) : undefined}
                  onHover={() => setSelected(i)}
                  onTriage={(into) =>
                    !busy && triage.mutate({ id: item.id, into, areaId: pendingArea })
                  }
                  onDiscard={() => !busy && discard.mutate(item.id)}
                />
              ))}
            </div>
            <Legend />
          </>
        )}
      </div>
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
  sphere,
  onHover,
  onTriage,
  onDiscard,
}: {
  item: Node;
  index: number;
  selected: boolean;
  areaCount: number;
  /** A Esfera escolhida como destino, se o usuário escolheu uma. */
  sphere: Area | undefined;
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
        "group flex items-center gap-3 rounded-[var(--radius-md)] border border-l-2 px-3",
        "transition-[background-color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
        selected
          ? "border-[var(--border-subtle)] border-l-[var(--sphere)] bg-[var(--bg-surface)]"
          : "border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--bg-surface)]",
      )}
      // Escolheu a Esfera? A linha inteira passa a ser dela — a borda esquerda,
      // o chip, o fundo. Só este item, e só até confirmar.
      style={{
        minHeight: "var(--row-list)",
        ...(sphere ? ({ "--sphere": sphere.color } as React.CSSProperties) : {}),
        ...(sphere
          ? { background: "color-mix(in srgb, var(--sphere) 8%, var(--bg-surface))" }
          : {}),
      }}
    >
      <span className="flex-1 truncate text-[13px] text-[var(--text-primary)]">
        {item.title}
      </span>

      {sphere && (
        <span
          className="nx-enter flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            background: "color-mix(in srgb, var(--sphere) 16%, transparent)",
            color: "var(--sphere)",
          }}
        >
          <SphereIcon name={sphere.icon} size={10} />
          {sphere.name}
        </span>
      )}

      <span
        className={cx(
          "tabular shrink-0 text-[11px]",
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
          className="rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors duration-[var(--dur-fast)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] hover:text-[var(--danger)]"
        >
          Descartar
        </button>
      </div>

      {areaCount === 0 && selected && (
        <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
          crie Esferas para organizar
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
      className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-transparent px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-[background-color,border-color,color] duration-[var(--dur-fast)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
    >
      {label}
      <span className="font-mono text-[9px] text-[var(--text-tertiary)]">{hint}</span>
    </button>
  );
}

/**
 * A régua de atalhos. `sticky`: a tela inteira rola agora (o Shell não rola
 * mais), e um rodapé que sobe junto com a lista some justo quando a fila é
 * longa — que é quando as teclas importam.
 */
function Legend() {
  return (
    <div className="sticky bottom-0 mt-auto flex shrink-0 items-center gap-4 border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-8 py-2.5 text-[11px] text-[var(--text-tertiary)]">
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
      {/* Por último e sem destaque, de propósito: escolher a Esfera é o passo
          OPCIONAL. Anunciá-lo junto de T/H/P sugeriria que a triagem agora tem
          dois passos obrigatórios — que é exatamente a fricção que o Inbox
          existe para não ter. */}
      <span className="flex items-center gap-1.5">
        <Kbd>1</Kbd>–<Kbd>9</Kbd> esfera (opcional)
      </span>
    </div>
  );
}
