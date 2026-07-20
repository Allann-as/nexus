/**
 * O calendário do NEXUS (v1.2, fase A5).
 *
 * Por que existe: todo campo de data do app era `<input type="date">`, e o
 * dropdown que o Windows abre por baixo dele não é nosso — fundo branco, fonte
 * do sistema, cantos retos. Num app que controla cada pixel, era o único lugar
 * onde a plataforma vazava para dentro da tela. Em uso real foi assim que o dono
 * descreveu: destoa de tudo.
 *
 * O contrato é o MESMO do input nativo que ele substitui, de propósito — `value`
 * e `onChange` falam `'YYYY-MM-DD'`, e `min`/`max` recortam a faixa. Trocar um
 * campo é trocar a tag; nenhuma tela precisa aprender um formato novo.
 *
 * Regra de ouro do arquivo: **'YYYY-MM-DD' é um dia LOCAL** (§1 do DATA_MODEL).
 * `new Date('2026-07-20')` seria parseado como UTC e, a oeste de Greenwich,
 * voltaria dia 19 — o bug clássico que faz um aporte de hoje cair ontem. Por
 * isso toda conversão aqui passa por `parseDay`/`formatDay`, que montam a data
 * pelos componentes, e nunca pela string.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import { cx } from "./primitives";

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** Semana de SEGUNDA, como a semana perfeita (ADR-0059) e o calendário. */
const WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"];

/** 'YYYY-MM-DD' -> Date LOCAL. Inválido ou vazio -> null. */
function parseDay(day: string | null | undefined): Date | null {
  if (!day) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date LOCAL -> 'YYYY-MM-DD'. */
function formatDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "20 de julho de 2026" — o rótulo do botão fechado. */
function humanize(d: Date): string {
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

/**
 * As 42 células da grade (6 semanas fixas).
 *
 * Seis linhas SEMPRE, mesmo quando o mês cabe em cinco: com altura variável a
 * grade pula de tamanho ao trocar de mês e o rodapé dança debaixo do cursor. É a
 * mesma decisão da grade do mês no Calendário (M3).
 */
function gridOf(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  // getDay(): 0=domingo. Queremos 0=segunda, então domingo vira 6.
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
  return Array.from({ length: 42 }, (_, i) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Escolher data",
  clearable = false,
  className,
  ariaLabel,
}: {
  /** 'YYYY-MM-DD' ou null/"" quando vazio. */
  value: string | null;
  /** Recebe 'YYYY-MM-DD', ou null quando o usuário limpa. */
  onChange: (day: string | null) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  /** Mostra "Limpar". Só faz sentido onde a data é opcional. */
  clearable?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseDay(value), [value]);
  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  // O mês visível. Abre no mês da data escolhida; sem data, no mês de hoje.
  const [cursor, setCursor] = useState(() => selected ?? today);
  useEffect(() => {
    if (open) setCursor(selected ?? today);
  }, [open, selected, today]);

  const root = useRef<HTMLDivElement>(null);

  // Fechar: Esc e clique fora. Sem isso o painel fica preso aberto atrás de uma
  // modal, que é o jeito mais rápido de um popover virar um bug de layout.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const minDay = parseDay(min);
  const maxDay = parseDay(max);
  const outOfRange = (d: Date) =>
    (minDay !== null && d < minDay) || (maxDay !== null && d > maxDay);

  const pick = (d: Date) => {
    if (outOfRange(d)) return;
    onChange(formatDay(d));
    setOpen(false);
  };

  const days = useMemo(() => gridOf(cursor), [cursor]);
  const sameDay = (a: Date, b: Date | null) =>
    b !== null && a.getTime() === b.getTime();

  return (
    <div ref={root} className={cx("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel ?? "Escolher data"}
        aria-expanded={open}
        className={cx(
          "flex h-9 w-full items-center gap-2 rounded-[var(--radius-md)] border px-3 text-left text-[13px] outline-none transition-colors",
          "border-[var(--border-subtle)] bg-[var(--bg-base)]",
          open
            ? "border-[var(--sphere)]"
            : "hover:border-[color-mix(in_srgb,var(--sphere)_45%,var(--border-subtle))]",
          selected ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]",
        )}
      >
        <CalendarDays size={14} className="shrink-0 text-[var(--text-tertiary)]" />
        <span className="tabular truncate">
          {selected ? humanize(selected) : placeholder}
        </span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1.5 w-[268px] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-raised)] p-3 shadow-[var(--shadow-float)]"
          role="dialog"
          aria-label="Calendário"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Mês anterior"
              onClick={() =>
                setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
              }
              className="rounded-[var(--radius-sm)] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-[12.5px] font-medium text-[var(--text-primary)]">
              {MONTHS[cursor.getMonth()]} de {cursor.getFullYear()}
            </span>
            <button
              type="button"
              aria-label="Próximo mês"
              onClick={() =>
                setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
              }
              className="rounded-[var(--radius-sm)] p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w, i) => (
              <span
                key={i}
                className="pb-1 text-center text-[10px] tracking-[0.08em] text-[var(--text-tertiary)] uppercase"
              >
                {w}
              </span>
            ))}
            {days.map((d) => {
              const outside = d.getMonth() !== cursor.getMonth();
              const disabled = outOfRange(d);
              const isSel = sameDay(d, selected);
              const isToday = sameDay(d, today);
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(d)}
                  aria-current={isToday ? "date" : undefined}
                  className={cx(
                    "tabular flex h-8 items-center justify-center rounded-[var(--radius-sm)] text-[12.5px] transition-colors",
                    disabled && "cursor-not-allowed opacity-25",
                    !disabled && !isSel && "hover:bg-[color-mix(in_srgb,var(--sphere)_18%,transparent)]",
                    isSel
                      ? "bg-[var(--sphere)] font-semibold text-[var(--bg-base)]"
                      : outside
                        ? "text-[var(--text-tertiary)]"
                        : "text-[var(--text-primary)]",
                    // Hoje sem estar selecionado: um anel, não um preenchimento —
                    // "hoje" é referência, "selecionado" é a escolha. Preencher os
                    // dois faria a tela ter duas respostas para a mesma pergunta.
                    isToday && !isSel && "ring-1 ring-[var(--sphere)] ring-inset",
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
            <button
              type="button"
              onClick={() => pick(today)}
              disabled={outOfRange(today)}
              className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Hoje
            </button>
            {clearable && (
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-base)] hover:text-[var(--text-primary)]"
              >
                Limpar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
