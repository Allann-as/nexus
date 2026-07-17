/**
 * "Neste dia": o card do Hub que mostra o que aconteceu no mesmo dia de anos
 * anteriores.
 *
 * Auto-suficiente — sua própria query, seu próprio vazio. Quando não há história
 * (o caso do usuário novo), ele renderiza `null` e some do Hub sem deixar buraco:
 * um card "nada aconteceu neste dia em anos anteriores" seria ruído, não memória.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { Card } from "../../design-system/primitives";
import { onThisDay, type LedgerEntry } from "../../lib/ipc";
import { describe, meta } from "./ledgerMeta";

interface AgoGroup {
  yearsAgo: number;
  entries: LedgerEntry[];
}

function agoLabel(yearsAgo: number): string {
  return yearsAgo === 1 ? "há 1 ano" : `há ${yearsAgo} anos`;
}

export function OnThisDay() {
  const q = useQuery({
    queryKey: ["timeline", "onThisDay"],
    queryFn: onThisDay,
  });

  const groups = useMemo<AgoGroup[]>(() => {
    const currentYear = new Date().getFullYear();
    const byAgo = new Map<number, LedgerEntry[]>();
    for (const entry of q.data ?? []) {
      const yearsAgo = currentYear - Number(entry.day.slice(0, 4));
      if (yearsAgo <= 0) continue; // só o passado — "neste dia" não é hoje
      const bucket = byAgo.get(yearsAgo) ?? [];
      bucket.push(entry);
      byAgo.set(yearsAgo, bucket);
    }
    return [...byAgo.entries()]
      .map(([yearsAgo, entries]) => ({ yearsAgo, entries }))
      .sort((a, b) => a.yearsAgo - b.yearsAgo);
  }, [q.data]);

  // Sem história para este dia: some do Hub por completo.
  if (groups.length === 0) return null;

  return (
    <Card className="p-5">
      <header className="mb-3.5 flex items-center gap-3">
        <span
          className="grid size-9 place-items-center rounded-[var(--radius-md)]"
          style={{ background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
          aria-hidden
        >
          <History size={17} strokeWidth={2} className="text-[var(--accent)]" />
        </span>
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
            Neste dia
          </h3>
          <p className="text-[11.5px] text-[var(--text-tertiary)]">
            o que você viveu em anos anteriores
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3.5">
        {groups.map((group) => {
          const shown = group.entries.slice(0, 3);
          const extra = group.entries.length - shown.length;
          return (
            <div key={group.yearsAgo}>
              <p className="mb-1.5 text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
                {agoLabel(group.yearsAgo)}
              </p>
              <ul className="flex flex-col gap-1.5">
                {shown.map((entry) => {
                  const m = meta(entry);
                  const Icon = m.icon;
                  return (
                    <li key={entry.seq} className="flex items-center gap-2.5">
                      <span
                        className="grid size-6 shrink-0 place-items-center rounded-full"
                        style={{
                          background: `color-mix(in srgb, ${m.tint} 13%, transparent)`,
                        }}
                        aria-hidden
                      >
                        <Icon size={12} strokeWidth={2} style={{ color: m.tint }} />
                      </span>
                      <span className="truncate text-[12.5px] text-[var(--text-secondary)]">
                        {describe(entry)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {extra > 0 && (
                <p className="mt-1 pl-[34px] text-[11px] text-[var(--text-tertiary)]">
                  +{extra} {extra === 1 ? "outro" : "outros"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
