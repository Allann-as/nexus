// DIAGNÓSTICO (passo 0) — mede, no render real (Edge headless + stub), se a
// galáxia ANIMA: matchMedia reduced, frames de RAF em 1s, e o teste dos DOIS
// quadros (toDataURL com ~450ms) por canvas — no bloqueio e no app, com e sem
// reduced-motion do SO. Não edita nada; só observa.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./harness.mjs', import.meta.url), 'utf8');
const PW_ABS = 'file:///C:/Users/allan/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
let chromium;
try { const m = await import('playwright'); chromium = m.chromium ?? m.default?.chromium; }
catch { const m = await import(PW_ABS); chromium = m.chromium ?? m.default?.chromium; }

// extrai o corpo de makeInit(scenario, displayName) do harness p/ reusar o stub
const start = src.indexOf('return `', src.indexOf('function makeInit'));
const end = src.indexOf('}\n\nasync function newPage');
const makeInit = new Function('scenario', 'displayName', src.slice(start, end));

const BASE = 'http://localhost:1420';

async function probe(browser, { reduce, scenario, url, label, bgPref }) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    ...(reduce ? { reducedMotion: 'reduce' } : {}),
  });
  const page = await ctx.newPage();
  await page.addInitScript(makeInit(scenario, 'Allan'));
  // Injeta a preferência "Movimento do fundo" no localStorage ANTES do main.tsx.
  if (bgPref !== undefined) {
    await page.addInitScript((pref) => {
      localStorage.setItem('nexus.ui', JSON.stringify({ state: { theme: 'dark', backgroundMotion: pref }, version: 0 }));
    }, bgPref);
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const res = await page.evaluate(async () => {
    const mm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // frames de RAF em ~600ms
    const frames = await new Promise((r) => {
      let n = 0; const id = requestAnimationFrame(function c() { n++; requestAnimationFrame(c); });
      setTimeout(() => { cancelAnimationFrame(id); r(n); }, 600);
    });
    // por canvas: move em ~450ms?
    const cvs = [...document.querySelectorAll('canvas')];
    const a = cvs.map((c) => { try { return c.toDataURL(); } catch { return 'x'; } });
    await new Promise((r) => setTimeout(r, 450));
    const b = cvs.map((c) => { try { return c.toDataURL(); } catch { return 'y'; } });
    const moving = a.map((x, i) => x !== b[i]);
    const bgAttr = document.documentElement.dataset.bgMotion ?? '(none)';
    return { mm, frames, canvases: cvs.length, moving, bgAttr };
  });
  console.log(`[${label}] reduce=${reduce} bgPref=${bgPref ?? 'default'} mm=${res.mm} bgMotionAttr=${res.bgAttr} frames600ms=${res.frames} canvases=${res.canvases} MOVENDO=${JSON.stringify(res.moving)}`);
  await ctx.close();
  return res;
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  console.log('--- A CORREÇÃO: SO em reduce, preferência default (Ligado) → deve MOVER ---');
  await probe(browser, { reduce: true, scenario: 'lock', url: BASE, label: 'BLOQUEIO', bgPref: undefined });
  await probe(browser, { reduce: true, scenario: 'app', url: BASE + '/#/sphere/health', label: 'APP', bgPref: undefined });
  console.log('--- CONTROLE: preferência "reduced" → deve PARAR (mesmo sem reduce do SO) ---');
  await probe(browser, { reduce: false, scenario: 'lock', url: BASE, label: 'BLOQUEIO', bgPref: 'reduced' });
  await probe(browser, { reduce: false, scenario: 'app', url: BASE + '/#/sphere/health', label: 'APP', bgPref: 'reduced' });
  console.log('--- SANIDADE: SO normal, default → move ---');
  await probe(browser, { reduce: false, scenario: 'app', url: BASE + '/#/sphere/health', label: 'APP', bgPref: undefined });
} finally {
  await browser.close();
}
