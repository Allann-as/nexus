/**
 * NEXUS — gerador das marcas (Aurora 2.0, rodada v2).
 *
 * A GRADE É O DESENHO. Nenhuma curva nasce "a olho": tudo aqui é math a partir
 * do centro do quadro. Rode `node generate.mjs` e os SVGs são reescritos.
 *
 * Regras da receita (§1.1 do prompt do M4.6):
 *   - UMA cor dominante (índigo #7C8CF8), trabalhada numa RAMPA TONAL — não em
 *     matizes diferentes. `INK` abaixo é o único vocabulário de cor do símbolo.
 *   - Fonte de luz consistente: canto SUPERIOR-ESQUERDO. O que aponta para lá é
 *     mais claro; o que aponta para o canto oposto, mais escuro. `lit()` é essa lei.
 *   - Hierarquia de traço: pesos variados, terminais desenhados.
 *   - Detalhe que recompensa o zoom (graduações, facetas) some com dignidade nos
 *     tamanhos pequenos: por isso cada conceito tem 3 níveis (marca/ícone/favicon).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ─────────────────────────  A rampa tonal (um só hue)  ───────────────────── */
// Índigo da marca no centro; claros para a luz, escuros para a profundidade.
// Matiz constante (~231°): o que muda é a luminosidade. Nunca há um segundo hue.
const INK = {
  l3: "#EEF1FF", // brilho especular (quase branco azulado)
  l2: "#CAD3FF",
  l1: "#A7B4FB",
  base: "#7C8CF8", // a cor da marca
  d1: "#5D6BDC",
  d2: "#414FB4",
  d3: "#2B3585",
  d4: "#1B2258",
  d5: "#10163A", // sombra mais profunda / fundo do squircle
};
const RAMP = [INK.d4, INK.d3, INK.d2, INK.d1, INK.base, INK.l1, INK.l2, INK.l3];

// Luz vindo do canto superior-esquerdo. Uma normal que aponta pra lá recebe mais luz.
const LIGHT = norm(-1, -1);
/** brilho 0..1 de uma face cuja normal (para fora) é (nx,ny) na tela (y p/ baixo) */
function litT(nx, ny) {
  const [lx, ly] = LIGHT;
  return (dot(nx, ny, lx, ly) + 1) / 2; // -1..1 → 0..1
}
/** escolhe um tom da rampa por brilho, entre lo e hi (índices) */
function lit(nx, ny, lo = 1, hi = 6) {
  const t = litT(nx, ny);
  return RAMP[Math.round(lo + t * (hi - lo))];
}

