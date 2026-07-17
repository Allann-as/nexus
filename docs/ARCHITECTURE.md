# NEXUS — Arquitetura

> Documento vivo. Atualize-o no mesmo commit que muda a estrutura.
> Estado atual: **M2.5 — Midnight Overhaul concluído**.

## 1. O que o NEXUS é

Um **Personal Operating System**: um único executável desktop que concentra
áreas, projetos, metas, hábitos, rotinas, agenda, notas, arquivos e uma linha do
tempo histórica imutável.

Projetado para acumular milhões de registros ao longo de décadas sem perder
velocidade.

## 2. A constituição (regras invioláveis)

| # | Regra | Como é garantida hoje |
|---|---|---|
| 1 | **Zero rede** | Nenhuma dependência HTTP. CSP `default-src 'self'`. Fontes empacotadas via `@fontsource` (nunca CDN). Allowlist Tauri mínima: só `core:default`. Updater desligado. |
| 2 | **Zero IA** | Todo insight é SQL + estatística descritiva, com `formula` e `sample_size` no payload. |
| 3 | **Um artefato** | SQLite embarcado (`bundled`). Sem Docker, sem serviço, sem processo residente. |
| 4 | **Dados sagrados** | WAL, transações, `quick_check` na abertura, backups (M5), export JSON/CSV (M5). |
| 5 | **Performance é feature** | Orçamentos da §8 do prompt mestre são requisitos. Listas virtualizadas; BI fora da thread de UI. |
| 6 | **Longevidade** | Dependências mínimas e maduras. Dados = SQL puro + JSON. Migrations em SQL plano. |
| 7 | **Clean Architecture** | Regra de dependência abaixo, verificada por revisão. |
| 8 | **Teclado-primeiro** | `Ctrl+K` e chords `G+<tecla>` no shell desde o M0. |

## 3. Regra de dependência

```
commands ──> application ──> domain <── infrastructure
```

As setas apontam para `domain`, e `domain` não aponta para nada. Essa é a regra
inteira.

- `domain/` — entidades, value objects, serviços puros. **Nunca** importa
  `rusqlite`, `tauri` ou `infrastructure`. Testável sem banco e sem janela.
  - Única exceção consciente: `domain/errors.rs` implementa `From<rusqlite::Error>`.
    O erro é convertido para `String` na fronteira, então nenhum tipo estrangeiro
    vaza para dentro do domínio. Ver ADR-0003.
- `application/` — casos de uso orquestrando o domínio via *ports* (traits).
- `infrastructure/` — adaptadores concretos (SQLite, arquivos, logs).
- `commands/` — camada de interface Tauri. Fina: parse, chama caso de uso, mapeia erro.

O frontend só conhece o backend por `src/lib/ipc.ts` — uma função TS por command
Rust. Nenhuma feature chama `invoke` diretamente.

## 4. Topologia de conexões (o ponto mais importante do backend)

Um escritor, muitos leitores — exatamente o que o WAL existe para servir:

- **`Db::write`** — uma única `Connection` atrás de um `Mutex`. O SQLite só
  permite um escritor por vez de qualquer forma; tornar isso explícito
  transforma disputa de lock em uma fila que controlamos, em vez de
  `SQLITE_BUSY` surpresa.
- **`Db::read`** — pool r2d2 (4 conexões) abertas `READ_ONLY` + `query_only=ON`.
  Sob WAL, leem concorrentemente a uma escrita em andamento, sem bloquear a UI.
  O `bi_engine` (M4) vai beber daqui.

Há **um único ponto** que abre conexão e aplica PRAGMAs:
`infrastructure/db/mod.rs::configure`.

```
journal_mode = WAL          (persiste no arquivo)
synchronous  = NORMAL       (seguro sob WAL)
foreign_keys = ON
busy_timeout = 5000
cache_size   = -64000       (64 MB)
mmap_size    = 268435456    (256 MB)
temp_store   = MEMORY
```

`PRAGMA optimize` roda no fechamento. `VACUUM` entra na manutenção mensal (M5).

**Ordem de abertura importa:** `quick_check` roda **antes** de qualquer migration
— um banco corrompido é detectado antes que qualquer escrita o toque.

## 5. Localização dos dados

`%APPDATA%/Nexus/` — nunca ao lado do executável.

