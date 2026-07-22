/**
 * Os TIERS de conquista — a cor e o nome de cada grau, num lugar só.
 *
 * O grau é RARIDADE, nunca pontuação: Ouro não vale mais que Bronze, é mais
 * raro (`domain::achievements`). As quatro cores são metais, e por isso são os
 * únicos hex crus que o design system admite: um metal não é um token de tema —
 * bronze é bronze no claro e no escuro, e derivá-lo de `--warning` faria o
 * dourado mudar junto com o âmbar de alerta.
 *
 * Existe porque o mesmo mapa já estava copiado na galeria de Conquistas e na
 * Semana Perfeita, e a Timeline seria a terceira cópia. Três cópias divergem no
 * dia em que só uma for corrigida — foi o argumento do `ArmedDelete` (v1.2) e do
 * `domain::ordering` (M3), e vale igual aqui.
 */

/** A cor de cada grau. Do backend vem a chave em minúsculas. */
export const TIER_COLOR: Record<string, string> = {
  bronze: "#C08457",
  silver: "#A8B0BC",
  gold: "#E0B34D",
  platinum: "#C4B5FD",
};

/** O rótulo de cada grau — o mesmo vocabulário da cor, escrito. */
export const TIER_LABEL: Record<string, string> = {
  bronze: "Bronze",
  silver: "Prata",
  gold: "Ouro",
  platinum: "Platina",
};

/** A ordem em que os graus aparecem — do mais fácil ao mais raro. */
export const TIER_ORDER = ["bronze", "silver", "gold", "platinum"];

/** A cor de um grau, com o fallback do accent para um grau desconhecido. */
export function tierColor(tier: string | null | undefined): string {
  return (tier && TIER_COLOR[tier]) || "var(--accent)";
}