/* ─────────────────────────────  math utils  ──────────────────────────────── */
function norm(x, y) {
  const m = Math.hypot(x, y) || 1;
  return [x / m, y / m];
}
function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}
const rad = (deg) => (deg * Math.PI) / 180;
/** ponto na circunferência; 0° = topo (12h), sentido horário */
function polar(cx, cy, r, deg) {
  const a = rad(deg - 90);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
const f = (n) => Number(n.toFixed(2));
const pt = ([x, y]) => `${f(x)},${f(y)}`;
const poly = (pts) => pts.map(pt).join(" ");

/* ───────────────────────────  wrappers de arquivo  ───────────────────────── */
function svg(vb, body, extraDefs = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}" width="${vb}" height="${vb}" role="img" aria-label="NEXUS">
<defs>${extraDefs}</defs>
${body}
</svg>\n`;
}

/** squircle (superelipse) de lado L, para o ícone de app */
function squirclePath(L, inset = 0) {
  const c = L / 2;
  const r = c - inset;
  const k = 0.2; // achatamento dos cantos: menor = mais "quadrado de app"
  const pts = [];
  const N = 80;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * 2 * Math.PI;
    // superelipse de expoente ~4
    const cs = Math.cos(a);
    const sn = Math.sin(a);
    const x = c + r * Math.sign(cs) * Math.abs(cs) ** (2 * k) ;
    const y = c + r * Math.sign(sn) * Math.abs(sn) ** (2 * k);
    pts.push([x, y]);
  }
  return "M" + pts.map(pt).join("L") + "Z";
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONCEITO 1 — ASTROLÁBIO
   Anéis concêntricos = as esferas da vida; graduações de instrumento de medida;
   a alidade (régua) cruza o centro no ângulo da marca; o núcleo é o nexo, e é o
   que brilha. Em 16px colapsa para anel + núcleo.
   ═══════════════════════════════════════════════════════════════════════════ */
function astrolabe() {
  const C = 120;
  const cx = C, cy = C;
  // Anéis (do limbo graduado para dentro). Raio + peso decrescentes = hierarquia.
  const RINGS = [
    { r: 104, w: 3.4, tone: INK.d2 }, // limbo (mater) — o mais grosso
    { r: 84, w: 2.2, tone: INK.d1 },
    { r: 65, w: 1.7, tone: INK.base },
    { r: 47, w: 1.35, tone: INK.l1 }, // clareia para dentro: a luz converge no nexo
  ];
  const ALIDADE = -34; // ângulo justificado: a diagonal do N, reusada no conceito 2

  const defs = `
    <radialGradient id="a-core" cx="38%" cy="34%" r="72%">
      <stop offset="0%" stop-color="${INK.l3}"/>
      <stop offset="30%" stop-color="${INK.l1}"/>
      <stop offset="70%" stop-color="${INK.base}"/>
      <stop offset="100%" stop-color="${INK.d2}"/>
    </radialGradient>
    <radialGradient id="a-halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${INK.base}" stop-opacity="0.5"/>
      <stop offset="60%" stop-color="${INK.base}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${INK.base}" stop-opacity="0"/>
    </radialGradient>
    ${RINGS.map((ring, i) => `
    <linearGradient id="a-ring${i}" x1="18%" y1="8%" x2="86%" y2="94%">
      <stop offset="0%" stop-color="${INK.l2}"/>
      <stop offset="42%" stop-color="${ring.tone}"/>
      <stop offset="100%" stop-color="${INK.d4}"/>
    </linearGradient>`).join("")}
  `;

  // Graduações do limbo, entre R=104 e para dentro. Três níveis de tique
  // (maior/médio/menor) = "detalhe que recompensa o olhar de perto".
  const RO = 104;
  const ticks = [];
  for (let deg = 0; deg < 360; deg += 3) {
    const major = deg % 30 === 0;
    const medium = !major && deg % 15 === 0;
    const len = major ? 11 : medium ? 6.5 : 3.5;
    const w = major ? 1.5 : medium ? 0.9 : 0.55;
    const tone = major ? INK.l1 : medium ? INK.base : INK.d1;
    const op = major ? 0.95 : medium ? 0.8 : 0.55;
    const [ox, oy] = polar(cx, cy, RO - 2, deg);
    const [ix, iy] = polar(cx, cy, RO - 2 - len, deg);
    ticks.push(`<line x1="${f(ox)}" y1="${f(oy)}" x2="${f(ix)}" y2="${f(iy)}" stroke="${tone}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`);
  }

  // Estrelas do rete: pequenos losangos nos anéis (as esferas marcadas no céu).
  const stars = [
    [84, 58], [65, 150], [84, 212], [47, 300], [65, 12],
  ].map(([r, deg]) => {
    const [x, y] = polar(cx, cy, r, deg);
    const s = 3.4;
    const d = `M${f(x)},${f(y - s)} L${f(x + s * 0.72)},${f(y)} L${f(x)},${f(y + s)} L${f(x - s * 0.72)},${f(y)} Z`;
    return `<path d="${d}" fill="${INK.l2}" opacity="0.9"/><circle cx="${f(x)}" cy="${f(y)}" r="0.9" fill="${INK.d4}"/>`;
  }).join("");

  // Alidade: régua diametral com pínulas (sight vanes) nas pontas e um ponteiro.
  const [ax1, ay1] = polar(cx, cy, 100, ALIDADE);
  const [ax2, ay2] = polar(cx, cy, 100, ALIDADE + 180);
  const [px, py] = polar(cx, cy, 104, ALIDADE); // ponta do ponteiro
  const nrm = norm(...polar(0, 0, 1, ALIDADE + 90)); // normal da barra
  const alidade = `
    <g stroke-linecap="round">
      <line x1="${f(ax2)}" y1="${f(ay2)}" x2="${f(ax1)}" y2="${f(ay1)}" stroke="${INK.d4}" stroke-width="6" opacity="0.35"/>
      <line x1="${f(ax2)}" y1="${f(ay2)}" x2="${f(ax1)}" y2="${f(ay1)}" stroke="${INK.l1}" stroke-width="2.2"/>
      <line x1="${f(ax2)}" y1="${f(ay2)}" x2="${f(ax1)}" y2="${f(ay1)}" stroke="${INK.l3}" stroke-width="0.8" opacity="0.7"/>
    </g>
    <path d="M${f(px)},${f(py)} L${f(ax1 - nrm[0]*5)},${f(ay1 - nrm[1]*5)} L${f(ax1 + nrm[0]*5)},${f(ay1 + nrm[1]*5)} Z" fill="${INK.l2}"/>
  `;

  const rings = RINGS.map((ring, i) =>
    `<circle cx="${cx}" cy="${cy}" r="${ring.r}" fill="none" stroke="url(#a-ring${i})" stroke-width="${ring.w}"/>`
  ).join("");

  const core = `
    <circle cx="${cx}" cy="${cy}" r="46" fill="url(#a-halo)"/>
    <circle cx="${cx}" cy="${cy}" r="27" fill="url(#a-core)"/>
    <circle cx="${cx}" cy="${cy}" r="27" fill="none" stroke="${INK.d3}" stroke-width="0.8" opacity="0.6"/>
    <circle cx="${cx}" cy="${cy}" r="20" fill="none" stroke="${INK.l3}" stroke-width="0.7" opacity="0.55"/>
    <circle cx="${f(cx - 6)}" cy="${f(cy - 7)}" r="4.5" fill="${INK.l3}" opacity="0.9"/>
    <circle cx="${cx}" cy="${cy}" r="2.4" fill="${INK.d4}"/>
  `;

  const body = `<g>${ticks.join("")}${rings}${stars}${alidade}${core}</g>`;
  const mark = svg(240, body, defs);

  /* ── ícone de app (squircle) — limbo só com tiques maiores, 2 anéis, núcleo ── */
  const iconTicks = [];
  for (let deg = 0; deg < 360; deg += 15) {
    const major = deg % 30 === 0;
    const len = major ? 10 : 6;
    const [ox, oy] = polar(cx, cy, RO - 4, deg);
    const [ix, iy] = polar(cx, cy, RO - 4 - len, deg);
    iconTicks.push(`<line x1="${f(ox)}" y1="${f(oy)}" x2="${f(ix)}" y2="${f(iy)}" stroke="${major ? INK.l2 : INK.base}" stroke-width="${major ? 1.8 : 1}" stroke-linecap="round" opacity="${major ? 0.95 : 0.7}"/>`);
  }
  const iconDefs = `
    <linearGradient id="a-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${INK.d3}"/>
      <stop offset="100%" stop-color="${INK.d5}"/>
    </linearGradient>
    ${defs}`;
  const iconBody = `
    <path d="${squirclePath(240)}" fill="url(#a-bg)"/>
    <path d="${squirclePath(240, 3)}" fill="none" stroke="${INK.d2}" stroke-width="1.5" opacity="0.6"/>
    <g>
      ${iconTicks.join("")}
      <circle cx="${cx}" cy="${cy}" r="104" fill="none" stroke="url(#a-ring0)" stroke-width="3.4"/>
      <circle cx="${cx}" cy="${cy}" r="72" fill="none" stroke="url(#a-ring2)" stroke-width="2"/>
      ${alidade}
      ${core}
    </g>`;
  const icon = svg(240, iconBody, iconDefs);

  /* ── app icon BOLD — a fonte do bundle raster (.ico/.png). Traço grosso,
        núcleo grande, só 12 tiques: sobrevive ao downscale para 32/16px com
        dignidade, sem virar borrão. É o nível "ícone simplificado" da receita. ── */
  const boldTicks = [];
  for (let deg = 0; deg < 360; deg += 30) {
    const [ox, oy] = polar(cx, cy, 98, deg);
    const [ix, iy] = polar(cx, cy, 84, deg);
    boldTicks.push(`<line x1="${f(ox)}" y1="${f(oy)}" x2="${f(ix)}" y2="${f(iy)}" stroke="${INK.l2}" stroke-width="3.2" stroke-linecap="round"/>`);
  }
  const [bax1, bay1] = polar(cx, cy, 96, ALIDADE);
  const [bax2, bay2] = polar(cx, cy, 96, ALIDADE + 180);
  const appicon = svg(240, `
    <path d="${squirclePath(240)}" fill="url(#a-bg)"/>
    <path d="${squirclePath(240, 4)}" fill="none" stroke="${INK.d2}" stroke-width="2" opacity="0.7"/>
    ${boldTicks.join("")}
    <circle cx="${cx}" cy="${cy}" r="100" fill="none" stroke="url(#a-ring0)" stroke-width="6.5"/>
    <circle cx="${cx}" cy="${cy}" r="64" fill="none" stroke="url(#a-ring2)" stroke-width="4"/>
    <line x1="${f(bax2)}" y1="${f(bay2)}" x2="${f(bax1)}" y2="${f(bay1)}" stroke="${INK.d5}" stroke-width="8" opacity="0.4" stroke-linecap="round"/>
    <line x1="${f(bax2)}" y1="${f(bay2)}" x2="${f(bax1)}" y2="${f(bay1)}" stroke="${INK.l1}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="52" fill="url(#a-halo)"/>
    <circle cx="${cx}" cy="${cy}" r="34" fill="url(#a-core)"/>
    <circle cx="${f(cx - 8)}" cy="${f(cy - 9)}" r="6" fill="${INK.l3}" opacity="0.92"/>
    <circle cx="${cx}" cy="${cy}" r="3" fill="${INK.d4}"/>
  `, iconDefs);

  /* ── favicon 16px — anel + núcleo, nada mais ── */
  const favicon = svg(16, `
    <circle cx="8" cy="8" r="6.6" fill="none" stroke="${INK.base}" stroke-width="1.5"/>
    <circle cx="8" cy="8" r="6.6" fill="none" stroke="${INK.l2}" stroke-width="0.5" opacity="0.6"/>
    <circle cx="8" cy="8" r="2.9" fill="${INK.l1}"/>
    <circle cx="6.9" cy="6.9" r="0.9" fill="${INK.l3}"/>
  `);

  /* ── versão com grade de construção ── */
  const gridLayer = gridCircles(cx, cy, [104, 84, 65, 47, 27], [ALIDADE, ALIDADE + 90]);
  const grid = svg(240, `${gridLayer}${body}`, defs);

  return { mark, icon, appicon, favicon, grid };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONCEITO 2 — FITA-N CONTÍNUA
   O N desenhado por UMA fita que dobra sobre si. A luz muda a cada dobra
   (profundidade sem 3D). O centro geométrico ganha o nexo (brilho).
   ═══════════════════════════════════════════════════════════════════════════ */
