# NEXUS — Modelo de Dados

> Estado: **schema v3** — `0001_core_schema.sql`, `0002_fts.sql` e
> `0003_ledger.sql` aplicados e cobertos por testes.

## 1. Convenções

| Aspecto | Decisão | Motivo |
|---|---|---|
| IDs | **UUIDv7** como `TEXT` | Ordenável por tempo → inserts B-tree sequenciais (sem page splits aleatórios) + merge de backups sem colisão. |
| Timestamps | `INTEGER` epoch **ms UTC** | Aritmética barata, sem fuso ambíguo, ordenação natural. |
| Dias | `TEXT 'YYYY-MM-DD'` **local** | A pergunta "fiz o hábito hoje?" é local, não UTC. Chave da timeline e dos ticks. |
| Markdown | `TEXT` puro | Formato eterno. |
| Migrations | SQL plano numerado, **imutável após commit** | Legível em 2056. Mudou de ideia? Escreva a próxima. |

## 2. Polimorfismo Universal — o padrão "Node"

**Problema:** nota, hábito, tarefa, meta, arquivo, evento — todos precisam
pertencer a áreas/projetos, receber tags, aparecer na busca e na timeline. A via
ingênua são 18 tabelas associativas.

**Solução: Single Table Core + Satellite Tables.** Toda entidade **é** um `node`
(identidade, título, área, hierarquia, status, timestamps). Os dados específicos
de cada tipo vivem em tabelas-satélite 1:1 onde **PK = FK**.

```
                    ┌──────────┐
                    │  areas   │  ← as "Esferas" da UI (ADR-0013)
                    │ template │    template = que tela abrir
                    └────┬─────┘    is_system = uma das 5 instaladas
                         │ area_id
                    ┌────▼─────┐         ┌──────────┐
       parent_id ──►│  nodes   │◄────────┤  links   │ (N:N universal)
       (hierarquia) │  kind    │         └──────────┘
                    └────┬─────┘         ┌──────────┐
                         │               │node_tags │──► tags
     ┌───────────┬───────┼───────┬───────┴──┬───────┴───┬──────────┐
     ▼           ▼       ▼       ▼          ▼           ▼          ▼
task_details habit_  goal_   note_     file_      event_    (futuros)
             details details details   details    details
```

**Por que isso escala por 30 anos**

- Busca, timeline, tags, links e lixeira operam **somente** sobre `nodes`.
  Uma feature nova não exige uma tabela associativa nova.
- Criar um tipo novo = 1 valor no CHECK de `kind` + 1 satélite + 1 migration.
- **Nenhum JOIN polimórfico caro**: você sempre conhece o `kind` antes de juntar
  com o satélite. O JOIN é sempre 1:1 por PK.

**Hierarquia vs. links.** `parent_id` cobre a hierarquia natural
(task→project, project→goal): é uma árvore, barata de percorrer. `links` cobre o
resto (`related`, `blocks`, `references`, `attached_to`), inclusive `[[wiki-links]]`
e backlinks.

### Índices e o porquê de cada um

| Índice | Serve a |
|---|---|
| `idx_nodes_kind_status` | "todos os hábitos ativos" — o acesso mais comum. |
| `idx_nodes_area` / `idx_nodes_parent` | Parciais (`WHERE ... NOT NULL`): não pagam por linhas órfãs. |
| `idx_task_due` / `idx_task_sched` | Parciais em `completed_at IS NULL`: o índice só carrega o que está em aberto — tarefas concluídas somem dele para sempre. É o que mantém "Hoje" barato após 10 anos. |
| `idx_event_range` | Overlap scan para detecção de conflito. |
| `idx_links_target` | Backlinks (`links` já tem PK em `source_id`). |
| `idx_file_sha` | Dedup de anexos por conteúdo. |
| `idx_ticks_day` | O Hub (0005). A PK de `habit_ticks` é `(habit_id, day)`, ótima para "o ano do hábito X" — e inútil para a pergunta transposta que o Hub faz, "os ticks de TODOS os hábitos nos últimos 30 dias". Sem ele, a tela que abre a cada cold start varreria a tabela inteira, que cresce para sempre. |

## 3. A Máquina do Tempo — ledger imutável

**Princípio: CQRS pragmático.** As tabelas da §2 são o **estado atual** — rápidas,
mutáveis, otimizadas para a leitura de hoje. A história vive num **ledger
append-only separado** que **nunca** participa das queries do dia a dia.

