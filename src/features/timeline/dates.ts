/**
 * As datas da Timeline, em pt-BR. Puro: sem React, sem IPC.
 *
 * O `day` é sempre `'YYYY-MM-DD'` no fuso local — a mesma regra do resto do
 * NEXUS (ver `calendar/grid.ts`). A aritmética de calendário mora lá; aqui ficam
 * só os rótulos que a Timeline mostra.
 */

import { addDays, fromDay, toDay } from "../calendar/grid";

export const MONTHS_LONG = [
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

export const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const WEEKDAYS_LONG = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

/** `(2026, 7)` → `'2026-07'`. */
export function monthKey(year: number, month1: number): string {
  return `${year}-${String(month1).padStart(2, "0")}`;
}

/** `'2026-07'` → os limites `['2026-07-01', '2026-07-31']` da visão MÊS. */
export function monthBounds(month: string): [string, string] {
  return [`${month}-01`, `${month}-31`];
}

/** `julho` (mês 1..12). */
export function monthNameLong(month1: number): string {
  return MONTHS_LONG[month1 - 1] ?? "";
}

/** `jul` (mês 1..12). */
export function monthNameShort(month1: number): string {
  return MONTHS_SHORT[month1 - 1] ?? "";
}

/**
 * O cabeçalho de um dia no feed: "17 de julho, sexta-feira".
 *
 * Hoje e ontem ganham nome próprio — é como um humano se orienta na própria
 * história antes de recorrer à data cheia.
 */
export function dayHeading(day: string): string {
  const d = fromDay(day);
  const dayMonth = `${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}`;
  const today = toDay(new Date());
  if (day === today) return `Hoje · ${dayMonth}`;
  if (day === addDays(today, -1)) return `Ontem · ${dayMonth}`;
  return `${dayMonth}, ${WEEKDAYS_LONG[d.getDay()]}`;
}

/** "14:30" — a hora local de um instante em epoch ms. */
export function timeOf(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}
