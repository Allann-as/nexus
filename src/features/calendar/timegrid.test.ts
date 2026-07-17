/**
 * A regra de onde a grade abre.
 *
 * Ela é uma conta sobre o relógio, então mora fora do componente e é conferida
 * sem montar tela nenhuma. O caso que a criou apareceu dirigindo o app às 4h da
 * manhã: a grade abria nas 7h e a linha do "agora" ficava fora da tela, acima —
 * o app escondendo justamente o instante em que ele estava.
 */

import { describe, expect, it } from "vitest";

import { openAtHour } from "./TimeGrid";

/** Um instante de hoje, na hora local pedida. */
const at = (hour: number, min = 0) => {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  return d.getTime();
};

describe("openAtHour", () => {
  it("abre nas 07h durante o dia inteiro", () => {
    // O padrão: ninguém quer ver sete horas de madrugada vazia ao abrir a
    // agenda de uma terça de trabalho.
    expect(openAtHour(at(9))).toBe(7);
    expect(openAtHour(at(15))).toBe(7);
    expect(openAtHour(at(23, 59))).toBe(7);
  });

  it("nunca abre depois de agora — a madrugada é o caso", () => {
    // 04h40: rolar até as 7h esconderia a linha do "agora" acima da tela.
    expect(openAtHour(at(4, 40))).toBe(3);
    expect(openAtHour(at(6, 59))).toBe(5);
  });

  it("não rola para antes da meia-noite", () => {
    // 00h30 - 1h seria -1: a coluna começa em 0, e um scrollTop negativo é
    // silenciosamente ignorado pelo browser (o que esconderia o bug).
    expect(openAtHour(at(0, 30))).toBe(0);
    expect(openAtHour(at(1))).toBe(0);
  });
});
