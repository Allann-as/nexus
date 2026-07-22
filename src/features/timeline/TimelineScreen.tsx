/**
 * A Máquina do Tempo (§2.6): a tela que reconta a história do usuário a partir
 * do ledger imutável.
 *
 * Duas visões — o feed do MÊS (a primária) e a grade do ANO — sobre uma barra de
 * controle (o `Scrubber`), no idioma COCKPIT: o alternador segmentado, os filtros
 * como `Chip` com o número real de cada tipo, e o painel `Terminal` em volta do
 * feed. Ao montar, a tela congela os meses fechados (`ensureTimelineRollups`) e
 * revalida a visão ANO, para o resumo do ano refletir o que acabou de ser
 * congelado.
 *
 * **Os filtros vêm do banco, não de uma lista em código.** A régua antiga tinha
 * sete pílulas fixas ("Tarefas", "Hábitos", "Metas", "Aportes", "Livros",
 * "Marcos") e nenhuma delas dizia quantos eventos havia atrás — num mês sem
 * nenhum aporte, "Aportes" era um botão que só sabia esvaziar a tela. Agora cada
 * pílula é um `entityKind` que EXISTE no mês, com a contagem dele. Ver ADR-0104.
 *
 * **Não há filtro por Esfera** — a decisão está no ADR-0104: o ledger não tem
 * `area_id` e não pode ter (ele é auto-suficiente por ADR-0023, e metade dos
 * seus fatos não é node nenhum). Um filtro que dependesse de JOIN com `nodes`
 * mentiria justamente sobre o passado, que é a única coisa que esta tela mostra.
 *
 * A Timeline é GLOBAL (rail), não é de uma Esfera: por isso a cor padrão é o
 * `--accent` do NEXUS, e não um `--sphere`.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Layers, Search, X } from "lucide-react";

import { PageHeader, PAGE_CONTAINER, cx } from "../../design-system/primitives";
import { Chip, MonoLabel, Terminal } from "../../design-system/instruments";
import {
  ensureTimelineRollups,
  timelineSummary,
  timelineYears,
  type RangeSummary,
} from "../../lib/ipc";
import { MonthView } from "./MonthView";
import { YearView } from "./YearView";
import { OnThisDay } from "./OnThisDay";
import { Scrubber, type TimelineMode } from "./Scrubber";
import { monthBounds, monthKey, monthNameLong } from "./dates";
import { KIND_LABEL } from "./ledgerMeta";

/**
 * A ordem preferida das pílulas de filtro.
 *
 * Não é uma lista de quem PODE aparecer — é só a ordem de quem aparecer. Um kind
 * fora dela vai para o fim, ordenado pela contagem; nenhum kind some da régua só
 * por ser novo, que é o defeito que a lista fixa tinha.
 */
const KIND_ORDER = [
  "task",
  "habit",
  "goal",
  "milestone",
  "annual_goal",
  "challenge",
  "achievement",
  "contribution",
  "fin_goal",
  "book",
  "subject",
  "note",
  "event",
  "project",
  "career_milestone",
  "personal_record",
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
  // resumos acabaram de ganhar os meses recém-congelados (e, na primeira
  // abertura da v1.3, os meses RE-congelados no formato novo: os da v1.2 não
  // sabiam contar conquistas — ADR-0104).
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
  const [fromDay, toDay] = monthBounds(monthStr);

  const years = useQuery({ queryKey: ["timeline", "years"], queryFn: timelineYears });

  // O censo do mês. Telas irmãs compartilham a queryKey: o `MonthView` recebe
  // este mesmo objeto, então o cabeçalho dele e as pílulas daqui nunca discordam.
  const summary = useQuery({
    queryKey: ["timeline", "summary", fromDay, toDay],
    queryFn: () => timelineSummary(fromDay, toDay),
    enabled: mode === "month",
  });

  // Trocar de mês pode deixar um filtro apontando para um tipo que não existe
  // mais — e um filtro invisível que esvazia a tela é pior que nenhum filtro.
  useEffect(() => {
    if (!kind || !summary.data) return;
    if (!summary.data.byKind.some((k) => k.kind === kind)) setKind(null);
  }, [kind, summary.data]);

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Timeline"
        subtitle="A máquina do tempo — cada ação registrada vira um evento para sempre"
      />

      <div className={`${PAGE_CONTAINER} min-h-0 flex-1 pb-16`}>
        <div className="flex flex-col gap-5">
          <Scrubber
            mode={mode}
            year={year}
            month={month}
            years={years.data ?? []}
            onMode={setMode}
            onYear={setYear}
            onMonth={setMonth}
          />

          {mode === "month" ? (
            <>
              <Terminal
                title={`${monthNameLong(month)} de ${year}`}
                icon={History}
                tone="phos"
                bodyClassName="flex flex-col gap-4 p-4"
              >
                <FilterRow
                  search={search}
                  onSearch={setSearch}
                  kind={kind}
                  onKind={setKind}
                  summary={summary.data}
                />
                <MonthView
                  month={monthStr}
                  search={search}
                  kind={kind}
                  summary={summary.data}
                />
              </Terminal>

              {/* "Neste dia" mora aqui e no Hub pela mesma queryKey — é a memória
                  que a Máquina do Tempo existe para servir, e ela estava só na
                  tela inicial. */}
              <OnThisDay />
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
  summary,
}: {
  search: string;
  onSearch: (value: string) => void;
  kind: string | null;
  onKind: (kind: string | null) => void;
  summary: RangeSummary | undefined;
}) {
  /* As pílulas SÃO o censo do mês, na ordem curada; o que a ordem não conhece
     entra depois, pela frequência que o backend já devolveu. */
  const chips = useMemo(() => {
    const present = summary?.byKind ?? [];
    const rank = (k: string) => {
      const at = KIND_ORDER.indexOf(k);
      return at === -1 ? KIND_ORDER.length : at;
    };
    return [...present].sort(
      (a, b) => rank(a.kind) - rank(b.kind) || b.count - a.count,
    );
  }, [summary]);

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
            "h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-base)]",
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

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <MonoLabel className="mr-1">Tipo</MonoLabel>
          <Chip
            tone="phos"
            icon={Layers}
            active={kind === null}
            onClick={() => onKind(null)}
          >
            Tudo
            <span className="tabular ml-1 text-[11px] opacity-70">
              {summary?.total ?? 0}
            </span>
          </Chip>
          {chips.map((c) => (
            <Chip
              key={c.kind}
              tone="phos"
              active={kind === c.kind}
              onClick={() => onKind(kind === c.kind ? null : c.kind)}
            >
              {KIND_LABEL[c.kind] ?? c.kind}
              <span className="tabular ml-1 text-[11px] opacity-70">{c.count}</span>
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
