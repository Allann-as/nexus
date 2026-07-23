/**
 * As contas de PRAZO de um compromisso — quantos dias faltam, e como dizê-lo.
 *
 * Moravam privadas dentro de `HealthExams`. Com a Faculdade precisando das
 * mesmas ("a entrega é em 3 dias"), deixá-las lá significaria copiá-las — e duas
 * cópias de "quantos dias entre" é como um lado começa a contar diferente do
 * outro sem ninguém perceber (a mesma razão do `careerTime.ts`, ADR-0089).
 *
 * Tudo aqui conta DIAS LOCAIS, nunca milissegundos: o que o usuário chama de
 * "amanhã" é uma data no calendário dele, não 24 horas a partir de agora.
 */

import { fromDay, toDay } from "./grid";

/** Dias até um dia local, a partir de hoje. Negativo = já passou. */
export function daysUntil(day: string): number {
  const today = fromDay(toDay(new Date()));
  const target = fromDay(day);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** O que falta: "hoje", "amanhã", "em 4 dias". */
export function countdown(days: number): string {
  if (days === 0) return "hoje";
  if (days === 1) return "amanhã";
  return `em ${days} dias`;
}

/**
 * O que passou: "ontem", "há 12 dias", "há 3 meses".
 *
 * Vira meses depois de 60 dias porque "há 214 dias" é um número que ninguém
 * converte de cabeça — e a pergunta do consultório (ou da secretaria) é
 * "quantos meses faz?".
 */
export function elapsed(days: number): string {
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 60) return `há ${days} dias`;
  const months = Math.round(days / 30);
  if (months < 24) return `há ${months} meses`;
  return `há ${Math.round(days / 365)} anos`;
}

/**
 * O prazo está IMINENTE? Até 3 dias, e ainda não passou.
 *
 * O LIMIAR ÚNICO de urgência do app (fase 10, item 3): a exceção proposital à
 * regra "1 cor por seção" — a menos de 3 dias, o âmbar de alerta; mais longe, a
 * cor da Esfera. Vale igual para o exame da Saúde, a prova de Estudos e os marcos
 * do Hub (que já pintavam D-3 de âmbar). Três dias é o "ainda dá pra agir AGORA";
 * a semana anterior era cedo demais e diluía o alerta a ponto de virar ruído.
 */
export function isSoon(days: number): boolean {
  return days >= 0 && days <= 3;
}
