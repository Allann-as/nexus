/**
 * O mês de um check-in de competência, em 'YYYY-MM' local.
 *
 * O backend fala 'YYYY-MM' e RECUSA um mês futuro (ADR-0037). Estas funções são
 * a mesma verdade do lado do frontend: o mês corrente vem do relógio LOCAL (nada
 * de `toISOString`, que puxaria para UTC e viraria o mês errado na virada), e o
 * passo para trás nunca passa do mês de hoje.
 */

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

/** O mês corrente em 'YYYY-MM', pelo relógio local. */
export function currentMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 'YYYY-MM' → "julho" (só o nome; o cartão já vive no presente). */
export function monthName(month: string): string {
  const m = Number(month.slice(5, 7));
  return MONTHS[m - 1] ?? month;
}

/** 'YYYY-MM' → "julho de 2026" (o rótulo completo, para a modal). */
export function monthLabel(month: string): string {
  return `${monthName(month)} de ${month.slice(0, 4)}`;
}

/** Anda `delta` meses a partir de 'YYYY-MM'. */
export function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return currentMonth(new Date(y, m - 1 + delta, 1));
}