```
nexus.db  nexus.db-wal  nexus.db-shm
media/     arquivos anexados (path relativo no banco, hash SHA-256)
backups/   snapshots via VACUUM INTO + retenção (M5)
exports/   JSON + CSV legíveis por humanos (M5)
logs/      rotação diária
```

## 6. Estado por milestone

| Milestone | Escopo | Estado |
|---|---|---|
| **M0** | Fundação: scaffold, pool+PRAGMAs+migrations, tokens, shell, `check.ps1` | ✅ **concluído** |
| **M1** | CRUD Áreas/Nodes, Inbox, ledger, FTS5, palette com busca real | ✅ **concluído** |
| **M2** | Tarefas, Projetos, Hábitos, Rotinas, ticks, streaks, Dashboard v1 | ✅ **concluído** |
| **M2.5** | Design system Midnight, Esferas da Vida, o Hub, rail global | ✅ **concluído** |
| M3 | Calendário (timeblocking, RFC-5545, conflitos), Metas + sub-desafios | ⬜ |
| M3.5 | Esferas I: Saúde (checkpoints, treino, exames) + Finanças (aportes, Saúde Financeira) | ⬜ |
| M4 | Esferas II: Objetivos Financeiros, Estudos + Biblioteca, Carreira; Notas; Timeline | ⬜ |
| M4.5 | `bi_engine`, Momentum, Conquistas, Retrospectiva | ⬜ |
| M5 | Backup/restore, export, Revisão Semanal, Modo Foco, seed de 5 anos | ⬜ |
| M6 | Ícone, instalador, manual, entrega | ⬜ |

### O que o M0 entrega de verdade

- Banco SQLite embarcado, WAL, FKs, schema core (`0001`) aplicado e idempotente.
- 7 testes cobrindo PRAGMAs, FKs, CHECK de `kind`, read-pool read-only, migrations.
- Shell navegável: sidebar colapsável, topbar, command palette (`Ctrl+K`) com
  fuzzy match, chords `G+<tecla>`, tema dark/light em runtime.
- Dashboard e Configurações **lendo dados reais** do SQLite via IPC tipado.
- `check.ps1` verde: fmt, clippy `-D warnings`, testes, `tsc`, vite build, release.

### O que o M1 entrega de verdade

- **Ledger imutável**: append-only garantido por trigger `RAISE(ABORT)` — nem o
  próprio NEXUS reescreve a história. Estado atual + evento **na mesma
  transação**, forçado pela assinatura do repositório (`create_with_event`).
- **Áreas**: CRUD, arquivar (nunca apagar), cores/ícones validados.
- **Inbox**: Quick Capture (`Ctrl+Shift+N`) e triagem teclado-primeiro
  (`T`/`H`/`P`/`Backspace`), com contador de envelhecimento (> 7 dias).
- **Busca FTS5**: acento-insensível, prefixo (buscar enquanto digita), entrada
  do usuário nunca interpretada como sintaxe.
- **Paleta**: ações (fuzzy local) + resultados FTS do banco, numa lista só.
- 58 testes (31 unitários + 27 de integração contra SQLite real em arquivo).

### O que o M2 entrega de verdade

- **Streaks corretos**: dia não agendado não quebra sequência; `skipped` é
  neutro e `failed` quebra; hoje sem tick tem carência (o dia não acabou);
  `TimesPerWeek` conta por semana, não por dia. 18 testes só nisso.
- **Nexus Score** determinístico com pesos **redistribuídos** entre o que se
  aplica, `None` (não zero) quando não havia nada a fazer, e "ⓘ como calculamos"
  exibindo a fórmula inteira.
- **Rotinas em cascata**: N ticks + N eventos numa única transação.
- **Projetos** com lista virtualizada e drag reorder por média dos vizinhos —
  mover é 1 update de 1 linha, com reespaçamento automático quando o double
  satura.
- **Heatmap anual** em SVG puro (nada de biblioteca de gráficos para 365 rects).

### Medições reais (build `tauri build`, release)

| Métrica | Orçamento | M0 | M1 | M2 |
|---|---|---|---|---|
| Binário | — | 4,8 MB | 5,2 MB | **5,3 MB** |
| Cold start até janela | < 1,5 s | 0,86 s | 0,92 s | **0,91 s** |
| RSS do processo host | < 300 MB total | 31 MB | 32 MB | **35 MB** |

