/**
 * O crivo do vocabulário do ledger.
 *
 * A Timeline traduz o ledger para a tela, e a tradução era PARCIAL: 8 dos 22
 * `event_type` e 10 dos 25 `entity_kind` não tinham entrada, e caíam num
 * `prettify()` que escrevia a chave interna do banco na tela — "Achievement
 * unlocked", "Focus session logged", "Nexus score", em inglês, num app em
 * português. Nada quebrava, nenhum teste falhava, e o feed do mês corrente do
 * seed tinha 27 linhas assim.
 *
 * Estes testes fecham o vocabulário. `all_event_types_are_translated` falha no
 * dia em que o Rust ganhar uma variante nova e ninguém traduzi-la — que é o
 * único momento em que se pode consertar isso de graça. Ver ADR-0104.
 */

import { describe as it_describe, expect, it } from "vitest";

import type { LedgerEntry } from "../../lib/ipc";
import {
  ALL_ENTITY_KINDS,
  ALL_EVENT_TYPES,
  KIND_LABEL,
  dayScore,
  describe,
  detail,
  meta,
  searchHaystack,
} from "./ledgerMeta";

function entry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    seq: 1,
    ts: 1_700_000_000_000,
    day: "2026-07-17",
    entityId: "x",
    entityKind: "task",
    eventType: "created",
    payload: "{}",
    titleSnapshot: "Alguma coisa",
    ...over,
  };
}

/** O fallback que este arquivo existe para tornar inalcançável. */
function prettify(eventType: string): string {
  const s = eventType.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

it_describe("ledgerMeta — o vocabulário fechado", () => {
  it("todo event_type tem rótulo próprio, nunca a chave crua", () => {
    const raw: string[] = [];
    for (const type of ALL_EVENT_TYPES) {
      const label = meta(entry({ eventType: type })).label;
      if (label === prettify(type)) raw.push(`${type} -> "${label}"`);
    }
    expect(raw, `event_type sem tradução:\n${raw.join("\n")}`).toEqual([]);
  });

  it("todo entity_kind tem rótulo humano", () => {
    const missing = ALL_ENTITY_KINDS.filter((k) => !KIND_LABEL[k]);
    expect(missing).toEqual([]);
  });

  it("nenhum rótulo contém underscore (a marca da chave interna vazando)", () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(meta(entry({ eventType: type })).label).not.toContain("_");
    }
    for (const label of Object.values(KIND_LABEL)) {
      expect(label).not.toContain("_");
    }
  });
});

it_describe("ledgerMeta — o payload que a tela jogava fora", () => {
  it("a conquista usa o ícone e o METAL que o payload traz", () => {
    const bronze = meta(
      entry({
        entityKind: "achievement",
        eventType: "achievement_unlocked",
        payload: '{"icon":"flame","tier":"bronze"}',
      }),
    );
    const silver = meta(
      entry({
        entityKind: "achievement",
        eventType: "achievement_unlocked",
        payload: '{"icon":"trending-up","tier":"silver"}',
      }),
    );

    expect(bronze.label).toBe("Conquista");
    expect(bronze.tint).toBe("#C08457");
    expect(silver.tint).toBe("#A8B0BC");
    expect(bronze.icon, "ícones distintos, não um troféu para as duas").not.toBe(
      silver.icon,
    );
  });

  it("um tier desconhecido cai no accent, não numa cor inventada", () => {
    const m = meta(
      entry({ eventType: "achievement_unlocked", payload: '{"tier":"mithril"}' }),
    );
    expect(m.tint).toBe("var(--accent)");
  });

  it("o checkpoint com alvo mostra a fração, não só a medição", () => {
    expect(
      detail(
        entry({
          entityKind: "annual_goal",
          eventType: "goal_checkpoint",
          payload: '{"value":5,"target":12}',
        }),
      ),
    ).toBe("5 de 12");

    // Sem alvo no payload não se inventa denominador.
    expect(
      detail(entry({ eventType: "goal_checkpoint", payload: '{"value":78.2}' })),
    ).toBe("mediu 78,2");
  });

  it("a temporada declara alvo e prazo", () => {
    expect(
      detail(
        entry({
          entityKind: "challenge",
          eventType: "challenge_started",
          payload: '{"targetCount":30,"endsOn":"2026-08-21","metric":"habit_days"}',
        }),
      ),
    ).toBe("alvo 30 · até 21/08");
  });

  it("o bloco de foco mostra a duração", () => {
    expect(
      detail(entry({ eventType: "focus_session_logged", payload: '{"minutes":25}' })),
    ).toBe("25 min");
  });

  it("subir de nível não ganha detalhe inventado — o payload é vazio", () => {
    expect(detail(entry({ eventType: "skill_level_up", payload: "{}" }))).toBeNull();
  });

  it("o check-in de competência mostra a auto-avaliação", () => {
    expect(
      detail(
        entry({
          eventType: "skill_checkin",
          payload: '{"month":"2026-07","studied":true,"applied":4,"stars":4}',
        }),
      ),
    ).toBe("4/5 · aplicou 4x");
  });
});

