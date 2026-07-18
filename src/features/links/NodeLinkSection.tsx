/**
 * Os vínculos de um node, dos DOIS lados (M4.6, item 6c, ADR-0046).
 *
 * Uma meta de carreira "conta para" (`contributes_to`) uma Meta Anual ou um item
 * de Estudos. O link é direcional (source → target), e o backlink aparece dos dois
 * lados: na meta de carreira, "conta para {X}"; na meta anual, "meta de carreira:
 * {Y}". O rótulo sai da DIREÇÃO + do kind da outra ponta.
 *
 * `canAdd` liga o seletor (busca FTS filtrada para os alvos linkáveis). Sem ele —
 * na meta anual — a seção só mostra os backlinks, em leitura.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CalendarRange,
  GraduationCap,
  Link2,
  Plus,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  linkNodes,
  nodeLinks,
  search,
  unlinkNodes,
  type Kind,
  type LinkEnd,
} from "../../lib/ipc";
import { cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";

/** Os kinds que fazem sentido como ALVO de um vínculo do usuário. */
const LINKABLE_TARGETS: Kind[] = ["annual_goal", "book", "subject"];

const KIND_ICON: Partial<Record<Kind, LucideIcon>> = {
  annual_goal: CalendarRange,
  book: BookOpen,
  subject: GraduationCap,
  goal: Target,
};

/** O rótulo direcional: o que este vínculo significa visto deste node. */
function relation(end: LinkEnd, direction: "out" | "in"): string {
  if (end.linkType === "contributes_to") {
    if (direction === "out") {
      return end.kind === "annual_goal" ? "conta para" : "vinculada a";
    }
    return end.kind === "goal" ? "meta de carreira" : "contribui";
  }
  return "relacionado";
}

export function NodeLinkSection({ nodeId, canAdd = false }: { nodeId: string; canAdd?: boolean }) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [picking, setPicking] = useState(false);

  const linksQ = useQuery({
    queryKey: ["node-links", nodeId],
    queryFn: () => nodeLinks(nodeId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["node-links"] });
  };

  const unlink = useMutation({
    mutationFn: (target: string) => unlinkNodes(nodeId, target, "contributes_to"),
    onSuccess: invalidate,
    onError: pushError,
  });

  const links = linksQ.data;
  const outgoing = links?.outgoing ?? [];
  const incoming = links?.incoming ?? [];
  const nothing = outgoing.length === 0 && incoming.length === 0;

  // Sem nada e sem poder adicionar: a seção não ocupa espaço (o padrão "sem dado,
  // nada na tela").
  if (nothing && !canAdd) return null;

  return (
    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {outgoing.map((e) => (
          <Chip
            key={`o-${e.nodeId}-${e.linkType}`}
            end={e}
            prefix={relation(e, "out")}
            onRemove={canAdd ? () => unlink.mutate(e.nodeId) : undefined}
          />
        ))}
        {incoming.map((e) => (
          <Chip key={`i-${e.nodeId}-${e.linkType}`} end={e} prefix={relation(e, "in")} muted />
        ))}

        {canAdd && (
          <button
            onClick={() => setPicking((p) => !p)}
            className={cx(
              "flex h-6 items-center gap-1 rounded-full border border-dashed px-2 text-[11px]",
              "border-[color-mix(in_srgb,var(--sphere)_40%,transparent)] text-[var(--sphere)]",
              "transition-colors hover:bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)]",
            )}
          >
            <Plus size={11} strokeWidth={2.4} />
            vincular
          </button>
        )}
      </div>

      {picking && (
        <LinkPicker
          sourceId={nodeId}
          onClose={() => setPicking(false)}
          onLinked={() => {
            setPicking(false);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function Chip({
  end,
  prefix,
  muted,
  onRemove,
}: {
  end: LinkEnd;
  prefix: string;
  muted?: boolean;
  onRemove?: () => void;
}) {
  const Icon = KIND_ICON[end.kind] ?? Link2;
  return (
    <span
      className={cx(
        "flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px]",
        muted
          ? "border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-secondary)]"
          : "border-[color-mix(in_srgb,var(--sphere)_30%,transparent)] bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)] text-[var(--text-primary)]",
      )}
    >
      <Icon size={11} className={muted ? "text-[var(--text-tertiary)]" : "text-[var(--sphere)]"} />
      <span className="text-[var(--text-tertiary)]">{prefix}</span>
      <span className="max-w-[160px] truncate">{end.title}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label="Remover vínculo"
          className="text-[var(--text-tertiary)] hover:text-[var(--danger)]"
        >
          <X size={11} />
        </button>
      )}
    </span>
  );
}

/** O seletor de alvo: busca FTS filtrada para Metas Anuais, livros e matérias. */
function LinkPicker({
  sourceId,
  onClose,
  onLinked,
}: {
  sourceId: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const pushError = useToasts((s) => s.pushError);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");

  useEffect(() => {
    const t = window.setTimeout(() => setDq(q), 140);
    return () => window.clearTimeout(t);
  }, [q]);

  const hits = useQuery({
    queryKey: ["link-search", dq],
    queryFn: () => search(dq, 12),
    enabled: dq.trim().length > 0,
  });

  const candidates = (hits.data ?? []).filter(
    (h) => LINKABLE_TARGETS.includes(h.kind as Kind) && h.nodeId !== sourceId,
  );

  const link = useMutation({
    mutationFn: (target: string) => linkNodes(sourceId, target, "contributes_to"),
    onSuccess: onLinked,
    onError: pushError,
  });

  return (
    <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        placeholder="Buscar meta anual, livro ou matéria…"
        className="h-8 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--sphere)] placeholder:text-[var(--text-tertiary)]"
      />
      <div className="mt-1.5 max-h-[180px] overflow-y-auto">
        {dq.trim().length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-[var(--text-tertiary)]">
            Digite para achar o que esta meta ajuda a alcançar.
          </p>
        ) : candidates.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-[var(--text-tertiary)]">
            Nenhuma meta anual, livro ou matéria para “{dq}”.
          </p>
        ) : (
          candidates.map((h) => {
            const Icon = KIND_ICON[h.kind as Kind] ?? Link2;
            return (
              <button
                key={h.nodeId}
                onClick={() => link.mutate(h.nodeId)}
                disabled={link.isPending}
                className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left text-[12px] text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
              >
                <Icon size={13} className="shrink-0 text-[var(--sphere)]" />
                <span className="flex-1 truncate">{h.title}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
