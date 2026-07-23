// Rasteriza o NÚCLEO ORBITAL (mesma geometria do NexusMark/splash) num PNG 1024²
// com o squircle grafite de fundo, para alimentar `tauri icon`. Usa o Edge do
// sistema (mesmo truque do harness). Saída: ../../app-icon.png (raiz do projeto).
const PW_ABS = 'file:///C:/Users/allan/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
let chromium;
try { const m = await import('playwright'); chromium = m.chromium ?? m.default?.chromium; }
catch { const m = await import(PW_ABS); chromium = m.chromium ?? m.default?.chromium; }

// viewBox 240 (a mesma grade do NexusMark), renderizado a 1024². Squircle grafite
// + duas órbitas cruzadas + núcleo + dois corpos. Sem glow (vaza fora do quadro).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 240 240" fill="none">
  <defs>
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#12181B"/>
      <stop offset="100%" stop-color="#070A0B"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="208" height="208" rx="58" fill="url(#p)"/>
  <rect x="16" y="16" width="208" height="208" rx="58" fill="none" stroke="#2C4A40" stroke-width="1.5" opacity="0.8"/>
  <ellipse cx="120" cy="120" rx="98" ry="38" stroke="#33E1A0" stroke-width="7" opacity=".5" transform="rotate(-25 120 120)"/>
  <ellipse cx="120" cy="120" rx="98" ry="38" stroke="#33E1A0" stroke-width="7" opacity=".3" transform="rotate(35 120 120)"/>
  <circle cx="120" cy="120" r="24" fill="#33E1A0"/>
  <circle cx="33" cy="82" r="10" fill="#33E1A0"/>
  <circle cx="202" cy="164" r="8" fill="#33E1A0" opacity=".75"/>
</svg>`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(
  `<!doctype html><html><head><style>*{margin:0;padding:0}html,body{width:1024px;height:1024px;background:transparent}</style></head><body>${svg}</body></html>`,
  { waitUntil: 'networkidle' },
);
const out = new URL('../../app-icon.png', import.meta.url).pathname.slice(1);
await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } });
console.log('wrote', out);
// Também salva o SVG-fonte para o repo (docs/).
const { writeFileSync } = await import('node:fs');
writeFileSync(new URL('./icon-source.svg', import.meta.url).pathname.slice(1), svg);
await browser.close();
