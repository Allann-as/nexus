# NEXUS — Decision Records (ADRs)

Registros curtos de toda decisão não-óbvia. Formato: contexto → decisão →
consequência. Um ADR nunca é editado depois de aceito; ele é **substituído** por
outro que o supersede.

---

## ADR-0001 — Ambiente de build: Rust + MSVC instalados na sessão

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** A máquina tinha Node 24, npm, pnpm e git, mas **não tinha Rust nem
o MSVC C++ Build Tools**. O Tauri não compila sem os dois. O WebView2 (150.x) já
estava presente — o Windows 11 o embarca.

**Decisão.** Instalar `Rustlang.Rustup` e `Microsoft.VisualStudio.2022.BuildTools`
(workload `VCTools` + recomendados) via winget.

**Consequência.** Rust 1.97.1, MSVC 14.44, Windows SDK 10.0.26100. O instalador do
VS pediu reinício, mas um teste de link real (`cargo run` num crate trivial)
passou sem reiniciar — o aviso era espúrio e foi ignorado com evidência, não com
suposição.

---

## ADR-0002 — Projeto fora do OneDrive (`C:\dev\nexus`)

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** A sessão abriu em `C:\Users\allan\OneDrive\Desktop\Nexus`, uma pasta
sincronizada. O `target/` do Rust gera dezenas de milhares de arquivos e vários
GB; o `node_modules/` agrava. O OneDrive tentaria sincronizar tudo isso, travando
arquivos durante o build (falhas intermitentes de link) e consumindo cota.

**Decisão.** Criar o projeto em `C:\dev\nexus`, como o próprio prompt mestre
sugeria. Confirmado com o usuário.

**Consequência.** Builds rápidos e determinísticos. O instalador final ainda é
copiado para a Área de Trabalho (M6) — o entregável chega onde o usuário espera,
sem que o repositório viva lá.

---

## ADR-0003 — `domain/errors.rs` conhece `rusqlite`

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** A regra de dependência diz que `domain` não importa
`rusqlite`/`tauri`. Mas erros de storage precisam virar erros de domínio em
**algum** ponto, e espalhar `.map_err(...)` por cada repositório é ruído puro.

**Decisão.** `domain/errors.rs` implementa `From<rusqlite::Error>` (e `r2d2`,
`rusqlite_migration`) convertendo para `NexusError::Storage(String)` na fronteira.
Nenhum tipo estrangeiro entra na variante — só texto já formatado.

**Consequência.** O `?` funciona naturalmente nos repositórios. A regra de
dependência é violada em **um arquivo, de forma consciente e documentada**, em vez
de erodida em dezenas. Se um dia trocarmos o SQLite, o conserto é local.

**Alternativa rejeitada.** Um `StorageError` genérico em `application/` com
conversão manual em cada repositório: mais puro no papel, muito mais cerimônia,
sem ganho real.

---

## ADR-0004 — `#![allow(linker_messages)]`

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** O `crate-type = ["staticlib","cdylib","rlib"]` do Tauri faz o linker
MSVC imprimir "Criando biblioteca ..." no stdout. O lint `linker_messages` do
rustc (on by default) transforma isso em warning. A DoD exige **zero warnings**;
não há como calar o linker.

**Decisão.** `#![allow(linker_messages)]` no `lib.rs`, com comentário apontando
para este ADR.

**Consequência.** O gate de zero-warning volta a ser significativo em vez de
conviver com ruído permanente. **Custo real:** warnings genuínos do linker também
ficam suprimidos neste crate. Aceito porque o link é exercitado a cada build e uma
falha real de link é um **erro**, não um warning.

---

## ADR-0005 — `cargo build --release` não produz um app funcional

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** Durante a verificação do M0, o binário de release abriu mostrando
`ERR_CONNECTION_REFUSED` em `localhost:1420` — a janela tentava carregar o
servidor de dev. O backend estava perfeito (log confirmou `schema migrated
from=0 to=1`); o frontend é que não estava embutido.

**Causa.** Só a CLI do Tauri orquestra o bundle: roda `beforeBuildCommand`
(`vite build`) e compila com o ambiente que faz `generate_context!` embutir o
`frontendDist`. `cargo build --release` sozinho compila o Rust e nada mais.

**Decisão.** `npx tauri build` é o **único** caminho para um artefato executável.
No `check.ps1`, `cargo build --release` permanece — mas apenas como *checagem de
compilação em modo release*, nunca como produtor de app.

**Consequência.** Ficou explícito no `ARCHITECTURE.md` §8. Reforça a exigência do
roadmap de **testar o app instalado, não o dev build** — este bug seria invisível
em `tauri dev`.

---

## ADR-0006 — Verificação por keystrokes sintéticos: abandonada

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** Para verificar `Ctrl+K` e os chords `G+<tecla>` no app real, tentei
dirigir a janela com `SendKeys` do WScript.Shell. O Windows bloqueia troca de
foreground por processo em background; mesmo com o truque de `AttachThreadInput`,
o foco voltou para o editor **entre** a checagem de guarda e o envio das teclas.
Resultado: as teclas foram digitadas na janela errada — duas vezes, incluindo o
chat do usuário.

**Decisão.** Não dirigir a UI com keystrokes sintéticos neste ambiente. A
verificação do M0 se apoia no que é observável com segurança: a janela abre
(0,86 s), renderiza, e o Dashboard exibe dados **lidos do SQLite** via IPC — o que
prova a cadeia React → invoke → Rust → SQLite ponta a ponta.

**Consequência.** A camada de teclado fica coberta por `tsc` e revisão, não por
teste de ponta a ponta. **Dívida registrada:** se um dia quisermos E2E de teclado,
o caminho correto é WebDriver (`tauri-driver`), que fala com o WebView em vez de
disputar o foco global do SO — não `SendKeys`.

---

## ADR-0007 — `retry: false` no TanStack Query

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** O TanStack Query retenta 3× por padrão, um comportamento desenhado
para redes instáveis.

**Decisão.** `retry: false` global.

**Consequência.** O backend é um arquivo SQLite local: não existe link instável
para atravessar. Uma falha aqui é um bug real (lock, corrupção, regressão) e deve
aparecer **imediatamente**, não ser mascarada por três tentativas silenciosas.

---

## ADR-0008 — Hash routing

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** Em produção a app carrega sob o protocolo `tauri://`, sem servidor
HTTP por trás.

**Decisão.** `createHashRouter` em vez de `createBrowserRouter`.

**Consequência.** Rotas profundas resolvem sem servidor. URLs ficam com `#/` —
irrelevante num app desktop sem barra de endereço.

---

## ADR-0009 — Fontes via `@fontsource`, nunca CDN

**Data:** 2026-07-16 · **Status:** aceito

**Contexto.** Inter e JetBrains Mono são a identidade tipográfica do Aurora. O
caminho usual (`@import` do Google Fonts) é uma chamada de rede em runtime —
proibido pela regra 1 da constituição.

**Decisão.** Pacotes `@fontsource-variable/inter` e `@fontsource/jetbrains-mono`
resolvidos de `node_modules` no build; `assetsInlineLimit: 0` os emite como
assets locais.

**Consequência.** Zero rede, e a tipografia é idêntica com o cabo desconectado —
que é o único modo em que o NEXUS deve rodar.
