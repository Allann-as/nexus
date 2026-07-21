/**
 * A frase da constância — o texto que diz o que vai acontecer.
 *
 * Ela tem teste porque é onde a regra do ADR-0079 fica VISÍVEL para o usuário:
 * sem alvo diário a constância conta DIAS; com alvo diário ela soma VALORES.
 * "30" sozinho num formulário é ambíguo — 30 dias? 30 reais? —, e uma frase
 * errada aqui ensina a coisa errada em silêncio.
 *
 * E concordância é conteúdo: "1 dias" é a marca de um app que ninguém leu.
 */

import { describe, expect, it } from "vitest";

import { constanciaSentence } from "./NewGoalModal";

describe("a frase da constância", () => {
  it("sem alvo diário, cada dia marcado vale UM da unidade", () => {
    // "30 dias sem fritura": a unidade É o dia, e o que se conta é ter marcado.
    expect(constanciaSentence(null, 30, "dias")).toBe(
      "Cada dia marcado conta 1 dias — a meta fecha em 30.",
    );
  });

  it("com alvo diário, marcar o dia soma o combinado", () => {
    // O ponto inteiro do alvo diário: um clique significa "guardei os R$ 10 de
    // sempre", e não zero.
    expect(constanciaSentence(10, 3650, "R$")).toBe(
      "Marcar o dia conta 10 R$, e a meta fecha ao somar 3650 R$.",
    );
  });

  it("sem alvo total ainda diz o que o dia vale", () => {
    // O usuário digita o alvo por último. Enquanto ele não digitou, a frase não
    // pode falar de um alvo que não existe — nem calar sobre o que já se sabe.
    expect(constanciaSentence(null, NaN, "dias")).toBe("Cada dia marcado conta 1 dias.");
    expect(constanciaSentence(10, NaN, "R$")).toBe(
      "Marcar o dia conta 10 R$. Digite um valor diferente no dia para corrigir.",
    );
  });

  it("um alvo de zero não é um alvo", () => {
    // Zero passa no `Number.isFinite` mas é a meta que nunca sai do lugar — o
    // backend a recusa (ADR-0079), e a frase não pode prometê-la.
    expect(constanciaSentence(null, 0, "dias")).toBe("Cada dia marcado conta 1 dias.");
  });

  it("sem unidade digitada ainda fala português", () => {
    // A unidade chega do catálogo da Esfera, mas o usuário pode apagá-la. A
    // frase cai em "dia" em vez de mostrar "conta 1  ." com um buraco.
    expect(constanciaSentence(null, 30, "")).toBe("Cada dia marcado conta 1 dia — a meta fecha em 30.");
    expect(constanciaSentence(null, 30, "   ")).toBe(
      "Cada dia marcado conta 1 dia — a meta fecha em 30.",
    );
  });
});
