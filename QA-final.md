# QA-final — v1.3.0 (branch fase10-correcoes-finais)

> **Limitação de ambiente, dita sem suavizar:** a **janela nativa do Tauri não
> renderiza nem se deixa dirigir neste ambiente** (headless). O que consigo abrir e
> observar de verdade é o **frontend** no Edge headless (Vite:1420 + `__TAURI_INTERNALS__`
> estubado). Portanto:
> - **BUG B (galáxia)** eu diagnostico, corrijo e PROVO aqui (teste dos dois quadros).
> - **BUG A (ícone nativo na barra de tarefas / canto da janela)** é um recurso EMBUTIDO
>   no `.exe` + cache do Windows — **não tenho como vê-lo com meus olhos aqui**. Faço a
>   correção definitiva às cegas (fonte correto → `tauri icon` → `set_icon` em runtime →
>   forçar rebuild) e digo exatamente o que verifiquei (os arquivos PNG/ICO) e o que só o
>   Allan poderá confirmar na máquina dele (a barra de tarefas).

## PASSO 0 — retrato inicial (render real, antes de editar)

Medido com `docs/verify-fase10/_diag.mjs` (Edge headless, dois cenários):

| Cenário | `matchMedia(reduce)` | frames RAF/600ms | canvases | MOVENDO (2 quadros, 450ms) |
|---|---|---|---|---|
| Bloqueio, SO normal | false | 102 | 3 | `[true, true, true]` |
| Bloqueio, SO reduce | **true** | 110 | 3 | `[false, false, false]` |
| App (Saúde), SO normal | false | 110 | 1 | `[true]` |
| App (Saúde), SO reduce | **true** | 109 | 1 | `[false]` |

**Leitura:**
- A galáxia **anima** quando o SO NÃO pede reduzir (`MOVENDO=true`). O loop de `requestAnimationFrame`
  está vivo (~110 frames/600ms ≈ 60fps) — **o Ramo 2 (RAF morto/StrictMode) está DESCARTADO**.
- A galáxia **para** quando o SO pede reduzir (`MOVENDO=false`) — **Ramo 1 confirmado**: o gate do
  `Starfield` é `prefersReducedMotion()` (`src/lib/motion.ts:13`), que consulta o `matchMedia` do SO.
  Se o Windows do Allan está com "Efeitos de animação" desligado, o WebView2 reporta `reduce` e o
  fundo desenha 1 quadro e congela. O app está "obedecendo" o SO — contra o desejo do usuário.
- **Ícone / N:** `index.html` (splash) e `NexusMark` (logo in-app) já são o núcleo orbital (fase 10).
  O ícone NATIVO do `.exe` foi regenerado no commit `0fb4e29`, mas **só um rebuild forçado + reinício
  re-embute o recurso** — e isso não é observável neste ambiente (ver BUG A).
- **StrictMode:** ativo em `src/main.tsx:22` (dev). Não causou congelamento (frames OK sem reduce).

## BUG B — CORRIGIDO e PROVADO (galáxia volta a animar)

**Causa raiz:** o `Starfield` (e a poeira da logo) gateavam por `prefersReducedMotion()`,
que consulta o `prefers-reduced-motion` do SO. No Windows com "Efeitos de animação"
desligado, o WebView2 reporta `reduce` → 1 quadro estático.

**Correção (desacoplar o fundo do SO + dar controle):**
- Preferência local **"Movimento do fundo"** (`backgroundMotion: "on" | "reduced"`, **default
  Ligado**) no store persistido (`stores/ui.ts`), espelhada em `<html data-bg-motion>`
  (`applyBackgroundMotion`) e aplicada ANTES do primeiro quadro em `main.tsx` (sem flash).
- `lib/motion.ts` ganha `backgroundMotionOn()` — lê `data-bg-motion`, **não** o SO. O
  `Starfield` recebe `motion` (prop reativa via `useUi`, passada por Shell/Lock/Onboarding) e a
  poeira da logo (`NexusMark`) lê `backgroundMotionOn()`. Os efeitos CHAMATIVOS (datilografia,
  saudação) continuam obedecendo o `prefers-reduced-motion` do SO — só o FUNDO foi desacoplado.
- Controle em **Configurações › Aparência** ("Movimento do fundo": Ligado/Reduzido). Verificado
  renderizado (`12-settings.png`).

**Prova (teste dos dois quadros, `_diag.mjs`, render real):**

| Cenário | `data-bg-motion` | MOVENDO (bloqueio) | MOVENDO (app) |
|---|---|---|---|
| **SO em reduce + default (Ligado)** | on | `[true,true,true]` | `[true]` |
| Preferência "Reduzido" (sem reduce do SO) | reduced | `[false,false,false]` | `[false]` |
| SO normal + default | on | — | `[true]` |

→ A galáxia agora **anima por padrão mesmo com o SO pedindo reduzir** (era o bug), e **para**
quando o usuário escolhe "Reduzido". É exatamente o item 20 do checklist.

## BUG A — ícone do app (feito às cegas; verificação visual é do Allan)

