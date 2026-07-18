/**
 * A tela de Foco (M5) — o ritmo da atenção.
 *
 * Um lugar para começar um bloco e ver o que o foco acumulou: minutos na semana,
 * constância e as melhores horas de foco (o insight, com a fórmula à mostra). Os
 * blocos recentes podem ser apagados — corrige o ESTADO, o ledger fica (ADR-0052).
 *
 * O timer em si é global (`FocusHost` no Shell): daqui só o disparamos.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Timer, Trash2 } from "lucide-react";

import { Button, EmptyState, PageHeader } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import { useFocus } from "../../stores/focus";
import {
  deleteFocusSession,
  focusStats,
  recentFocusSessions,
  type FocusSession,
} from "../../lib/ipc";
import { formatMinutes, shortDay } from "../studies/studyFormat";
import { FocusStatsPanel } from "./FocusStatsPanel";

export function FocusScreen() {
  const start = useFocus((s) => s.start);

  const stats = useQuery({ queryKey: ["focus-stats", null], queryFn: () => focusStats(null) });
  const recent = useQuery({ queryKey: ["recent-focus", null], queryFn: () => recentFocusSessions(null) });

  const st = stats.data;
  const hasBlocks = (st?.totalSessions ?? 0) > 0;
  const blocks = recent.data ?? [];

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Foco"
        subtitle="Blocos de foco concluídos — e as suas melhores horas"
        actions={
          <Button variant="primary" size="sm" icon={Play} onClick={() => start()}>
            Iniciar foco
          </Button>
        }
      />

      <div className="min-h-0 flex-1 space-y-6 px-8 pb-16">
        {hasBlocks && st ? (
          <>
            <FocusStatsPanel stats={st} />
            {blocks.length > 0 && <RecentBlocks blocks={blocks} />}
          </>
        ) : (
          !stats.isLoading && (
            <EmptyState
              icon={Timer}
              title="Nenhum bloco de foco ainda"
              hint="Comece um pomodoro a partir de qualquer tarefa (ou daqui mesmo). Quando o bloco zerar, ele entra na sua história e rende XP — só o concluído conta."
              action={
                <Button variant="primary" icon={Play} onClick={() => start()}>
                  Iniciar foco
                </Button>
              }
            />
          )
        )}
      </div>
    </div>
  );
}

function RecentBlocks({ blocks }: { blocks: FocusSession[] }) {
  const client = useQueryClient();
  const push = useToasts((s) => s.push);
  const pushError = useToasts((s) => s.pushError);
  const [armed, setArmed] = useState<string | null>(null);

  const remove = async (id: string) => {
    try {
      await deleteFocusSession(id);
      push("success", "Bloco removido");
      void client.invalidateQueries({ queryKey: ["recent-focus"] });
      void client.invalidateQueries({ queryKey: ["focus-stats"] });
      void client.invalidateQueries({ queryKey: ["gamification"] });
      void client.invalidateQueries({ queryKey: ["spheres"] });
    } catch (e) {
      pushError(e);
    } finally {
      setArmed(null);
    }
  };

  return (
    <section>
      <h3 className="mb-3 text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
        Blocos recentes
      </h3>
      <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {blocks.map((b, i) => (
          <div
            key={b.id}
            className="group flex items-center gap-3 px-4 py-2.5"
            style={{ borderTop: i === 0 ? undefined : "1px solid var(--border-subtle)" }}
          >
            <Timer size={14} className="shrink-0 text-[var(--text-tertiary)]" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">
              {b.taskTitle ?? b.label ?? "Foco livre"}
            </span>
            <span className="tabular shrink-0 text-[12px] font-medium text-[var(--text-secondary)]">
              {formatMinutes(b.minutes)}
            </span>
            <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
              {shortDay(b.day)}
            </span>
            {armed === b.id ? (
              <button
                onClick={() => remove(b.id)}
                className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]"
              >
                Confirmar
              </button>
            ) : (
              <button
                onClick={() => setArmed(b.id)}
                className="shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 hover:text-[var(--danger)]"
                aria-label="Remover bloco"
                title="Remover (corrige o estado; a história fica)"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