function ribbon() {
  const W = 30; // largura da fita
  const x0 = 66, x1 = 174; // extremos horizontais
  const y0 = 66, y1 = 174; // extremos verticais
  const cx = 120, cy = 120;

  // Os três trechos como quadriláteros. A dobra vira nas junções.
  const leftPost = [[x0, y0], [x0 + W, y0], [x0 + W, y1], [x0, y1]];
  const rightPost = [[x1 - W, y0], [x1, y0], [x1, y1], [x1 - W, y1]];
  // Diagonal: do topo do poste esquerdo à base do poste direito.
  const diag = [[x0, y0], [x0 + W, y0], [x1, y1], [x1 - W, y1]];

  // Gradientes: a luz muda a cada dobra. Poste esq. = médio; diagonal = escuro
  // (a face virou pra longe da luz); poste dir. = claro (voltou pra luz).
  const defs = `
    <linearGradient id="r-left" x1="0" y1="0" x2="1" y2="1.2">
      <stop offset="0%" stop-color="${INK.l1}"/>
      <stop offset="55%" stop-color="${INK.base}"/>
      <stop offset="100%" stop-color="${INK.d1}"/>
    </linearGradient>
    <linearGradient id="r-diag" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${INK.d1}"/>
      <stop offset="50%" stop-color="${INK.d2}"/>
      <stop offset="100%" stop-color="${INK.d3}"/>
    </linearGradient>
    <linearGradient id="r-right" x1="0" y1="0" x2="1" y2="1.2">
      <stop offset="0%" stop-color="${INK.l2}"/>
      <stop offset="55%" stop-color="${INK.l1}"/>
      <stop offset="100%" stop-color="${INK.base}"/>
    </linearGradient>
    <radialGradient id="r-nexus" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${INK.l3}" stop-opacity="0.95"/>
      <stop offset="35%" stop-color="${INK.l2}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${INK.l2}" stop-opacity="0"/>
    </radialGradient>
  `;

  // Vincos: hairlines claras nas arestas de dobra (onde os trechos se encontram).
  const foldA = `M${pt([x0 + W, y0])} L${pt([x1, y1])}`; // aresta interna da diagonal
  const foldB = `M${pt([x0, y0])} L${pt([x1 - W, y1])}`; // aresta externa da diagonal
  const seamTop = `M${pt([x0 + W, y0])} L${pt([x0 + W, 92])}`; // costura do vinco superior-esq
  const seamBot = `M${pt([x1 - W, y1])} L${pt([x1 - W, 148])}`; // costura do vinco inferior-dir

  const body = `
    <g>
      <polygon points="${poly(diag)}" fill="url(#r-diag)"/>
      <polygon points="${poly(leftPost)}" fill="url(#r-left)"/>
      <polygon points="${poly(rightPost)}" fill="url(#r-right)"/>
      <path d="${foldA}" stroke="${INK.d4}" stroke-width="1" opacity="0.4"/>
      <path d="${foldB}" stroke="${INK.l2}" stroke-width="0.9" opacity="0.55"/>
      <path d="${seamTop}" stroke="${INK.l2}" stroke-width="0.9" opacity="0.5"/>
      <path d="${seamBot}" stroke="${INK.d4}" stroke-width="0.9" opacity="0.4"/>
      <!-- brilho de topo em cada poste: a luz bate na quina de cima -->
      <path d="M${pt([x0, y0 + 1.2])} L${pt([x0 + W, y0 + 1.2])}" stroke="${INK.l3}" stroke-width="1.4" opacity="0.7" stroke-linecap="round"/>
      <path d="M${pt([x1 - W, y0 + 1.2])} L${pt([x1, y0 + 1.2])}" stroke="${INK.l3}" stroke-width="1.4" opacity="0.85" stroke-linecap="round"/>
      <!-- o nexo: o cruzamento no centro -->
      <circle cx="${cx}" cy="${cy}" r="26" fill="url(#r-nexus)"/>
      <circle cx="${cx}" cy="${cy}" r="3.1" fill="${INK.l3}"/>
    </g>`;
  const mark = svg(240, body, defs);

  /* ── ícone de app ── */
  const iconDefs = `
    <linearGradient id="r-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${INK.d3}"/>
      <stop offset="100%" stop-color="${INK.d5}"/>
    </linearGradient>${defs}`;
  const icon = svg(240, `
    <path d="${squirclePath(240)}" fill="url(#r-bg)"/>
    <path d="${squirclePath(240, 3)}" fill="none" stroke="${INK.d2}" stroke-width="1.5" opacity="0.6"/>
    ${body}`, iconDefs);

  /* ── favicon 16px — N cheio, duas tonalidades ── */
  const s = 16 / 240;
  const sc = (p) => [p[0] * s, p[1] * s];
  const favicon = svg(16, `
    <polygon points="${poly(diag.map(sc))}" fill="${INK.d2}"/>
    <polygon points="${poly(leftPost.map(sc))}" fill="${INK.base}"/>
    <polygon points="${poly(rightPost.map(sc))}" fill="${INK.l1}"/>
    <circle cx="8" cy="8" r="1.1" fill="${INK.l3}"/>
  `);

  /* ── grade ── */
  const gridLayer = `
    <g stroke="${INK.d2}" stroke-width="0.5" opacity="0.5" fill="none">
      <rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>
      <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>
      <line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y1}"/>
      <line x1="${x0}" y1="${cy}" x2="${x1}" y2="${cy}"/>
      <circle cx="${cx}" cy="${cy}" r="26"/>
    </g>`;
  const grid = svg(240, `${gridLayer}${body}`, defs);

  return { mark, icon, favicon, grid };
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONCEITO 3 — SELO FACETADO
   Um octógono biselado (a gema que pega luz na moldura), e no campo central um
   N em prisma: cada haste tem duas facetas (lado claro / lado escuro) e uma
   crista especular. As arestas internas formam o N. Passa permanência.
   ═══════════════════════════════════════════════════════════════════════════ */
function seal() {
  const cx = 120, cy = 120;
  const RO = 96, RI = 72; // octógono externo/interno (a moldura biselada)
  const oct = (r) => Array.from({ length: 8 }, (_, i) => polar(cx, cy, r, 22.5 + i * 45));
  const outer = oct(RO), inner = oct(RI);

  // Bisel: 8 trapézios, um por aresta. Tom por orientação da normal vs. luz.
  const bevels = outer.map((o, i) => {
    const oN = outer[(i + 1) % 8];
    const iN = inner[(i + 1) % 8];
    const iC = inner[i];
    // normal para fora da aresta = média das direções radiais dos dois vértices
    const mx = (o[0] + oN[0]) / 2 - cx, my = (o[1] + oN[1]) / 2 - cy;
    const [nx, ny] = norm(mx, my);
    const tone = lit(nx, ny, 1, 6);
    return `<polygon points="${poly([o, oN, iN, iC])}" fill="${tone}"/>`;
  }).join("");
  // Arestas do bisel: hairlines para dar corte de gema.
  const bevelEdges = outer.map((o, i) => {
    const iC = inner[i];
    const [nx, ny] = norm(o[0] - cx, o[1] - cy);
    const bright = litT(nx, ny) > 0.5;
    return `<line x1="${f(o[0])}" y1="${f(o[1])}" x2="${f(iC[0])}" y2="${f(iC[1])}" stroke="${bright ? INK.l3 : INK.d5}" stroke-width="0.8" opacity="${bright ? 0.7 : 0.5}"/>`;
  }).join("");

  // Campo central recuado (mais escuro): onde o N vive.
  const field = `<polygon points="${poly(inner)}" fill="${INK.d4}"/>`;

  // O N em prisma dentro do campo. Cada haste = dois triângulos ao longo do eixo.
  const W = 15;
  const bx0 = 88, bx1 = 152, by0 = 84, by1 = 156;
  function prism(quad, axisVertical) {
    // quad em ordem: TL, TR, BR, BL. Divide pelo meio no eixo longo → 2 facetas.
    const [TL, TR, BR, BL] = quad;
    const midTop = mid(TL, TR), midBot = mid(BL, BR);
    // faceta esquerda/superior recebe mais luz; direita/inferior menos.
    const nA = axisVertical ? norm(-1, 0) : norm(0, -1);
    const nB = axisVertical ? norm(1, 0) : norm(0, 1);
    const facetA = `<polygon points="${poly([TL, midTop, midBot, BL])}" fill="${lit(nA[0], nA[1], 3, 7)}"/>`;
    const facetB = `<polygon points="${poly([midTop, TR, BR, midBot])}" fill="${lit(nB[0], nB[1], 1, 4)}"/>`;
    const ridge = `<line x1="${f(midTop[0])}" y1="${f(midTop[1])}" x2="${f(midBot[0])}" y2="${f(midBot[1])}" stroke="${INK.l3}" stroke-width="1" opacity="0.75"/>`;
    return facetA + facetB + ridge;
  }
  const leftPost = [[bx0, by0], [bx0 + W, by0], [bx0 + W, by1], [bx0, by1]];
  const rightPost = [[bx1 - W, by0], [bx1, by0], [bx1, by1], [bx1 - W, by1]];
  const diag = [[bx0, by0], [bx0 + W, by0], [bx1, by1], [bx1 - W, by1]];
  const N =
    prism(diag, false) +
    prism(leftPost, true) +
    prism(rightPost, true);

  const defs = `
    <radialGradient id="s-glow" cx="42%" cy="38%" r="70%">
      <stop offset="0%" stop-color="${INK.l2}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${INK.l2}" stop-opacity="0"/>
    </radialGradient>`;
  const body = `
    <g>
      ${bevels}
      ${field}
      <polygon points="${poly(inner)}" fill="url(#s-glow)"/>
      ${N}
      ${bevelEdges}
      <polygon points="${poly(inner)}" fill="none" stroke="${INK.d5}" stroke-width="1.2" opacity="0.7"/>
      <polygon points="${poly(outer)}" fill="none" stroke="${INK.l2}" stroke-width="0.8" opacity="0.35"/>
    </g>`;
  const mark = svg(240, body, defs);

  /* ── ícone de app: o próprio selo já é a forma; sobre um squircle escuro ── */
  const iconDefs = `
    <linearGradient id="s-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${INK.d3}"/>
      <stop offset="100%" stop-color="${INK.d5}"/>
    </linearGradient>${defs}`;
  const icon = svg(240, `
    <path d="${squirclePath(240)}" fill="url(#s-bg)"/>
    ${body}`, iconDefs);

  /* ── favicon 16px: octógono cheio + N simples ── */
  const s16 = 16 / 240;
  const sc = (p) => [p[0] * s16, p[1] * s16];
  const favicon = svg(16, `
    <polygon points="${poly(outer.map(sc))}" fill="${INK.d2}"/>
    <polygon points="${poly(inner.map(sc))}" fill="${INK.d4}"/>
    <polygon points="${poly(leftPost.map(sc))}" fill="${INK.l1}"/>
    <polygon points="${poly(diag.map(sc))}" fill="${INK.base}"/>
    <polygon points="${poly(rightPost.map(sc))}" fill="${INK.l1}"/>
  `);

  /* ── grade ── */
  const gridLayer = `
    <g stroke="${INK.d2}" stroke-width="0.5" opacity="0.5" fill="none">
      <circle cx="${cx}" cy="${cy}" r="${RO}"/>
      <circle cx="${cx}" cy="${cy}" r="${RI}"/>
      ${outer.map((o) => `<line x1="${cx}" y1="${cy}" x2="${f(o[0])}" y2="${f(o[1])}"/>`).join("")}
      <rect x="${bx0}" y="${by0}" width="${bx1 - bx0}" height="${by1 - by0}"/>
    </g>`;
  const grid = svg(240, `${gridLayer}${body}`, defs);

  return { mark, icon, favicon, grid };
}

function mid(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/* grade de círculos concêntricos + raios, para as versões "com grade" */
function gridCircles(cx, cy, radii, spokes) {
  const circles = radii.map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${INK.d2}" stroke-width="0.5" opacity="0.5"/>`).join("");
  const rays = [];
  for (let deg = 0; deg < 360; deg += 30) {
    const [x, y] = polar(cx, cy, 108, deg);
    rays.push(`<line x1="${cx}" y1="${cy}" x2="${f(x)}" y2="${f(y)}" stroke="${INK.d2}" stroke-width="0.4" opacity="0.35"/>`);
  }
  const s = spokes.map((deg) => {
    const [x1, y1] = polar(cx, cy, 108, deg);
    const [x2, y2] = polar(cx, cy, 108, deg + 180);
    return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${INK.base}" stroke-width="0.6" opacity="0.5"/>`;
  }).join("");
  return `<g>${circles}${rays.join("")}${s}</g>`;
}

/* ─────────────────────────────  emitir  ──────────────────────────────────── */
const CONCEPTS = { astrolabe: astrolabe(), ribbon: ribbon(), seal: seal() };
for (const [name, set] of Object.entries(CONCEPTS)) {
  for (const [variant, content] of Object.entries(set)) {
    writeFileSync(join(HERE, name, `${variant}.svg`), content);
  }
  console.log(`  ${name}: mark, icon, favicon, grid`);
}
console.log("ok");
