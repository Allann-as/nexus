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

/**
 * O que o usuário digitou no campo de valor → centavos. `null` se não é dinheiro.
 *
 * Mora aqui, e não na tela, porque a fase 4 descobriu que existiam DUAS cópias
 * desta regra: uma no modal de aporte e outra dentro do parser do Ctrl+K. Duas
 * cópias divergem no dia em que só uma aprende um formato — e o formato aqui é
 * português: **o ponto é milhar e a vírgula é decimal**. "1.234,56" é mil
 * duzentos e trinta e quatro reais; ler isso com o `Number` do JavaScript
 * direto daria `1.234`, ou seja, um real e vinte e três centavos.
 *
 * Aceita o "R$" colado e espaços à vontade, porque quem cola um valor de outro
 * lugar cola com o símbolo junto. Recusa zero e negativo: o SINAL é do modo
 * (aporte/resgate), nunca do que se digita — um "-100" no campo de um aporte
 * seria uma segunda forma de dizer resgate, e duas formas discordam.
 */
export function parseAporteAmount(raw: string): number | null {
  const cleaned = raw.replace(/\s|R\$/g, "").replace(/\./g, "").replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
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
