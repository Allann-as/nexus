/**
 * O Calendário: mês, semana e dia, com timeblocking.
 *
 * Esta é a tela que orquestra; o desenho mora no `MonthGrid`/`TimeGrid`, a
 * aritmética no `grid.ts`, o layout de conflito no `layout.ts` e os dados no
 * `useCalendarData.ts`. O que sobra aqui é o que só o dono da tela pode decidir:
 * qual janela está aberta, o que cada gesto escreve, e o que o teclado faz.
 *
 * # A aurora aqui é neutra
 *
 * Toda tela de Esfera define `--sphere` e se tinge inteira. O calendário não: ele
 * é global, como o Hub e o Inbox — as terças de terapia e as reuniões de trabalho
 * dividem a mesma grade. Tingi-lo com uma cor seria afirmar que a semana pertence
 * a uma Esfera. Cada BLOCO se tinge da sua; o fundo fica no `--accent`.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { isChordPending } from "../../app/useKeyboard";
import { CountUp } from "../../design-system/cards";
import { Modal } from "../../design-system/Modal";
import { Button, Kbd, cx } from "../../design-system/primitives";
import { useToasts } from "../../stores/toasts";
import {
  cancelOccurrence,
  createEvent,
  deleteEvent,
  listAreas,
  moveEvent,
  resizeEvent,
  type Occurrence,
  type Recurrence,
} from "../../lib/ipc";
import { MAX_VISIBLE, MonthGrid, type DayItem } from "./MonthGrid";
import { EventModal, type EventDraft } from "./EventModal";
import { TimeGrid, type DraftBlock } from "./TimeGrid";
import {
  addDays,
  addMonths,
  fromDay,
  hhmm,
  monthGrid,
  monthLabel,
  toDay,
  weekGrid,
} from "./grid";
import {
  occurrenceKey,
  useConflicts,
  useMaterializationWindow,
  useOccurrences,
} from "./useCalendarData";

type View = "month" | "week" | "day";

const VIEW_LABEL: Record<View, string> = {
  month: "Mês",
  week: "Semana",
  day: "Dia",
};

/**
 * De quanto em quanto tempo a linha "agora" anda.
 *
 * 30s e não 1s: a linha se move 1px a cada ~1,2min numa coluna de 52px/hora, e
 * um `setInterval` de 1 segundo seria um re-render por segundo para não mostrar
 * diferença nenhuma — exatamente o "0% de CPU em idle" que a constituição
 * proíbe gastar.
 */
const NOW_TICK_MS = 30_000;

