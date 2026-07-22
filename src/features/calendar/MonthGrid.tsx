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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="grid shrink-0 grid-cols-7 border-b border-[var(--border-subtle)]">
        {WEEKDAY_SHORT.map((w) => (
          <div
            key={w}
            className="py-2 text-center text-[10px] font-semibold tracking-[0.1em] text-[var(--text-tertiary)] uppercase"
          >
            {w}
          </div>
        ))}
      </div>

      {/* `grid-rows-6` fixo: as seis linhas dividem a altura em partes iguais,
          então uma semana cheia não estica só a linha dela.

          A altura era `560` no código — um número mágico que dava ~93px por
          linha, e 93px não comportam o cabeçalho do dia + dois compromissos + o
          "+N". O aviso de "tem mais coisa aqui" era ele próprio cortado pelo
          `overflow-hidden`, que é a mesma classe de defeito que ele existia para
          consertar. Agora a grade OCUPA a altura disponível (`flex-1`), então a
          célula cresce com a janela em vez de ficar presa a um número escrito
          uma vez. Ver ADR-0097. */}
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
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

/**
 * Quantos itens uma célula desenha antes do "+N".
 *
 * **Exportada de propósito**: o `CalendarScreen` decide com ela quando abrir o
 * popover do dia. Enquanto o número morava nos dois arquivos, os dois discordavam
 * — a grade cortava em 3 e a tela só abria o popover acima de 3, então um dia com
 * EXATAMENTE 3 compromissos escondia um sem "+N", sem popover e sem aviso. Um
 * número que duas telas precisam saber tem que ter um dono só (ADR-0097).
 *
 * E o valor é 2, não 3, porque é o que de fato CABE: a linha da grade tem ~93px
 * (560 ÷ 6), e o cabeçalho do dia mais três itens passam disso — o terceiro era
 * cortado pelo `overflow-hidden` enquanto a conta achava que ele estava visível.
 */
export const MAX_VISIBLE = 2;

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
        // `p-1` e não `p-1.5`: os 4px de folga a mais eram exatamente o que
        // faltava para o "+N" caber na célula (ADR-0097).
        "group relative flex min-w-0 cursor-pointer flex-col gap-0.5 border-r border-b border-[var(--border-subtle)] p-1",
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
            "tabular grid size-5 place-items-center rounded-full text-[10.5px]",
            isToday
              ? "bg-[var(--accent)] font-semibold text-white"
              : outside
                ? "text-[var(--text-tertiary)]"
                : "text-[var(--text-secondary)]",
          )}
        >
          {dayNumber}
        </span>
        {/* A contagem total morava aqui e só aparecia no HOVER — informação que
            só existe quando o mouse passa por cima é informação que não existe
            para quem está lendo o mês. Quem avisa que há mais é o "+N" abaixo,
            que é permanente e clicável. */}
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

      </div>

      {/* O "+N" fica FORA do contêiner que corta, como irmão `shrink-0`.
          Dentro dele, ele era a última linha de um bloco `overflow-hidden` e
          virava a primeira coisa a ser cortada — o aviso de "tem mais coisa
          aqui" sumindo pela mesma razão que ele existe para denunciar. Aqui a
          linha dele é garantida, e quem cede espaço são os itens (que é o que o
          `MAX_VISIBLE` já controla).

          E é BOTÃO, não rótulo: clicar pede a lista completa do dia. */}
      {hidden > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="shrink-0 rounded-[4px] px-1 text-left text-[9.5px] leading-[13px] font-medium text-[var(--text-tertiary)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          +{hidden} {hidden === 1 ? "outro" : "outros"}
        </button>
      )}
    </div>
  );
}
