/**
 * `areaId → cor da Esfera`, num lugar só.
 *
 * Toda tela precisa disto e nenhuma deve reimplementar: a alternativa é cada
 * uma montar seu `listAreas` + `find`, e quando a regra do fallback mudar (ou
 * alguém esquecer a Esfera arquivada) as telas divergem em silêncio — cada uma
 * pintando a mesma Esfera de um jeito.
 *
 * Custo: zero requisições novas. A chave `["areas"]` já é buscada pela rail,
 * pelo Hub, pelo Topbar e pela paleta; o TanStack Query desduplica. Este hook é
 * um `find` sobre um cache que já está quente.
 *
 * `include_archived = true` de propósito: um projeto pode apontar para uma
 * Esfera arquivada, e "some da lista" nunca quis dizer "perde a cor". Sem isso,
 * arquivar uma Esfera despintaria silenciosamente todo conteúdo dela.
 */

import { useQuery } from "@tanstack/react-query";

import { listAreas } from "../lib/ipc";

/**
 * A cor de uma Esfera, ou o azul do NEXUS quando não há Esfera.
 *
 * O fallback não é um erro: o Inbox e tudo que ainda não foi triado vivem sem
 * Esfera de propósito. Neutro é a resposta certa para "ainda não decidi".
 */
export function useSphereColor(areaId: string | null | undefined): string {
  const { data: areas } = useQuery({
    queryKey: ["areas", "all"],
    queryFn: () => listAreas(true),
    // A cor de uma Esfera muda quando o usuário a edita — raro, e a tela de
    // Esferas invalida a chave quando acontece.
    staleTime: 5 * 60_000,
  });

  if (!areaId) return "var(--accent)";
  return areas?.find((a) => a.id === areaId)?.color ?? "var(--accent)";
}

/**
 * O `style` pronto para pendurar num container.
 *
 * Define `--sphere`, e a partir daí aurora, ícone, gráfico, checkbox e barra se
 * tingem sozinhos — nenhum deles precisa saber que Esferas existem. É este
 * indireto que mantém os primitives ignorantes do domínio.
 *
 *   <div {...sphereStyle(useSphereColor(task.areaId))}>
 */
export function sphereStyle(color: string): { style: React.CSSProperties } {
  return { style: { "--sphere": color } as React.CSSProperties };
}
