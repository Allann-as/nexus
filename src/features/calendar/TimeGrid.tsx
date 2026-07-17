/**
 * A grade de horas: a semana e o dia, com timeblocking.
 *
 * Apresentação + gesto. Ela não chama IPC: recebe as ocorrências e devolve o que
 * a mão do usuário fez (`onCreate`, `onMove`, `onResize`). Quem escreve é a
 * tela, num lugar só — assim o "só esta ocorrência ou a série?" não se
 * multiplica por três gestos.
 *
 * # Por que Pointer Events, e não mouse/touch
 *
 * `setPointerCapture` é o que faz o arrasto sobreviver a sair da coluna: sem
 * ele, mover o mouse rápido para fora do bloco entrega o `pointermove` a outro
 * elemento e o arrasto congela no meio. Com captura, o alvo original recebe o
 * gesto inteiro até o `pointerup` — inclusive fora da janela.
 */

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { cx } from "../../design-system/primitives";
import type { Occurrence } from "../../lib/ipc";
import {
  dayEndMs,
  dayStartMs,
  durationLabel,
  fractionOfDay,
  hhmm,
  instantAt,
  snapMs,
  WEEKDAY_SHORT,
} from "./grid";
import { layoutColumns } from "./layout";

/** O passo do arrasto. 30min é o que a §2 pede e o que a régua desenha. */
const SLOT_MIN = 30;

/** A altura de uma hora. Menos que isto e um evento de 30min vira uma tira. */
const HOUR_PX = 52;

/**
 * A hora em que a grade abre por padrão: 07h.
 *
 * O resto do dia existe e rola — a coluna tem 24h de altura de verdade. O que
 * esta constante faz é escolher para onde a rolagem aponta na montagem: abrir às
 * 00h mostraria sete horas de nada a quem só quer ver a tarde.
 */
const FIRST_VISIBLE_HOUR = 7;

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** O que a grade devolve quando o usuário arrasta numa área vazia. */
export interface DraftBlock {
  day: string;
  startsAt: number;
  endsAt: number;
}

/** O gesto em curso. `null` = a mão está parada. */
type Drag =
  | { kind: "create"; day: string; anchorMs: number; currentMs: number }
  | { kind: "move"; occurrence: Occurrence; day: string; startsAt: number }
  | { kind: "resize"; occurrence: Occurrence; endsAt: number };

/**
 * A hora em que a grade abre.
 *
 * 07h na maior parte do dia — mas nunca DEPOIS de agora. Quem abre o app às 4h
 * da manhã veria a grade rolada para as 7h e a linha do "agora" fora da tela,
 * acima: o app estaria escondendo justamente o instante em que ele está. Uma
 * hora de folga antes para o bloco que está acontecendo caber inteiro.
 *
 * Livre e testável: a regra é uma conta sobre o relógio, e ela não precisa de
 * uma tela montada para ser conferida.
 */
export function openAtHour(nowMs: number): number {
  const hour = new Date(nowMs).getHours();
  return Math.max(0, Math.min(FIRST_VISIBLE_HOUR, hour - 1));
}

