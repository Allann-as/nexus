import { describe, expect, it } from "vitest";

import { mondaysOf, toDay } from "./weekStrip";

describe("mondaysOf", () => {
  it("começa na primeira segunda do ano", () => {
    // 2026-01-01 é uma quinta; a primeira segunda é 05/01.
    expect(mondaysOf(2026)[0]).toBe("2026-01-05");
  });

  it("não pula a semana quando 1º de janeiro JÁ é segunda", () => {
    // 2024-01-01 é segunda. Um `(8 - dow) % 7` sem o cuidado do domingo daria
    // 0 aqui (certo), mas a borda merece o teste: o primeiro elemento tem que
    // ser o PRÓPRIO 1º de janeiro, não o dia 8.
    expect(mondaysOf(2024)[0]).toBe("2024-01-01");
  });

  it("trata o domingo, em que o resto zeraria pelo lado errado", () => {
    // 2023-01-01 é domingo; a primeira segunda é o dia 02.
    expect(mondaysOf(2023)[0]).toBe("2023-01-02");
  });

  it("fica dentro do ano e devolve 52 ou 53 semanas", () => {
    for (const y of [2023, 2024, 2025, 2026]) {
      const ms = mondaysOf(y);
      expect(ms.length).toBeGreaterThanOrEqual(52);
      expect(ms.length).toBeLessThanOrEqual(53);
      expect(ms[0].startsWith(String(y))).toBe(true);
      expect(ms[ms.length - 1].startsWith(String(y))).toBe(true);
    }
  });

  it("anda de sete em sete e só cai em segunda", () => {
    for (const day of mondaysOf(2026)) {
      const [y, m, d] = day.split("-").map(Number);
      expect(new Date(y, m - 1, d).getDay()).toBe(1);
    }
  });
});

describe("toDay", () => {
  it("preenche mês e dia com zero à esquerda", () => {
    expect(toDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
