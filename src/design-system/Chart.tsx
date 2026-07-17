/**
 * A ponte React → ECharts.
 *
 * Um componente e não `useEffect` espalhado por tela, porque as quatro regras da
 * §6 do plano são fáceis de esquecer uma por vez e todas custam caro:
 *
 *   1. **Uma instância por gráfico.** `echarts.init` no mesmo `<div>` duas vezes
 *      vaza a primeira — e um canvas vazado continua desenhando.
 *   2. **`lazyUpdate` + `notMerge: false`** no set de opção: sem isso todo
 *      re-render remonta o gráfico do zero.
 *   3. **Animação só na montagem.** Re-render com animação ligada faz a linha
 *      "pular" a cada dado novo, e o app parece nervoso em vez de vivo.
 *   4. **Resize por `ResizeObserver`.** O ECharts não redimensiona sozinho: sem
 *      isto o gráfico fica do tamanho que o container tinha no primeiro frame —
 *      normalmente zero, se ele montou dentro de algo que ainda ia crescer.
 *
 * `dispose` no unmount não é higiene: sem ele, cada visita à tela deixa um
 * canvas e um observer vivos, e o orçamento de 300 MB acaba.
 */

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import { NEXUS_THEME, registerNexusTheme } from "./nexusTheme";
import { useUi } from "../stores/ui";
import { cx } from "./primitives";

// Import a la carte: o bundle só carrega o que o app desenha. O `echarts`
// inteiro custa ~1 MB, e o NEXUS usa quatro tipos de gráfico.
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export function Chart({
  option,
  height = 240,
  className,
  onReady,
}: {
  /** O `option` do ECharts. Só o DADO — o estilo vem do tema. */
  option: echarts.EChartsCoreOption;
  height?: number;
  className?: string;
  onReady?: (chart: echarts.ECharts) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  // O `option` mais recente, para a montagem poder pintar sem entrar nas deps
  // do efeito que cria a instância.
  const optionRef = useRef(option);
  optionRef.current = option;
  // `false` até o primeiro `setOption`. É o que separa "entrou na tela" (anima)
  // de "o dado mudou" (não anima).
  const painted = useRef(false);

  // O tema resolve tokens do CSS, então trocar claro/escuro exige re-registrar
  // e remontar: o canvas já pintou as cores antigas e não as recalcula sozinho.
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    if (!ref.current) return;

    registerNexusTheme();
    const chart = echarts.init(ref.current, NEXUS_THEME, { renderer: "canvas" });
    chartRef.current = chart;
    // Pinta JÁ, com o option corrente. Sem isto, uma troca de tema descarta a
    // instância e cria outra vazia — o efeito de baixo só roda quando `option`
    // muda, e trocar de tema não muda o dado.
    painted.current = false;
    chart.setOption({ ...optionRef.current, animation: true });
    painted.current = true;
    onReady?.(chart);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // `option` fora das deps de propósito: quem alimenta o dado é o efeito
    // abaixo. Juntar os dois recriaria o canvas a cada mudança de valor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // Montagem anima; atualização, não. Uma linha que refaz o desenho de 600ms
    // a cada tick de dado deixa o app nervoso — e a §6 do plano proíbe
    // animação que não seja de entrada.
    //
    // `lazyUpdate`: o ECharts agrupa a mudança no próximo frame em vez de
    // recalcular o layout inteiro a cada `setOption`.
    chart.setOption(
      { ...option, animation: !painted.current },
      { lazyUpdate: true, notMerge: false },
    );
    painted.current = true;
  }, [option]);

  return <div ref={ref} className={cx("w-full", className)} style={{ height }} />;
}
