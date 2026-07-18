/**
 * Formatação compartilhada dos Estudos — uma fonte só para minutos e horas, para
 * o painel, os cards de matéria e as estatísticas não divergirem no jeito de
 * dizer "2 h 30 min".
 */

/** Minutos → "2 h 30 min", "45 min" ou "1 h". Zero vira "0 min". */
export function formatMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  if (rest === 0) return `${h} h`;
  return `${h} h ${rest} min`;
}

/** Minutos → horas com uma casa, para o número-herói ("4,5"). */
export function toHours(min: number): number {
  return Math.round((min / 60) * 10) / 10;
}

/** A hora do dia (0–23) num rótulo curto: "21h". */
export function hourLabel(h: number): string {
  return `${h}h`;
}

/** "2026-07-18" → "18 jul", para as datas curtas das listas. */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  const months = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  const mi = Number(m) - 1;
  if (mi < 0 || mi > 11 || !d) return day;
  return `${Number(d)} ${months[mi]}`;
}
