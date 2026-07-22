/**
 * "Neste dia": o que aconteceu no mesmo dia de anos anteriores.
 *
 * Auto-suficiente — sua própria query, seu próprio vazio. Quando não há história
 * (o caso do usuário novo), ele renderiza `null` e some sem deixar buraco: um
 * card "nada aconteceu neste dia em anos anteriores" seria ruído, não memória.
 *
 * Vive em DOIS lugares pela mesma `queryKey`: a faixa lateral do Hub e a
 * Timeline. É a memória que a Máquina do Tempo existe para servir, e ela estava
 * só na tela inicial — quem abrisse a Timeline procurando o próprio passado não
 * a encontrava lá (ADR-0104).
 *
 * O `compact` é do Hub: lá o espaço é de uma coluna lateral e três linhas por
 * ano bastam para a lembrança. Na Timeline a tela é inteira, e cortar o que o
 * backend já mandou seria descartar dado por hábito.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { Terminal, MonoLabel } from "../../design-system/instruments";
import { onThisDay, type LedgerEntry } from "../../lib/ipc";
import { describe, detail, meta } from "./ledgerMeta";

interface AgoGroup {
  yearsAgo: number;
  entries: LedgerEntry[];
}

function agoLabel(yearsAgo: number): string {
  return yearsAgo === 1 ? "há 1 ano" : `há ${yearsAgo} anos`;
}

export function OnThisDay({ compact = false }: { compact?: boolean }) {
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

  // Sem história para este dia: some por completo.
  if (groups.length === 0) return null;

  return (
    <Terminal
      title="Neste dia"
      icon={History}
      tone="phos"
      right={
        <span className="text-[11px] text-[var(--text-tertiary)]">
          o que você viveu em anos anteriores
        </span>
      }
      bodyClassName="flex flex-col gap-3.5 p-4"
    >
      {groups.map((group) => {
        const shown = compact ? group.entries.slice(0, 3) : group.entries;
        const extra = group.entries.length - shown.length;
        return (
          <div key={group.yearsAgo}>
            <p className="mb-1.5">
              <MonoLabel>{agoLabel(group.yearsAgo)}</MonoLabel>
            </p>
            <ul className="flex flex-col gap-1.5">
              {shown.map((entry) => {
                const m = meta(entry);
                const secondary = compact ? null : detail(entry);
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
                    {secondary && (
                      <span className="truncate text-[11.5px] text-[var(--text-tertiary)]">
                        · {secondary}
                      </span>
                    )}
                    {!compact && (
                      <span
                        className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                        style={{
                          background: `color-mix(in srgb, ${m.tint} 12%, transparent)`,
                          color: m.tint,
                        }}
                      >
                        {m.label}
                      </span>
                    )}
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
    </Terminal>
  );
}
