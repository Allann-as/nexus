/**
 * A visão MÊS: o feed de tudo que aconteceu, agrupado por dia, do dia mais
 * recente para o mais antigo.
 *
 * É a tela primária da Timeline. O agrupamento por dia e os filtros são
 * client-side (o backend já devolve newest-first por seq, então a ordem se
 * preserva de graça), mas o NÚMERO que a tela anuncia vem do censo do backend —
 * não do tamanho do array recebido.
 *
 * **O teto é declarado.** A leitura é paginada: um mês do seed de 5 anos tem
 * ~6.600 eventos e a página é de 400. Antes, a tela pedia 500 (o padrão do
 * `ipc.ts`), recebia 500 e escrevia "500 eventos em julho" — o tamanho da
 * página apresentado como o tamanho do mês, com a busca varrendo só o que tinha
 * chegado, em silêncio. Agora o cabeçalho separa o que está CARREGADO do que
 * EXISTE, e o filtro avisa sobre o que ainda não foi lido. Ver ADR-0104.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, History, SearchX } from "lucide-react";

import { Button, EmptyState } from "../../design-system/primitives";
import { CountUp } from "../../design-system/cards";
import { MonoLabel, SegBar } from "../../design-system/instruments";
import { timelineRange, type LedgerEntry, type RangeSummary } from "../../lib/ipc";
import { dayHeading, monthBounds, monthNameLong, timeOf } from "./dates";
import { dayScore, describe, detail, meta, searchHaystack } from "./ledgerMeta";

/**
 * Quantos eventos por leitura.
 *
 * 400 cobre com folga um mês de uso real (o seed de demonstração faz ~210) e
 * mantém o primeiro render barato num mês de uso extremo. O que não coube não
 * some: vira o botão "carregar mais", com o quanto falta escrito nele.
 */
const PAGE = 400;

interface DayGroup {
  day: string;
  /** O que a pessoa FEZ — o score do dia sai daqui e vira o cabeçalho. */
  entries: LedgerEntry[];
  /** O Nexus Score congelado do dia, se houver. `null` = dia não fechado. */
  score: number | null;
}

/**
 * Agrupa por dia preservando a ordem newest-first que o backend já entrega, e
 * promove o `nexus_score` do dia a propriedade do dia.
 */
function groupByDay(entries: LedgerEntry[], keepScoreRows: boolean): DayGroup[] {
  const groups: DayGroup[] = [];
  const index = new Map<string, number>();
  for (const entry of entries) {
    let at = index.get(entry.day);
    if (at == null) {
      at = groups.length;
      index.set(entry.day, at);
      groups.push({ day: entry.day, entries: [], score: null });
    }
    const score = dayScore(entry);
    if (score != null && !keepScoreRows) {
      groups[at].score = score;
      continue;
    }
    if (score != null) groups[at].score = score;
    groups[at].entries.push(entry);
  }
  return groups.filter((g) => g.entries.length > 0 || g.score != null);
}

export function MonthView({
  month,
  search,
  kind,
  summary,
}: {
  /** 'YYYY-MM'. */
  month: string;
  search: string;
  kind: string | null;
  /** O censo do mês — a verdade sobre quantos eventos existem. */
  summary: RangeSummary | undefined;
}) {
  const [fromDay, toDay] = monthBounds(month);
  const [limit, setLimit] = useState(PAGE);

  // Trocar de mês recomeça a paginação: carregar 3 páginas em julho não é razão
  // para ler 1.200 eventos de agosto antes de saber se agosto tem tanto assim.
  useEffect(() => setLimit(PAGE), [month]);

  const q = useQuery({
    queryKey: ["timeline", "range", fromDay, toDay, limit],
    queryFn: () => timelineRange(fromDay, toDay, limit),
  });

  const all = useMemo(() => q.data ?? [], [q.data]);
  const query = search.trim().toLowerCase();
  const total = summary?.total ?? all.length;
  const missing = Math.max(0, total - all.length);

  const filtered = useMemo(() => {
    return all.filter((e) => {
      if (kind && e.entityKind !== kind) return false;
      if (query && !searchHaystack(e).includes(query)) return false;
      return true;
    });
  }, [all, kind, query]);

  /* Filtrar pelo próprio Score é pedir para vê-los COMO eventos; nesse caso eles
     continuam na lista em vez de sumirem para dentro dos cabeçalhos.

     O último grupo é DESCARTADO enquanto houver página por ler: a página corta
     por evento, não por dia, então o dia mais antigo do lote quase sempre vem
     pela metade — e o contador do cabeçalho dele diria "39" sobre um dia de 85.
     Um cabeçalho de dia é uma afirmação sobre o dia inteiro; melhor não desenhar
     o dia do que desenhá-lo mentindo. O que sobra continua contado no botão. */
  const { groups, partialDay } = useMemo(() => {
    const days = groupByDay(filtered, kind === "daily_score");
    if (missing === 0) return { groups: days, partialDay: null as string | null };
    // Sobrando um dia só, não há o que descartar sem esvaziar a tela: ele fica,
    // mas SEM o contador. Um dia sem número não afirma nada; um dia com o
    // número errado afirma o que não é.
    if (days.length <= 1) return { groups: days, partialDay: days[0]?.day ?? null };
    return { groups: days.slice(0, -1), partialDay: null as string | null };
  }, [filtered, kind, missing]);
  const monthNumber = Number(month.slice(5, 7));
  const filtering = Boolean(kind) || Boolean(query);

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

  if (total === 0) {
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
      <div className="flex flex-col gap-3">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-10">
          <EmptyState
            icon={SearchX}
            title="Nada encontrado"
            hint={
              missing > 0
                ? `Nenhum dos ${all.length} eventos já lidos combina com o filtro — e ainda faltam ${missing} deste mês. Carregue o resto ou afrouxe o filtro.`
                : "Nenhum evento deste mês combina com o filtro. Tente afrouxar a busca ou o tipo."
            }
          />
        </div>
        {missing > 0 && <LoadMore missing={missing} onMore={() => setLimit((l) => l + PAGE)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Tally
        shown={filtered.length}
        loaded={all.length}
        total={total}
        missing={missing}
        filtering={filtering}
        monthNumber={monthNumber}
      />

      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <DaySection
            key={group.day}
            group={group}
            countable={group.day !== partialDay}
          />
        ))}
      </div>

      {missing > 0 && <LoadMore missing={missing} onMore={() => setLimit((l) => l + PAGE)} />}
    </div>
  );
}

