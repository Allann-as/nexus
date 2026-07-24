# VERIFY — Fase 9: ver de verdade, não só compilar

Branch `fase9-bloqueio-borda`, commit `d86af1a`. Esta é a rodada que fecha os itens que o
`QA-fase9.md` deixou como `[⏳ dirigida ao vivo]`. Diferente do QA (que provou que
**compila/testa/mede**), aqui a pergunta é: **o app abre e as telas parecem/se comportam como
o pedido?** — e a resposta vem com **prova visual** (PNGs que eu abri e li) e **runtime real**.

## Resposta direta (as 3 perguntas)

1. **Consegui abrir/renderizar desta vez? SIM — por dois caminhos.**
   - **Tauri NATIVO real:** rodei o `nexus.exe` (build de debug, confirmado byte-atual com o
     HEAD — `cargo build` não recompilou nada na árvore limpa) contra um `NEXUS_DATA_DIR`
     isolado e vazio. Subiu **sem panic**, janela no ar por 10s, log limpo:
     `iniciando NEXUS` → `Database migrated to version 20`. **Não** consigo tirar screenshot da
     janela nativa (WebView2), então o pixel veio do 2º caminho.
   - **Frontend (web) em Chromium headless:** subi só o `vite` (:1420) e abri num **Edge
     headless via Playwright**, com `window.__TAURI_INTERNALS__.invoke` **estubado** (sem
     backend Rust). 9 PNGs, um por estado. O mock está descrito abaixo e o harness está em
     [docs/verify-fase9/harness.mjs](docs/verify-fase9/harness.mjs).

2. **O que eu VI renderizado × o que segue só por código:**
   - **VI (screenshot lido por mim):** bloqueio antes do PIN, bloqueio após PIN certo (identidade
     progressiva), PIN errado, onboarding passo 1 (senha), onboarding passo 2 (nome), as 3 seções
     tingidas (Saúde/Finanças/Carreira) com borda infinita + barra tingida, e o bloqueio em
     reduced-motion. Também VI, em runtime nativo, o boot sem panic e **sem `security.json`
     criado** (PIN de fábrica não semeado).
   - **Só por código (não capturei pixel):** o *movimento* em si (twinkle/estrela cadente/
     datilografia — um PNG é um quadro parado); o **tema CLARO** do starfield; e o hash+salt do
     PIN (é backend, provado por `security.rs` + testes).

3. **FAIL/DÚVIDA, sem suavizar:** **nenhum FAIL.** Duas DÚVIDAs honestas, ambas de *cobertura de
   prova*, não de defeito observado — ver a seção "DÚVIDAS" abaixo.

## Como o frontend foi renderizado (o mock, explícito)

Edge headless (canal `msedge`), viewport 1440×900, DPR 1. `invoke` estubado com respostas locais
plausíveis. Cenários:

| Cenário | `lock_status` | outros mocks |
|---|---|---|
| bloqueio | `{enabled:true, configured:true}` | `boot_telemetry`={pingMs:0.11, lastBackup: há 2h, v1.3.0}; `app_settings`={displayName:"Allan"}; `verify_pin`= (pin==="135790") |
| onboarding | `{enabled:false, configured:false}` | `set_pin`/`set_display_name` → ok |
| app (seções) | `{enabled:false, configured:true}` | `list_areas`/`get_area`/`sphere_overview` com 3 Esferas (Saúde=verde `#33e1a0`, Finanças=ciano `#38bdf8`, Carreira=magenta `#d946ef`) |

> Nota de honestidade sobre o app (seções): as 3 Esferas do mock usam `template:"simple"`
> (→ `SphereDashboard`), para o render não depender de estubar cada dashboard especializado. Isso
> **não enfraquece** o que o item 6 pede: a **borda infinita** e a **barra tingida** são globais
> (moram na `Shell`, não no template), então o PNG as prova de ponta a ponta. O conteúdo por
> template segue verificado por código.