export function TimeGrid({
  days,
  today,
  nowMs,
  occurrences,
  conflicted,
  colourOf,
  onCreate,
  onMove,
  onResize,
  onOpen,
}: {
  /** 7 dias (semana) ou 1 (dia). A grade não sabe a diferença. */
  days: string[];
  today: string;
  /** O instante da linha "agora". Vem de fora: a grade não tem relógio. */
  nowMs: number;
  occurrences: Occurrence[];
  conflicted: Set<string>;
  colourOf: (areaId: string | null) => string;
  onCreate: (draft: DraftBlock) => void;
  onMove: (occurrence: Occurrence, newStart: number) => void;
  onResize: (occurrence: Occurrence, newEnd: number) => void;
  onOpen: (occurrence: Occurrence) => void;
}) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Rola até a primeira hora visível uma vez, na montagem. `useState` com
  // inicializador e não `useEffect`: um efeito rolaria de novo a cada mudança de
  // semana, arrancando a rolagem da mão de quem estava olhando as 22h.
  const [scrolled, setScrolled] = useState(false);
  const attachScroller = (el: HTMLDivElement | null) => {
    scroller.current = el;
    if (el && !scrolled) {
      el.scrollTop = openAtHour(nowMs) * HOUR_PX;
      setScrolled(true);
    }
  };

  const allDay = occurrences.filter((o) => o.allDay);
  const timed = occurrences.filter((o) => !o.allDay);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      {/* ===== cabeçalho: os dias ===== */}
      <div
        className="grid border-b border-[var(--border-subtle)]"
        style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}
      >
        <div />
        {days.map((day) => (
          <DayHeader key={day} day={day} isToday={day === today} />
        ))}
      </div>

      {/* ===== a faixa de dia inteiro ===== */}
      {allDay.length > 0 && (
        <div
          className="grid border-b border-[var(--border-subtle)] bg-[var(--bg-base)]"
          style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}
        >
          <div className="py-1 pr-2 text-right text-[9px] tracking-wider text-[var(--text-tertiary)] uppercase">
            dia
          </div>
          {days.map((day) => (
            <div key={day} className="flex flex-col gap-0.5 border-l border-[var(--border-subtle)] p-1">
              {allDay
                .filter((o) => o.day === day)
                .map((o) => (
                  <button
                    key={`${o.eventId}@${o.startsAt}`}
                    onClick={() => onOpen(o)}
                    style={{ "--sphere": colourOf(o.areaId) } as React.CSSProperties}
                    className="truncate rounded-[4px] bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)] px-1.5 py-0.5 text-left text-[10px] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--sphere)_30%,transparent)]"
                  >
                    {o.title}
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* ===== a grade de horas ===== */}
      <div ref={attachScroller} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `56px repeat(${days.length}, 1fr)`,
            height: 24 * HOUR_PX,
          }}
        >
          {/* a régua */}
          <div className="relative">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 text-[10px] text-[var(--text-tertiary)] tabular"
                style={{ top: h * HOUR_PX }}
              >
                {h > 0 && `${String(h).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {days.map((day) => (
            <DayColumn
              key={day}
              day={day}
              isToday={day === today}
              nowMs={nowMs}
              occurrences={timed.filter((o) => o.day === day)}
              conflicted={conflicted}
              colourOf={colourOf}
              drag={drag}
              setDrag={setDrag}
              onCreate={onCreate}
              onMove={onMove}
              onResize={onResize}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayHeader({ day, isToday }: { day: string; isToday: boolean }) {
  const d = new Date(dayStartMs(day));
  return (
    <div className="border-l border-[var(--border-subtle)] py-2 text-center">
      <div className="text-[10px] tracking-[0.1em] text-[var(--text-tertiary)] uppercase">
        {WEEKDAY_SHORT[d.getDay()]}
      </div>
      <div
        className={cx(
          "tabular mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-[13px]",
          isToday
            ? "bg-[var(--accent)] font-semibold text-white"
            : "text-[var(--text-secondary)]",
        )}
      >
        {d.getDate()}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  isToday,
  nowMs,
  occurrences,
  conflicted,
  colourOf,
  drag,
  setDrag,
  onCreate,
  onMove,
  onResize,
  onOpen,
}: {
  day: string;
  isToday: boolean;
  nowMs: number;
  occurrences: Occurrence[];
  conflicted: Set<string>;
  colourOf: (areaId: string | null) => string;
  drag: Drag | null;
  setDrag: (d: Drag | null) => void;
  onCreate: (draft: DraftBlock) => void;
  onMove: (occurrence: Occurrence, newStart: number) => void;
  onResize: (occurrence: Occurrence, newEnd: number) => void;
  onOpen: (occurrence: Occurrence) => void;
}) {
  const column = useRef<HTMLDivElement>(null);

  /** Onde o ponteiro está, em epoch, já alinhado ao slot. */
  const msAt = (clientY: number): number => {
    const box = column.current?.getBoundingClientRect();
    if (!box) return dayStartMs(day);
    const fraction = (clientY - box.top) / box.height;
    return snapMs(instantAt(day, fraction), SLOT_MIN, day);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Só o botão principal cria: o direito é do menu de contexto, e o do meio
    // cola no Linux.
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = msAt(e.clientY);
    setDrag({ kind: "create", day, anchorMs: at, currentMs: at + SLOT_MIN * 60_000 });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const at = msAt(e.clientY);

    if (drag.kind === "create" && drag.day === day) {
      setDrag({ ...drag, currentMs: at });
    } else if (drag.kind === "move") {
      // O bloco segue o ponteiro pela BORDA DE CIMA. Seguir pelo ponto onde a
      // mão pegou seria mais fiel, mas exigiria guardar o offset do clique — e
      // com slots de 30min a diferença é invisível.
      setDrag({ ...drag, day, startsAt: at });
    } else if (drag.kind === "resize") {
      // A borda de baixo nunca passa por cima da de cima: um slot é o mínimo.
      const floor = drag.occurrence.startsAt + SLOT_MIN * 60_000;
      setDrag({ ...drag, endsAt: Math.max(floor, at) });
    }
  };

  const onPointerUp = () => {
    if (!drag) return;

    if (drag.kind === "create" && drag.day === day) {
      const [a, b] = [drag.anchorMs, drag.currentMs].sort((x, y) => x - y);
      // Um clique seco (sem arrastar) vale um slot: o gesto mais rápido de
      // criar não pode exigir precisão de pixel.
      const endsAt = b - a < SLOT_MIN * 60_000 ? a + SLOT_MIN * 60_000 : b;
      onCreate({ day, startsAt: a, endsAt });
    } else if (drag.kind === "move") {
      if (drag.startsAt !== drag.occurrence.startsAt) {
        onMove(drag.occurrence, drag.startsAt);
      }
    } else if (drag.kind === "resize") {
      if (drag.endsAt !== drag.occurrence.endsAt) {
        onResize(drag.occurrence, drag.endsAt);
      }
    }
    setDrag(null);
  };

  const placed = layoutColumns(occurrences);
  const preview = drag?.kind === "create" && drag.day === day ? drag : null;

  return (
    <div
      ref={column}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      className="relative border-l border-[var(--border-subtle)]"
    >
      {/* As linhas da grade. `pointer-events-none`: elas são régua, não alvo —
          um clique tem que chegar à coluna, que é quem sabe converter Y em hora. */}
      <div className="pointer-events-none absolute inset-0">
        {HOURS.map((h) => (
          <div
            key={h}
            className={cx(
              "absolute inset-x-0 border-t",
              // A meia-hora é mais fraca que a hora cheia: a régua tem que ser
              // legível sem competir com os blocos.
              "border-[var(--border-subtle)]",
            )}
            style={{ top: h * HOUR_PX }}
          />
        ))}
        {HOURS.map((h) => (
          <div
            key={`half-${h}`}
            className="absolute inset-x-0 border-t border-dashed border-[color-mix(in_srgb,var(--border-subtle)_50%,transparent)]"
            style={{ top: h * HOUR_PX + HOUR_PX / 2 }}
          />
        ))}
      </div>

      {placed.map(({ item, column: col, columns }) => {
        const isDragging =
          drag?.kind !== "create" &&
          drag?.occurrence.eventId === item.eventId &&
          drag?.occurrence.startsAt === item.startsAt;

        const startsAt =
          isDragging && drag?.kind === "move" ? drag.startsAt : item.startsAt;
        const endsAt =
          isDragging && drag?.kind === "move"
            ? drag.startsAt + (item.endsAt - item.startsAt)
            : isDragging && drag?.kind === "resize"
              ? drag.endsAt
              : item.endsAt;

        return (
          <EventBlock
            key={`${item.eventId}@${item.startsAt}`}
            occurrence={item}
            day={day}
            startsAt={startsAt}
            endsAt={endsAt}
            colour={colourOf(item.areaId)}
            conflicted={conflicted.has(`${item.eventId}@${item.startsAt}`)}
            dragging={isDragging}
            column={col}
            columns={columns}
            onGrab={(e, kind) => {
              // Sem isto o `pointerdown` sobe para a coluna e o gesto vira um
              // "criar evento" começando em cima do bloco que a mão pegou.
              e.stopPropagation();
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag(
                kind === "move"
                  ? { kind: "move", occurrence: item, day, startsAt: item.startsAt }
                  : { kind: "resize", occurrence: item, endsAt: item.endsAt },
              );
            }}
            onOpen={() => onOpen(item)}
          />
        );
      })}

      {/* o bloco fantasma do arrasto em área vazia */}
      {preview && <DraftPreview day={day} drag={preview} />}

      {isToday && <NowLine day={day} nowMs={nowMs} />}
    </div>
  );
}

/** A linha "agora", atravessando a coluna de hoje. */
function NowLine({ day, nowMs }: { day: string; nowMs: number }) {
  const top = fractionOfDay(nowMs, day) * 100;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
      style={{ top: `${top}%` }}
    >
      <div className="size-2 shrink-0 rounded-full bg-[var(--accent)]" />
      <div className="h-px flex-1 bg-[var(--accent)]" />
    </div>
  );
}

function DraftPreview({
  day,
  drag,
}: {
  day: string;
  drag: { anchorMs: number; currentMs: number };
}) {
  const [a, b] = [drag.anchorMs, drag.currentMs].sort((x, y) => x - y);
  const top = fractionOfDay(a, day) * 100;
  const height = Math.max(
    (Math.max(SLOT_MIN * 60_000, b - a) / (dayEndMs(day) - dayStartMs(day))) * 100,
    0.5,
  );

  return (
    <div
      className="pointer-events-none absolute inset-x-1 z-30 rounded-[6px] border border-dashed border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] px-1.5 py-1"
      style={{ top: `${top}%`, height: `${height}%` }}
    >
      <span className="tabular text-[10px] font-medium text-[var(--accent)]">
        {hhmm(a)} – {hhmm(Math.max(a + SLOT_MIN * 60_000, b))}
      </span>
    </div>
  );
}

function EventBlock({
  occurrence,
  day,
  startsAt,
  endsAt,
  colour,
  conflicted,
  dragging,
  column,
  columns,
  onGrab,
  onOpen,
}: {
  occurrence: Occurrence;
  day: string;
  startsAt: number;
  endsAt: number;
  colour: string;
  conflicted: boolean;
  dragging: boolean;
  column: number;
  columns: number;
  onGrab: (e: ReactPointerEvent<HTMLDivElement>, kind: "move" | "resize") => void;
  onOpen: () => void;
}) {
  const dayMs = dayEndMs(day) - dayStartMs(day);
  const top = fractionOfDay(startsAt, day) * 100;
  // O bloco não pode passar do fim da coluna: um evento das 23h às 1h é
  // desenhado até a meia-noite, e o resto dele pertence ao dia seguinte.
  const height = Math.max(((Math.min(endsAt, dayEndMs(day)) - startsAt) / dayMs) * 100, 1);

  // A largura é dividida pelo cluster de conflito; a folga de 2% deixa o de trás
  // aparecer por baixo, que é o que faz "dois às 15h" ser óbvio de relance.
  const width = 100 / columns;

  return (
    <div
      onPointerDown={(e) => onGrab(e, "move")}
      onDoubleClick={onOpen}
      style={
        {
          "--sphere": colour,
          top: `${top}%`,
          height: `${height}%`,
          left: `${column * width + 1}%`,
          width: `${width - 2}%`,
        } as React.CSSProperties
      }
      className={cx(
        "group absolute z-10 flex cursor-grab flex-col overflow-hidden rounded-[6px] border px-1.5 py-1 select-none",
        "bg-[color-mix(in_srgb,var(--sphere)_22%,var(--bg-surface))]",
        // O conflito é laranja na BORDA, não no fundo: o fundo é da Esfera, e
        // trocá-lo faria a cor mentir sobre de quem é o compromisso.
        conflicted
          ? "border-[var(--warning)]"
          : "border-[color-mix(in_srgb,var(--sphere)_45%,transparent)]",
        // Só `opacity` e `transform` animam (§6): a sombra fica fora do arrasto.
        dragging && "z-40 opacity-70",
      )}
      title={`${occurrence.title} · ${hhmm(startsAt)}–${hhmm(endsAt)}`}
    >
      <div className="flex items-center gap-1">
        <span className="tabular shrink-0 text-[9px] text-[var(--text-tertiary)]">
          {hhmm(startsAt)}
        </span>
        {occurrence.isRecurring && (
          <span
            aria-hidden
            className="size-1 shrink-0 rounded-full bg-[var(--sphere)]"
            title="Faz parte de uma série"
          />
        )}
      </div>
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-primary)]">
        {occurrence.title}
      </span>
      {height > 6 && (
        <span className="tabular text-[9px] text-[var(--text-tertiary)]">
          {durationLabel(endsAt - startsAt)}
        </span>
      )}

      {/* A alça de redimensionar: 6px na borda de baixo. Ela só aparece no hover
          para não competir com o conteúdo, mas o alvo existe sempre — um alvo
          que só nasce no hover é um alvo que o mouse nunca encontra. */}
      <div
        onPointerDown={(e) => onGrab(e, "resize")}
        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
      >
        <div className="mx-auto h-0.5 w-6 rounded-full bg-[var(--sphere)] opacity-0 transition-opacity group-hover:opacity-70" />
      </div>
    </div>
  );
}
