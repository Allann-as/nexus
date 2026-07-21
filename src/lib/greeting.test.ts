import { describe, expect, it } from "vitest";

import { greeting, greetingForHour } from "./greeting";

describe("greetingForHour", () => {
  it("cobre as quatro faixas do dia", () => {
    expect(greetingForHour(0)).toBe("Boa madrugada");
    expect(greetingForHour(4)).toBe("Boa madrugada");
    expect(greetingForHour(5)).toBe("Bom dia");
    expect(greetingForHour(11)).toBe("Bom dia");
    expect(greetingForHour(12)).toBe("Boa tarde");
    expect(greetingForHour(17)).toBe("Boa tarde");
    expect(greetingForHour(18)).toBe("Boa noite");
    expect(greetingForHour(23)).toBe("Boa noite");
  });

  it("não tem buraco entre 0 e 23", () => {
    for (let h = 0; h < 24; h++) {
      expect(greetingForHour(h)).not.toBe("");
    }
  });
});

describe("greeting", () => {
  it("aceita a data injetada — testar 'boa noite' não pede rodar às 21h", () => {
    // Meio-dia e 21h locais, construídos pelo construtor local (o mesmo fuso que
    // `getHours()` lê), para o teste não depender de UTC.
    expect(greeting(new Date(2026, 6, 21, 12, 0))).toBe("Boa tarde");
    expect(greeting(new Date(2026, 6, 21, 21, 0))).toBe("Boa noite");
    expect(greeting(new Date(2026, 6, 21, 7, 0))).toBe("Bom dia");
    expect(greeting(new Date(2026, 6, 21, 3, 0))).toBe("Boa madrugada");
  });
});
