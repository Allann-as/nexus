/**
 * O tracker plugável de dias (ARSENAL, ADR-0058).
 *
 * Um heatmap de hábito ANEXÁVEL a qualquer node por um vínculo `contributes_to`
 * (hábito → contexto). Onde ele entra, o usuário liga um hábito e passa a ver os
 * dias cumpridos alinhados ao ano — e, na Meta anual, essa contagem alimenta o
 * progresso sozinha (a coluna manual deixa de mandar). O mesmo componente pluga na
 * Matéria (só exibição). A Esfera é uma `area`, não um node, então fica de fora
 * (v1.1) — `links` não a alcança.
 *
 * O vínculo é o `contributes_to` que já existia (ADR-0046): nenhum tipo novo,
 * nenhuma migração. Ler os hábitos ligados = os `incoming` de `node_links` cujo
 * `kind` é 'habit'.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CalendarDays, ChevronDown, Plus, X } from "lucide-react";

import {
  habitYearHeatmap,
  linkNodes,
  listHabits,
  nodeLinks,
  unlinkNodes,
  type LinkEnd,
} from "../../lib/ipc";
import { cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { Heatmap } from "./Heatmap";

export function HabitTracker({
  nodeId,
  year,
  color,
}: {
  /** O contexto que recebe o tracker (a meta, a matéria). */
  nodeId: string;
  /** O ano-calendário do heatmap. */
  year: number;
  /** A cor da Esfera para tingir as células (o Heatmap lê `--sphere`). */
  color?: string | null;
}) {
  const qc = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const [picking, setPicking] = useState(false);

  const links = useQuery({
    queryKey: ["node-links", nodeId],
    queryFn: () => nodeLinks(nodeId),
  });
  const tracked = (links.data?.incoming ?? []).filter(
    (l) => l.linkType === "contributes_to" && l.kind === "habit",
  );

  const habits = useQuery({
    queryKey: ["habits", "all"],
    queryFn: () => listHabits(),
    enabled: picking,
  });

  const invalidate = () => {
    // O node-links redesenha a lista; a contagem da meta é DERIVADA, então a
    // visão do ano tem que recomputar. Invalidar por prefixo pega qualquer ano.
    void qc.invalidateQueries({ queryKey: ["node-links", nodeId] });
    void qc.invalidateQueries({ queryKey: ["annual-goal-year"] });
    void qc.invalidateQueries({ queryKey: ["annual-goal-years"] });
    void qc.invalidateQueries({ queryKey: ["subject-progress"] });
  };

  const attach = useMutation({
    // `contributes_to`, source = o hábito, target = o contexto (ADR-0058).
    mutationFn: (habitId: string) => linkNodes(habitId, nodeId, "contributes_to"),
    onSuccess: () => {
      setPicking(false);
      invalidate();
    },
    onError: pushError,
  });
  const detach = useMutation({
    mutationFn: (habitId: string) => unlinkNodes(habitId, nodeId, "contributes_to"),
    onSuccess: invalidate,
    onError: pushError,
  });

  const linkedIds = new Set(tracked.map((l) => l.nodeId));
  const options = (habits.data ?? []).filter((h) => !linkedIds.has(h.id));

  return (
    <div
      className="mt-3 border-t border-[var(--border-subtle)] pt-3"
      style={{ "--sphere": color ?? "var(--accent)" } as React.CSSProperties}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
          <CalendarDays size={12} className="text-[var(--sphere)]" />
          Rastreador de dias
        </span>
        {!picking && (
          <button
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--sphere)]"
          >
            <Plus size={12} />
            {tracked.length === 0 ? "Ligar um hábito" : "Ligar outro"}
          </button>
        )}
      </div>

      {picking && (
        <div className="mb-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-1.5">
          {options.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-[var(--text-tertiary)]">
              {habits.isLoading ? "Carregando hábitos…" : "Nenhum hábito para ligar."}
            </p>
          ) : (
            <ul className="max-h-44 overflow-y-auto">
              {options.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => attach.mutate(h.id)}
                    disabled={attach.isPending}
                    className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--sphere)_12%,transparent)] hover:text-[var(--text-primary)]"
                  >
                    <Activity size={13} className="shrink-0 text-[var(--sphere)]" />
                    <span className="truncate">{h.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => setPicking(false)}
            className="mt-1 w-full rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
          >
            Cancelar
          </button>
        </div>
      )}

      {tracked.length === 0 && !picking && (
        <p className="text-[11px] leading-[16px] text-[var(--text-tertiary)]">
          Ligue um hábito e os dias cumpridos aparecem aqui — na Meta, a contagem passa
          a vir dos ticks sozinha.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {tracked.map((l) => (
          <TrackerRow
            key={l.nodeId}
            link={l}
            year={year}
            onDetach={() => detach.mutate(l.nodeId)}
            detaching={detach.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function TrackerRow({
  link,
  year,
  onDetach,
  detaching,
}: {
  link: LinkEnd;
  year: number;
  onDetach: () => void;
  detaching: boolean;
}) {
  const [open, setOpen] = useState(false);
  const cells = useQuery({
    queryKey: ["habit-year-heatmap", link.nodeId, year],
    queryFn: () => habitYearHeatmap(link.nodeId, year),
    enabled: open,
  });

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
        >
          <ChevronDown
            size={13}
            className={cx(
              "shrink-0 text-[var(--text-tertiary)] transition-transform",
              open && "rotate-180",
            )}
          />
          <Activity size={13} className="shrink-0 text-[var(--sphere)]" />
          <span className="truncate">{link.title}</span>
        </button>
        <button
          onClick={onDetach}
          disabled={detaching}
          aria-label={`Desligar ${link.title}`}
          className="shrink-0 rounded-[var(--radius-sm)] p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] hover:text-[var(--danger)]"
        >
          <X size={13} />
        </button>
      </div>
      {open && (
        <div className="overflow-x-auto border-t border-[var(--border-subtle)] px-2.5 py-2">
          {cells.data && cells.data.length > 0 ? (
            <Heatmap cells={cells.data} />
          ) : (
            <p className="py-2 text-[11px] text-[var(--text-tertiary)]">
              {cells.isLoading ? "Carregando…" : `Sem dias registrados em ${year}.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
