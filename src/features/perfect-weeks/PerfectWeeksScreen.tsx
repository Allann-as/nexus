/**
 * Semana Perfeita (ARSENAL) — o calendário anual das semanas em que 100% do
 * agendado foi cumprido, a sequência atual e o recorde.
 *
 * Tudo DERIVADO das séries de hábito (nada gravado): desmarcar um tick pode
 * desfazer uma semana perfeita, e é assim que tem que ser. Uma semana perfeita é
 * exigente por definição — sem abono: pular não conta como cumprir.
 *
 * As conquistas 4/12/26 desta tela vêm do BANCO (`gamification_overview`), não
 * de `total >= limiar`. A diferença importa: uma semana perfeita pode ser
 * desfeita ao desmarcar um tick, mas a conquista que já caiu está no ledger e
 * não volta atrás. Derivar o estado aqui faria esta tela dizer "bloqueada" para
 * algo que a tela de Conquistas mostra como conquistada — a tela contradizendo o
 * banco (ADR-0096). A `queryKey` é a MESMA de lá, de propósito: as duas leem a
 * mesma entrada de cache e não têm como divergir.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarHeart, ChevronLeft, ChevronRight, Flame, Sigma, Trophy } from "lucide-react";

import {
  gamificationOverview,
  perfectWeekView,
  syncAchievements,
  type GalleryEntry,
  type PerfectWeekCell,
  type PerfectWeekStatus,
} from "../../lib/ipc";
import { PageHeader, PAGE_CONTAINER, Card, EmptyState, cx } from "../../design-system/primitives";
import { StatTile } from "../../design-system/cards";
import { SegBar, MonoLabel } from "../../design-system/instruments";
import { DynamicIcon } from "../../design-system/DynamicIcon";
import { tierColor } from "../../design-system/tiers";
import { Formula } from "../../design-system/Formula";
import { fromDay } from "../calendar/grid";
import { mondaysOf } from "./weekStrip";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/* A faixa do ano: uma célula por semana, em UMA linha. A escolha é deliberada —
   a sequência é o assunto desta tela, e uma sequência só se enxerga se as
   semanas vizinhas forem vizinhas na tela. Quebrar em linhas (o `flex-wrap` de
   antes) parte a run de seis semanas ao meio e ela deixa de existir para quem
   olha. 53 × 18px = 954px, dentro do cartão. */
const CELL_W = 14;
const CELL_H = 30;
const GAP = 4;
const TOP = 16; // a faixa dos rótulos de mês

