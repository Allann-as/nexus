/**
 * O Horizonte (ARSENAL) — a faixa do Hub com os próximos marcos.
 *
 * O que está vindo (eventos e temporadas que terminam) com o D-dias e quantas
 * tarefas ainda estão em aberto ligadas àquele marco ("Viagem · 12 dias · 2
 * tarefas abertas"). Só aparece quando há algo no horizonte — como o "Neste dia".
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Flag, ListTodo } from "lucide-react";

import { horizon, type HorizonItem } from "../../lib/ipc";
import { useSphereColor } from "../../design-system/useSphereColor";
import { cx } from "../../design-system/primitives";

export function HorizonBand() {
  const q = useQuery({ queryKey: ["horizon"], queryFn: () => horizon(90) });
  const items = q.data ?? [];
  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-[10px] font-semibold tracking-[0.14em] text-[var(--text-tertiary)] uppercase">
        Horizonte
      </h2>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
        {items.map((it) => (
          <HorizonCard key={`${it.kind}:${it.id}`} item={it} />
        ))}
      </div>
    </section>
  );
}

function HorizonCard({ item }: { item: HorizonItem }) {
  const navigate = useNavigate();
  const color = useSphereColor(item.areaId);
  const Icon = item.kind === "challenge" ? Flag : CalendarClock;

  return (
    <button
      onClick={() => navigate(item.kind === "challenge" ? "/game" : "/calendar")}
      style={{ "--sphere": color } as React.CSSProperties}
      className={cx(
        "group flex w-[220px] shrink-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 text-left",
        "transition-[transform,border-color] duration-[var(--dur-base)] ease-[var(--ease)]",
        "hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--sphere)_45%,transparent)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-md)]"
          style={{ background: "color-mix(in srgb, var(--sphere) 14%, transparent)" }}
        >
          <Icon size={14} style={{ color: "var(--sphere)" }} />
        </span>
        <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
          {item.title}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[22px] leading-none font-semibold tabular-nums text-[var(--text-primary)]">
          {item.daysUntil <= 0 ? "hoje" : item.daysUntil}
        </span>
        {item.daysUntil > 0 && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {item.daysUntil === 1 ? "dia" : "dias"}
          </span>
        )}
      </div>

      {item.openTasks > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
          <ListTodo size={12} />
          {item.openTasks} {item.openTasks === 1 ? "tarefa aberta" : "tarefas abertas"}
        </span>
      )}
    </button>
  );
}
