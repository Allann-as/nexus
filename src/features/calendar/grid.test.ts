/**
 * O contrato da aritmética do calendário.
 *
 * Data é onde todo calendário sangra, e sangra em produção: o bug do horário de
 * verão aparece uma vez por ano, o do dia 31 aparece em quatro meses do ano, e o
 * da grade de 5 vs 6 linhas aparece quando o mês começa no sábado. Nenhum deles
 * aparece no dia em que o código é escrito — que é exatamente por que eles
 * precisam de teste, e não de leitura atenta.
 */

import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  dayEndMs,
  dayStartMs,
  durationLabel,
  fractionOfDay,
  fromDay,
  hhmm,
  instantAt,
  isSameMonth,
  lastDayOfMonth,
  monthGrid,
  monthLabel,
  snapMs,
  toDay,
  weekGrid,
  weekStart,
} from "./grid";

describe("toDay / fromDay", () => {
  it("não escorrega de dia por causa do fuso", () => {
    // `new Date('2026-07-17')` é interpretado como UTC pelo ES e, a oeste de
    // Greenwich, volta como dia 16. Este é o bug clássico de data em JS.
    expect(toDay(fromDay("2026-07-17"))).toBe("2026-07-17");
  });

  it("preenche mês e dia com zero à esquerda", () => {
    expect(toDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("faz round-trip em qualquer dia do ano", () => {
    for (const day of ["2026-01-01", "2026-02-28", "2026-06-15", "2026-12-31"]) {
      expect(toDay(fromDay(day))).toBe(day);
    }
  });
});

describe("addDays", () => {
  it("atravessa a virada de mês e de ano", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("acha o 29 de fevereiro num ano bissexto", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("sobrevive à virada do horário de verão", () => {
    // O caso que mata a aritmética de milissegundos: no dia em que o relógio
    // adianta, "meia-noite + 24h" cai às 23h do MESMO dia, e um laço que soma
    // 24h repete o dia. Andar pelo campo .getDate() deixa o browser resolver.
    //
    // O Brasil não tem mais horário de verão, mas o app roda na máquina do
    // usuário e o fuso é dele. Andar por dia tem que valer em qualquer fuso.
    const seq = [0, 1, 2, 3].map((n) => addDays("2026-10-17", n));
    expect(seq).toEqual(["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
  });
});

describe("addMonths — a armadilha do dia 31", () => {
  it("gruda no último dia do mês curto em vez de vazar para o mês seguinte", () => {
    // `setMonth` puro faria 31/01 + 1 mês = 03/03 (porque 31/02 "transborda").
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("acha o 29 de fevereiro num ano bissexto", () => {
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("atravessa a virada de ano nos dois sentidos", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("bate com a mesma regra do domínio em Rust", () => {
    // `domain::recurrence::add_months` faz exatamente isto. As duas
    // implementações precisam concordar: o backend materializa a série e o
    // frontend navega os meses — divergir faria a seta do mês pular um dia que
    // o banco tem.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("lastDayOfMonth", () => {
  it("conhece os meses curtos e o ano bissexto sem regra escrita à mão", () => {
    expect(lastDayOfMonth(2026, 0)).toBe(31); // janeiro
    expect(lastDayOfMonth(2026, 1)).toBe(28); // fevereiro comum
    expect(lastDayOfMonth(2028, 1)).toBe(29); // fevereiro bissexto
    expect(lastDayOfMonth(2026, 3)).toBe(30); // abril
    expect(lastDayOfMonth(2026, 11)).toBe(31); // dezembro
  });

  it("2100 não é bissexto — a regra dos 400 anos", () => {
    // O NEXUS foi feito para durar décadas; a exceção do século é real.
    expect(lastDayOfMonth(2100, 1)).toBe(28);
    expect(lastDayOfMonth(2000, 1)).toBe(29);
  });
});

describe("weekStart", () => {
  it("volta para o domingo", () => {
    // 2026-07-17 é uma sexta; o domingo dela é 12/07.
    expect(weekStart("2026-07-17")).toBe("2026-07-12");
    expect(weekStart("2026-07-12")).toBe("2026-07-12");
    expect(weekStart("2026-07-18")).toBe("2026-07-12");
    expect(weekStart("2026-07-19")).toBe("2026-07-19");
  });

  it("atravessa a virada de mês", () => {
    expect(weekStart("2026-08-01")).toBe("2026-07-26");
  });
});

describe("monthGrid", () => {
  it("tem sempre 42 células", () => {
    // Altura fixa: um mês que muda de altura conforme o calendário faz a tela
    // pular a cada seta, e o usuário navega meses em sequência.
    for (const anchor of ["2026-02-01", "2026-07-17", "2026-08-01", "2026-11-30"]) {
      expect(monthGrid(anchor)).toHaveLength(42);
    }
  });

  it("começa no domingo da semana do dia 1º", () => {
    // Julho/2026 começa numa quarta; a grade abre no domingo 28/06.
    const grid = monthGrid("2026-07-17");
    expect(grid[0]).toBe("2026-06-28");
    expect(grid).toContain("2026-07-01");
  });

  it("cobre o mês inteiro mesmo no pior caso", () => {
    // Agosto/2026 tem 31 dias e começa num sábado — o caso que precisa de 6
    // linhas. Com 5 linhas, os últimos dias sumiriam da tela.
    const grid = monthGrid("2026-08-01");
    expect(grid).toContain("2026-08-01");
    expect(grid).toContain("2026-08-31");
  });

  it("não pula nem repete dia nenhum", () => {
    const grid = monthGrid("2026-07-17");
    expect(new Set(grid).size).toBe(42);
    for (let i = 1; i < grid.length; i++) {
      expect(grid[i]).toBe(addDays(grid[i - 1], 1));
    }
  });

  it("dá o mesmo resultado para qualquer dia âncora do mesmo mês", () => {
    // A grade é do MÊS, não do dia: clicar no dia 3 e no dia 27 não pode
    // desenhar meses diferentes.
    expect(monthGrid("2026-07-01")).toEqual(monthGrid("2026-07-31"));
  });
});

describe("weekGrid", () => {
  it("tem 7 dias, de domingo a sábado", () => {
    const week = weekGrid("2026-07-17");
    expect(week).toEqual([
      "2026-07-12",
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-18",
    ]);
  });
});

describe("isSameMonth", () => {
  it("separa o mês das bordas da grade", () => {
    expect(isSameMonth("2026-07-01", "2026-07-17")).toBe(true);
    expect(isSameMonth("2026-06-30", "2026-07-17")).toBe(false);
    expect(isSameMonth("2026-08-01", "2026-07-17")).toBe(false);
  });

  it("não confunde o mesmo mês de anos diferentes", () => {
    expect(isSameMonth("2025-07-15", "2026-07-17")).toBe(false);
  });
});

describe("dayStartMs / dayEndMs", () => {
  it("o fim de um dia é o começo do seguinte", () => {
    // Meio-aberto: a janela [início, fim) do dia 17 encosta na do 18 sem
    // sobrepor. É o que faz um evento às 23h59 do 17 não aparecer no 18.
    expect(dayEndMs("2026-07-17")).toBe(dayStartMs("2026-07-18"));
  });

  it("um dia normal dura 24 horas", () => {
    expect(dayEndMs("2026-07-17") - dayStartMs("2026-07-17")).toBe(86_400_000);
  });
});

describe("fractionOfDay", () => {
  it("põe a meia-noite no topo e o meio-dia no meio", () => {
    expect(fractionOfDay(dayStartMs("2026-07-17"), "2026-07-17")).toBe(0);
    expect(fractionOfDay(dayStartMs("2026-07-17") + 12 * 3600_000, "2026-07-17")).toBeCloseTo(
      0.5,
    );
  });

  it("satura em vez de sair da coluna", () => {
    // Um evento que começou ontem e termina hoje é desenhado a partir do topo,
    // e não 300px acima da tela.
    expect(fractionOfDay(dayStartMs("2026-07-16"), "2026-07-17")).toBe(0);
    expect(fractionOfDay(dayStartMs("2026-07-19"), "2026-07-17")).toBe(1);
  });
});

describe("monthLabel", () => {
  it("escreve o mês em português", () => {
    expect(monthLabel("2026-07-17")).toBe("julho de 2026");
    expect(monthLabel("2026-03-01")).toBe("março de 2026");
  });
});

describe("instantAt", () => {
  it("é o inverso do fractionOfDay", () => {
    // Os dois lados do arrasto: `fractionOfDay` põe o bloco na coluna,
    // `instantAt` lê onde o usuário o soltou. Uma divergência entre eles moveria
    // o evento para um horário diferente do que a mão largou.
    const day = "2026-07-17";
    const noon = dayStartMs(day) + 12 * 3_600_000;
    expect(instantAt(day, fractionOfDay(noon, day))).toBe(noon);
  });

  it("põe o topo da coluna na meia-noite e o fim no dia seguinte", () => {
    expect(instantAt("2026-07-17", 0)).toBe(dayStartMs("2026-07-17"));
    expect(instantAt("2026-07-17", 1)).toBe(dayEndMs("2026-07-17"));
  });
});

describe("snapMs", () => {
  it("alinha ao slot mais próximo", () => {
    const day = "2026-07-17";
    const t = (h: number, m: number) => dayStartMs(day) + (h * 60 + m) * 60_000;

    expect(snapMs(t(9, 20), 30, day)).toBe(t(9, 30));
    expect(snapMs(t(9, 10), 30, day)).toBe(t(9, 0));
    // Quem já está no slot fica onde está.
    expect(snapMs(t(9, 30), 30, day)).toBe(t(9, 30));
  });

  it("ancora na meia-noite local, não no epoch", () => {
    // O epoch zero é meia-noite em Londres. Num fuso de meia hora (Índia,
    // Nepal), arredondar o epoch cru poria todo slot 30min fora do lugar — e o
    // NEXUS não escolhe onde é usado.
    const day = "2026-07-17";
    const snapped = snapMs(dayStartMs(day) + 61_000, 30, day);
    expect(hhmm(snapped)).toBe("00:00");
  });
});

describe("durationLabel", () => {
  it("fala como um humano", () => {
    expect(durationLabel(30 * 60_000)).toBe("30min");
    expect(durationLabel(60 * 60_000)).toBe("1h");
    expect(durationLabel(90 * 60_000)).toBe("1h30");
    expect(durationLabel(125 * 60_000)).toBe("2h05");
  });

  it("não inventa duração negativa", () => {
    expect(durationLabel(-5_000)).toBe("0min");
  });
});
