import { describe, expect, it } from "vitest";

import { annualPace } from "./pace";

describe("annualPace", () => {
  it("não projeta sem alvo", () => {
    expect(annualPace(10, 0, 0.5)).toBeNull();
  });

  it("não projeta cedo demais no ano", () => {
    expect(annualPace(2, 100, 0.01)).toBeNull();
  });

  it("no meio do ano com metade do alvo está no ritmo", () => {
    const p = annualPace(50, 100, 0.5)!;
    expect(p.projected).toBeCloseTo(100);
    expect(p.onTrack).toBe(true);
  });

  it("atrasado projeta abaixo e pede um ritmo por mês", () => {
    // metade do ano, só 30 de 100 → projeta 60, faltam 70 em 6 meses ≈ 11,7/mês
    const p = annualPace(30, 100, 0.5)!;
    expect(p.projected).toBeCloseTo(60);
    expect(p.onTrack).toBe(false);
    expect(p.perMonthNeeded).toBeGreaterThan(11);
    expect(p.message).toContain("mês");
  });

  it("adiantado projeta acima do alvo", () => {
    const p = annualPace(80, 100, 0.5)!;
    expect(p.projected).toBeCloseTo(160);
    expect(p.onTrack).toBe(true);
  });

  it("alvo já batido diz que bateu", () => {
    const p = annualPace(100, 100, 0.5)!;
    expect(p.message).toContain("batido");
  });
});