/**
 * A contagem do topo — a frase que mais mentia na tela.
 *
 * Três números distintos, e nenhum se disfarça de outro: o que o filtro deixou
 * passar, o que já foi lido do banco, e o que o mês tem.
 */
function Tally({
  shown,
  loaded,
  total,
  missing,
  filtering,
  monthNumber,
}: {
  shown: number;
  loaded: number;
  total: number;
  missing: number;
  filtering: boolean;
  monthNumber: number;
}) {
  const noun = (n: number) => (n === 1 ? "evento" : "eventos");
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="tabular text-[15px] font-semibold text-[var(--text-primary)]">
        <CountUp to={filtering ? shown : total} />
      </span>
      <span className="text-[12.5px] text-[var(--text-secondary)]">
        {filtering
          ? `${noun(shown)} no filtro · ${total} em ${monthNameLong(monthNumber)}`
          : `${noun(total)} em ${monthNameLong(monthNumber)}`}
      </span>
      {missing > 0 && (
        <span className="text-[11.5px] text-[var(--text-tertiary)]">
          — {filtering ? "filtrando " : "mostrando "}
          <span className="tabular">{loaded}</span> já lidos
        </span>
      )}
    </div>
  );
}

function LoadMore({ missing, onMore }: { missing: number; onMore: () => void }) {
  return (
    <div className="flex justify-center">
      <Button variant="ghost" onClick={onMore}>
        <ChevronDown size={14} strokeWidth={2} />
        Carregar mais {missing} {missing === 1 ? "evento" : "eventos"}
      </Button>
    </div>
  );
}

/**
 * Um dia do feed.
 *
 * O cabeçalho é a RÉGUA: o tique de fósforo, a data, a contagem do dia e — o
 * dado que estava jogado na lista como mais uma linha cinza — o Nexus Score
 * congelado daquele dia. Um `nexus_score` por dia é 1 em cada 10 linhas do feed
 * e não é um ato do usuário; como medidor do dia ele mede, como linha ele
 * empurrava o que a pessoa fez para baixo.
 *
 * Dia sem score congelado NÃO desenha um medidor vazio: "não medido" e "zero"
 * são coisas diferentes, e um trilho apagado afirmaria a segunda.
 */
function DaySection({
  group,
  countable,
}: {
  group: DayGroup;
  /** `false` no dia que a página cortou: ali o número não seria o do dia. */
  countable: boolean;
}) {
  return (
    <section>
      <header className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full bg-[var(--accent)]" />
        {/* Sem `capitalize`: a classe do Tailwind capitaliza CADA palavra, e
            `dayHeading` devolve uma frase em português — "22 de julho,
            quarta-feira" virava "22 De Julho, Quarta-Feira". */}
        <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
          {dayHeading(group.day)}
        </h3>
        {countable && (
          <span className="tabular rounded-full bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
            {group.entries.length}
          </span>
        )}

        {group.score != null && (
          <span className="ml-auto flex items-center gap-2" title="Nexus Score congelado do dia">
            <MonoLabel>Score</MonoLabel>
            {/* A largura vive no INVÓLUCRO, não numa classe passada à SegBar: a
                raiz dela já é `w-full`, e duas utilitárias de largura na mesma
                lista se resolvem pela ordem do CSS, não pela do atributo — o
                medidor saía cortado, e um Score 75 acendia menos segmentos que
                um 57. Um instrumento com a escala truncada mente pior que
                nenhum instrumento. */}
            <span className="block w-[72px] shrink-0">
              <SegBar
                value={group.score / 100}
                segments={10}
                height={6}
                gap={2}
                color="var(--accent)"
                animate={false}
              />
            </span>
            <span className="tabular text-[11.5px] font-semibold text-[var(--text-secondary)]">
              {group.score}
            </span>
          </span>
        )}
      </header>

      {/* O trilho vertical: uma linha que costura os eventos do dia. */}
      {group.entries.length > 0 && (
        <ol className="relative ml-[13px] border-l border-[var(--border-subtle)]">
          {group.entries.map((entry) => (
            <EventRow key={entry.seq} entry={entry} />
          ))}
        </ol>
      )}
    </section>
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
