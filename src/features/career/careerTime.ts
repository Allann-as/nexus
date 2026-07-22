/**
 * As contas de tempo e a leitura de um marco da Carreira.
 *
 * Moravam dentro do `CareerDashboard`. Quando a linha do tempo saiu para a sua
 * própria aba (ADR-0089), as duas telas passaram a precisar das mesmas funções —
 * e duas cópias de "quantos dias entre" é como um dos lados começa a contar
 * diferente do outro sem ninguém perceber.
 */

import type { CareerMilestoneKind, LedgerEntry } from "../../lib/ipc";
import { CAREER_KIND_META } from "./careerKinds";

const MONTHS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** '2026-07-12' → '12 de jul de 2026'. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${Number(d)} de ${MONTHS[Number(m) - 1] ?? m} de ${y}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** O dia LOCAL de hoje como 'YYYY-MM-DD' — a mesma convenção do backend. */
export function todayLocal(): string {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

/** '2026-07-12' de um epoch-ms LOCAL — para a meta com prazo (o deadline é ms). */
export function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Dias entre dois 'YYYY-MM-DD' (UTC para não tropeçar em horário de verão). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Uma duração em dias, em português curto: "2 anos 3 meses", "5 meses", "12 dias". */
export function humanize(days: number): string {
  if (days <= 0) return "hoje";
  if (days < 45) return `${days} ${days === 1 ? "dia" : "dias"}`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months} ${months === 1 ? "mês" : "meses"}`;
  const years = Math.floor(days / 365.25);
  const rem = Math.floor((days - years * 365.25) / 30.44);
  const y = `${years} ${years === 1 ? "ano" : "anos"}`;
  return rem > 0 ? `${y} ${rem} ${rem === 1 ? "mês" : "meses"}` : y;
}

export interface Milestone {
  entry: LedgerEntry;
  kind: CareerMilestoneKind;
  note: string | null;
}

/** Lê o `payload` de um evento de marco. Payload ilegível cai no marco genérico. */
export function parseMilestone(entry: LedgerEntry): Milestone {
  let kind: CareerMilestoneKind = "other";
  let note: string | null = null;
  try {
    const p = JSON.parse(entry.payload) as { kind?: string; note?: string | null };
    if (p.kind && p.kind in CAREER_KIND_META) kind = p.kind as CareerMilestoneKind;
    note = p.note ?? null;
  } catch {
    // Um payload ilegível não pode derrubar a tela.
  }
  return { entry, kind, note };
}
