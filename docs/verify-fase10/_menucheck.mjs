import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./harness.mjs', import.meta.url), 'utf8');
const PW_ABS = 'file:///C:/Users/allan/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
const { chromium } = await import(PW_ABS).then((m) => ({ chromium: m.chromium ?? m.default?.chromium }));
const makeInit = new Function('scenario', 'displayName', src.slice(src.indexOf('return `', src.indexOf('function makeInit')), src.indexOf('}\n\nasync function newPage')));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript(makeInit('app', 'Allan'));
await page.goto('http://localhost:1420/#/sphere/finance', { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
const info = await page.evaluate(() => {
  const aside = document.querySelector('aside[aria-label="Navegação"]');
  const parent = aside?.parentElement;
  const cs = aside ? getComputedStyle(aside) : null;
  const cp = parent ? getComputedStyle(parent) : null;
  return {
    asideFound: !!aside,
    displayNever: cs ? cs.display : '(n/a)',
    transitionProperty: cs ? cs.transitionProperty : '(n/a)',
    transitionDuration: cs ? cs.transitionDuration : '(n/a)',
    transitionTiming: cs ? cs.transitionTimingFunction : '(n/a)',
    parentTransition: cp ? `${cp.transitionProperty} ${cp.transitionDuration} ${cp.transitionTimingFunction}` : '(n/a)',
  };
});
console.log(JSON.stringify(info, null, 0));
await browser.close();
