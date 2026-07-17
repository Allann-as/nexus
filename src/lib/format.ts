/** Presentation-only formatting shared across features. */

/**
 * Até quantas casas uma métrica pode mostrar antes de virar poeira de float.
 *
 * Uma pesagem tem 1 casa, uma altura tem 2; ninguém registra um peso com 5
 * decimais. O teto existe só para `0.1 + 0.2 = 0.30000000000000004` não pintar
 * 17 casas na tela.
 */
const MAX_METRIC_DECIMALS = 4;

/**
 * Quantas casas decimais um VALOR REGISTRADO merece — as que ele realmente tem.
 *
 * A regra do arquiteto: **o valor exibido é sempre o valor registrado, com as
 * casas que o usuário digitou. Arredondamento só em agregados, nunca em
 * registros.** Uma meta de 82 kg até 72 kg tem alvo inteiro, mas a pesagem de
 * hoje é 77,4 — e arredondar pelo alvo exibia "77", um número que o usuário
 * nunca registrou. As casas vêm do VALOR, não de outro campo.
 *
 * `toFixed` + poda dos zeros à direita mata a poeira de float (77,40000001 →
 * 77,4) sem inventar precisão: 82 continua sem casa, 72,45 continua com duas.
 *
 * É o único lugar que decide isso. Cada tela que mostra um número registrado
 * passa por aqui — `decimalsFor` local em componente é o bug que esta função
 * fecha.
 */
export function metricDecimals(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const trimmed = value
    .toFixed(MAX_METRIC_DECIMALS)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  const dot = trimmed.indexOf(".");
  return dot === -1 ? 0 : trimmed.length - dot - 1;
}

/**
 * Um valor registrado, como texto pt-BR, com a precisão dele.
 *
 * Para exibição estática (fora do count-up, que precisa das casas soltas). A
 * vírgula é a decimal do português; o valor é o registrado, não um arredondado.
 */
export function formatMetric(value: number): string {
  const decimals = metricDecimals(value);
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Centavos → "R$ 1.234,56". Dinheiro é sempre centavo inteiro no NEXUS
 * (constituição): a conversão para reais mora aqui, num lugar só, para nenhuma
 * tela dividir por 100 à mão e arredondar diferente.
 */
export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * Centavos → "R$ 1,2 mil" / "R$ 3,4 mi" — para eixos de gráfico e rótulos
 * curtos, onde o valor exato pesa mais que a precisão.
 *
 * Só para APRESENTAÇÃO em espaço apertado: o número exato aparece no tooltip e
 * nos cards, formatado por `formatMoney`. Aqui o arredondamento é legítimo —
 * é um rótulo de eixo, não um registro (ver `metricDecimals`).
 */
export function formatMoneyShort(cents: number): string {
  const reais = cents / 100;
  const abs = Math.abs(reais);
  if (abs >= 1_000_000) return `R$ ${(reais / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `R$ ${(reais / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${reais.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}

/** Byte counts in the largest unit that keeps the number readable. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
