/**
 * O contrato do layout de conflitos.
 *
 * Cada caso aqui é um desenho errado que já aconteceu em algum calendário: o
 * cluster que se parte no meio, o evento longo que some atrás dos curtos, as 20
 * tiras de 5% de largura. Nenhum deles quebra nada — eles só desenham errado, e
 * desenhar errado não levanta exceção.
 */

import { describe, expect, it } from "vitest";

import { layoutColumns, type Span } from "./layout";

/** Um bloco em horas do mesmo dia — `9, 11` é "das 9h às 11h". */
const at = (startsAt: number, endsAt: number): Span => ({ startsAt, endsAt });

describe("layoutColumns", () => {
  it("dá a largura inteira a quem não briga com ninguém", () => {
    // O caso comum e o mais fácil de estragar: um dia com 3 compromissos em
    // horários distintos não pode virar 3 tiras finas.
    const out = layoutColumns([at(9, 10), at(11, 12), at(14, 15)]);
    expect(out.map((p) => p.columns)).toEqual([1, 1, 1]);
    expect(out.map((p) => p.column)).toEqual([0, 0, 0]);
  });

  it("divide a largura entre dois que se sobrepõem", () => {
    const out = layoutColumns([at(9, 11), at(10, 12)]);
    expect(out.map((p) => p.columns)).toEqual([2, 2]);
    expect(out.map((p) => p.column)).toEqual([0, 1]);
  });

  it("mantém no mesmo cluster três blocos em que só os vizinhos se tocam", () => {
    // A das 9h às 11h, B das 10h às 12h, C das 11h30 às 13h. A e C NÃO se tocam,
    // mas B toca os dois: os três dividem a MESMA largura, senão a metade de A
    // e a metade de C seriam a mesma metade e se sobreporiam na tela.
    //
    // Duas colunas e não três: C reusa a coluna de A, que já acabou às 11h. O
    // divisor é a maior CONCORRÊNCIA do cluster (2), não o tamanho dele (3) —
    // três tiras deixariam um terço da coluna vazio o dia inteiro.
    const out = layoutColumns([at(9, 11), at(10, 12), at(11.5, 13)]);
    expect(out.map((p) => p.columns)).toEqual([2, 2, 2]);
    expect(out.map((p) => p.column)).toEqual([0, 1, 0]);
  });

  it("mantém o cluster aberto sob um evento longo", () => {
    // O fim do cluster é o MAIOR fim visto, não o do último bloco. Sem isso, o
    // cluster fecharia depois do primeiro curto e o evento das 9h às 18h
    // desenharia por cima dos seguintes.
    const out = layoutColumns([at(9, 18), at(10, 11), at(12, 13)]);
    expect(out.map((p) => p.columns)).toEqual([2, 2, 2]);
    expect(out[0].column).toBe(0);
    expect(out[1].column).toBe(1);
    expect(out[2].column).toBe(1);
  });

  it("reusa a coluna de quem já terminou", () => {
    // 20 reuniões seguidas às segundas são 20 blocos e UMA coluna. Abrir uma
    // coluna por bloco daria tiras de 5% de largura.
    const out = layoutColumns([at(9, 10), at(10, 11), at(11, 12)]);
    expect(out.every((p) => p.columns === 1)).toBe(true);
  });

  it("trata encostado como não-sobreposto, igual ao backend", () => {
    // Meio-aberto: quem acaba às 10h e quem começa às 10h não conflitam. O Rust
    // (`domain::recurrence::overlaps`) diz a mesma coisa — se as duas regras
    // discordassem, o backend acusaria um conflito que a tela desenha lado a
    // lado.
    const out = layoutColumns([at(9, 10), at(10, 11)]);
    expect(out.map((p) => p.columns)).toEqual([1, 1]);
  });

  it("devolve os blocos na ordem em que os recebeu", () => {
    // A saída alimenta um `.map` de React: reordenar aqui trocaria as `key`s de
    // lugar e faria o React remontar blocos que não mudaram — animação de
    // montagem incluída, a cada re-render.
    const items = [at(14, 15), at(9, 11), at(10, 12)];
    const out = layoutColumns(items);
    expect(out.map((p) => p.item)).toEqual(items);
  });

  it("não se importa com a ordem da entrada", () => {
    const asc = layoutColumns([at(9, 11), at(10, 12)]);
    const desc = layoutColumns([at(10, 12), at(9, 11)]);
    expect(desc[0].column).toBe(asc[1].column);
    expect(desc[1].column).toBe(asc[0].column);
  });

  it("aguenta uma lista vazia", () => {
    expect(layoutColumns([])).toEqual([]);
  });
});
