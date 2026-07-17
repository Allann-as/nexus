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
                    │  areas   │
                    └────┬─────┘
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

## 6. Integridade e migrations

- `user_version` gerenciado pelo `rusqlite_migration`.
- Na inicialização: `PRAGMA quick_check` **antes** das migrations. Falhou? Oferecer
  restauração do backup mais recente **antes** de abrir a UI (M5).
- Toda migration roda em transação, precedida de backup automático do arquivo (M5).