it_describe("ledgerMeta — o Score sai da lista e vira a régua do dia", () => {
  it("o nexus_score entrega o valor congelado", () => {
    expect(
      dayScore(
        entry({
          entityKind: "daily_score",
          eventType: "nexus_score",
          payload: '{"value":57,"formulaVersion":"m4.5-behavioural"}',
        }),
      ),
    ).toBe(57);
  });

  it("qualquer outro evento não é score", () => {
    expect(dayScore(entry({ eventType: "checked" }))).toBeNull();
  });

  it("um payload ilegível não vira zero — vira ausência", () => {
    expect(dayScore(entry({ eventType: "nexus_score", payload: "{{{" }))).toBeNull();
  });
});

it_describe("ledgerMeta — a busca", () => {
  it("acha um aporte pelo nome do banco e pelo rótulo do gesto", () => {
    const hay = searchHaystack(
      entry({
        entityKind: "contribution",
        eventType: "value_recorded",
        // O título de uma contribuição é a frase do backend, não a conta.
        titleSnapshot: "Aporte de R$ 500.00",
        payload:
          '{"amountCents":50000,"assetClass":"renda_fixa","accountId":"acct-nubank"}',
      }),
    );
    expect(hay, "a conta vem do accountId do payload").toContain("nubank");
    expect(hay).toContain("renda fixa");
    expect(hay).toContain("aporte");
  });

  it("acha uma conquista buscando por 'conquista'", () => {
    const hay = searchHaystack(
      entry({
        entityKind: "achievement",
        eventType: "achievement_unlocked",
        titleSnapshot: "Uma semana",
        payload: '{"icon":"flame","tier":"bronze"}',
      }),
    );
    expect(hay).toContain("conquista");
  });
});

it_describe("ledgerMeta — o título verbatim", () => {
  it("o resgate se anuncia como resgate, com o valor absoluto em pt-BR", () => {
    const e = entry({
      entityKind: "contribution",
      titleSnapshot: "Resgate de R$ -1200.00 removido",
      payload: '{"amountCents":-120000,"accountId":"acct-btg","assetClass":"cripto"}',
    });
    // Sem `toBe` na string inteira: `formatMoney` separa "R$" do número com um
    // espaço NÃO-QUEBRÁVEL (U+00A0, vem do Intl), e um teste preso a um
    // caractere invisível falha por um motivo que ninguém lê no diff.
    expect(describe(e)).toMatch(/^Resgate de R\$\s1\.200,00$/);
    expect(meta(e).label).toBe("Resgate");
    // A segunda linha é a CONTA e a classe — nunca o título repetido.
    expect(detail(e)).toBe("BTG · Cripto");
  });

  it("sem título e sem regra, cai no rótulo do kind — não na chave crua", () => {
    expect(describe(entry({ entityKind: "focus_session", titleSnapshot: "" }))).toBe(
      "Foco",
    );
  });
});
