# NEXUS — Arquitetura

> Documento vivo. Atualize-o no mesmo commit que muda a estrutura.
> Estado atual: **M5.5 + REFINO PRIME+ concluídos**. O PRIME entregou o sistema
> de layout, a geometria do astrolábio nos fundos, o menu O NEXO, empty states
> próprios e a tela de bloqueio por PIN; o REFINO (veredito do usuário ao vivo)
> subiu o degrau: accent índigo da marca + sistema de botões (ADR-0055), fundos
> mais ricos, o NEXO como mapa radial completo, donut fluido com saldo no centro,
> exclusão de aporte + extrato redesenhado (ADR-0056), a tela de bloqueio de "OK"
> a "UAU", e o hub **Objetivos** de qualquer natureza com o ritmo de constância
> (ADR-0057). O M5 (Confiança) e o código no GitHub (ADR-0051) já estavam.
> Próximo: M5.6 — ARSENAL (tracker plugável com contagem automática, semana
> perfeita, recordes, ano em pixels, comparativos, horizonte, retrospectiva,
> bandeja) e então M6 — a entrega da v1.0.0.

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
  O `bi_engine` (M4.5) bebe daqui: o `InsightWorker` roda numa thread própria,
  lê por `with_read` e grava só o `insight_cache` (ADR-0040).

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

> **Isolamento do dev (ADR-0048):** `Paths::resolve` honra a variável
> `NEXUS_DATA_DIR` — se setada, o app (e o `seed_demo`) ancora ali em vez do
> `%APPDATA%`. É o que mantém uma **dirigida de UI fora do banco real**: use
> `.\dev.ps1`, que aponta o app para `.\.devdata` (gitignorado), semeia dados
> sintéticos e sobe o `tauri dev`. O `%APPDATA%/Nexus` real só é tocado quando o
> próprio usuário abre o app.

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
| **M3** | Calendário (timeblocking, RFC-5545, conflitos), Metas + sub-desafios | ✅ **concluído** |
| **M3.5** | Esferas I: Saúde (checkpoints, treino, exames) + Finanças (aportes, Saúde Financeira) | ✅ **concluído** |
| **M4** | Esferas II: Objetivos Financeiros, Estudos + Biblioteca, Carreira; Notas; Timeline | ✅ **concluído** |
| **M4.5** | `bi_engine`, XP/níveis, Conquistas, Temporadas, Metas Anuais, Score congelado | ✅ **concluído** |
| **M4.6** | Aurora 2.0: hambúrguer, marca astrolábio, nav por Esfera, Carreira/Estudos, Configurações-hub, fundo em camadas, Hub-painel, isolamento de dev | ✅ **concluído** |
| **M5** | Auto-backup + restauro, exportação humana, Revisão Semanal, Modo Foco, orçamentos provados a 5 anos, GitHub | ✅ **concluído** |
| **M5.5** | PRIME: sistema de layout, fundos geométricos, o menu O NEXO, empty states, bloqueio por PIN | ✅ **concluído** |
| M5.6 | ARSENAL: tracker plugável, semana perfeita, recordes, ano em pixels, comparativos, horizonte, retrospectiva, bandeja | ⬜ |
| M6 | Ícone, instalador, manual, entrega da v1.0.0 | ⬜ |

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

### O que o M3 entrega de verdade

- **Calendário** em mês/semana/dia. A grade do mês tem 6 linhas fixas (um mês que
  encolhe faz a tela pular a cada seta); a de horas tem slots de 30 min e abre nas
  07h — mas **nunca depois de agora**, senão quem abre o app às 4h da manhã não vê
  a linha do "agora" (achado dirigindo o app).
- **Timeblocking** por Pointer Events com `setPointerCapture` (sem ele, mover o
  mouse rápido para fora do bloco congela o arrasto): arrastar no vazio cria,
  arrastar o bloco move, arrastar a borda de baixo redimensiona.
- **Conflitos** lado a lado, com largura dividida pela maior CONCORRÊNCIA do
  cluster — não pelo tamanho dele. O cluster acumula pelo MAIOR fim visto, senão
  um evento das 9h às 18h fecharia o grupo cedo e desenharia por cima dos curtos.
  Borda `--warning`; o fundo continua sendo da Esfera (a cor não codifica).
