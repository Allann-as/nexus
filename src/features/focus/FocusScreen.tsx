/**
 * A tela de Foco (M5) — o ritmo da atenção.
 *
 * Um lugar para começar um bloco e ver o que o foco acumulou: minutos na semana,
 * constância e as melhores horas de foco (o insight, com a fórmula à mostra). Os
 * blocos recentes podem ser apagados — corrige o ESTADO, o ledger fica (ADR-0052).
 *
 * O timer em si é global (`FocusHost` no Shell): daqui só o disparamos.
 *
 * A lista de recentes mostra a HORA de cada bloco, não só o dia. O `ts` sempre
 * veio no `FocusSession` e a tela o descartava — numa tela cuja tese é "quando
 * você foca", a hora de cada bloco é o dado que liga a lista ao gráfico.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, Timer } from "lucide-react";

import { ArmedDelete } from "../../design-system/ArmedDelete";
import { Button, EmptyState, PageHeader, PAGE_CONTAINER } from "../../design-system/primitives";
import { Terminal } from "../../design-system/instruments";
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

/** "14:30" — a hora local de um instante. O bloco tem hora, e ela importa aqui. */
function timeOf(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function FocusScreen() {
  const start = useFocus((s) => s.start);

  const stats = useQuery({ queryKey: ["focus-stats", null], queryFn: () => focusStats(null) });
  // A MESMA queryKey do `FocusHost` — as duas telas leem a mesma lista, e duas
  // chaves diferentes seriam duas cópias do mesmo dado esperando divergir.
  const recent = useQuery({ queryKey: ["recent-focus"], queryFn: () => recentFocusSessions(null) });

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

      <div className={`${PAGE_CONTAINER} min-h-0 flex-1 space-y-6 pb-16`}>
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
    }
  };

  return (
    <Terminal
      title="Blocos recentes"
      icon={Timer}
      tone="phos"
      right={
        <span className="text-[11px] text-[var(--text-tertiary)]">
          os <span className="tabular">{blocks.length}</span> últimos
        </span>
      }
      bodyClassName="p-0"
    >
      <ul>
        {blocks.map((b, i) => (
          <li
            key={b.id}
            className="group flex items-center gap-3 px-4 py-2.5"
            style={{ borderTop: i === 0 ? undefined : "1px solid var(--border-subtle)" }}
          >
            <Timer size={14} className="shrink-0 text-[var(--accent)]" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">
              {b.taskTitle ?? b.label ?? "Foco livre"}
            </span>
            <span className="tabular shrink-0 text-[12px] font-medium text-[var(--text-secondary)]">
              {formatMinutes(b.minutes)}
            </span>
            <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">
              {shortDay(b.day)} · {timeOf(b.ts)}
            </span>
            {/* O gesto armado é o do design system (v1.2, fase B) — esta tela
                tinha a sua própria cópia, sem desarme por tempo, por Esc nem por
                clique fora. Cinco cópias divergem; esta era a sexta. */}
            <ArmedDelete
              onConfirm={() => void remove(b.id)}
              question="Remover este bloco?"
              confirmLabel="Remover"
              ariaLabel="Remover bloco"
              className="shrink-0 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 focus-within:opacity-100"
            />
          </li>
        ))}
      </ul>
    </Terminal>
  );
}
