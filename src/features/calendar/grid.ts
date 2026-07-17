/**
 * A aritmética do calendário. Pura: sem React, sem IPC, sem `Date.now()`.
 *
 * Módulo próprio porque data é onde todo calendário sangra — fuso, horário de
 * verão, semana que começa na segunda, mês que precisa de 6 linhas. Aqui isso é
 * testável sem montar tela nenhuma (`grid.test.ts`).
 *
 * # A regra que atravessa o arquivo: o dia é uma STRING
 *
 * `'YYYY-MM-DD'` no fuso local, igual ao resto do NEXUS (`habit_ticks.day`,
 * `event_occurrences.day`). Nunca um `Date` como chave.
 *
 * O motivo é o horário de verão. Um `Date` é um instante; "que dia é hoje" é uma
 * pergunta sobre o calendário do usuário. No dia em que o relógio adianta, um
 * "meia-noite + 24h" cai às 23h do mesmo dia — e um laço que soma 24h para
 * andar no calendário repete ou pula um dia, uma vez por ano, em produção.
 * Andar pelo campo `.getDate()` deixa o browser resolver o fuso.
 */

/** Domingo = 0 … sábado = 6 — igual ao `strftime('%w')` do SQLite e ao domínio. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** `'YYYY-MM-DD'` no fuso local. */
export function toDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * `'YYYY-MM-DD'` → `Date` à meia-noite LOCAL.
 *
 * `new Date('2026-07-17')` seria interpretado como UTC pelo ES: em Brasília,
 * isso volta como 21h do dia 16. O construtor de componentes é local por
 * definição, e é por isso que ele é usado aqui em vez do parser de string.
 */
export function fromDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** `day` + n dias, sem aritmética de milissegundos (ver o cabeçalho). */
export function addDays(day: string, n: number): string {
  const d = fromDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** `day` + n meses, grudando no último dia do mês curto — igual ao domínio. */
export function addMonths(day: string, n: number): string {
  const d = fromDay(day);
  const target = d.getMonth() + n;
  const wanted = d.getDate();
  d.setDate(1); // evita o overflow de 31/01 + 1 mês virar 03/03
  d.setMonth(target);
  d.setDate(Math.min(wanted, lastDayOfMonth(d.getFullYear(), d.getMonth())));
  return toDay(d);
}

export function lastDayOfMonth(year: number, month0: number): number {
  // Dia 0 do mês seguinte É o último dia deste. Vale para fevereiro bissexto
  // sem nenhuma regra de bissexto escrita à mão.
  return new Date(year, month0 + 1, 0).getDate();
}

/**
 * O domingo da semana de `day`.
 *
 * Domingo e não segunda: a grade do mês é desenhada com a semana começando no
 * domingo (padrão brasileiro), e o índice bate com o `weekday_index` do
 * domínio. O `week_start` do Rust usa SEGUNDA porque lá ele serve ao streak
 * semanal ("3x por semana"), que é outra pergunta.
 */
export function weekStart(day: string): string {
  const d = fromDay(day);
  d.setDate(d.getDate() - d.getDay());
  return toDay(d);
}

/**
 * A grade do mês: sempre 6 semanas × 7 dias = 42 células.
 *
 * Seis linhas SEMPRE, mesmo quando cinco bastariam. Um mês que muda de altura
 * conforme o calendário faz a tela inteira pular a cada seta — e o usuário
 * navega meses em sequência, então ele veria o salto o tempo todo. 42 células é
 * o teto real (31 dias começando no sábado ocupa 6 linhas), então a grade fixa
 * nunca corta nada.
 */
export function monthGrid(anchor: string): string[] {
  const d = fromDay(anchor);
  const first = toDay(new Date(d.getFullYear(), d.getMonth(), 1));
  const start = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Os 7 dias da semana de `anchor`, de domingo a sábado. */
export function weekGrid(anchor: string): string[] {
  const start = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** `day` pertence ao mesmo mês que `anchor`? (as bordas da grade não pertencem) */
export function isSameMonth(day: string, anchor: string): boolean {
  return day.slice(0, 7) === anchor.slice(0, 7);
}

/** Epoch ms da meia-noite local de `day` — a fronteira que o backend recebe. */
export function dayStartMs(day: string): number {
  return fromDay(day).getTime();
}

/** Epoch ms do fim do dia (exclusivo): a meia-noite do dia seguinte. */
export function dayEndMs(day: string): number {
  return dayStartMs(addDays(day, 1));
}

/**
 * A posição vertical de um instante dentro do dia, em fração de 0..1.
 *
 * É o que converte "14h30" na coordenada do bloco na coluna do dia. Um instante
 * fora do dia satura em 0 ou 1 em vez de sair da coluna: um evento que começou
 * ontem e termina hoje é desenhado a partir do topo, e não 300px acima da tela.
 */
export function fractionOfDay(ms: number, day: string): number {
  const start = dayStartMs(day);
  const span = dayEndMs(day) - start;
  return Math.max(0, Math.min(1, (ms - start) / span));
}

/**
 * O inverso do `fractionOfDay`: a fração da coluna vira um instante.
 *
 * É o que traduz "o usuário soltou o mouse a 40% da altura da coluna de terça"
 * em epoch. Sem saturar, de propósito: arrastar um bloco para baixo do fim do
 * dia é um gesto legítimo (o evento continua na madrugada seguinte), e é o
 * `snapMs` que decide o alinhamento, não esta função.
 */
export function instantAt(day: string, fraction: number): number {
  const start = dayStartMs(day);
  return start + Math.round(fraction * (dayEndMs(day) - start));
}

/**
 * Arredonda um instante para o slot mais próximo, a partir da MEIA-NOITE LOCAL
 * do dia dele.
 *
 * Não a partir do epoch: o epoch zero é meia-noite em Londres, e num fuso de
 * meia hora (Índia, Nepal — o NEXUS não escolhe onde é usado) todo slot sairia
 * torto. Ancorar no dia local faz "09:30" ser 09:30 em qualquer lugar.
 */
export function snapMs(ms: number, stepMin: number, day: string): number {
  const step = stepMin * 60_000;
  const base = dayStartMs(day);
  return base + Math.round((ms - base) / step) * step;
}

/** "14:30" — a hora local de um instante. */
export function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * "1h30" / "45min" — a duração de um bloco, como um humano a diria.
 *
 * Existe para o modal e o bloco não formatarem minutos cada um do seu jeito.
 */
export function durationLabel(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

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

/** "julho de 2026" — o título do mês. */
export function monthLabel(day: string): string {
  const d = fromDay(day);
  return `${MONTHS[d.getMonth()]} de ${d.getFullYear()}`;
}

export const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
