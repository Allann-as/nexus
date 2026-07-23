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

/**
 * O FUNDO deve animar? (fase 10, BUG B)
 *
 * DESACOPLADO do `prefers-reduced-motion` do SO de propósito: a galáxia ambiente é
 * a identidade do produto, e no Windows o "Efeitos de animação" desligado fazia o
 * WebView2 reportar `reduce` e o fundo congelava sem o usuário pedir. A verdade
 * agora é a preferência "Movimento do fundo" (`<html data-bg-motion>`, default
 * LIGADO — ver applyBackgroundMotion/useUi). Sem a marca ainda escrita (primeiro
 * quadro do boot), o default é LIGADO: o ambiente nasce vivo.
 */
export function backgroundMotionOn(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.dataset.bgMotion !== "reduced";
}
