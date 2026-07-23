/**
 * A pergunta única: o movimento está desligado?
 *
 * DUAS fontes, uma resposta — o SO (`prefers-reduced-motion`) OU a escolha
 * explícita das Configurações (que marca `<html data-reduced-motion>` mesmo com o
 * SO em movimento normal, ver applyReducedMotion). O canvas da poeira estelar e o
 * datilografado da tela de bloqueio consultam isto antes de animar: com o
 * movimento desligado, os dois mostram o estado FINAL de imediato, sem loop.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (document.documentElement.dataset.reducedMotion === "true") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