- **A janela se estende sozinha** conforme a navegação (ADR-0026), e toda
  ocorrência lembra de que turno da regra ela é (ADR-0022) — sem isso, arrastar a
  última ocorrência abre um buraco na série ou ressuscita a que foi arrastada.
- **Metas** com barra grossa, projeção por mínimos quadrados (com a fórmula a um
  clique) e árvore de sub-desafios: checkbox, contador que se preenche pelos ticks
  do hábito ligado, arrasto para reordenar e o toggle de qual barra manda.
- **A ordem de lista arrastável virou domínio** (`domain::ordering`): a média dos
  vizinhos que o M2 escreveu para tarefas agora serve também aos sub-desafios —
  duas cópias divergiriam no dia em que só uma fosse corrigida.

### O que o M3.5 entrega de verdade

- **Saúde**: os checkpoints do dia são os hábitos REAIS do core, filtrados pela
  Esfera (uma query, `habits_today`, compartilhada com o Hub) — marcar aqui é o
  mesmo tick de sempre. O painel de treino é um heatmap ECharts (a fronteira do
  ADR-0018: análise densa) mais a taxa por dia da semana. Exames são eventos de
  calendário com `category='exame'` (coluna da 0007, não uma tabela nova — ver
  ADR-0028), com alerta de < 7 dias.
- **Finanças** (migration 0010): `contributions` (aporte; resgate é valor
  negativo) e `portfolio_snapshots` (patrimônio informado à mão). Dinheiro é
  sempre centavo inteiro. Registrar um aporte é um FATO — grava no ledger, e o
  ledger passou a admitir fatos que não são nodes (`LedgerEntityKind`,
  ADR-0027). Aporte em 5 segundos por modal e por Ctrl+K ("aportar 500 no btg",
  parser testado).
- **Saúde Financeira 0–100** (`domain::financial_health`, pura e testada):
  30 regularidade + 25 diversificação (1−Herfindahl) + 25 objetivos (M4) + 20
  consistência, com os pesos redistribuídos entre o que se aplica (ADR-0014) e a
  fórmula sempre exibível. Computada ao vivo, não gravada (ADR-0028).
- **ECharts entra de verdade** (ADR-0018): a área acumulada e o donut de
  alocação das Finanças, e o heatmap de treino da Saúde — as três telas de
  análise densa que justificam a engine. O resto do app segue em SVG.

### O que o M4 entrega de verdade

- **Objetivos Financeiros** (as "caixinhas", kind `fin_goal`): grade de cards com
  barra grossa/glow, `R$ guardado / alvo` com count-up, badge do banco e a projeção
  determinística (`domain::savings`, média dos últimos 3 meses, fórmula exibível).
  Depósito em 1 clique; fechar dispara a celebração dourada (CSS one-shot) e a
  conquista 🏆 no ledger. O progresso das caixinhas ativas alimenta a parcela
  "Objetivos" da Saúde Financeira (ADR-0031, cumprindo o ADR-0028).
- **Estudos + Biblioteca** (kind `book`): estante visual com capas GERADAS
  localmente (gradiente + iniciais, sem imagem externa), estrelas interativas,
  filtros por status/prateleira/nota, meta anual de leitura com anel + ritmo. Terminar
  um livro grava a conquista no ledger e transforma a resenha numa NOTA linkada via
  `links`. Idiomas/Faculdade/Cursos reusam o kind `project`.
- **Carreira**: marcos profissionais como fatos ledger-only
  (`LedgerEntityKind::CareerMilestone`, ADR-0032), com a "linha da carreira" no painel;
  Projetos e Habilidades reusam `project`.
- **Notas** (CodeMirror 6): editor Markdown com preview ao vivo, checkboxes
  interativos, `[[wiki-links]]` com autocomplete + backlinks automáticos (2º consumidor
  de `links`), e anexos copiados para `media/AAAA/MM/<sha>.<ext>` com SHA-256 e dedup
  (colar imagem do clipboard entra direto). Protocolo `asset:` habilitado com escopo em
  `media/`.
- **Timeline** (a Máquina do Tempo): scrubber de ano/mês, visão MÊS como feed do ledger
  agrupado por dia (sem JOIN com `nodes` — `title_snapshot` + `payload`), visão ANO por
  `timeline_rollups` congelados pelo job de fechamento (disparado pela navegação,
  ADR-0034) + o mês corrente ao vivo, filtros, e o card "Neste dia" no Hub.