**O que EU verifiquei com os olhos aqui:** `src-tauri/icons/icon.png` e `128x128.png` são o
**núcleo orbital** (não o "N"); `icon.svg` foi substituído (sem resíduo do "N"). O `set_icon`
compila e o binário **recompila e linka** (`cargo build` → `nexus.exe`, EXIT 0).

**O que fiz (correção definitiva na ordem pedida):**
1. Fonte 1024² do núcleo confirmado visualmente (`docs/verify-fase10/icon-source.svg` / `_makeicon.mjs`).
2. `tauri icon` já regenerou `.ico/.icns/.png/Square*/StoreLogo` (commit `0fb4e29`).
3. **`set_icon` em runtime** (`src-tauri/src/lib.rs`, no `setup`): carrega o PNG do núcleo
   embutido via `include_bytes!` e aplica na janela `main` — cinto e suspensório contra recurso
   teimoso / cache do Windows.
4. **Forcei o re-embed**: `touch src-tauri/build.rs` → `cargo build` (re-roda o `tauri-build`,
   que grava o `icon.ico` no `.exe`). Binário novo gerado.

**O que NÃO consigo verificar aqui (dito sem suavizar):** a **barra de tarefas** e o **canto da
janela** são artefatos NATIVOS do Windows; a janela do Tauri **não renderiza neste ambiente**.
Não vi o ícone final na barra de tarefas — isso só o Allan confirma na máquina dele. Se ainda
aparecer o "N" após reiniciar o app por completo, é **cache de ícones do Windows**: `ie4uinit.exe
-show` ou reiniciar o Explorer. O `set_icon` deve resolver o canto da janela mesmo antes disso.

## VALIDAÇÃO — o que dá para dirigir no headless vs o que é do app nativo

**Honestidade de ambiente:** o headless renderiza o **frontend** com um backend FALSO (stub). Ele
prova LAYOUT/ESTADO das telas que o stub cobre, mas **não executa CRUD real** (criar/editar/
concluir/excluir tocam o SQLite via IPC, que aqui é mock). Marco `PASS` só no que observei, e
`N/V (headless)` no que exige o app nativo — sem fingir.

| # | Item | Resultado | O que vi / por quê |
|---|---|---|---|
| 1 | Onboarding (senha→nome→entra) | **PASS** | `04/05`: cria senha, placeholder "Insira seu nome", botão barra-de-acento |
| 2 | Bloqueio retorno + identidade progressiva | **PASS** | `02`: pontos verdes, "operador identificado ✓", "bem-vindo de volta, Allan" |
| 3 | PIN errado sem vazar nome | **PASS** | `03`: tremor/erro, sem nome |
| 4 | Logo in-app = núcleo (sem "N") | **PASS** | núcleo no bloqueio, rail, hub, onboarding, settings |
| 4b | Ícone NATIVO (barra/janela) | **N/V** | recurso do .exe; corrigido (rebuild+set_icon), verificação é do Allan |
| 5 | Menu cápsulas + peek na cor da seção | **PASS** | `11`: fio 5px `#4d8dff` pulsando, recolhe/revela |
| 6 | Fundo ponta-a-ponta + tinge por seção + anima | **PASS** | `06a/06b/10/12`: estrelas movendo, tinta por seção, sem faixa |
| 7 | Config: "Movimento do fundo" Ligado/Reduzido | **PASS** | `12` + prova `_diag` (anima/para) |
| 7b | Config: nome / alterar senha | **N/V** | precisa do backend real (IPC de settings/PIN) |
| 8 | Hub: saudação digita, cursor some ~6s | **PASS** | `10`: "Boa madrugada, Allan" com caret |
| 9–14 | Esferas Saúde/Finanças (render) | **PASS** | `06a` Saúde verde + exame âmbar ≤3d; `06b` Finanças ciano |
| 9–14 | CRUD das esferas (marcar/criar/excluir) + Carreira/Estudos/Casa | **N/V** | painéis com queries próprias não modeladas pelo stub; CRUD exige backend |
| 15–18 | Timeline/Insights/Metas Anuais/Conquistas/Notas+anexos | **N/V** | idem — exigem app nativo + dados reais |
| 20 | reduced-motion SO + "Movimento do fundo" | **PASS** | `_diag`: Ligado anima mesmo com SO reduce; Reduzido para |
| 21 | Zero rede (arquivos tocados) | **PASS** | grep abaixo = nenhum |

**Não-regressão (executado):** `npx tsc --noEmit` → **0**; `vitest run` → **129/129**; `cargo
check` + `cargo build` → **0**.

## Grep de rede (arquivos tocados nesta fase)
`fetch(`/`reqwest`/`http(s)://`/`XMLHttpRequest`/`WebSocket`/`axios`/`ws://`/`TcpStream` nos
`.ts/.tsx/.rs/.css` do diff → **nenhum**. `set_icon` usa `include_bytes!` (local); a migração é
SQL local. 100% offline mantido.

## Pendências honestas
- A validação FUNCIONAL completa (CRUD de cada esfera, anexos, insights sem cache velho, escala de
  5 anos) **exige rodar o app nativo** — não é executável neste ambiente headless. Está listada
  como `N/V` acima, não como PASS. Recomendo ao Allan rodar `.\dev.ps1` e percorrer os itens 9–19.
- Ícone na barra de tarefas: idem — só a máquina do Allan confirma.