## Tabela requisito → evidência → veredito

*(Sem FAIL. As duas DÚVIDAs no fim.)*

| # | Requisito | Evidência | Veredito |
|---|---|---|---|
| 1 | App **abre em runtime** (não só compila), sem panic no boot | Runtime nativo: `nexus.exe` subiu, janela 10s, log `Database migrated to version 20`, 0 erro. `cargo build` = "Finished" sem recompilar (binário == HEAD) | **PASS** |
| 2 | Bloqueio antes do PIN: saudação **sem nome**, terminal "aguardando operador", barra HUD com telemetria | `01-lock-before.png`: "Boa noite." sem nome; `> ledger íntegro …… OK` + `> aguardando operador▮`; barra `> Quarta-feira, 22 de julho · ping <1ms · último backup há 2h · v1.3.0 · 22/07/2026` + relógio. Código: [LockScreen.tsx:274-289](src/features/lock/LockScreen.tsx#L274-L289), [:232-268](src/features/lock/LockScreen.tsx#L232-L268) | **PASS** |
| 3 | Após PIN certo: nascem **abaixo** "operador identificado ✓" e "Seja bem-vindo de volta, **{nome}**", **depois** destrava | `02-lock-after.png`: as duas linhas brotaram abaixo de "aguardando operador"; "Allan" em fósforo. Código: [LockScreen.tsx:463-474](src/features/lock/LockScreen.tsx#L463-L474) (enqueue abaixo), [:93-104](src/features/lock/LockScreen.tsx#L93-L104) (reveal → hold 850ms → cortina) | **PASS** |
| 4 | PIN errado: erro/tremor, **sem vazar o nome** | `03-lock-wrong.png`: bolinhas + aros **vermelhos**, `PIN incorreto. Tente novamente.`, `> senha incorreta` (âmbar/vermelho), saudação segue "Boa noite." sem nome. Tremor: [pinpad.tsx:27](src/features/lock/pinpad.tsx#L27) `nexus-shake 450ms` | **PASS** |
| 5 | Onboarding: cria senha com **confirmação** | `04-onboarding-create.png`: "Passo 1 de 2 · Crie sua senha", 6 bolinhas, "definindo nova senha…". Confirmação: [OnboardingScreen.tsx:72-93](src/features/lock/OnboardingScreen.tsx#L72-L93) (não bate → volta ao passo 1) | **PASS** |
| 6 | Onboarding: pergunta o **nome**, salvo na **mesma chave** que a saudação lê | `05-onboarding-name.png`: "Passo 2 de 2 · Como você gostaria de ser chamado?", input + "Entrar no NEXUS". `set_display_name` grava `settings.json`; a saudação de retorno lê a **mesma** `["app-settings"]`: [greeting.ts:50-57](src/lib/greeting.ts#L50-L57) + [OnboardingScreen.tsx:54](src/features/lock/OnboardingScreen.tsx#L54) | **PASS** |
| 7 | Senha **nunca em texto puro** (hash+salt) | [security.rs:175-197](src-tauri/src/infrastructure/security.rs#L175-L197): `hash_pin` = SHA-256 iterado 120k× sobre `salt‖pin`; `PinConfig` guarda só `hash`+`salt`, nunca o PIN. `LockStatus` [:47-60](src-tauri/src/infrastructure/security.rs#L47-L60) nunca expõe hash/salt | **PASS** |
| 8 | **PIN de fábrica (242807) removido** do boot; instalações existentes **preservadas** | Runtime: boot em pasta vazia **NÃO criou `security.json`** (sem PIN semeado). Código: `ensure_seeded` **não** é chamado no boot — [lib.rs](src-tauri/src/lib.rs) só registra comandos; guarda/migração descrita em [state.rs:343-349](src-tauri/src/state.rs#L343-L349) ("não fazer nada com o que já existe"). `configured:false` → onboarding: [App.tsx:155-201](src/app/App.tsx#L155-L201) | **PASS** |
| 9 | Borda infinita: **um** starfield fixo cobrindo a viewport; raiz sem fundo sólido destoante; **barra do topo tingida**; troca de seção **transiciona** a cor | `06a/06b/06c`: starfield de ponta a ponta (atrás de rail+conteúdo, sem faixa dura), topbar tingida (verde/ciano/magenta) e starfield tingido junto. Código: [Shell.tsx:64-77](src/app/Shell.tsx#L64-L77) (um canvas `-z-10` no `isolate`), [Topbar.tsx:44-52](src/app/Topbar.tsx#L44-L52) (bg/borda por `--tint`, transição 400ms), [useSectionTint.ts:29-43](src/app/useSectionTint.ts#L29-L43), [Starfield.tsx:136](src/design-system/Starfield.tsx#L136) (persegue o alvo ~400ms) | **PASS** |
| 10 | **ping = latência local medida** (não rede); data/hora do **relógio local** | [system.rs:82-97](src-tauri/src/commands/system.rs#L82-L97): `ping_ms` = tempo de um `ledger.count()` real. Data/hora: `new Date()`/`toLocaleDateString("pt-BR")` [LockScreen.tsx:236-245](src/features/lock/LockScreen.tsx#L236-L245),[:531-535](src/features/lock/LockScreen.tsx#L531-L535) | **PASS** |
| 11 | **ZERO rede** (nenhuma chamada externa nova) | Grep por `fetch(`/`reqwest`/`http(s)://`/`ws://`/`socket`/`WebSocket` nos 13 arquivos tocados: **0**. Em todo `src/`: único hit é `overview.refetch()` (React Query local — o padrão casou "refetch"). Diff do commit: **0** padrão de rede. `Cargo.toml`: **sem** reqwest/hyper/tungstenite/curl | **PASS** |
| 12 | **reduced-motion** desliga bloqueio + app (quadro estático) | `07-reduced-motion.png`: bloqueio completo e legível de imediato (datilografia entregue inteira). Guard: [Starfield.tsx:197-209](src/design-system/Starfield.tsx#L197-L209) (um quadro, sem rAF), [LockScreen.tsx:414-417](src/features/lock/LockScreen.tsx#L414-L417) (linha inteira), [motion.ts:10-14](src/lib/motion.ts#L10-L14) (SO **ou** preferência) | **PASS** |

## DÚVIDAS (cobertura de prova, não defeito visto)

- **D1 — Tema CLARO do starfield.** Todos os PNGs são no tema escuro (o Cockpit "nasce escuro").
  O QA já sinalizou que estrelas de fósforo sobre fundo claro *podem* ficar ruidosas — segue
  **só por código** (o alfa é o mesmo nos dois temas). Não é um FAIL: é um estado que não
  fotografei. Se quiser, capturo o claro numa próxima passada.
- **D2 — O movimento em si.** Um PNG é um quadro parado: ele prova composição/cor/legibilidade e o
  *estado final*, não a suavidade do twinkle, da estrela cadente ou do timing de 850ms da
  revelação. Esses seguem verificados por código + pelo quadro estático do reduced-motion. Para
  provar animação de fato seria preciso vídeo/rastreio de quadros — fora do que fiz aqui.

## O que ficou provado em runtime nativo (sem pixel)

```
INFO iniciando NEXUS root=…\scratchpad\rundata
INFO Database migrated to version 20
INFO schema migrated from=0 to=20
```
Pasta de dados após o boot: `nexus.db`, `backups/`, `exports/`, `logs/`, `media/`,
`retrospectives/` — **e nenhum `security.json`** (prova viva do item 8: o primeiro acesso não
semeia PIN; cairia no onboarding).

## Artefatos

PNGs e harness em [docs/verify-fase9/](docs/verify-fase9/). Nenhum bug encontrado → **nenhum
commit de correção**. Os artefatos podem entrar num `chore(qa)` separado ou ficar de fora — a
critério do dono.
