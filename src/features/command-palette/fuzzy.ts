/**
 * O casamento fuzzy da Command Palette.
 *
 * Módulo próprio, e não uma função escondida dentro do componente, por um
 * motivo prático: isto é lógica pura sobre strings e é a única coisa entre o
 * usuário e todo o resto do app. Aqui ela é testável sem React, sem DOM e sem
 * Tauri — ver `fuzzy.test.ts`.
 */

/**
 * Tira acento e caixa: 'saúde' e 'Saude' viram a mesma coisa.
 *
 * Sem isto, num app em português, a paleta é quase inútil: ninguém digita acento
 * numa caixa de busca, e 'calendario' NÃO casava 'Calendário' — o 'a' procurado
 * não é o 'á' do texto, são codepoints diferentes. O mesmo valia para 'saude',
 * 'financas' e 'habitos', ou seja, quase todo rótulo do produto.
 *
 * NFD separa a letra do diacrítico ('á' → 'a' + U+0301); o range U+0300–U+036F é
 * o bloco dos diacríticos combinantes, que então se joga fora.
 */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Fuzzy por subsequência: 'cal' casa 'Calendário', 'mp' casa 'Metas & Projetos'.
 *
 * Devolve uma DISTÂNCIA: menor é melhor, e `null` é "não casou". Cada buraco
 * entre duas letras casadas soma ponto, então um casamento consecutivo e no
 * começo vence um espalhado pelo fim.
 */
export function fuzzyScore(needle: string, haystack: string): number | null {
  if (!needle) return 0;
  const n = fold(needle);
  const h = fold(haystack);

  let score = 0;
  let hi = 0;
  let lastHit = -1;

  for (const ch of n) {
    const hit = h.indexOf(ch, hi);
    if (hit === -1) return null;
    score += hit - lastHit - 1; // penaliza buracos
    lastHit = hit;
    hi = hit + 1;
  }
  return score;
}