Essa separação é a razão de a timeline poder crescer para milhões de linhas sem
tornar o Dashboard mais lento: são tabelas diferentes, índices diferentes,
caminhos de acesso diferentes.

```sql
CREATE TABLE ledger (
    seq         INTEGER PRIMARY KEY,   -- rowid: ordem total
    ts          INTEGER NOT NULL,
    day         TEXT NOT NULL,         -- 'YYYY-MM-DD' local
    entity_id   TEXT NOT NULL,         -- SEM FK de propósito: sobrevive ao delete
    entity_kind TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    payload     TEXT NOT NULL DEFAULT '{}',
    title_snapshot TEXT NOT NULL       -- título na época
);
CREATE INDEX idx_ledger_day    ON ledger(day);
CREATE INDEX idx_ledger_entity ON ledger(entity_id, ts);
```

**Regras de ouro**

1. Todo caso de uso relevante grava estado atual **e** ledger **na mesma
   transação**. Ou os dois acontecem, ou nenhum.
2. **Nunca** há UPDATE/DELETE em `ledger` — protegido por trigger `RAISE(ABORT)`.
3. `entity_id` **não tem FK**: o evento histórico sobrevive ao apagamento da
   entidade. A história não some porque você deletou uma nota.
4. `title_snapshot` + `payload` autossuficiente ⇒ a timeline renderiza **sem
   JOIN** com `nodes`. Renomear um projeto hoje não reescreve o passado.
5. Leitura: `WHERE day BETWEEN ? AND ?` usa `idx_ledger_day` — custo independente
   do tamanho total da tabela.

**Escala honesta:** 200 eventos/dia × 30 anos ≈ 2,2 M de linhas ≈ algumas centenas
de MB. Com esses índices, o SQLite lida com isso sem esforço.

### habit_ticks — a série mais consultada pelo BI

```sql
CREATE TABLE habit_ticks (
    habit_id TEXT NOT NULL,
    day      TEXT NOT NULL,
    status   TEXT NOT NULL CHECK (status IN ('done','skipped','failed')),
    value    REAL,
    ts       INTEGER NOT NULL,
    PRIMARY KEY (habit_id, day)
) WITHOUT ROWID;
```

`WITHOUT ROWID` **não é detalhe**: a tabela vira uma B-tree clusterizada pela PK,
então "todos os ticks do hábito X no último ano" é um **range scan sequencial**,
não N buscas aleatórias. É o que faz o heatmap de 365 células abrir instantâneo.

### timeline_rollups — meses congelados

```sql
CREATE TABLE timeline_rollups (
    month TEXT NOT NULL, metric TEXT NOT NULL,
    value REAL NOT NULL, computed_at INTEGER NOT NULL,
    PRIMARY KEY (month, metric)
) WITHOUT ROWID;
```

Meses encerrados são congelados pelo `bi_engine` (job mensal). A visão "ano" lê
**só** rollups; a visão "mês/dia" lê o ledger paginado. É assim que a timeline de
5 anos atrás abre em < 100 ms.

## 4. Busca Universal — FTS5

```sql
CREATE VIRTUAL TABLE search_index USING fts5(
    title, body, tags,
    content='', contentless_delete=1,
    tokenize = "unicode61 remove_diacritics 2"
);
```

- `content=''` (contentless): o índice **não duplica** os dados — o banco não
  dobra de tamanho.
- `remove_diacritics 2`: `saude` encontra `saúde`. Inegociável em português.
- Sincronizado por triggers em `nodes` / `note_details` / `node_tags`.
- `search(query, limit, offset)` retorna id, kind, title, snippet e rank (bm25).
- `rebuild_search_index` fica exposto como ação de manutenção.

### Não existe coluna `node_id` aqui — e isso é deliberado (ADR-0010)

Numa tabela contentless o FTS5 **não guarda valor de coluna nenhum**, nem os
`UNINDEXED`. Ler qualquer coluna devolve **NULL**. Uma coluna `node_id` seria
sempre NULL e um `JOIN` por ela casaria **zero linhas, em silêncio** — foi
exatamente o bug encontrado no M1.

O vínculo é `search_index.rowid = nodes.rowid` (`nodes` tem PK TEXT mas continua
sendo tabela com rowid). Pelo mesmo motivo, `snippet()`/`highlight()` não estão
disponíveis: o trecho é montado em Rust a partir de `nodes`/`note_details`.