export function CalendarScreen() {
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(() => toDay(new Date()));
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [opened, setOpened] = useState<Occurrence | null>(null);
  const [overflowDay, setOverflowDay] = useState<string | null>(null);

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [today, setToday] = useState(() => toDay(new Date()));

  const client = useQueryClient();
  const pushError = useToasts((s) => s.pushError);
  const push = useToasts((s) => s.push);

  // O relógio da tela. `today` junto de `nowMs` porque o app fica aberto: quem
  // deixa o NEXUS ligado à meia-noite tem que ver o anel de "hoje" trocar de
  // dia sozinho, e não no próximo F5.
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
      setToday(toDay(new Date()));
    }, NOW_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const days = useMemo(
    () => (view === "month" ? monthGrid(anchor) : view === "week" ? weekGrid(anchor) : [anchor]),
    [view, anchor],
  );
  const win = useMemo(
    () => ({ from: days[0], to: days[days.length - 1] }),
    [days],
  );

  const { data: occurrences = [] } = useOccurrences(win);
  const { conflicts, conflicted } = useConflicts(win);
  useMaterializationWindow(anchor);

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", "all"],
    queryFn: () => listAreas(true),
    staleTime: 5 * 60_000,
  });

  const colourOf = useColourOf();

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["events"] });
    void client.invalidateQueries({ queryKey: ["conflicts"] });
  };

  /* ===== os gestos ===== */

  const onCreate = async (e: {
    title: string;
    areaId: string | null;
    startsAt: number;
    endsAt: number;
    rrule: Recurrence | null;
  }) => {
    try {
      await createEvent({
        title: e.title,
        areaId: e.areaId,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        // "Toda semana" sem dia é a semana do próprio evento: o domínio quer o
        // índice do dia, e quem sabe qual é é a data que o usuário arrastou.
        rrule:
          e.rrule?.type === "weekly" && e.rrule.days.length === 0
            ? { ...e.rrule, days: [new Date(e.startsAt).getDay()] }
            : e.rrule,
      });
      setDraft(null);
      refresh();
    } catch (err) {
      pushError(err);
    }
  };

  /**
   * Arrastar uma ocorrência.
   *
   * A pergunta "só esta ou a série?" é respondida aqui e uma vez: o backend
   * SEMPRE move só a ocorrência (a regra não se reescreve — ver o
   * `move_occurrence_with_event`). O que falta é o usuário saber disso, e o
   * lugar de contar é depois de acontecer: um diálogo antes de cada arrasto
   * transformaria o gesto mais rápido da tela em dois cliques.
   */
  const onMove = async (o: Occurrence, newStart: number) => {
    try {
      await moveEvent(o.eventId, o.startsAt, newStart);
      refresh();
      if (o.isRecurring) {
        push("success", `Só esta ocorrência foi remarcada para ${hhmm(newStart)} — a série segue igual.`);
      }
    } catch (err) {
      pushError(err);
    }
  };

  const onResize = async (o: Occurrence, newEnd: number) => {
    try {
      await resizeEvent(o.eventId, o.startsAt, newEnd);
      refresh();
    } catch (err) {
      pushError(err);
    }
  };

  const onDelete = async (o: Occurrence) => {
    try {
      await deleteEvent(o.eventId);
      setOpened(null);
      refresh();
    } catch (err) {
      pushError(err);
    }
  };

  const onCancelOne = async (o: Occurrence) => {
    try {
      await cancelOccurrence(o.eventId, o.startsAt);
      setOpened(null);
      refresh();
    } catch (err) {
      pushError(err);
    }
  };

  /* ===== teclado ===== */

  const step = (n: number) => {
    setAnchor((a) => (view === "month" ? addMonths(a, n) : addDays(a, view === "week" ? n * 7 : n)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      ) {
        return;
      }
      // `G` já foi pressionado: a próxima tecla é do chord global. Sem esta
      // guarda, `G`+`T` iria para a Timeline E puxaria o calendário para hoje.
      if (isChordPending() || e.ctrlKey || e.metaKey || e.altKey) return;
      // Um modal aberto é dono do teclado: `M` ali é para digitar.
      if (draft || opened) return;

      switch (e.key.toLowerCase()) {
        case "t":
          setAnchor(toDay(new Date()));
          break;
        case "arrowleft":
          step(-1);
          break;
        case "arrowright":
          step(1);
          break;
        case "m":
          setView("month");
          break;
        case "w":
          setView("week");
          break;
        case "d":
          setView("day");
          break;
        case "n": {
          // O `N` cria no slot focado: a próxima hora cheia do dia selecionado,
          // que é o que "novo evento" quer dizer quando não há mouse.
          const day = selected ?? anchor;
          // `fromDay`, nunca `new Date(day)`: uma string 'AAAA-MM-DD' é parseada
          // como meia-noite UTC, que em UTC-3 é 21h do dia ANTERIOR — o `N`
          // criava o evento um dia antes do selecionado. Ver ADR-0097.
          const at = fromDay(day);
          at.setHours(new Date().getHours() + 1, 0, 0, 0);
          setDraft({ startsAt: at.getTime(), endsAt: at.getTime() + 3_600_000 });
          break;
        }
        default:
          return;
      }
      e.preventDefault();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ===== o que a grade do mês desenha ===== */

  const itemsByDay = useMemo(() => {
    const map = new Map<string, DayItem[]>();
    for (const o of occurrences) {
      const list = map.get(o.day) ?? [];
      list.push({
        id: occurrenceKey(o),
        title: o.title,
        colour: colourOf(o.areaId),
        timeLabel: o.allDay ? null : hhmm(o.startsAt),
        conflicted: conflicted.has(occurrenceKey(o)),
      });
      map.set(o.day, list);
    }
    return map;
  }, [occurrences, colourOf, conflicted]);

  const byKey = useMemo(
    () => new Map(occurrences.map((o) => [occurrenceKey(o), o])),
    [occurrences],
  );

  const weekCount = occurrences.filter((o) => !o.allDay).length;

  return (
    <div className="nx-page nx-enter flex h-full flex-col overflow-hidden">
      {/* ===== header ===== */}
      <header className="flex flex-wrap items-end justify-between gap-3 px-6 pt-5 pb-4">
        <div>
          <h1 className="text-[26px] leading-none font-semibold tracking-tight text-[var(--text-primary)] first-letter:uppercase">
            {monthLabel(anchor)}
          </h1>
          <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">
            <CountUp to={weekCount} /> {weekCount === 1 ? "compromisso" : "compromissos"}
            {conflicts.length > 0 && (
              <>
                {" · "}
                <span className="text-[var(--warning)]">
                  {conflicts.length} {conflicts.length === 1 ? "choque" : "choques"}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5">
            <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => step(-1)} aria-label="Anterior" />
            <button
              onClick={() => setAnchor(toDay(new Date()))}
              className="h-7 px-2 text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Hoje
            </button>
            <Button variant="ghost" size="sm" icon={ChevronRight} onClick={() => step(1)} aria-label="Próximo" />
          </div>

          <div className="flex items-center gap-0.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-0.5">
            {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cx(
                  "rounded-full px-3 py-1 text-[12px] font-medium transition-colors duration-[var(--dur-fast)]",
                  view === v
                    ? "bg-[color-mix(in_srgb,var(--accent)_20%,transparent)] text-[var(--text-primary)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
                )}
              >
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>

          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            onClick={() => {
              // Mesma armadilha do atalho `N`: dia local, não meia-noite UTC.
              const at = fromDay(selected ?? anchor);
              at.setHours(new Date().getHours() + 1, 0, 0, 0);
              setDraft({ startsAt: at.getTime(), endsAt: at.getTime() + 3_600_000 });
            }}
          >
            Novo
          </Button>
        </div>
      </header>

      {/* ===== a grade ===== */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pb-5">
        {view === "month" ? (
          <MonthGrid
            anchor={anchor}
            today={today}
            itemsByDay={itemsByDay}
            selected={selected}
            onSelectDay={(day) => {
              setSelected(day);
              // Um dia com mais do que cabe abre o popover; a grade já mostra o
              // "+N" e o clique é o pedido de ver o resto. O limite vem da
              // GRADE (`MAX_VISIBLE`), não de um 3 escrito aqui: era essa cópia
              // que deixava o dia com exatamente 3 esconder um em silêncio.
              const items = itemsByDay.get(day) ?? [];
              if (items.length > MAX_VISIBLE) setOverflowDay(day);
            }}
            onOpenItem={(id) => setOpened(byKey.get(id) ?? null)}
          />
        ) : (
          <TimeGrid
            days={days}
            today={today}
            nowMs={nowMs}
            occurrences={occurrences}
            conflicted={conflicted}
            colourOf={colourOf}
            onCreate={(d: DraftBlock) => setDraft({ startsAt: d.startsAt, endsAt: d.endsAt })}
            onMove={onMove}
            onResize={onResize}
            onOpen={setOpened}
          />
        )}

        <footer className="flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
          <span>
            <Kbd>T</Kbd> hoje
          </span>
          <span>
            <Kbd>←</Kbd> <Kbd>→</Kbd> navega
          </span>
          <span>
            <Kbd>M</Kbd> <Kbd>W</Kbd> <Kbd>D</Kbd> visão
          </span>
          <span>
            <Kbd>N</Kbd> novo
          </span>
          {view !== "month" && <span className="ml-auto">Arraste para criar, mover ou esticar</span>}
        </footer>
      </div>

      {overflowDay && (
        <DayOverflow
          day={overflowDay}
          occurrences={occurrences.filter((o) => o.day === overflowDay)}
          colourOf={colourOf}
          onOpen={(o) => {
            setOverflowDay(null);
            setOpened(o);
          }}
          onClose={() => setOverflowDay(null)}
        />
      )}

      <EventModal
        draft={draft}
        existing={opened}
        areas={areas.filter((a) => !a.archivedAt)}
        onCreate={onCreate}
        onDelete={onDelete}
        onCancelOccurrence={onCancelOne}
        onClose={() => {
          setDraft(null);
          setOpened(null);
        }}
      />
    </div>
  );
}

/**
 * `areaId → cor`, sem um hook por item.
 *
 * O `useSphereColor` resolve UMA Esfera e é o lugar certo para um card. Aqui a
 * pergunta é feita ~40 vezes por render (uma por bloco), e um hook não pode ser
 * chamado em laço. Isto reusa o mesmo cache do TanStack Query — a chave
 * `["areas","all"]` é a mesma — e devolve a função.
 */
function useColourOf(): (areaId: string | null) => string {
  const { data: areas } = useQuery({
    queryKey: ["areas", "all"],
    queryFn: () => listAreas(true),
    staleTime: 5 * 60_000,
  });

  return useMemo(() => {
    const map = new Map((areas ?? []).map((a) => [a.id, a.color]));
    // O fallback é o mesmo do `useSphereColor`: sem Esfera é neutro, não erro.
    return (areaId: string | null) => (areaId && map.get(areaId)) || "var(--accent)";
  }, [areas]);
}

/** O dia inteiro de uma célula que não coube — o que o "+N" abre. */
function DayOverflow({
  day,
  occurrences,
  colourOf,
  onOpen,
  onClose,
}: {
  day: string;
  occurrences: Occurrence[];
  colourOf: (areaId: string | null) => string;
  onOpen: (o: Occurrence) => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} size="sm">
      <div className="p-4">
          <header className="mb-3 flex items-center gap-2">
            <CalendarDays size={14} className="text-[var(--text-tertiary)]" />
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              {/* `fromDay` e não `new Date(day)`: era isto que fazia o popover do
                  dia 30 se anunciar como "29 de julho" (ADR-0097). */}
              {fromDay(day).getDate() + " de " + monthLabel(day).split(" de ")[0]}
            </h3>
            <span className="tabular ml-auto text-[11px] text-[var(--text-tertiary)]">
              {occurrences.length}
            </span>
          </header>

          <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
            {occurrences.map((o) => (
              <button
                key={occurrenceKey(o)}
                onClick={() => onOpen(o)}
                style={{ "--sphere": colourOf(o.areaId) } as React.CSSProperties}
                className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)] px-2.5 py-2 text-left hover:bg-[color-mix(in_srgb,var(--sphere)_20%,transparent)]"
              >
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: "var(--sphere)" }}
                />
                <span className="tabular shrink-0 text-[10px] text-[var(--text-tertiary)]">
                  {o.allDay ? "dia" : hhmm(o.startsAt)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">
                  {o.title}
                </span>
              </button>
            ))}
          </div>
      </div>
    </Modal>
  );
}
