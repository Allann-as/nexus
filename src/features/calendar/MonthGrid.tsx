/**
 * A grade do mês.
 *
 * Apresentação pura: ela recebe os dias e o que cai em cada um, e não sabe de
 * onde isso veio. Toda a aritmética é do `grid.ts` (testado sem tela); aqui só
 * mora o desenho.
 *
 * A grade tem altura fixa de 6 linhas — ver `monthGrid`. Um mês que encolhe para
 * 5 linhas faria a tela inteira pular a cada seta, e navegar meses em sequência
 * é exatamente o que se faz num calendário.
 */

import { cx } from "../../design-system/primitives";
import { isSameMonth, monthGrid, WEEKDAY_SHORT } from "./grid";

/** O que a grade precisa saber sobre um item para desenhá-lo. Nada além disso. */
export interface DayItem {
  id: string;
  title: string;
  /** A cor da Esfera dona. Já resolvida — a grade não faz lookup. */
  colour: string;
  /** `null` para um item de dia inteiro. */
  timeLabel: string | null;
  conflicted?: boolean;
}

export function MonthGrid({
  anchor,
  today,
  itemsByDay,
  selected,
  onSelectDay,
  onOpenItem,
}: {
  /** Qualquer dia do mês a desenhar. */
  anchor: string;
  today: string;
  itemsByDay: Map<string, DayItem[]>;
  selected: string | null;
  onSelectDay: (day: string) => void;
  onOpenItem: (id: string) => void;
}) {
  const days = monthGrid(anchor);

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="grid grid-cols-7 border-b border-[var(--border-subtle)]">
        {WEEKDAY_SHORT.map((w) => (
          <div
            key={w}
            className="py-2 text-center text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase"
          >
            {w}
          </div>
        ))}
      </div>

      {/* `grid-rows-6` fixo + `auto-rows-fr`: as seis linhas dividem a altura em
          partes iguais, então uma semana cheia não estica só a linha dela. */}
      <div className="grid grid-cols-7 grid-rows-6" style={{ height: 560 }}>
        {days.map((day) => (
          <DayCell
            key={day}
            day={day}
            outside={!isSameMonth(day, anchor)}
            isToday={day === today}
            isSelected={day === selected}
            items={itemsByDay.get(day) ?? []}
            onSelect={() => onSelectDay(day)}
            onOpenItem={onOpenItem}
          />
        ))}
      </div>
    </div>
  );
}

/** Quantos itens cabem numa célula antes do "+N". Acima disso vira mingau. */
const MAX_VISIBLE = 3;

function DayCell({
  day,
  outside,
  isToday,
  isSelected,
  items,
  onSelect,
  onOpenItem,
}: {
  day: string;
  outside: boolean;
  isToday: boolean;
  isSelected: boolean;
  items: DayItem[];
  onSelect: () => void;
  onOpenItem: (id: string) => void;
}) {
  const dayNumber = Number(day.slice(8));
  const hidden = items.length - MAX_VISIBLE;

  return (
    <div
      onClick={onSelect}
      className={cx(
        "group relative flex min-w-0 cursor-pointer flex-col gap-0.5 border-r border-b border-[var(--border-subtle)] p-1.5",
        "transition-colors duration-[var(--dur-fast)]",
        // As bordas do mês existem para a semana não ter buraco, mas elas não
        // são o assunto: ficam apagadas para o mês ainda ser um bloco visual.
        outside && "opacity-40",
        isSelected ? "bg-[color-mix(in_srgb,var(--sphere)_10%,transparent)]" : "hover:bg-[var(--bg-hover)]",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cx(
            "tabular grid size-6 place-items-center rounded-full text-[11px]",
            isToday
              ? "bg-[var(--accent)] font-semibold text-white"
              : outside
                ? "text-[var(--text-tertiary)]"
                : "text-[var(--text-secondary)]",
          )}
        >
          {dayNumber}
        </span>
        {items.length > 0 && (
          <span className="tabular text-[9px] text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100">
            {items.length}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
        {items.slice(0, MAX_VISIBLE).map((item) => (
          <button
            key={item.id}
            onClick={(e) => {
              // Sem isto o clique no item também selecionaria o dia, e abrir um
              // evento moveria a seleção por baixo do usuário.
              e.stopPropagation();
              onOpenItem(item.id);
            }}
            style={{ "--sphere": item.colour } as React.CSSProperties}
            className={cx(
              "flex w-full items-center gap-1 rounded-[4px] px-1 py-0.5 text-left",
              "transition-colors duration-[var(--dur-fast)]",
              "bg-[color-mix(in_srgb,var(--sphere)_14%,transparent)] hover:bg-[color-mix(in_srgb,var(--sphere)_26%,transparent)]",
            )}
            title={item.title}
          >
            {/* A bolinha carrega a cor; o texto usa token de texto. Cor em
                texto de 9px é ilegível, e a identidade já está na bolinha. */}
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: "var(--sphere)" }}
            />
            {item.timeLabel && (
              <span className="tabular shrink-0 text-[9px] text-[var(--text-tertiary)]">
                {item.timeLabel}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-primary)]">
              {item.title}
            </span>
            {item.conflicted && (
              <span
                className="size-1.5 shrink-0 rounded-full bg-[var(--warning)]"
                title="Conflito de horário"
              />
            )}
          </button>
        ))}

        {hidden > 0 && (
          <span className="px-1 text-[9px] text-[var(--text-tertiary)]">
            +{hidden}
          </span>
        )}
      </div>
    </div>
  );
}