Detalhe de sintaxe: com alias, o `MATCH` exige o **nome da tabela**
(`search_index MATCH ?`), não o alias.

### A entrada do usuário nunca é sintaxe

Texto livre não pode virar operador. `AND` seria conjunção, `*` curinga, `"` erro
de sintaxe, `foo:bar` filtro de coluna — a busca quebraria enquanto a pessoa
digita. `build_match_query` tokeniza por `is_alphanumeric` (some todo caractere
de sintaxe, e 'saúde'/'ação' sobrevivem) e põe **aspas** em cada token (neutraliza
as palavras-chave). Cada token ganha `*` para busca-enquanto-digita.

`'; DROP TABLE nodes;--` vira `"DROP"* "TABLE"* "nodes"*` — uma busca literal
inofensiva.

## 5. Insights determinísticos (M4)

Cada insight carrega a própria explicação: `formula`, `sample_size`,
`confidence_label`. A UI mostra "ⓘ como calculamos" em todo card.

**Guardas anti-ruído (obrigatórias):** nunca exibir correlação com amostra
< 30 dias, nem lift entre 0,9 e 1,1.

### Correlação entre hábitos — tabela de contingência 2×2

Pergunta: *"fazer o hábito A muda a chance de eu cumprir o B?"* Métricas: **lift**
e **coeficiente phi (φ)**. Renderização por template determinístico quando
`phi >= 0.25 e lift >= 1.3`:

> "Nos dias em que você faz **{A}**, a chance de cumprir **{B}** sobe de
> {p_b_given_not_a}% para {p_b_given_a}% (últimos {n} dias)."

Só considera dias em que **ambos** estavam agendados. Com 30 hábitos são 435
pares — queries baratas em background. SQL de referência no prompt mestre §5.2.

### Demais insights da V1

| Insight | Cálculo |
|---|---|
| Streaks | Atual e recorde, respeitando `schedule_json` — **dia não agendado não quebra streak**. |
| Ofensores | Taxa de falha por dia da semana (`GROUP BY strftime('%w', day)`). |
| Heatmap | 365 células por hábito + densidade geral. |
| Carga de trabalho | Soma de `duration_min` + eventos da semana vs. média móvel de 8 semanas → alerta quando > 1,25× (**guarda anti-burnout**). |
| Tendência de metas | Regressão linear sobre `goal_checkpoints` → projeção da data de atingimento. |
| **Nexus Score** | 40% hábitos agendados cumpridos + 30% tarefas planejadas + 20% rotina matinal + 10% inbox zerada. Série própria no ledger. |
| Neste dia | Ledger em `day` de 1/2/5 anos atrás. |

## 5.5 As Esferas da Vida (0005)

Uma Esfera **é** uma linha de `areas` — não uma tabela nova. O motivo, a
alternativa recusada e o custo (um conceito com dois nomes) estão no **ADR-0013**.

| Coluna | Papel |
|---|---|
| `template` | Que tela a Esfera abre: `health`, `finance`, `fin_goals`, `career`, `studies`, `simple`. **Não é o id nem o nome**: renomear "Saúde" para "Corpo" não pode apagar a tela, e um id não diz nada sobre comportamento. Imutável depois de criada — virar uma Esfera de Saúde em agenda simples deixaria checkpoints e histórico de treino órfãos, vivos e sem tela. |
| `is_system` | As 5 que o NEXUS instala. **Não** impede editar nem arquivar (a vida do usuário é dele); serve para o wizard não oferecer uma segunda "Finanças", que partiria o patrimônio em duas telas que nunca somam. |

A migration **é** o seed: as 5 Esferas e os 6 bancos nascem com ids fixos e
legíveis (`sphere-health`, `acct-nubank`), com `INSERT OR IGNORE`. Ver ADR-0014.

`accounts` chega junto, antes dos aportes do M3.5, porque `contributions` vai
referenciá-la — criar o alvo da FK antes da FK — e porque a Esfera Finanças
precisa listar os bancos desde o primeiro boot. Ela não tem `created_at`: uma
conta não é um acontecimento, é uma gaveta. O ledger conta o que você fez (o
aporte), não onde você guardou.

## 5.6 O Tempo (0007)

### Adicionar um `kind` custa uma recriação de tabela

