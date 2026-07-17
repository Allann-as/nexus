/**
 * A capa gerada de um livro — arte determinística, sem imagem externa.
 *
 * Um livro na estante precisa de uma cara. Buscar capa de API seria rede, cache
 * e um estado de "carregando imagem" por card; aqui a capa É o título: um
 * gradiente de duas paradas cujo tom é um hash estável do nome. O mesmo livro
 * abre sempre com a mesma cor, e a cor é escura o bastante para o texto branco
 * por cima ficar legível sobre o navy.
 *
 * Exceção às regras de cor do projeto: aqui o hex é a ARTE (capas são dado
 * virado desenho), então a cor é calculada, não uma var de tema.
 */

/** DJB2 — hash estável e barato de string. Serve para escolher o tom. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  // >>> 0 para voltar a um inteiro sem sinal — senão o módulo dá negativo.
  return h >>> 0;
}

/** hsl → estilo de fundo. Mantém a arte num único lugar. */
function hsl(h: number, s: number, l: number): string {
  return `hsl(${h} ${s}% ${l}%)`;
}

/**
 * O estilo da capa: um gradiente diagonal de duas paradas, tom estável no
 * título. Saturação e luminância são fixas e baixas — capas garridas brigariam
 * com o navy; estas assentam nele e deixam o branco por cima legível.
 */
export function coverStyle(title: string): React.CSSProperties {
  const hue = hashString(title.trim().toLowerCase()) % 360;
  // A segunda parada gira 40° — o suficiente para o gradiente ter vida sem
  // virar arco-íris. Ambas escuras (22%/13%) para o texto branco vencer sempre.
  const top = hsl(hue, 42, 22);
  const bottom = hsl((hue + 40) % 360, 38, 13);
  return {
    background: `linear-gradient(150deg, ${top} 0%, ${bottom} 100%)`,
  };
}

/** Palavras vazias do português — não viram inicial de capa. */
const STOPWORDS = new Set([
  "o", "a", "os", "as", "um", "uma", "uns", "umas",
  "de", "da", "do", "das", "dos", "e", "ou", "em", "no", "na",
  "nos", "nas", "por", "para", "com", "sem", "que", "ao", "aos",
]);

/**
 * 1–2 letras maiúsculas das palavras significativas do título.
 *
 * "O Nome do Vento" → "NV"; "1984" → "19"; "Sapiens" → "S". Pula as palavras
 * vazias para a inicial cair no que importa, não no artigo.
 */
export function bookInitials(title: string): string {
  const words = title
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const significant = words.filter(
    (w) => !STOPWORDS.has(w.toLowerCase()),
  );
  const pick = (significant.length > 0 ? significant : words).slice(0, 2);

  if (pick.length === 0) return "?";
  if (pick.length === 1) {
    // Uma palavra só: duas primeiras letras dela ("Sapiens" → "SA" fica pesado;
    // uma inicial é mais limpo). Mas para números ("1984") duas lê melhor.
    const w = pick[0];
    return /^\d/.test(w) ? w.slice(0, 2).toUpperCase() : w[0].toUpperCase();
  }
  return pick.map((w) => w[0].toUpperCase()).join("");
}
