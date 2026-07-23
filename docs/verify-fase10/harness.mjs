// Renderiza o FRONTEND do NEXUS (web) num Edge headless contra o vite dev server
// (:1420), com window.__TAURI_INTERNALS__.invoke ESTUBADO — sem backend Rust.
// Captura PNGs de cada estado da fase 10. Ver VERIFY-fase10.md.
//
// Playwright não está no node_modules do projeto; ele foi resolvido do cache do
// npx na fase 9. ESM ignora NODE_PATH, então importamos por caminho absoluto, com
// fallback para o pacote nominal caso algum dia ele entre no projeto.
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PW_ABS = 'file:///C:/Users/allan/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.js';
let chromium;
try {
  const m = await import('playwright');
  chromium = m.chromium ?? m.default?.chromium;
} catch {
  const m = await import(PW_ABS);
  chromium = m.chromium ?? m.default?.chromium;
}

const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:1420';
const P = (n) => path.join(OUT, n);

// ---- o STUB do backend, injetado antes de qualquer script da página ----
function makeInit(scenario, displayName) {
  return `
  (() => {
    const SC = ${JSON.stringify(scenario)};
    const NAME = ${JSON.stringify(displayName)};
    const now = Date.now();
    // Cores DO PROJETO (banco/tokens), não as do mockup: Saúde verde, Finanças
    // azul, Carreira magenta, Estudos ciano, Casa violeta.
    const AREAS = [
      { id:'health',  name:'Saúde',    icon:'heart',    color:'#34d399', sortOrder:0, template:'health',  isSystem:true, archivedAt:null },
      { id:'finance', name:'Finanças', icon:'wallet',   color:'#38c6e0', sortOrder:1, template:'finance', isSystem:true, archivedAt:null },
      { id:'career',  name:'Carreira', icon:'briefcase',color:'#ec4899', sortOrder:2, template:'career',  isSystem:true, archivedAt:null },
      { id:'studies', name:'Estudos',  icon:'book-open',color:'#5b8def', sortOrder:3, template:'studies', isSystem:true, archivedAt:null },
      { id:'home',    name:'Casa',     icon:'home',     color:'#8e7dff', sortOrder:4, template:'simple',  isSystem:true, archivedAt:null },
    ];
    const spark = Array.from({length:30}, (_,i)=> 0.3 + 0.5*Math.abs(Math.sin(i/3)));
    const card = (a) => ({ ...a, habitsTodayDone:3, habitsTodayTotal:5, bestStreak:12,
      bestStreakTitle:'Treino de força', openTasks:4, openProjects:2, spark, isEmpty:false });
    const SPHERES = AREAS.map(card);

    const MOCKS = {
      lock_status: () => SC === 'onboarding' ? { enabled:false, configured:false }
                       : SC === 'app'         ? { enabled:false, configured:true }
                       : { enabled:true, configured:true },
      boot_telemetry: () => ({ pingMs:0.11, lastBackupMs: now - 2*3600*1000, appVersion:'1.3.0' }),
      app_settings: () => ({ closeToTray:false, displayName:NAME }),
      set_display_name: (a) => ({ closeToTray:false, displayName:(a&&a.value)||NAME }),
      set_close_to_tray: (a) => ({ closeToTray:!!(a&&a.value), displayName:NAME }),
      verify_pin: (a) => a && a.pin === '135790',
      set_pin: () => null,
      disable_pin: () => null,
      system_info: () => ({ schemaVersion:29, dbSizeBytes:84_400_000, nodeCount:50000,
        areaCount:6, ledgerCount:400000, dataDir:'C:/dev/nexus/.devdata', isCustomDataDir:true, appVersion:'1.3.0' }),
      list_areas: () => AREAS,
      get_area: (a) => AREAS.find(x => x.id === (a && a.id)) || AREAS[0],
      sphere_overview: () => SPHERES,
      count_nodes: () => 3,
      habits_today: () => [],
      dashboard_today: () => ({ day:'2026-07-22', habits:[], tasks:[], inboxOpen:0,
        score:{ value:72, components:[], formula:'' } }),
      gamification_overview: () => ({ overall:{ level:7, xp:12480, intoLevel:480, span:1000 },
        spheres:[], achievements:[] }),
      score_history: () => Array.from({length:14},(_,i)=>({ day:'d'+i, value:60+i })),
      get_insights: () => ({ burnout:null }),
      finance_overview: () => ({ portfolioCents:0, totalContributedCents:0, monthly:[], byClass:[], health:null }),
      perfect_week_view: () => ({ totalYear:3, weeks:[] }),
      // Um exame daqui a 2 dias (≤3 → urgência âmbar, para provar o item 3).
      events_by_category: () => {
        const d = new Date(now + 2*86400000);
        const day = d.toISOString().slice(0,10);
        return [{ eventId:'ex1', title:'Exame de sangue', location:'Lab Central',
          day, startsAt: d.toISOString(), category:'exame' }];
      },
      list_events: () => [],
    };

    // Muitas telas fazem \`const { data = [] } = useQuery\` — mas o default só vale
    // para \`undefined\`, não \`null\`. Um comando sem mock que devolvesse null
    // quebraria \`data[0]\`. Então o fallback é generoso: array vazio para o que
    // cheira a lista (inclui *_by_category, *_by_*), null para o resto.
    const listy = (cmd) => /^list_|^recent_|_range$|_by_|s$|overview|history|events/.test(cmd);
    function dispatch(cmd, args) {
      if (cmd.startsWith('plugin:')) return Promise.resolve(null);
      const fn = MOCKS[cmd];
      if (fn) { try { return Promise.resolve(fn(args)); } catch(e){ return Promise.reject(e);} }
      return Promise.resolve(listy(cmd) ? [] : null);
    }

    let cbid = 0; const cbs = {};
    window.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => dispatch(cmd, args),
      transformCallback: (cb) => { const id = ++cbid; cbs[id] = cb; return id; },
      unregisterCallback: (id) => { delete cbs[id]; },
      convertFileSrc: (p) => p,
      metadata: { currentWindow:{ label:'main' }, currentWebview:{ label:'main' } },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  })();
  `;
}