export function PerfectWeeksScreen() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const view = useQuery({
    queryKey: ["perfect-weeks", year],
    queryFn: () => perfectWeekView(year),
  });

  /* Mesma chave e mesma função da tela de Conquistas: uma entrada de cache só,
     nenhuma chance de as duas telas mostrarem estados diferentes da mesma
     conquista. */
  const gamification = useQuery({
    queryKey: ["gamification"],
    queryFn: async () => {
      await syncAchievements();
      return gamificationOverview();
    },
  });

  const data = view.data;
  const hasData = !!data && data.weeks.length > 0;

  /* O denominador do ano são as semanas JULGÁVEIS, não as 52. Uma semana sem
     nenhum hábito agendado é neutra por definição do domínio (não é perfeita nem
     quebrada) — contá-la embaixo diria "8 de 52" para quem só começou a rastrear
     em outubro e não errou uma vez. */
  const judged = useMemo(
    () => (data?.weeks ?? []).filter((w) => w.status !== "empty").length,
    [data],
  );

  const milestones = useMemo(
    () =>
      (gamification.data?.achievements ?? [])
        .filter((a) => a.key.startsWith("perfect_week_"))
        .sort((a, b) => threshold(a.key) - threshold(b.key)),
    [gamification.data],
  );

  const streak = data?.streak;

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-y-auto">
      <PageHeader
        title="Semana Perfeita"
        subtitle="As semanas em que você cumpriu 100% do que estava agendado — sem abono"
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setYear((y) => y - 1)}
              aria-label="Ano anterior"
              className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-glow)] hover:text-[var(--text-primary)]"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="tabular w-14 text-center text-[14px] font-semibold text-[var(--text-primary)]">
              {year}
            </span>
            <button
              onClick={() => setYear((y) => Math.min(currentYear, y + 1))}
              disabled={year >= currentYear}
              aria-label="Próximo ano"
              className="grid size-8 place-items-center rounded-[var(--radius-md)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-glow)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      <div className={cx(PAGE_CONTAINER, "flex flex-col gap-4 pb-10")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {/* A sequência atual ganha medidor porque tem um teto de verdade: o
              próprio recorde. "3 semanas" sozinho não diz se é perto ou longe do
              melhor que já se fez — e o recorde é sempre >= a atual, então a
              barra nunca estoura. Sem recorde ainda, não há escala e o medidor
              some. */}
          <StatTile
            icon={Flame}
            label="Sequência atual"
            value={streak?.current ?? 0}
            unit="semanas"
            tone="success"
            seg={streak && streak.record > 0 ? streak.current / streak.record : undefined}
            hint={
              streak && streak.record > 0
                ? `seu recorde é ${streak.record} ${plural(streak.record, "semana", "semanas")}`
                : "ainda sem recorde"
            }
          />
          {/* Recorde e total NÃO ganham medidor: não existe teto para nenhum dos
              dois. Medidor sem denominador é o instrumento mentindo (ADR-0098). */}
          <StatTile
            icon={Trophy}
            label="Recorde"
            value={streak?.record ?? 0}
            unit="semanas"
            tone="accent"
            hint="a maior sequência de sempre"
          />
          <StatTile
            icon={CalendarHeart}
            label={`Perfeitas em ${year}`}
            value={data?.totalYear ?? 0}
            unit={judged > 0 ? `de ${judged}` : "semanas"}
            tone="sphere"
            seg={judged > 0 ? (data?.totalYear ?? 0) / judged : undefined}
            hint={judged > 0 ? "semanas julgáveis do ano" : "nenhuma semana julgável ainda"}
          />
          {/* O total de sempre vinha do backend em `streak.total` e a tela o
              jogava fora — e é justamente ele que as conquistas 4/12/26 medem. */}
          <StatTile
            icon={Sigma}
            label="Total de sempre"
            value={streak?.total ?? 0}
            unit="semanas"
            tone="cyan"
            hint="em toda a história, somando os anos"
          />
        </div>

        {!hasData ? (
          <Card className="p-0">
            <EmptyState
              icon={CalendarHeart}
              title={`Nenhuma semana completa em ${year}`}
              hint={
                /* O template não pode mentir: mandar "marque seus hábitos" para
                   quem tem 30 semanas perfeitas em outro ano trata um ano vazio
                   como um app vazio. */
                (streak?.total ?? 0) > 0
                  ? `Você tem ${streak!.total} ${plural(streak!.total, "semana perfeita", "semanas perfeitas")} em outros anos — use as setas do topo para navegar até eles.`
                  : "Uma semana perfeita é aquela em que todo hábito agendado foi cumprido, de segunda a domingo. Marque seus hábitos e as semanas perfeitas aparecem aqui — a régua é exigente de propósito."
              }
            />
          </Card>
        ) : (
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">
                O ano em semanas
              </h2>
              <Legend />
            </div>
            <div className="flex justify-center overflow-x-auto pb-1">
              <WeekStrip weeks={data!.weeks} year={year} />
            </div>
            <Formula>
              Semana perfeita = toda ocorrência agendada (Daily/Weekdays por dia,
              "N x/semana" pela cota) cumprida com "done" entre segunda e domingo.
              Pular NÃO abona. Só semanas encerradas entram; a corrente fica de fora
              até terminar. O denominador de "{data!.totalYear} de {judged}" é o
              número de semanas julgáveis — as que tinham ao menos um hábito agendado.
            </Formula>
          </Card>
        )}

        {milestones.length > 0 && (
          <Card className="p-5">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Marcos</h2>
              <MonoLabel>
                {milestones.filter((m) => m.unlocked).length} de {milestones.length}
              </MonoLabel>
            </div>
            <p className="mb-4 text-[11px] text-[var(--text-tertiary)]">
              Contam as semanas perfeitas de toda a história, não as do ano.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {milestones.map((m) => (
                <MilestoneTile key={m.key} entry={m} total={streak?.total ?? 0} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ---------- a faixa do ano ---------- */

interface Placed {
  cell: PerfectWeekCell;
  x: number;
  /** A semana ainda não terminou — não foi julgada, e não pode ser desenhada. */
  future: boolean;
}

function WeekStrip({ weeks, year }: { weeks: PerfectWeekCell[]; year: number }) {
  const { placed, ticks, todayX } = useMemo(() => layout(weeks, year), [weeks, year]);
  /* A largura é a do que foi DESENHADO, não a do ano inteiro — senão o SVG
     reserva de agosto a dezembro e a faixa fica colada à esquerda com meio
     cartão vazio à direita. Dimensionar ao conteúdo e centralizar é a mesma
     decisão que o Ano em Pixels tomou pelo mesmo motivo (ADR-0098). O ano
     passado ocupa a largura toda; o corrente cresce até ocupá-la. */
  const drawn = placed.filter((p) => !p.future).length;
  const width = Math.max(1, drawn) * (CELL_W + GAP) + 26; // 26 = folga do rótulo "hoje"
  const height = TOP + CELL_H + 2;

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`As semanas de ${year}, uma célula por semana`}
    >
      {ticks.map((t) => (
        <text
          key={t.label + t.x}
          x={t.x}
          y={10}
          className="fill-[var(--text-tertiary)]"
          style={{ fontSize: 10 }}
        >
          {t.label}
        </text>
      ))}
      {placed.map(({ cell, x, future }) =>
        /* A semana futura NÃO é desenhada. Pintá-la de "sem hábito" (tracejado)
           diria que nada estava agendado nela — o instrumento afirmando algo que
           o dado não sustenta. O espaço vazio à direita É a informação: o ano
           ainda não chegou lá. */
        future ? null : <WeekRect key={cell.weekStart} cell={cell} x={x} />,
      )}
      {todayX != null && (
        <>
          <line
            x1={todayX}
            y1={TOP - 3}
            x2={todayX}
            y2={TOP + CELL_H + 2}
            stroke="var(--text-tertiary)"
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={0.7}
          />
          <text
            x={todayX + 3}
            y={TOP + CELL_H + 1}
            className="fill-[var(--text-tertiary)]"
            style={{ fontSize: 9 }}
          >
            hoje
          </text>
        </>
      )}
    </svg>
  );
}

function WeekRect({ cell, x }: { cell: PerfectWeekCell; x: number }) {
  const perfect = cell.status === "perfect";
  const empty = cell.status === "empty";
  return (
    <rect
      x={x}
      y={TOP}
      width={CELL_W}
      height={CELL_H}
      rx={4}
      fill={
        perfect
          ? "var(--success)"
          : empty
            ? "transparent"
            : "color-mix(in srgb, var(--text-tertiary) 22%, transparent)"
      }
      stroke={empty ? "var(--border-subtle)" : undefined}
      strokeDasharray={empty ? "3 3" : undefined}
      style={
        perfect
          ? { filter: "drop-shadow(0 0 5px color-mix(in srgb, var(--success) 55%, transparent))" }
          : undefined
      }
    >
      <title>{describe(cell)}</title>
    </rect>
  );
}

/**
 * Posiciona o ANO INTEIRO — todas as segundas-feiras do ano —, não só as semanas
 * que o backend devolveu.
 *
 * O backend só manda da primeira semana com tick em diante, porque é de lá que a
 * régua começa a valer. Desenhar só isso fazia "O ano em semanas" mostrar de
 * março a julho e chamar aquilo de ano: a faixa encolhia para um terço do cartão
 * e deixava vazio dos dois lados. As semanas anteriores ao primeiro tick são
 * legitimamente NEUTRAS (nenhum hábito era rastreado), que é exatamente o estado
 * `empty` que a legenda já explica — então elas são desenhadas como tal, e a
 * escala do ano fica constante de janeiro a dezembro.
 */
function layout(weeks: PerfectWeekCell[], year: number) {
  const known = new Map(weeks.map((w) => [w.weekStart, w]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const placed: Placed[] = [];
  const ticks: { label: string; x: number }[] = [];
  let lastMonth = -1;
  let todayX: number | null = null;

  let i = 0;
  for (const monday of mondaysOf(year)) {
    const x = i * (CELL_W + GAP);
    const d = fromDay(monday);

    // A semana só é julgável quando o domingo dela passou (a mesma régua do
    // `complete_weeks` do domínio: uma semana só se julga quando termina).
    const sunday = new Date(d);
    sunday.setDate(sunday.getDate() + 6);
    const future = sunday > today;
    if (future && todayX == null) todayX = x - GAP / 2;

    placed.push({
      cell: known.get(monday) ?? { weekStart: monday, status: "empty" },
      x,
      future,
    });

    const month = d.getMonth();
    if (month !== lastMonth && !future) {
      lastMonth = month;
      ticks.push({ label: MONTHS[month], x });
    }
    i += 1;
  }

  return { placed, ticks, todayX };
}

function describe(cell: PerfectWeekCell): string {
  const d = fromDay(cell.weekStart);
  const when = `Semana de ${String(d.getDate()).padStart(2, "0")}/${MONTHS[d.getMonth()]}`;
  return `${when} — ${statusLabel(cell.status)}`;
}

/* ---------- os marcos 4/12/26 ---------- */

function MilestoneTile({ entry, total }: { entry: GalleryEntry; total: number }) {
  const color = tierColor(entry.tier);
  const goal = threshold(entry.key);
  const missing = Math.max(0, goal - total);

  return (
    <div
      className={cx(
        "flex flex-col gap-2 rounded-[var(--radius-lg)] border bg-[var(--bg-surface)] p-3",
        entry.unlocked
          ? "border-[var(--border-subtle)]"
          : "border-dashed border-[var(--border-subtle)]",
      )}
    >
      <div className="flex items-center gap-2">
        {/* Bloqueada mostra o PRÓPRIO ícone em silhueta, não um cadeado — a mesma
            decisão da galeria (ADR-0098). */}
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{
            background: entry.unlocked
              ? `color-mix(in oklab, ${color} 18%, transparent)`
              : "var(--bg-base)",
            color: entry.unlocked ? color : "var(--text-tertiary)",
            opacity: entry.unlocked ? 1 : 0.55,
          }}
        >
          <DynamicIcon name={entry.icon} size={18} />
        </span>
        <h3
          className={cx(
            "min-w-0 flex-1 text-[12px] leading-tight font-semibold",
            entry.unlocked ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
          )}
        >
          {entry.title}
        </h3>
      </div>

      <p className="text-[11px] leading-[15px] text-[var(--text-tertiary)]">{entry.description}</p>

      {entry.unlocked ? (
        /* Conquistada: a data em que caiu. Nada de barra cheia — e nada de barra
           de progresso "3 de 26" ao lado de uma conquista já ganha, que é o que
           aconteceria se o estado fosse derivado do total de hoje em vez de lido
           do ledger. */
        <p className="tabular mt-auto text-[10px] text-[var(--text-tertiary)]">
          {entry.unlockedAt != null ? `conquistado em ${unlockedDay(entry.unlockedAt)}` : "conquistado"}
        </p>
      ) : (
        <div className="mt-auto flex flex-col gap-1.5">
          <SegBar value={goal > 0 ? total / goal : 0} segments={goal <= 12 ? goal : 26} height={6} />
          <span className="tabular text-[10px] text-[var(--text-tertiary)]">
            {total} de {goal} · faltam {missing}
          </span>
        </div>
      )}
    </div>
  );
}

/** O limiar embutido na chave (`perfect_week_12` → 12). */
function threshold(key: string): number {
  const n = Number(key.split("_").pop());
  return Number.isFinite(n) ? n : 0;
}

function unlockedDay(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ---------- miudezas ---------- */

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-[4px] bg-[var(--success)]" />
        Perfeita
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-[4px] bg-[color-mix(in_srgb,var(--text-tertiary)_22%,transparent)]" />
        Faltou algo
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-[4px] border border-dashed border-[var(--border-subtle)]" />
        Sem hábito
      </span>
    </div>
  );
}

function statusLabel(s: PerfectWeekStatus): string {
  switch (s) {
    case "perfect":
      return "perfeita";
    case "broken":
      return "faltou algo";
    default:
      return "sem hábito agendado";
  }
}

/** Concordância: "1 semana", "2 semanas" (a lição do "atrasado em 5 livros"). */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
