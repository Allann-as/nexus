/**
 * O contrato do casamento fuzzy da paleta.
 *
 * A dobra de acentos tem teste porque ela já quebrou: até o M2.5, 'saude' não
 * casava 'Saúde', 'calendario' não casava 'Calendário' e 'financas' não casava
 * 'Finanças'. Num app em português — onde ninguém digita acento numa busca —
 * isso era a paleta inteira quebrada, e passou despercebido por três milestones
 * porque nada aqui era testado.
 *
 * A paleta é o caminho de teclado até as Esferas, e o nome das Esferas é do
 * usuário: ele VAI ter acento. Estes testes existem para isto nunca regredir.
 */

import { describe, expect, it } from "vitest";

import { fold, fuzzyScore } from "./fuzzy";

const matches = (needle: string, haystack: string) => fuzzyScore(needle, haystack) !== null;

describe("fold", () => {
  it("tira os acentos do português", () => {
    expect(fold("Saúde")).toBe("saude");
    expect(fold("Finanças")).toBe("financas");
    expect(fold("Calendário")).toBe("calendario");
    expect(fold("Hábitos")).toBe("habitos");
    expect(fold("Objetivos Financeiros")).toBe("objetivos financeiros");
  });

  it("é idempotente — dobrar o que já está dobrado não muda nada", () => {
    expect(fold(fold("Saúde"))).toBe(fold("Saúde"));
  });

  it("não come letras que não são acento", () => {
    // 'ç' vira 'c', mas o que não é diacrítico tem que sobreviver inteiro.
    expect(fold("Metas & Projetos 2026")).toBe("metas & projetos 2026");
  });
});

describe("fuzzyScore — a regressão que motivou este arquivo", () => {
  // Digitado sem acento -> rótulo com acento. Era exatamente isto que devolvia
  // null antes do M2.5.
  it.each([
    ["saude", "Ir para Saúde"],
    ["calendario", "Ir para Calendário"],
    ["financas", "Ir para Finanças"],
    ["habitos", "Ir para Hábitos"],
    ["objetivos financeiros", "Ir para Objetivos Financeiros"],
  ])("'%s' casa '%s'", (needle, haystack) => {
    expect(matches(needle, haystack)).toBe(true);
  });

  it("casa também quando o usuário DIGITA o acento", () => {
    // A dobra vale para os dois lados: quem tem teclado ABNT e digita 'saúde'
    // não pode ser punido por isso.
    expect(matches("saúde", "Ir para Saúde")).toBe(true);
    expect(matches("finanças", "Ir para Finanças")).toBe(true);
  });

  it("ignora a caixa", () => {
    expect(matches("SAUDE", "Ir para Saúde")).toBe(true);
    expect(matches("sAuDe", "Ir para Saúde")).toBe(true);
  });
});

describe("fuzzyScore — subsequência", () => {
  it("casa prefixo e sigla", () => {
    expect(matches("cal", "Ir para Calendário")).toBe(true);
    expect(matches("mp", "Ir para Metas & Projetos")).toBe(true);
  });

  it("recusa o que não está lá", () => {
    // A dobra não pode virar um casa-tudo: uma paleta que casa qualquer coisa
    // é tão inútil quanto uma que não casa nada.
    expect(fuzzyScore("xyz", "Ir para Saúde")).toBeNull();
    expect(fuzzyScore("zzz", "Ir para Calendário")).toBeNull();
  });

  it("exige a ordem — subsequência não é anagrama", () => {
    expect(fuzzyScore("edu", "Saúde")).toBeNull();
  });

  it("busca vazia casa tudo com distância zero", () => {
    // A paleta abre sem nada digitado e precisa listar as ações.
    expect(fuzzyScore("", "Ir para Saúde")).toBe(0);
  });

  it("menor é melhor: consecutivo vence espalhado", () => {
    const consecutivo = fuzzyScore("saude", "Saúde")!;
    const espalhado = fuzzyScore("saude", "Ir para Saúde")!;
    expect(consecutivo).toBeLessThan(espalhado);
  });

  it("ordena os candidatos como a paleta os mostra", () => {
    // O caso real: digitar 'ca' com Calendário e Carreira na lista. Os dois
    // casam; o teste fixa que o mais próximo do começo ganha.
    const rotulos = ["Ir para Timeline", "Ir para Calendário", "Ir para Carreira"];
    const ranked = rotulos
      .map((r) => ({ r, s: fuzzyScore("ca", r) }))
      .filter((x): x is { r: string; s: number } => x.s !== null)
      .sort((a, b) => a.s - b.s)
      .map((x) => x.r);

    expect(ranked).toEqual(["Ir para Calendário", "Ir para Carreira"]);
  });
});
