/**
 * PRÓXIMOS MARCOS — a segunda peça da coluna direita (v1.3, §2.1).
 *
 * Substitui a `HorizonBand`, que era uma RÉGUA horizontal com os marcos
 * posicionados no tempo. A régua foi reprovada: numa faixa de 1100px, dois
 * eventos a 3 e 5 dias ficavam colados e ilegíveis, e o eixo ocupava mais pixel
 * do que os próprios marcos. A lista vertical com o D-dias em mono diz a mesma
 * coisa em menos espaço e sem ambiguidade.
 *
 * A fonte é a MESMA (`horizon`): eventos do calendário + temporadas, com D-dias e
 * as pendências ligadas por `links` (ADR-0063). Some inteira quando não há marco
 * nenhum — um painel vazio dizendo "nada por aqui" seria o espaço morto que o
 * Cockpit existe para eliminar.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Flag } from "lucide-react";

import { horizon, type HorizonItem } from "../../lib/ipc";
import { Terminal } from "../../design-system/instruments";
import { cx } from "../../design-system/primitives";
import { useSphereColorResolver } from "../../design-system/useSphereColor";

const VISIBLE = 6;

export function NextMilestones() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["horizon"], queryFn: () => horizon() });
  const colorOf = useSphereColorResolver();

  const items = q.data ?? [];
  if (items.length === 0) return null;

  return (
    <Terminal title="Próximos marcos" icon={Flag} bodyClassName="p-0">
      <ul className="divide-y divide-[var(--border-subtle)]">
        {items.slice(0, VISIBLE).map((it) => (
          <li key={`${it.kind}-${it.id}`}>
            <button
              onClick={() => navigate(it.kind === "event" ? "/calendar" : "/objectives")}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--bg-raised)]"
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ background: colorOf(it.areaId) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-[var(--text-primary)]">
                  {it.title}
                </span>
                {it.openTasks > 0 && (
                  <span className="tabular block text-[10px] text-[var(--text-tertiary)]">
                    {it.openTasks} {it.openTasks === 1 ? "pendência" : "pendências"}
                  </span>
                )}
              </span>
              <DDay days={it.daysUntil} />
            </button>
          </li>
        ))}
      </ul>
    </Terminal>
  );
}

/**
 * O D-dias em mono.
 *
 * Hoje e amanhã ganham PALAVRA, não número: "D-0" obriga a traduzir, e a coluna
 * existe para responder sem tradução. De 2 dias em diante o número é mais denso
 * que a data e ordena sozinho.
 */
function DDay({ days }: { days: number }) {
  const urgent = days <= 1;
  const soon = days <= 3;
  const label = days <= 0 ? "hoje" : days === 1 ? "amanhã" : `D-${days}`;
  return (
    <span
      className={cx(
        "tabular shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold",
        urgent
          ? "text-[var(--danger)]"
          : soon
            ? "text-[var(--warning)]"
            : "text-[var(--text-tertiary)]",
      )}
      style={
        urgent
          ? { background: "color-mix(in srgb, var(--danger) 12%, transparent)" }
          : soon
            ? { background: "color-mix(in srgb, var(--warning) 12%, transparent)" }
            : undefined
      }
    >
      {label}
    </span>
  );
}

export type { HorizonItem };
