/**
 * O tema do ECharts — a linguagem Midnight aplicada a gráfico de verdade.
 *
 * # Quando usar ECharts, e quando NÃO usar
 *
 * A regra é o ADR-0018: **SVG para ≤ ~100 pontos decorativos; ECharts para
 * telas de análise.** Os sparklines e anéis do Hub são e continuam sendo SVG
 * (`charts.tsx`) — o Hub é o caminho do cold start e nunca instancia engine de
 * gráfico. Aqui entra o que pede eixo, tooltip, zoom e legenda: calendário,
 * heatmaps, Finanças e Insights.
 *
 * # Por que um tema, e não opções soltas por gráfico
 *
 * Um `option` de ECharts tem ~40 chaves de estilo. Repetir isso por gráfico
 * garante que o quinto vá divergir do primeiro — e aí "o app tem gráficos
 * bonitos" vira "o app tem cinco estilos de gráfico". O tema é registrado uma
 * vez e todo gráfico nasce certo; o `option` de cada tela fica só com o DADO.
 *
 * # Os tokens não chegam aqui sozinhos
 *
 * O ECharts pinta em canvas, então ele precisa de cor RESOLVIDA — `var(--accent)`
 * chegaria como a string literal e o canvas desenharia preto. `readToken()` lê
 * o valor computado do CSS no momento do registro. Por isso o tema é registrado
 * DEPOIS do tema claro/escuro estar aplicado no `<html>`, e re-registrado quando
 * ele troca (ver `useEchartsTheme`).
 */

import * as echarts from "echarts/core";

export const NEXUS_THEME = "nexus";

/** Lê um token do CSS já resolvido. O canvas não entende `var(--x)`. */
function readToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Monta e registra o tema a partir dos tokens vigentes.
 *
 * Idempotente: registrar duas vezes com o mesmo nome sobrescreve, que é
 * exatamente o que a troca de tema precisa.
 */
export function registerNexusTheme(): void {
  const accent = readToken("--accent", "#4D8DFF");
  const accentBright = readToken("--accent-bright", "#7EB2FF");
  const textPrimary = readToken("--text-primary", "#EDF2FC");
  const textSecondary = readToken("--text-secondary", "#8FA0C2");
  const textTertiary = readToken("--text-tertiary", "#54637F");
  const surface = readToken("--bg-surface", "#0E1729");
  const border = readToken("--border-subtle", "#1B2A47");

  // Eixos e grid quase invisíveis: zero chartjunk. A linha do dado é a única
  // coisa que pode ser forte na tela.
  const axisLine = { lineStyle: { color: border, width: 1 } };
  const axisLabel = { color: textTertiary, fontSize: 10, fontFamily: "JetBrains Mono" };
  const splitLine = { lineStyle: { color: border, width: 1, type: "solid" as const } };

  echarts.registerTheme(NEXUS_THEME, {
    color: [
      accent,
      readToken("--sphere-saude", "#34D399"),
      readToken("--sphere-objetivos", "#FBBF24"),
      readToken("--sphere-carreira", "#EC4899"),
      readToken("--sphere-estudos", "#5B8DEF"),
      readToken("--accent-deep", "#1E4FD8"),
    ],
    backgroundColor: "transparent",

    textStyle: { fontFamily: "Inter Variable, Inter, sans-serif", color: textSecondary },

    title: {
      textStyle: { color: textPrimary, fontSize: 13, fontWeight: 600 },
      subtextStyle: { color: textTertiary, fontSize: 11 },
    },

    // A linha do Midnight: 2px, ponta redonda, com halo.
    line: {
      lineStyle: { width: 2, cap: "round" as const, join: "round" as const },
      symbol: "circle",
      symbolSize: 6,
      smooth: false,
    },

    categoryAxis: {
      axisLine,
      axisTick: { show: false },
      axisLabel,
      splitLine: { show: false },
      splitArea: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel,
      splitLine,
      splitArea: { show: false },
    },

    // Tooltip no padrão GlassPanel — nunca o branco default, que numa tela
    // navy parece um bug de renderização.
    tooltip: {
      backgroundColor: surface,
      borderColor: border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: textPrimary, fontSize: 12 },
      extraCssText: `border-radius: 10px; box-shadow: ${readToken(
        "--shadow-float",
        "0 16px 48px rgb(2 6 16 / 0.66)",
      )};`,
      axisPointer: {
        lineStyle: { color: accentBright, width: 1, type: "dashed" as const },
        crossStyle: { color: accentBright, width: 1 },
      },
    },

    legend: { textStyle: { color: textSecondary, fontSize: 11 }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },

    grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
  });
}

/**
 * O glow de uma série de linha — o traço com brilho do Midnight.
 *
 * Fica aqui e não no tema porque o ECharts não deixa `shadowBlur` de série no
 * registro do tema; ele é do `itemStyle`/`lineStyle` de cada série. Espalhar
 * `shadowBlur: 12` por cada tela seria a divergência que o tema existe para
 * evitar, então a receita mora num lugar só.
 *
 * `shadowBlur` é ESTÁTICO: a sombra não anima. Animar sombra em loop é o que a
 * §6 do plano proíbe — ela repinta todo frame.
 */
export function glowLine(color: string) {
  return {
    lineStyle: {
      width: 2,
      color,
      shadowBlur: 12,
      shadowColor: color,
      cap: "round" as const,
    },
    itemStyle: { color },
  };
}

/**
 * O gradiente de área sob uma linha: a cor em 25% descendo para transparente.
 */
export function areaGradient(color: string) {
  return {
    color: {
      type: "linear" as const,
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: withAlpha(color, 0.25) },
        { offset: 1, color: withAlpha(color, 0) },
      ],
    },
  };
}

/**
 * `#RRGGBB` + alfa → `rgb(r g b / a)`.
 *
 * O canvas do ECharts não aceita `color-mix()`, que é como o resto do design
 * system compõe transparência. Um hex de 8 dígitos (`#RRGGBBAA`) resolveria,
 * mas quebraria se a cor vier como `rgb(...)` do `getComputedStyle`.
 */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${r} ${g} ${b} / ${alpha})`;
  }
  // Já é rgb()/rgba() vindo do getComputedStyle: deixa o browser resolver.
  const m = hex.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b] = m[1].split(/[\s,]+/);
    return `rgb(${r} ${g} ${b} / ${alpha})`;
  }
  return hex;
}