- **`MonthlyByWeekday`** ("toda 3ª terça", ADR-0030): variante de recorrência que pula
  o mês sem a N-ésima ocorrência, derivada da data do evento na UI do calendário.
- **Template `simple`**: Agenda (compromissos = eventos do calendário unificado) +
  Checklists (reuso de `project`+`task`), mais o wizard "+ Nova Esfera" (só `simple`,
  ADR-0035).
- **Migration 0011**: recria `nodes` UMA vez para os dois kinds novos (ADR-0029), mais
  `fin_goal_details`/`fin_goal_deposits`, `book_details` e `reading_goals`.

### O que o M4.5 entrega de verdade

- **`bi_engine`** (`InsightService` + `InsightWorker`, ADR-0040): numa thread
  própria, lê do pool `query_only` e grava só o `insight_cache`; aquece no boot e
  recomputa **debounced** (30 s), com `input_signature` pulando o que não mudou. Os
  insights que cruzam entidades: **correlações** entre pares de hábitos (2×2 sobre
  os dias em que ambos estavam agendados, `domain::correlation`, com as guardas
  n≥30 / faixa morta / pisos do template) e a **guarda anti-burnout**
  (`domain::burnout`). Verificado ponta a ponta em `tests/life.rs`.
- **Gamificação DERIVADA** (ADR-0037): XP por Esfera é a soma dos pontos de tudo
  que o usuário fez (uma query só, pontos vindos do domínio), nunca uma coluna;
  `domain::xp` dá o nível pela curva `100·n^1.5`. A **galeria de conquistas** tem
  o catálogo no código (`domain::achievements`, ícones Lucide, nunca emoji) e o
  desbloqueio no ledger, sincronizado de forma idempotente (ADR-0038).
- **Temporadas** (kind `challenge`, ADR-0036): placar computado (ticks de um hábito
  na janela, ou contador manual), estado "vencida" **derivado** da passagem do tempo,
  ciclo completo (criar/incrementar/abandonar/`sync` que fecha as que bateram o alvo).
- **Metas Anuais** (kind `annual_goal`, ADR-0036): organizadas por ano, binárias ou
  quantitativas, com a visão do ano cruzando **% decorrido vs progresso** e os
  checkpoints no ledger. Cria para o ano corrente e futuros; o passado é recusado.
- **Nexus Score congelado** (ADR-0039/0041): cada dia fechado vira um evento
  `nexus_score` no ledger — a história nunca é recomputada. O congelado é
  comportamental (hábitos + tarefas), pois rotina e inbox são sinais de agora.
- **Frontend**: telas de Insights, Conquistas (`/game`) e Metas Anuais
  (`/annual-goals`), todas com ícones Lucide/SVG e "ⓘ como calculamos"
  (`design-system/Formula`). As rotas e a rail vêm de `app/navigation.ts` (fonte
  única), sem acoplar à sidebar — o M4.6 troca a casca lendo o mesmo array.

### O que o M5.5 entrega de verdade

- **Sistema de layout** (§3.1): um `PageContainer`/`PAGE_CONTAINER` único (max-w
  1360, padding lateral), para nenhuma tela inventar a própria margem. `PageHeader`
  vira barra de largura total; a coluna de dado é contida logo abaixo.
- **A geometria do astrolábio nos fundos** (§3.2): a marca vira o fundo. Dois
  pseudo-elementos de `.nx-page` (zero DOM, presentes em toda tela por construção)
  desenham a mesma família geométrica do NexusMark — anéis, limbo graduado,
  alidade, constelação — fora de centro, tingida pela Esfera via **máscara** (SVG
  branco data-URI + `background-color: var(--sphere)`). Estático, `--astro-alpha`.
- **O NEXO** (§3.3): o menu central que substitui a gaveta-lista do hambúrguer.
  A faixa orbital (as Esferas num arco elíptico, cada uma com o anel de hoje e o
  nível), a busca que reusa o MESMO motor do Ctrl+K (`useCommandRows`, uma
  superfície só), os destinos curados com micro-dado vivo, e o rodapé de estado
  (backup, nível, Score). Teclado total: 1–9, setas+Enter, Esc.
- **Empty states próprios** (§3.4): o `EmptyState` passa a desenhar o
  `AstrolabeGlyph` — o emblema da marca tingido pela Esfera com o ícone do módulo
  no núcleo. As ~29 telas ganham a assinatura de uma vez; cada uma já passa a
  própria frase e ação.
