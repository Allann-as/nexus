/**
 * O contrato do parser de "aportar 500 no btg".
 *
 * Cada caso é uma forma que o usuário digita de verdade: com e sem "no", com
 * vírgula decimal, com apelido do banco, e o "aporte" solto que NÃO é um comando
 * (para a paleta não pôr uma linha fantasma no topo da busca).
 */

import { describe, expect, it } from "vitest";

import { parseAporte, parseAporteAmount, fold } from "./parseAporte";
import type { Account } from "../../lib/ipc";

const ACCOUNTS: Account[] = [
  { id: "acct-btg", name: "BTG Banking", kind: "banking", color: "#000", sortOrder: 0 },
  { id: "acct-itau", name: "Itaú", kind: "banking", color: "#f70", sortOrder: 1 },
  { id: "acct-nubank", name: "Nubank", kind: "banking", color: "#80d", sortOrder: 2 },
];

describe("parseAporte", () => {
  it("entende 'aportar 500 no btg'", () => {
    const p = parseAporte("aportar 500 no btg", ACCOUNTS);
    expect(p?.amountCents).toBe(50000);
    expect(p?.accountId).toBe("acct-btg");
  });

  it("aceita a vírgula decimal do português", () => {
    expect(parseAporte("aportar 1.234,56 no nubank", ACCOUNTS)?.amountCents).toBe(123456);
  });

  it("acha o banco por apelido sem acento", () => {
    // "itau" tem que casar "Itaú" — o usuário não digita o acento.
    expect(parseAporte("aportar 300 no itau", ACCOUNTS)?.accountId).toBe("acct-itau");
  });

  it("vale sem banco: o modal abre com o valor e o usuário escolhe a conta", () => {
    const p = parseAporte("aportar 200", ACCOUNTS);
    expect(p?.amountCents).toBe(20000);
    expect(p?.accountId).toBeUndefined();
  });

  it("aceita as variações do verbo", () => {
    expect(parseAporte("aporta 100 na nubank", ACCOUNTS)?.accountId).toBe("acct-nubank");
    expect(parseAporte("aporte 100 btg", ACCOUNTS)?.accountId).toBe("acct-btg");
  });

  it("não é comando quando não começa com 'aportar'", () => {
    // "aporte da semana" não tem valor: é texto para a busca, não um comando.
    expect(parseAporte("relatório de aporte", ACCOUNTS)).toBeNull();
    expect(parseAporte("aportar no btg", ACCOUNTS)).toBeNull();
    expect(parseAporte("calendário", ACCOUNTS)).toBeNull();
  });

  it("recusa valor zero ou negativo", () => {
    expect(parseAporte("aportar 0 no btg", ACCOUNTS)).toBeNull();
  });
});

describe("fold", () => {
  it("tira acento e caixa", () => {
    expect(fold("Itaú")).toBe("itau");
    expect(fold("BTG Banking")).toBe("btg banking");
  });
});

/**
 * O campo de valor do Terminal de aporte (v1.3, fase 4).
 *
 * A regra saiu de dentro da tela para cá quando a fase 4 achou DUAS cópias dela.
 * Cada caso abaixo é uma forma que o usuário digita de verdade — e o primeiro é o
 * que o dono pediu para validar na dirigida: **R$ 99,90 se digita**, e não se
 * arredonda para o botão rápido mais próximo.
 */
describe("parseAporteAmount", () => {
  it("aceita o centavo digitado à mão", () => {
    expect(parseAporteAmount("99,90")).toBe(9990);
    expect(parseAporteAmount("0,01")).toBe(1);
  });

  it("lê o ponto como MILHAR, que é o português", () => {
    // O `Number` do JavaScript leria "1.234,56" como um real e vinte e três —
    // este é o caso que uma segunda cópia da regra erraria sozinha.
    expect(parseAporteAmount("1.234,56")).toBe(123456);
    expect(parseAporteAmount("10.000")).toBe(1_000_000);
  });

  it("tolera o R$ e os espaços de quem cola de outro lugar", () => {
    expect(parseAporteAmount("R$ 500")).toBe(50000);
    expect(parseAporteAmount("  1.500,00  ")).toBe(150000);
  });

  it("recusa o que não é dinheiro", () => {
    expect(parseAporteAmount("")).toBeNull();
    expect(parseAporteAmount("abc")).toBeNull();
    expect(parseAporteAmount("0")).toBeNull();
  });

  it("recusa o negativo: o sinal é do MODO, nunca do que se digita", () => {
    // Um "-100" no campo de um aporte seria uma segunda forma de dizer resgate,
    // e duas formas discordam no dia em que só uma é lida.
    expect(parseAporteAmount("-100")).toBeNull();
  });
});
