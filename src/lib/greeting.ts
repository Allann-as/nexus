/**
 * A saudação — uma só, para o app inteiro.
 *
 * Duas coisas moram aqui porque as duas telas que saúdam (o Hub e, na fase 6, a
 * tela de bloqueio) precisam das duas, e duas cópias divergiriam no dia em que só
 * uma fosse corrigida:
 *
 *   1. A FAIXA DE HORA (bom dia / boa tarde / boa noite) — função pura, testável
 *      sem relógio nem janela.
 *   2. O NOME de quem está na frente do app — que vem do `settings.json`, não do
 *      código. O NEXUS vai ser compartilhado localmente com outras pessoas, então
 *      "Allan" é o PADRÃO, nunca uma constante cravada na saudação. Ver ADR-0075.
 */

import { useQuery } from "@tanstack/react-query";

import { appSettings } from "./ipc";

/** O mesmo padrão do backend (`DEFAULT_DISPLAY_NAME` em infrastructure/settings.rs). */
export const DEFAULT_DISPLAY_NAME = "Allan";

/**
 * A faixa de hora. Pura e com a hora INJETADA — testar "boa noite" não pode
 * exigir rodar a suíte às 21h.
 *
 * QUATRO faixas, não três: a madrugada é uma delas. O Hub já distinguia quem
 * abre o app às 3h desde o M2.5, e centralizar a saudação não podia ser a
 * desculpa para essa nuance se perder no caminho.
 */
export function greetingForHour(hour: number): string {
  if (hour < 5) return "Boa madrugada";
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/** A saudação de agora. */
export function greeting(now: Date = new Date()): string {
  return greetingForHour(now.getHours());
}

/**
 * O nome de exibição, do `settings.json`.
 *
 * Compartilha a chave `["app-settings"]` com a tela de Configurações DE PROPÓSITO:
 * é o mesmo dado, e assim salvar o nome lá reflete no Hub sem recarregar nada —
 * uma invalidação, duas telas. Enquanto a leitura não chega (ou se ela falha), cai
 * no padrão: a saudação nunca aparece pela metade.
 */
export function useDisplayName(): string {
  const q = useQuery({
    queryKey: ["app-settings"],
    queryFn: appSettings,
    staleTime: 5 * 60_000,
  });
  return q.data?.displayName?.trim() || DEFAULT_DISPLAY_NAME;
}
