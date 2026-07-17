/**
 * A Máquina do Tempo (§2.6): a tela que reconta a história do usuário a partir
 * do ledger imutável.
 *
 * Duas visões — o feed do MÊS (a primária) e a grade do ANO — sobre uma barra de
 * controle (o `Scrubber`). Ao montar, a tela congela os meses fechados
 * (`ensureTimelineRollups`) e revalida a visão ANO, para o resumo do ano refletir
 * o que acabou de ser congelado.
 *
 * A Timeline é GLOBAL (rail), não é de uma Esfera: por isso a cor padrão é o
 * `--accent` do NEXUS, e não um `--sphere`.
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";

import { PageHeader, cx } from "../../design-system/primitives";
import { ensureTimelineRollups } from "../../lib/ipc";
import { MonthView } from "./MonthView";
import { YearView } from "./YearView";
import { Scrubber, type TimelineMode } from "./Scrubber";
import { monthKey } from "./dates";

/** Os atalhos de tipo do filtro. Cada pílula é um `entityKind` do ledger. */
const KIND_FILTERS: { label: string; kind: string | null }[] = [
  { label: "Tudo", kind: null },
  { label: "Tarefas", kind: "task" },
  { label: "Hábitos", kind: "habit" },
  { label: "Metas", kind: "goal" },
  { label: "Aportes", kind: "contribution" },
  { label: "Livros", kind: "book" },
  { label: "Marcos", kind: "career_milestone" },
];

export function TimelineScreen() {
  const client = useQueryClient();
  const now = new Date();

  const [mode, setMode] = useState<TimelineMode>("month");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string | null>(null);

  // Congela os meses fechados uma vez, ao abrir — e revalida a visão ANO, cujos
  // resumos acabaram de ganhar os meses recém-congelados.
  useEffect(() => {
    let alive = true;
    void ensureTimelineRollups()
      .then(() => {
        if (alive) {
          void client.invalidateQueries({ queryKey: ["timeline", "year"] });
        }
      })
      .catch(() => {
        // Congelar é otimização, não pré-requisito: se falhar, a leitura ao
        // vivo ainda desenha o feed. Não vale um toast.
      });
    return () => {
      alive = false;
    };
  }, [client]);

  const monthStr = monthKey(year, month);

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Timeline"
        subtitle="A máquina do tempo — cada ação registrada vira um evento para sempre"
      />

      <div className="min-h-0 flex-1 px-8 pb-16">
        <div className="mx-auto flex max-w-[900px] flex-col gap-5">
          <Scrubber
            mode={mode}
            year={year}
            month={month}
            onMode={setMode}
            onYear={setYear}
            onMonth={setMonth}
          />

          {mode === "month" ? (
            <>
              <FilterRow
                search={search}
                onSearch={setSearch}
                kind={kind}
                onKind={setKind}
              />
              <MonthView month={monthStr} search={search} kind={kind} />
            </>
          ) : (
            <YearView
              year={String(year)}
              onPickMonth={(picked) => {
                setYear(Number(picked.slice(0, 4)));
                setMonth(Number(picked.slice(5, 7)));
                setMode("month");
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FilterRow({
  search,
  onSearch,
  kind,
  onKind,
}: {
  search: string;
  onSearch: (value: string) => void;
  kind: string | null;
  onKind: (kind: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          size={14}
          strokeWidth={2}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--text-tertiary)]"
        />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Buscar na história…"
          className={cx(
            "h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]",
            "pr-8 pl-9 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]",
            "transition-colors duration-[var(--dur-fast)] ease-[var(--ease)]",
            "focus:border-[var(--border-glow)] focus:outline-none",
          )}
        />
        {search && (
          <button
            onClick={() => onSearch("")}
            aria-label="Limpar busca"
            className="absolute top-1/2 right-2.5 grid size-5 -translate-y-1/2 place-items-center rounded-full text-[var(--text-tertiary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          >
            <X size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {KIND_FILTERS.map((f) => {
          const active = f.kind === kind;
          return (
            <button
              key={f.label}
              onClick={() => onKind(f.kind)}
              className={cx(
                "h-7 rounded-full px-3 text-[12px] font-medium",
                "transition-[background-color,color,border-color] duration-[var(--dur-fast)] ease-[var(--ease)]",
                "border",
                active
                  ? "border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--text-primary)]"
                  : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
