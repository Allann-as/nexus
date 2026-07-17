/**
 * O parser do comando "aportar 500 no btg" (§3.2).
 *
 * Módulo próprio, fora da paleta, porque é uma função pura com casos de canto
 * (vírgula vs ponto, banco por apelido, "aporte" sem valor) — testável sem
 * montar a paleta.
 */

import type { Account } from "../../lib/ipc";

export interface ParsedAporte {
  amountCents: number;
  accountId?: string;
  label: string;
}

/** minúsculas sem acento — para "itaú" casar com o que o usuário digita. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * "aportar 500 no btg" → { 50000 centavos, acct-btg }.
 *
 * Aceita "aporta/aportar/aporte", o valor com vírgula ou ponto, e um trecho do
 * nome do banco depois de "no/na/em/pra". O banco casa por substring do nome,
 * dobrado (sem acento) — "btg" acha "BTG Banking", "itau" acha "Itaú".
 *
 * `null` quando não é um comando de aporte: aí a paleta segue com a busca
 * normal, sem uma linha fantasma.
 */
export function parseAporte(query: string, accounts: Account[]): ParsedAporte | null {
  const m = /^aport(?:ar|e|a)?\s+([\d.,]+)\s*(?:no|na|em|pra|para|para o)?\s*(.*)$/i.exec(
    query.trim(),
  );
  if (!m) return null;

  // "1.234,56" (pt-BR) → 1234.56: o ponto é milhar, a vírgula é decimal.
  const value = Number(m[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const amountCents = Math.round(value * 100);

  const bankQuery = fold(m[2].trim());
  const account = bankQuery ? accounts.find((a) => fold(a.name).includes(bankQuery)) : undefined;

  const reais = value.toLocaleString("pt-BR", { minimumFractionDigits: 2 });
  const label = account ? `Aportar R$ ${reais} no ${account.name}` : `Aportar R$ ${reais}`;

  return { amountCents, accountId: account?.id, label };
}