- **A tela de bloqueio por PIN** (§3.5, ADR-0054): privacidade de TELA, não cifra
  de disco. `infrastructure::security` guarda `SHA-256^120000(salt‖pin)` num
  `security.json` fora do banco (sobrevive a restauro, lido no boot). PIN de
  fábrica `242807`; `LockScreen` no design da marca; `Ctrl+L` bloqueia; trocar e
  desligar exigem o atual. Backup/restauração independem do PIN.

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

1. **O fundo nunca é chapado.** Duas escalas de fundo, ambas estáticas e de custo
   de render ~zero (sem canvas, sem partícula, sem frame de animação):
   - **Da PÁGINA** (`.nx-page`, em `styles.css`): navy sólido + dot grid + aurora
     radial na cor da Esfera, empilhados como `background-image`. Rola com o
     conteúdo (`background-attachment: local`) — é a identidade da tela.
   - **Da VIEWPORT** (`.nx-viewport-fx`, sobre o `<main>` do `Shell` — M4.6 item 9):
     grão de filme (`feTurbulence` embarcado como data-URI, blend `overlay`) +
     vinheta elíptica. Emoldura os olhos, não o texto: fica presa à viewport
     enquanto a página rola por baixo, porque o `<main>` é `overflow-hidden` e do
     tamanho da janela. Ver ADR-0049.
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
  charts.tsx      Sparkline, Gauge, ProgressRing, ProgressBar (SVG — ADR-0018)
  useSphereColor  areaId -> cor, num lugar só. Nenhuma tela reimplementa.
  Checkbox.tsx    o gesto mais repetido do app
  useCountUp.ts   rAF, respeita prefers-reduced-motion, zero animação em idle
```

**Orçamento de movimento** (§6 do plano): só `transform` e `opacity` animam;
`box-shadow`/`filter` nunca em loop; no máximo **um** `backdrop-filter` visível
por vez (por isso a palette e a captura são mutuamente exclusivas no `Shell`);
com o app parado, nenhuma animação roda.

**Gráficos: SVG ou ECharts?** (ADR-0018) — `SVG para ≤ ~100 pontos decorativos;
ECharts para telas de análise.` Os micro-gráficos do Hub são SVG **para sempre**
(`charts.tsx`): o Hub é o caminho do cold start e nunca instancia engine de
gráfico. ECharts (`Chart.tsx` + `nexusTheme.ts`, desde o M3) entra só onde a tela
é de análise — calendário/heatmaps, Finanças, Insights —, onde eixo, tooltip e
zoom não se reimplementam à mão.

O `Chart.tsx` existe para as quatro regras da §6 não serem esquecidas uma por
vez: uma instância por gráfico (init duplicado vaza um canvas que continua
desenhando), `lazyUpdate`, animação **só na montagem**, e `ResizeObserver` (o
ECharts não redimensiona sozinho — sem ele o gráfico fica do tamanho que o
container tinha no primeiro frame, normalmente zero). O tema lê os tokens
resolvidos do CSS, porque o canvas não entende `var(--x)`; por isso ele é
re-registrado quando o tema claro/escuro troca.

**A cor da Esfera nunca é a única pista** (ADR-0017): ela tinge, não codifica.
Todo lugar que mostra uma Esfera mostra também ícone e nome. Nenhum gráfico pode
plotar Esferas distinguíveis só por cor com legenda de bolinha.

**O Inbox é a única tela que não se tinge** — de propósito. Ele é o lugar do que
ainda não tem Esfera, e o azul neutro diz isso. A exceção é o preview da
triagem: escolher a Esfera de destino (1–9) tinge aquele item ao vivo, porque aí
a cor não afirma uma decisão, ela mostra a que está prestes a ser tomada.

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
npm run tauri dev      # desenvolvimento (abre o %APPDATA% real — evite dirigir aqui)
.\dev.ps1              # dev com dados de teste ISOLADOS (.devdata) — para dirigir a UI (ADR-0048)
.\check.ps1            # gate completo (fmt, clippy, testes, tsc, build, release)
.\check.ps1 -Quick     # sem o build release
npx tauri build        # instaladores NSIS + MSI
```

> **Atenção:** `cargo build --release` sozinho **não** produz um app funcional —
> ele não embute o frontend e o binário tenta carregar `localhost:1420`. Só a
> CLI (`tauri build`) orquestra o bundle. Ver ADR-0005.
