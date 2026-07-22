/**
 * A rede de segurança da resolução de marca (ADR-0085).
 *
 * O que este teste protege não é o desenho — é a CHAVE. A logo de um banco
 * resolvida pelo nome exibido some no dia em que o usuário renomeia a conta, e
 * esse é o tipo de regressão que passa no gate, passa na dirigida (onde as
 * contas ainda têm o nome de fábrica) e só aparece na vida de quem usa o app.
 */

import { describe, expect, it } from "vitest";

import { BANK_BY_ID, bankBrand } from "./bankBrand";
import { BANK_GLYPHS } from "./assets/banks";

describe("bankBrand — a marca de uma conta", () => {
  it("resolve as seis contas semeadas pela 0005, todas com logo", () => {
    const semeadas = [
      "acct-santander",
      "acct-bradesco",
      "acct-nubank",
      "acct-itau",
      "acct-btg",
      "acct-btg-invest",
    ];
    for (const id of semeadas) {
      const marca = bankBrand("qualquer nome", id);
      expect(marca.glyph, `${id} ficou sem logo`).toBeDefined();
      expect(marca.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
    expect(Object.keys(BANK_BY_ID).sort()).toEqual(semeadas.sort());
  });

  it("RENOMEAR a conta não apaga a logo — o id manda, o nome não", () => {
    const original = bankBrand("Nubank", "acct-nubank");
    const renomeada = bankBrand("conta principal", "acct-nubank");
    expect(renomeada).toEqual(original);
    expect(renomeada.glyph).toBe(BANK_GLYPHS.nubank);
  });

  it("um nome que cita outro banco NÃO vence o id", () => {
    // O usuário renomeou a conta do Itaú para "Bradesco antigo". O id continua
    // sendo o do Itaú, e é ele que decide.
    expect(bankBrand("Bradesco antigo", "acct-itau").glyph).toBe(BANK_GLYPHS.itau);
  });

  it("as duas contas do BTG compartilham a marca e se separam pela cor", () => {
    const banking = bankBrand("BTG Banking", "acct-btg");
    const invest = bankBrand("BTG Investimentos", "acct-btg-invest");
    expect(banking.glyph).toBe(invest.glyph);
    expect(banking.color).not.toBe(invest.color);
  });

  it("sem id, cai no nome — inclusive com acento e caixa trocada", () => {
    expect(bankBrand("ITAÚ").glyph).toBe(BANK_GLYPHS.itau);
    expect(bankBrand("meu santander").glyph).toBe(BANK_GLYPHS.santander);
  });

  it("banco conhecido SEM logo não quebra: vem monograma, não `undefined`", () => {
    const inter = bankBrand("Inter");
    expect(inter.glyph).toBeUndefined();
    expect(inter.short).toBe("Int");
  });

  it("conta que não casa com nada cai no monograma de duas letras", () => {
    const carteira = bankBrand("Carteira", "acct-livre-01");
    expect(carteira.glyph).toBeUndefined();
    expect(carteira.short).toBe("CA");
    expect(carteira.color).toBe("var(--accent)");
  });

  it("nome vazio ainda devolve algo desenhável", () => {
    expect(bankBrand("   ").short).toBe("•");
  });
});

describe("BANK_GLYPHS — as marcas desenhadas", () => {
  it("toda marca tem path e um viewBox QUADRADO", () => {
    for (const [nome, g] of Object.entries(BANK_GLYPHS)) {
      expect(g.d.length, `${nome} sem path`).toBeGreaterThan(0);
      expect(g.d.startsWith("M"), `${nome} não começa com M`).toBe(true);
      const [, , w, h] = g.viewBox.split(" ").map(Number);
      // Quadrado é o que faz as seis pesarem igual no ladrilho de 32px: sem
      // isso cada logo entra com a proporção do arquivo de origem.
      expect(w, `${nome} não é quadrado`).toBeCloseTo(h, 5);
      expect(w).toBeGreaterThan(0);
    }
  });
});