A §2 promete que criar um tipo é rotina: "1 valor no CHECK de `kind` + 1
satélite + 1 migration". A 0007 cobrou a promessa pela primeira vez (`milestone`)
e o preço apareceu: **o SQLite não sabe alterar um `CHECK`**. A única via é o
[12-step procedure](https://sqlite.org/lang_altertable.html#otheralter) — criar
a tabela nova, copiar, dropar a antiga, renomear.

Recriar `nodes` — a tabela mais referenciada do schema — tem três armadilhas, e
**as três falham em silêncio**. Cada uma tem um teste em `migrations.rs`
(`mod recreating_nodes`), e o próximo `kind` (o `book` do M4) segue a mesma
receita:

| Armadilha | O que acontece se esquecer |
|---|---|
| **CASCADE** | `DROP TABLE nodes` com FK ligada roda um `DELETE FROM` implícito, e os `ON DELETE CASCADE` dos oito satélites apagam anos de dados. As FKs são desligadas **no runner** (`migrations.rs`), não no `.sql`: o pragma é no-op dentro de uma transação, e é dentro de uma que cada migration roda. `foreign_key_check` roda depois, sobre o banco inteiro. |
| **rowid** | `search_index` é FTS5 contentless: o vínculo com o conteúdo é `search_index.rowid = nodes.rowid` (§4). Copiar sem `rowid` explícito renumera tudo e a busca passa a devolver a linha errada — sem erro. |
| **rename** | Desde o 3.25 o `ALTER TABLE RENAME` reparsa o schema para reescrever referências em triggers/views. Os gatilhos de FTS que moram em `note_details`/`node_tags` falam de `nodes`, que acabou de ser dropada → o rename explode. `PRAGMA legacy_alter_table=ON` devolve o comportamento que o 12-step espera. |

### Recorrências: materializadas, não expandidas

`event_occurrences` guarda cada ocorrência como linha. A alternativa — guardar só
a RRULE e expandir na leitura — faz desenhar novembro/2027 exigir expandir
**toda** regra do banco desde o começo dos tempos, a cada troca de mês. Com
ocorrências materializadas é um range scan por `starts_at`: o custo é do mês
pedido, não da história.

O preço é a janela: 18 meses à frente, estendida pelo `EventService` quando o
usuário navega para perto da borda.

Um evento **sem** recorrência também ganha uma linha aqui. Não é desperdício: é o
que faz o calendário ler UMA tabela em vez de um `UNION` de "avulsos + séries" em
toda query — e um `UNION` que alguém vai esquecer de atualizar um dia.

`status` na ocorrência ('scheduled' | 'cancelled' | 'moved') é o que permite
"toda terça, MENOS a de 25/11": a exceção mora na ocorrência, e a regra da série
não é reescrita.

### Sub-desafios são nodes

O node já carrega quase tudo: título, `parent_id` (a meta) e `status='done'` —
que **é** o checkbox. `milestone_details` guarda só o resto: se é `simple` (um
checkbox) ou `counter` ("21/30 dias", alimentado pelos ticks de um hábito
linkado, nunca por número digitado à mão), o `weight` na média e a ordem.

`goal_details.progress_source` existe porque uma meta quantitativa tem duas
medidas possíveis de progresso — a métrica e os sub-desafios — e elas discordam.
Adivinhar qual mostrar seria o app decidindo por um número que é do usuário.

`milestone_details.counts_from` (0009) é o dia a partir do qual o contador conta.
Sem ele, "30 dias de academia" criado hoje sobre um hábito com 120 dias de
histórico nasce **marcado, exibindo 51/30** — foi o que a tela mostrou. O padrão
é o dia da criação; o passado é aceito ("conte desde o início do mês") e o futuro
não, igual ao `day` de um tick. NULL = conta tudo, que é o que dizem as linhas
anteriores à 0009. Ver ADR-0025.

### A ocorrência lembra de que turno ela é (0008)

`event_occurrences` tem duas colunas de tempo que quase sempre são iguais, e a
diferença entre elas é o que sustenta a extensão da janela:

| coluna | responde | quem manda |
|---|---|---|
| `starts_at` | **quando** a ocorrência acontece | o usuário, arrastando |
| `rule_start` | **qual turno da regra** ela é | a regra |

Um arrasto reescreve `starts_at` no lugar (é a PK). Sem `rule_start`, a pergunta
"até onde esta série já foi materializada?" não teria resposta depois do primeiro
arrasto: a borda por `MAX(starts_at)` abre um buraco de semanas na série quando a
última ocorrência é empurrada para frente, e a borda que ignora as movidas
ressuscita a ocorrência que o usuário tirou dali. O índice UNIQUE
`(event_id, rule_start)` diz ao banco a invariante — **uma linha por turno** — e é
ele que torna a extensão idempotente de graça. Ver ADR-0022.

## 5.7 As Finanças (0010)

A Esfera Finanças é sobre INVESTIR, não gastar (o controle de gastos vive em
outro app). Duas tabelas apontando para `accounts` (os 6 bancos da 0005):

- **`contributions`** — cada aporte. `amount_cents INTEGER` (dinheiro é sempre
  centavo, nunca float), `asset_class` num CHECK fechado (é o eixo do donut, e
  uma classe livre viraria uma fatia de um só). **Resgate é aporte negativo** —
  não uma tabela separada nem uma coluna de sinal: a soma acumulada já faz a
  conta, e uma segunda tabela duplicaria toda query de total. `happened_on` é dia
  local `'YYYY-MM-DD'`, como `habit_ticks.day` — "quanto aportei em março" é um
  range scan por texto, sem `strftime(..., 'localtime')`.
- **`portfolio_snapshots`** — o patrimônio informado à mão, PK `month`. O NEXUS
  sabe o que você aportou, mas o patrimônio também rende sozinho e isso ele não
  tem como saber (sem cotação, sem rede). `INSERT OR REPLACE`: reinformar o mês
  corrige, não empilha.

Um aporte é um FATO da vida do usuário, então também vira evento no ledger — e
foi ele que forçou o ledger a admitir história que não é sobre um node
(`LedgerEntityKind`, ADR-0027). A **Saúde Financeira** (`domain::financial_health`)
é uma função pura do histórico, com pesos redistribuídos e fórmula exibível
(ADR-0028); ela é computada, nunca gravada.

## 5.8 Esferas II e Memória (0011)

Dois kinds novos numa recriação só de `nodes` (ADR-0029): `fin_goal` (as
caixinhas) e `book` (a Biblioteca). As três armadilhas do 12-step (CASCADE,
rowid, rename dos gatilhos de FTS) ganharam mais um teste — provando que a
SEGUNDA recriação sobre dados existentes também é segura.

- **`fin_goal_details`** — a caixinha: `target_cents` (centavo inteiro),
  `account_id` (o banco onde o dinheiro mora, opcional), `deadline`, `emoji`.
  **`fin_goal_deposits`** — cada depósito; resgate é negativo, e a soma acumulada
  já faz a conta (a mesma decisão de `contributions`). O total guardado vem de
  query, nunca de um número à mão. Índice `(goal_id, happened_on)` para o total e
  a média de 3 meses da projeção.
- **`book_details`** — autor, páginas, `status` de leitura (fila/lendo/lido/
  abandonado, CHECK), `rating` 0–5, `shelf` (texto livre — a estante é do usuário,
  não eixo de gráfico), datas. Terminar um livro marca o node `done` e a resenha
  vira uma NOTA linkada via `links` (`link_type='references'`).
- **`reading_goals`** — a meta anual (`year` PK), como `portfolio_snapshots`:
  reinformar corrige, não empilha. Não é um node — é configuração numérica.

**A tabela `links` ganha seus primeiros consumidores de código.** Notas
(`[[wiki-links]]` → `references`, com backlinks do outro lado) e anexos
(`attached_to`, nota → node `file`). Salvar o corpo de uma nota resincroniza só os
'references'; os 'attached_to' não vêm do texto e ficam intactos (ADR-0033).

**A Timeline** lê o ledger (visão MÊS, por `idx_ledger_day`) e `timeline_rollups`
(visão ANO, meses congelados). Marcos de carreira são fatos sem node no ledger
(`entity_kind='career_milestone'`, ADR-0032). Nenhuma tabela nova: `timeline_rollups`
e `insight_cache` já existiam desde a 0003.

## 5.9 Vida: Metas Anuais e Temporadas (0012)

**Dois kinds novos numa recriação só de `nodes`** (a TERCEIRA do projeto, ADR-0036):
`annual_goal` (a seção Metas Anuais) e `challenge` (as Temporadas/Desafios). As três
armadilhas do 12-step ganharam mais um teste — a segunda recriação sobre dado já
existente prova, de novo, que CASCADE/rowid/rename estão sob controle.

- **`annual_goal_details`** — a meta anual: `year` (INTEGER, o eixo da visão por ano;
  índice `idx_annual_goal_year`), `goal_kind` (`binary`/`quantitative`, CHECK),
  `metric_name`/`target_value`/`current_value`/`unit` (só a quantitativa usa). O
  **status é o `nodes.status`** (ativa=`active`, concluída=`done`, abandonada=`dropped`).
  Ela **reusa o padrão de goal, não a tabela** `goal_details` (ADR-0036): o progresso
  de uma quantitativa é `current_value/target_value`, e cada atualização vira um
  evento `goal_checkpoint` no ledger — não linhas numa tabela de checkpoints diários.
- **`challenge_details`** — a temporada: janela `starts_on`/`ends_on` ('YYYY-MM-DD'
  local), `metric` (`habit_days`/`manual`, CHECK), `habit_id` (o hábito que alimenta
  `habit_days`, reusando `habit_ticks`), `target_count` (>0, o alvo do placar) e
  `manual_count` (o contador de `manual`). Índice parcial `idx_challenge_habit`. O
  estado é o `nodes.status`; **"vencida" é DERIVADO** (`ends_on < hoje` e ainda
  `active`), nunca gravado.

**Nada de tabela para XP, conquistas ou Score** — os três são derivados/eventos:

- **XP e níveis por Esfera** (ADR-0037) — DERIVADOS do estado. `domain::xp` é a
  aritmética pura: a tabela de pontos abaixo, e a curva `custo(n) = 100·n^1.5` para
  ALCANÇAR o nível `n` (nível 1 = 0 XP; a soma acumulada dos custos dá o piso de cada
  nível). O XP por Esfera é a soma dos pontos de tudo que o usuário fez, agrupado pela
  `area_id` do node. Cacheado em `insight_cache`; a fonte é o estado.

  | Feito | Pontos |
  |---|---|
  | Hábito cumprido no dia | 10 |
  | Sessão de estudo registrada | 10 |
  | Bloco de foco concluído | 10 |
  | Tarefa planejada concluída | 15 |
  | Checkpoint de meta | 20 |
  | Sub-desafio de meta concluído | 25 |
  | Livro terminado | 60 |
  | Caixinha (objetivo financeiro) fechada | 80 |
  | Temporada vencida | 120 |
  | Meta anual concluída | 200 |

- **Conquistas** (ADR-0038) — o **catálogo vive em `domain::achievements`** (regra =
  `métrica >= limiar`, com ícone Lucide, nunca emoji); o **desbloqueio é um evento no
  ledger** (`achievement_unlocked`, `entity_kind='achievement'`, `entity_id=<key>`),
  sincronizado de forma idempotente (o `key` é a UNIQUE lógica). A galeria = catálogo
  ∪ desbloqueadas; as bloqueadas viram silhuetas.

- **Nexus Score congelado** (ADR-0039) — um evento diário no ledger (`nexus_score`,
  `entity_kind='daily_score'`, `entity_id=<dia>`), com o valor e a **versão da fórmula**
  no payload, agregado em `timeline_rollups` no fechamento de mês. **O passado nunca é
  recomputado** — a história é o que você viu na época.

### Insights determinísticos ganham forma (`domain::correlation`, `domain::burnout`)

As guardas da §5 saíram do papel para código puro e testado:

- **Correlação 2×2** (`correlation`): lift e phi (φ), com `n >= 30` obrigatório, a
  **faixa morta** de lift `[0,9 ; 1,1]` (efeito indistinguível de acaso, nunca vira
  card) e os pisos do template afirmativo (`φ >= 0,25` **e** `lift >= 1,3`). Sem
  denominador dos dois lados (A feito todo dia, ou B nunca sem A) → `None`, não um
  número inventado.
- **Anti-burnout** (`burnout`): carga da semana ÷ média móvel de até 8 semanas
  (mínimo 4 para falar), alerta acima de `1,25×`. Base zero → `None`.

## 5.10 Carreira e Estudos (0013)

**Dois kinds novos numa recriação só** (a QUARTA do projeto, ADR-0045): `skill`
(Carreira) e `subject` (Estudos). Olhar o item 7 antes de escrever a migration do 6
pagou a recriação uma vez para os dois — a regra dos ADR-0029/0036. As três
armadilhas do 12-step (CASCADE, rowid, rename) ganharam mais um teste.

- **`skill_details`** — a competência: `level` (INTEGER, começa em 1, `CHECK level>=1`),
  `category` (texto livre, agrupa a trilha) e `max_level` (teto opcional; o `CHECK
  (max_level IS NULL OR max_level >= level)` recusa subir além do teto no próprio
  banco). Subir de nível **não é derivação**: é um evento no ledger (`skill_level_up`,
  `entity_kind='skill'`, `entity_id`=node) gravado na MESMA transação que incrementa
  `level` (ADR-0037/0045). A trilha de evolução é a série desses eventos.
- **`subject_details`** — a matéria: `category` e `target_minutes` (meta opcional em
  minutos). O progresso é COMPUTADO (agrega sessões/livros/vínculos), nunca gravado.
  Repo/comandos entregues no item 7 (ver §5.12).
- **`study_sessions`** — o LOG das sessões (não um node, como `contributions`):
  `subject_id`/`book_id`/`skill_id` (todos opcionais, `ON DELETE SET NULL` — a hora
  estudada sobrevive ao apagamento do vínculo), `topic`, `minutes` (`CHECK >0`), `day`
  e `ts`. Índices por `day` e por `subject_id` parcial. Repo/comandos entregues no
  item 7 (ver §5.12).

**XP ganha uma fonte nova** (a tabela de pontos, §5.9, e `domain::xp`): subir de nível
numa competência vale **40 XP** (`XP_SKILL_LEVEL_UP`) — entre o sub-desafio (25) e o
livro (60): um feito repetível e significativo, atribuído à Esfera da competência.
Como todo XP, é DERIVADO (soma dos eventos `skill_level_up`), nunca uma coluna.

## 5.11 Metas de carreira linkáveis (0014)

**`links.link_type` ganha `contributes_to`** (ADR-0046) — uma meta de carreira
"conta para" uma Meta Anual ou um item de Estudos. Direcional: `source` contribui
para `target`. O CHECK fechado do `link_type` exigiu recriar a tabela `links`, mas
sem as três armadilhas de `nodes` (sem gatilhos de FTS, sem rowid, nada a
referencia) — copiar, dropar, renomear, reindexar `idx_links_target`.

O acesso é genérico (`LinkRepository`): criar (INSERT OR IGNORE, idempotente),
remover e ler resolvido nos dois sentidos. O backlink aparece dos dois lados lendo
a mesma linha — `outgoing` de um é `incoming` do outro. O comando de usuário só
admite `related` e `contributes_to`; `references`/`attached_to` continuam exclusivos
das notas/anexos (`NoteService`).

## 5.12 Estudos aprofundado — sessões e estatísticas (item 7, M4.6)

O item 7 ativa a fundação da 0013 sem nenhuma migration nova. **Nenhuma tabela
nova** — `subject_details` e `study_sessions` já existiam. O que chegou é código:
repositórios, o `StudyService`, comandos e a UI. Ver **ADR-0047**.

- **A sessão de estudo é um LOG que vale XP.** `study_session_repo` grava a linha
  em `study_sessions` E o evento `study_session_logged` (`entity_kind='study_session'`,
  um fato sem node — `LedgerEntityKind::StudySession`, ADR-0027/0047) na mesma
  transação. Vale **10 XP** (`XP_STUDY_SESSION`, o tier do gesto diário, §5.9),
  plano por sessão para não se poder inflar por minutos, atribuído à Esfera da
  matéria (ou do livro/competência ligados, por `COALESCE`) no `xp_by_area`.

- **O progresso da matéria é computado.** `subject_progress` agrega as sessões:
  minutos totais, contagem, último dia, livros distintos tocados, itens vinculados
  por `links` e o progresso vs. `target_minutes`. Nada disso é gravado — é somado
  ao ler (a filosofia do XP e da Saúde Financeira, ADR-0037/0028).

- **Estatísticas de estudo** (`StudyService::study_stats`): horas na semana (soma
  dos minutos dos últimos 7 dias ÷ 60) com tendência, constância (dias distintos
  com sessão nos últimos 30) e melhores horários — a hora sai do `ts` convertido
  para o fuso LOCAL (`strftime('%H', ts/1000, 'unixepoch', 'localtime')`), a única
  exceção ao costume de não usar `localtime`, porque a sessão guarda o `day` mas
  não o turno (ADR-0047 §4).

- **Estatísticas de leitura** (`BookService::reading_stats`): páginas/dia (páginas
  dos livros terminados no ano ÷ dias decorridos) e tempo médio para terminar
  (média de fim − início sobre os livros com as duas datas) — funções puras do
  estado dos livros, com a fórmula à mostra; omitidas sem amostra.

- **Revisão espaçada (SM-2): adiada** (ADR-0045/0047). O item 7 fechou sem ela; se
  vier, é tabela nova sem recriação, com ADR próprio.

## 5.13 Modo Foco — o pomodoro que vira histórico (0015, M5)

O Modo Foco é um timer pomodoro configurável, disparável a partir de qualquer
tarefa. Um bloco CONCLUÍDO vira uma linha de `focus_sessions` — um LOG, não um
node, exatamente como a sessão de estudo (§5.12). Ver o **ADR do Modo Foco**.

- **`focus_sessions`** (0015, `CREATE TABLE` simples — sem recriação): `task_id`
  (opcional, `ON DELETE SET NULL` — os minutos focados sobrevivem ao apagamento da
  tarefa), `label` (rótulo livre quando não há tarefa), `minutes` (`CHECK >0`),
  `day` e `ts`. Índices por `day` e por `task_id` parcial.

- **Só um bloco COMPLETO é registrado.** O timer do frontend só chama
  `log_focus_session` ao zerar; abandonar no meio não grava nada nem rende XP. É o
  guard que impede o farm e casa com a semântica do pomodoro — o tempo tem de
  passar de verdade.

- **Um bloco vale XP.** `focus_session_repo` grava a linha E o evento
  `focus_session_logged` (`entity_kind='focus_session'`, um fato sem node —
  `LedgerEntityKind::FocusSession`) na mesma transação. Vale **10 XP**
  (`XP_FOCUS_SESSION`, o tier do gesto diário, §5.9), **plano por bloco** para não
  se poder inflar por minutos, atribuído à Esfera da tarefa focada no `xp_by_area`
  (foco livre, sem tarefa, cai em `area_id` NULL — conta só no XP geral).

- **Estatísticas de foco** (`FocusService::focus_stats`): minutos na semana com
  tendência vs. a anterior, constância (dias distintos com bloco nos últimos 30) e
  as **melhores horas de foco** — a hora sai do `ts` convertido para o fuso LOCAL
  (`strftime('%H', ts/1000, 'unixepoch', 'localtime')`), como no estudo, porque o
  bloco guarda o `day` mas não o turno. Determinísticas, com a fórmula à mostra,
  omitidas sem amostra (constituição §2).

- **Apagar um bloco corrige o ESTADO, não a história.** `delete_focus_session`
  remove a linha (recomputa XP e estatísticas); o evento no ledger permanece
  (append-only), como desmarcar um hábito.

## 6. Integridade e migrations

- `user_version` gerenciado pelo `rusqlite_migration`.
- Na inicialização: `PRAGMA quick_check` **antes** das migrations. Falhou? Oferecer
  restauração do backup mais recente **antes** de abrir a UI (M5).
- Toda migration roda em transação.
- **O snapshot pré-migration (v1.2).** Esta linha prometia desde o M5 um "backup
  automático do arquivo" antes de migrar. A promessa **não era verdade**: o
  `Db::open` ia do `quick_check` direto para o `migrations::run`. Achado ao abrir a
  v1.2 — a primeira versão a migrar um `%APPDATA%` com dados REAIS do usuário —, e
  corrigido antes de qualquer migration nova ser escrita.

  `snapshot_before_migrating` grava `backups/pre-migration-AAAAMMDD-HHMMSS.db`
  **só quando o banco vai de fato ser alterado** (`user_version` entre 1 e a versão
  corrente): um banco novo em folha não tem nada a perder. É `VACUUM INTO`, não
  cópia de arquivo — sob WAL, o `nexus.db` sozinho é um estado velho, pois as
  escritas recentes moram no `-wal`. É `.db` cru e fora do padrão `nexus-*.zip` de
  propósito: assim a **retenção nunca o poda** e ele não polui a lista da UI. Falhar
  não impede o boot (o aviso vai para o log) — o app não pode se recusar a abrir por
  causa da própria apólice.
