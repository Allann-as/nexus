/**
 * As segundas-feiras de um ano — a régua horizontal da faixa da Semana Perfeita.
 *
 * Mora fora do componente para poder ser testada sem montar React: a função é
 * pequena mas tem uma borda de verdade — o dia da semana em que cai 1º de
 * janeiro decide qual é a primeira segunda do ano, e o caso "1º de janeiro JÁ é
 * segunda" é o que um `(8 - dow) % 7` ingênuo erra por sete dias.
 */

/** `Date` local → `'AAAA-MM-DD'`, sem passar por UTC. */
export function toDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Toda segunda-feira cujo ano é `year` — as mesmas semanas que o backend indexa
 * (ele filtra por `week_start.year() == year`).
 *
 * `new Date(y, 0, 1)` é local POR CONSTRUÇÃO. Nunca `new Date("2026-01-01")`,
 * que o ECMAScript parseia como meia-noite UTC e que em Brasília volta como 21h
 * do dia 31 de dezembro — o defeito que custou o ADR-0097.
 */
export function mondaysOf(year: number): string[] {
  const out: string[] = [];
  const d = new Date(year, 0, 1);
  const dow = d.getDay(); // 0 = domingo, 1 = segunda
  d.setDate(d.getDate() + (dow === 0 ? 1 : (8 - dow) % 7));
  while (d.getFullYear() === year) {
    out.push(toDay(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}
