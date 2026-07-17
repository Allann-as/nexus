/**
 * O contrato da formatação de métrica.
 *
 * A regra do arquiteto: o valor exibido é sempre o valor registrado, com as
 * casas que o usuário digitou. O bug que criou este teste foi uma pesagem de
 * 77,4 exibida como "77" — o card dizendo um número que ninguém registrou.
 */

import { describe, expect, it } from "vitest";

import { formatMetric, metricDecimals } from "./format";

describe("metricDecimals", () => {
  it("dá as casas que o valor realmente tem", () => {
    expect(metricDecimals(82)).toBe(0);
    expect(metricDecimals(77.4)).toBe(1);
    expect(metricDecimals(72.45)).toBe(2);
  });

  it("não arredonda um registro pelo alvo — o bug que fechou", () => {
    // Uma meta de 82 até 72 tem alvo INTEIRO; a pesagem de hoje é 77,4. As casas
    // vêm do valor registrado, não do alvo redondo.
    expect(metricDecimals(77.4)).toBe(1);
  });

  it("mata a poeira de float em vez de pintar 17 casas", () => {
    expect(metricDecimals(0.1 + 0.2)).toBe(1); // 0.30000000000000004 -> 1
    expect(metricDecimals(77.40000000001)).toBe(1);
  });

  it("aguenta um valor não-finito sem quebrar a tela", () => {
    expect(metricDecimals(NaN)).toBe(0);
    expect(metricDecimals(Infinity)).toBe(0);
  });
});

describe("formatMetric", () => {
  it("mostra o registro com a precisão dele, em pt-BR", () => {
    expect(formatMetric(82)).toBe("82");
    expect(formatMetric(77.4)).toBe("77,4");
    expect(formatMetric(72.45)).toBe("72,45");
  });

  it("não inventa casa nem come casa", () => {
    // Nem "77,40" (casa inventada) nem "77" (casa comida): o valor exato.
    expect(formatMetric(77.4)).toBe("77,4");
  });
});
