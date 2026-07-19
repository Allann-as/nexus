/**
 * A visão MÊS: o feed de tudo que aconteceu, agrupado por dia, do dia mais
 * recente para o mais antigo.
 *
 * É a tela primária da Timeline. Uma leitura só do backend (`timelineRange`)
 * traz o mês inteiro; o agrupamento por dia e os filtros são client-side, para
 * "qualquer mês de qualquer ano abre em <100ms" (o backend já devolve
 * newest-first por seq, então a ordem se preserva de graça).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, SearchX } from "lucide-react";

import { EmptyState } from "../../design-system/primitives";
import { CountUp } from "../../design-system/cards";
import { timelineRange, type LedgerEntry } from "../../lib/ipc";
import { dayHeading, monthBounds, monthNameLong, timeOf } from "./dates";
import { describe, detail, meta, searchHaystack } from "./ledgerMeta";

interface DayGroup {
  day: string;
  entries: LedgerEntry[];
}

/** Agrupa por dia preservando a ordem newest-first que o backend já entrega. */
function groupByDay(entries: LedgerEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const index = new Map<string, number>();
  for (const entry of entries) {
    let at = index.get(entry.day);
    if (at == null) {
      at = groups.length;
      index.set(entry.day, at);
      groups.push({ day: entry.day, entries: [] });
    }
    groups[at].entries.push(entry);
  }
  return groups;
}

export function MonthView({
  month,
  search,
  kind,
}: {
  /** 'YYYY-MM'. */
  month: string;
  search: string;
  kind: string | null;
}) {
  const [fromDay, toDay] = monthBounds(month);
  const q = useQuery({
    queryKey: ["timeline", "range", fromDay, toDay],
    queryFn: () => timelineRange(fromDay, toDay),
  });

  const all = q.data ?? [];
  const query = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    return all.filter((e) => {
      if (kind && e.entityKind !== kind) return false;
      if (query && !searchHaystack(e).includes(query)) return false;
      return true;
    });
  }, [all, kind, query]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const monthNumber = Number(month.slice(5, 7));

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        {[0, 1].map((g) => (
          <div key={g} className="flex flex-col gap-2.5">
            <div className="h-3.5 w-40 animate-pulse rounded bg-[var(--bg-surface)]" />
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-12 animate-pulse rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-10">
        <EmptyState
          icon={History}
          title={`Nada aconteceu em ${monthNameLong(monthNumber)}`}
          hint="Nenhum evento foi registrado neste mês. Conforme você usa o NEXUS, sua história enche a Timeline sozinha."
        />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-10">
        <EmptyState
          icon={SearchX}
          title="Nada encontrado"
          hint="Nenhum evento deste mês combina com o filtro. Tente afrouxar a busca ou o tipo."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[12.5px] text-[var(--text-tertiary)]">
        <span className="tabular font-semibold text-[var(--text-secondary)]">
          <CountUp to={filtered.length} />
        </span>{" "}
        {filtered.length === 1 ? "evento" : "eventos"} em {monthNameLong(monthNumber)}
      </p>

      {groups.map((group) => (
        <section key={group.day}>
          {/* A régua de dias mais marcada (C9): um tique do accent abre cada dia,
              e a contagem vira um chip — o olho encontra os cortes de dia de longe. */}
          <header className="mb-2 flex items-center gap-2">
            <span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full bg-[var(--accent)]" />
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)] capitalize">
              {dayHeading(group.day)}
            </h3>
            <span className="tabular rounded-full bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
              {group.entries.length}
            </span>
          </header>

          {/* O trilho vertical: uma linha que costura os eventos do dia. */}
          <ol className="relative ml-[13px] border-l border-[var(--border-subtle)]">
            {group.entries.map((entry) => (
              <EventRow key={entry.seq} entry={entry} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function EventRow({ entry }: { entry: LedgerEntry }) {
  const m = meta(entry);
  const secondary = detail(entry);
  const Icon = m.icon;

  return (
    <li className="relative py-2 pl-6">
      <span
        className="absolute -left-[14px] top-2 grid size-[27px] place-items-center rounded-full border"
        style={{
          background: `color-mix(in srgb, ${m.tint} 13%, var(--bg-base))`,
          borderColor: `color-mix(in srgb, ${m.tint} 34%, transparent)`,
        }}
        aria-hidden
      >
        <Icon size={13} strokeWidth={2} style={{ color: m.tint }} />
      </span>

      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] leading-[19px] text-[var(--text-primary)]">
            {describe(entry)}
          </p>
          {secondary && (
            <p className="mt-0.5 truncate text-[12px] leading-[16px] text-[var(--text-tertiary)]">
              {secondary}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span
            className="rounded-full px-2 py-0.5 text-[10.5px] font-medium"
            style={{
              background: `color-mix(in srgb, ${m.tint} 12%, transparent)`,
              color: m.tint,
            }}
          >
            {m.label}
          </span>
          <span className="tabular text-[11px] text-[var(--text-tertiary)]">
            {timeOf(entry.ts)}
          </span>
        </div>
      </div>
    </li>
  );
}
