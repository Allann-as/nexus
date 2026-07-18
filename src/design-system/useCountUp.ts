/**
 * Números que montam contando.
 *
 * Regra do Midnight: todo valor de destaque conta até o seu número na entrada.
 * É o que faz o dado parecer vivo em vez de impresso.
 *
 * Três coisas que este hook faz questão de acertar:
 *
 *  1. **Anima só quando o dado muda.** Nunca em idle, nunca em re-render por
 *     hover ou por estado de vizinho. Com o app parado, zero rAF agendado —
 *     é o que faz o DevTools Performance mostrar 0% de CPU ocioso (§6).
 *  2. **Respeita `prefers-reduced-motion`.** Sem animação o valor aparece
 *     PRONTO. Um número que fica em 0 para quem desligou movimento seria pior
 *     que um número que não anima.
 *  3. **Termina exato.** O último frame é `to`, não "0.998 × to" — o valor
 *     final é atribuído fora da interpolação. Sem isso um "100%" acabaria
 *     eternamente em 99%.
 */

import { useEffect, useRef, useState } from "react";

/** easeOutQuart — desacelera forte no fim; é o que faz o número "assentar". */
function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

function prefersReducedMotion(): boolean {
  // O override manual das Configurações (data-reduced-motion) vale além do SO:
  // quem forçou "reduzir movimento" vê o número pronto, não contando.
  if (document.documentElement.dataset.reducedMotion === "true") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Conta de 0 (ou do valor anterior) até `to` e devolve o valor corrente.
 *
 * @param to      o destino. Mudou o destino, recomeça a contagem de onde está.
 * @param durMs   duração. 500ms é o padrão do Midnight.
 */
export function useCountUp(to: number, durMs = 500): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? to : 0));
  // Guardado em ref e não em state: ler o valor de partida não pode causar
  // um render a mais, e ele muda dentro do próprio efeito.
  const fromRef = useRef(prefersReducedMotion() ? to : 0);

  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(to)) {
      fromRef.current = to;
      setValue(to);
      return;
    }

    const from = fromRef.current;
    if (from === to) return;

    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durMs);
      if (t >= 1) {
        // Exato no fim, sempre.
        fromRef.current = to;
        setValue(to);
        return;
      }
      setValue(from + (to - from) * easeOutQuart(t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Desmontar no meio da contagem tem que cancelar o frame pendente: sem
    // isto, trocar de tela durante a animação deixa um rAF vivo chamando
    // setState num componente morto.
    return () => cancelAnimationFrame(raf);
  }, [to, durMs]);

  return value;
}