async function newPage(ctx, scenario, name = 'Allan') {
  const page = await ctx.newPage();
  await page.addInitScript(makeInit(scenario, name));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  page-error>', m.text()); });
  page.on('pageerror', (e) => console.log('  PAGEERROR>', e.message));
  return page;
}

async function typePin(page, digits) {
  for (const d of digits) { await page.keyboard.press(d); await page.waitForTimeout(70); }
}

const shots = [];
async function snap(page, file, note) {
  await page.screenshot({ path: P(file) });
  shots.push({ file, note });
  console.log('  saved', file, '—', note);
}

const only = process.argv[2]; // opcional: um prefixo pra rodar só um subconjunto
const want = (tag) => !only || tag.startsWith(only);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  if (want('lock')) {
    let page = await newPage(ctx, 'lock');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3200);
    await snap(page, '01-lock-before.png', 'bloqueio: logo orbital, sem aneis atras do PIN, sem nome');
    await page.close();

    page = await newPage(ctx, 'lock');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await typePin(page, '135790');
    await page.waitForFunction(() => document.body.innerText.includes('bem-vindo de volta'), { timeout: 5000 }).catch(()=>{});
    await page.waitForTimeout(600);
    await snap(page, '02-lock-after.png', 'PIN certo: pontos verdes + operador identificado + bem-vindo');
    await page.close();

    page = await newPage(ctx, 'lock');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await typePin(page, '000000');
    await page.waitForTimeout(180);
    await snap(page, '03-lock-wrong.png', 'PIN errado: tremor, sem vazar nome');
    await page.close();
  }

  if (want('onboarding')) {
    const page = await newPage(ctx, 'onboarding');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await snap(page, '04-onboarding-create.png', 'onboarding passo 1: crie sua senha');
    await typePin(page, '246810');
    await page.waitForTimeout(300);
    await typePin(page, '246810');
    await page.waitForFunction(() => document.body.innerText.includes('gostaria de ser chamado'), { timeout: 4000 }).catch(()=>{});
    await page.waitForTimeout(300);
    await snap(page, '05-onboarding-name.png', 'onboarding passo 2: nome (placeholder "Insira seu nome")');
    await page.close();
  }

  if (want('hub')) {
    const page = await newPage(ctx, 'app');
    await page.goto(BASE + '/#/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2600); // deixa a saudacao datilografar
    await snap(page, '10-hub.png', 'Hub: saudacao digitada, botoes barra-de-acento');
    await page.close();
  }

  if (want('app')) {
    // Só as seções que o STUB consegue popular por inteiro (Saúde/Finanças). Os
    // painéis de Carreira/Estudos leem queries específicas que este backend falso
    // não modela — no app real com dado semeado elas renderizam; aqui cairiam num
    // ErrorBoundary de mock, não de código. Ver VERIFY-fase10.md.
    for (const s of [['health','06a-app-saude.png','Saude verde'],
                     ['finance','06b-app-financas.png','Financas azul']]) {
      const page = await newPage(ctx, 'app');
      await page.goto(BASE + '/#/sphere/' + s[0], { waitUntil: 'networkidle' });
      await page.waitForTimeout(1600);
      await snap(page, s[1], s[2]);
      await page.close();
    }
  }

  if (want('menu')) {
    const page = await newPage(ctx, 'app');
    await page.goto(BASE + '/#/sphere/finance', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);
    // recolhe o menu (Ctrl+B) e captura o fio de borda
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(700);
    await snap(page, '11-menu-collapsed.png', 'menu recolhido: fio pulsando na cor da secao (azul)');
    await page.close();
  }

  if (want('reduced')) {
    const rmCtx = await browser.newContext({ viewport:{ width:1440, height:900 }, deviceScaleFactor:1, reducedMotion:'reduce' });
    const page = await rmCtx.newPage();
    await page.addInitScript(makeInit('lock', 'Allan'));
    page.on('pageerror', (e) => console.log('  PAGEERROR>', e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await snap(page, '07-reduced-motion.png', 'reduced-motion: estatico e legivel');
    await rmCtx.close();
  }

  console.log('\\nOK —', shots.length, 'screenshots em', OUT);
} finally {
  await browser.close();
}