> Ressalva honesta: RAM total (host + WebView2) e os orçamentos de busca,
> timeline e scroll só podem ser validados contra o seed de 5 anos, no M5. Os
> números acima são de um banco praticamente vazio — não provam escala.

### Semear dados de demonstração (dev)

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example seed_demo
```

Escreve em `%APPDATA%/Nexus` pelos **mesmos casos de uso** que a UI usa (não por
INSERT cru), então os dados passam pelas validações e geram eventos de ledger
reais. Base do seed de 5 anos do M5.

## 7. Frontend

- **React 19 + TypeScript + Vite**; **Tailwind v4** lendo os tokens de
  `design-system/tokens.css` via `@theme inline`.
- **Zustand** para estado de UI (tema) — persistido em localStorage, pois são
  preferências de chrome, não dados do usuário.
- **TanStack Query** para tudo que vem do SQLite. `retry: false` de propósito:
  o backend é um arquivo local, não um serviço de rede; não há link instável
  para retentar, e uma falha aqui é um bug real que deve aparecer.
- **Hash routing** (`createHashRouter`): em produção a app carrega sob o
  protocolo `tauri://`, onde não há servidor para resolver caminhos profundos.

### O design system (Midnight, desde o M2.5)

Substituiu o Aurora do M0 — ver ADR-0015. Três ideias, e todo componente as
obedece:

1. **O fundo nunca é chapado.** `.nx-page` (em `styles.css`) empilha três
   camadas de `background-image` estático: navy sólido + dot grid + aurora
   radial. Sem canvas, sem partícula, sem frame de animação: o fundo não custa
   nada porque não faz nada.
2. **O dado é o herói.** Número grande, mono, `tabular-nums`, contando até o
   valor na montagem (`useCountUp`). O rótulo é pequeno e terciário.
3. **Cor por Esfera.** A tela define `--sphere` no container; aurora, ícone,
   gráfico e checkbox leem a variável. Nenhum componente sabe que Esferas
   existem. A cor **tinge, nunca codifica** — ver ADR-0017.

```
design-system/
  tokens.css      as variáveis (dark + light). Hex cru em componente é bug.
  primitives.tsx  Button, Card, Kbd, EmptyState, PageHeader
  cards.tsx       HeroCard, StatCard, SummaryCard, GlassPanel, CountUp, Val
  charts.tsx      Sparkline, Gauge, ProgressRing, ProgressBar (SVG — ADR-0016)
  Checkbox.tsx    o gesto mais repetido do app
  useCountUp.ts   rAF, respeita prefers-reduced-motion, zero animação em idle
```

**Orçamento de movimento** (§6 do plano): só `transform` e `opacity` animam;
`box-shadow`/`filter` nunca em loop; no máximo **um** `backdrop-filter` visível
por vez (por isso a palette e a captura são mutuamente exclusivas no `Shell`);
com o app parado, nenhuma animação roda.

### Navegação: dois níveis (desde o M2.5)

A sidebar de 240px com lista de módulos morreu. No lugar:

- **A rail** (56px, `app/Rail.tsx`) é global: Hub, Calendário, Inbox, Timeline,
  Insights, Configurações. Só o que não pertence a Esfera nenhuma porque
  pertence a todas. A fonte é `app/navigation.ts`.
- **O Hub** (`features/hub/`) é a tela inicial: as Esferas em cards com dado
  real, o Nexus Score, e a faixa "Hoje".
- **A Esfera** (`features/spheres/`) é contextual: header tingido + tabs pill.
  O `template` da Esfera decide quais tabs existem.

As Esferas vêm do banco, não de uma lista em código — o usuário cria as dele.
Por isso a Command Palette lista Esferas: é o caminho de teclado até elas, e
`G+<tecla>` só alcança rota fixa.

## 8. Como rodar

```powershell
npm install
npm run tauri dev      # desenvolvimento
.\check.ps1            # gate completo (fmt, clippy, testes, tsc, build, release)
.\check.ps1 -Quick     # sem o build release
npx tauri build        # instaladores NSIS + MSI
```

> **Atenção:** `cargo build --release` sozinho **não** produz um app funcional —
> ele não embute o frontend e o binário tenta carregar `localhost:1420`. Só a
> CLI (`tauri build`) orquestra o bundle. Ver ADR-0005.
