/**
 * Onde cada bloco é desenhado quando dois compromissos brigam pelo mesmo
 * horário.
 *
 * Puro e separado da tela pela mesma razão do `grid.ts`: isto é um algoritmo com
 * casos de canto (três eventos onde só dois se tocam, um evento longo cruzando
 * vários curtos), e testá-lo exige montar zero componentes.
 *
 * # A regra
 *
 * Blocos que se sobrepõem dividem a largura da coluna do dia. Quem NÃO se
 * sobrepõe a ninguém ocupa a largura inteira — um dia com 4 compromissos em
 * horários distintos não pode desenhar 4 tiras finas.
 *
 * O agrupamento é por CLUSTER e não por par: A das 9h às 11h, B das 10h às 12h e
 * C das 11h30 às 13h formam um grupo de três larguras, mesmo A e C não se
 * tocando. Se cada par decidisse sua largura, A e C ficariam com metade cada e
 * se sobreporiam entre si na tela.
 */

/** O mínimo que o layout precisa saber de um bloco. */
export interface Span {
  startsAt: number;
  endsAt: number;
}

export interface Placed<T> {
  item: T;
  /** A coluna dentro do cluster, de 0 a `columns - 1`. */
  column: number;
  /** Quantas colunas o cluster inteiro tem. É o divisor da largura. */
  columns: number;
}

/**
 * Meio-aberto, igual ao `domain::recurrence::overlaps` do Rust: quem termina às
 * 10h e quem começa às 10h NÃO se tocam. As duas regras têm que concordar, senão
 * o backend acusa um conflito que a tela desenha lado a lado — ou o contrário.
 */
function overlaps(a: Span, b: Span): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * Distribui os blocos em colunas.
 *
 * A ordem de entrada não importa: ela é normalizada por início. A saída segue a
 * ordem da entrada, para o React não perder a identidade das chaves.
 */
export function layoutColumns<T extends Span>(items: T[]): Placed<T>[] {
  // `index` preserva a posição original: a saída volta na ordem em que chegou,
  // mesmo o algoritmo precisando varrer por horário.
  const sorted = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.startsAt - b.item.startsAt || a.item.endsAt - b.item.endsAt);

  const out: Placed<T>[] = new Array(items.length);

  // Um cluster acumula enquanto algum bloco dele ainda estiver aberto. O fim do
  // cluster é o MAIOR fim visto até aqui, não o do último bloco: um evento das
  // 9h às 18h mantém o cluster aberto sobre todos os curtos que ele cruza.
  let cluster: { item: T; index: number; column: number }[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columns = cluster.reduce((max, c) => Math.max(max, c.column + 1), 0);
    for (const c of cluster) {
      out[c.index] = { item: c.item, column: c.column, columns };
    }
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const entry of sorted) {
    if (entry.item.startsAt >= clusterEnd && cluster.length > 0) {
      flush();
    }

    // A primeira coluna livre: um bloco reusa a coluna de quem já terminou, em
    // vez de abrir uma nova. Sem isto, 20 reuniões seguidas às segundas viram 20
    // colunas de 5% de largura cada.
    let column = 0;
    while (cluster.some((c) => c.column === column && overlaps(c.item, entry.item))) {
      column += 1;
    }

    cluster.push({ item: entry.item, index: entry.index, column });
    clusterEnd = Math.max(clusterEnd, entry.item.endsAt);
  }
  if (cluster.length > 0) flush();

  return out;
}
