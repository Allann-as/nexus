-- =====================================================================
-- 0016 — BÚSSOLA (v1.2): a migration ÚNICA das fases C, D e E
-- =====================================================================
--
-- A regra de batch da constituição (ADR-0029/0036/0045/0058) manda olhar o
-- roadmap INTEIRO antes de tocar no schema. As três fases da v1.2 que pedem
-- schema foram levantadas juntas e cabem aqui:
--
--   C. Metas com TIPO      -> goal_details reconstruída (§1)
--   D. Estudos por trilha  -> subject_details ganha colunas (§2)
--   E. Habilidades 2.0     -> skill_checkins, tabela nova (§3)
--
-- **Nenhum `kind` novo, nenhum `link_type` novo** — e isso É o resultado do
-- levantamento, registrado para não se recriar `nodes` por reflexo:
--
--   * Os DEGRAUS de uma meta (o "por etapas" do C1, e os sub-desafios do C2) são
--     os `milestone` que já existem desde a 0007: um node ordenado com
--     `parent_id` = a meta, e `nodes.status='done'` como o checkbox. Uma escada
--     "Básico -> Fluente" é uma lista ordenada deles; o degrau atual é a
--     contagem dos concluídos. Zero tabela nova para o que já era uma árvore.
--   * As três seções de Estudos (Idiomas/Faculdade/Cursos) passam a ser
--     `subject`, o kind que já existe — não `project`. Ver §2.
--   * O check-in de habilidade é um FATO mensal, e fatos que não são nodes já
--     têm morada (`contributions`, `study_sessions`, `focus_sessions`).
--
-- Portanto: **nenhuma recriação de `nodes`**, e as três armadilhas do 12-step
-- (CASCADE, rowid, rename dos gatilhos de FTS) não se aplicam a nada aqui.


-- =====================================================================
-- 1. As metas ganham TIPO (fase C)
-- =====================================================================
--
-- O problema, achado em uso real: `goal_details` nasceu na 0001 assumindo que
-- TODA meta é quantitativa — `metric_name`, `start_value`, `target_value`,
-- `unit` e `direction` são todos NOT NULL. "Conseguir um emprego" não tem
-- nenhum dos cinco. O formulário não conseguia nem oferecer o tipo, porque o
-- banco recusaria a linha.
--
-- Os três tipos:
--   * 'quantitative' — o formato de sempre (métrica/hoje/alvo/unidade).
--   * 'binary'       — a CONQUISTA. Só título e prazo. Progresso vem dos
--                      degraus, ou do ato de concluir.
--   * 'staged'       — a ESCADA de níveis nomeados ("Básico -> Fluente"). O
--                      progresso é o degrau atual sobre o total. Serve idiomas,
--                      faixas, certificações.
--
-- O SQLite não afrouxa um NOT NULL no lugar, então a tabela é RECONSTRUÍDA.
-- Isto é muito mais barato que recriar `nodes`:
--   * não há gatilho de FTS falando de `goal_details` (o rename não explode);
--   * não há rowid a preservar (o vínculo do FTS é com `nodes`, não com o
--     satélite) — mas ela é WITHOUT ROWID? não: é tabela comum, e nada indexa
--     o rowid dela, então a renumeração é inofensiva;
--   * quem a referencia é `goal_checkpoints(goal_id) -> goal_details(node_id)`.
--     As FKs estão desligadas pelo runner (`migrations.rs`) durante toda
--     migration, e o `foreign_key_check` roda depois sobre o banco inteiro: as
--     mesmas linhas voltam com as mesmas PKs, então a referência continua de pé.
--
-- As linhas existentes são todas quantitativas — é o único tipo que existia.

CREATE TABLE goal_details_new (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,

    -- O TIPO. Default 'quantitative': é o que toda linha anterior a esta
    -- migration é, e o que o formulário oferece primeiro.
    goal_kind    TEXT NOT NULL DEFAULT 'quantitative'
                 CHECK (goal_kind IN ('quantitative','binary','staged')),

    -- Os cinco campos da meta quantitativa. Agora NULLABLE: uma conquista e uma
    -- escada não têm métrica. O CHECK no fim da tabela é que garante a coerência
    -- — nullable não quer dizer opcional para quem É quantitativa.
    metric_name  TEXT,
    start_value  REAL,
    target_value REAL,
    unit         TEXT,
    direction    TEXT CHECK (direction IS NULL OR direction IN ('increase','decrease')),

    deadline     INTEGER,

    progress_source TEXT NOT NULL DEFAULT 'metric'
                 CHECK (progress_source IN ('metric','milestones')),

    -- A invariante que o NOT NULL costumava dar de graça, agora dita por tipo:
    -- uma meta quantitativa PRECISA dos cinco campos; as outras duas não podem
    -- fingir que têm métrica. Sem isto, "binary" com target_value viraria uma
    -- meta que mostra uma barra que ninguém alimenta.
    CHECK (
        (goal_kind = 'quantitative'
             AND metric_name  IS NOT NULL
             AND start_value  IS NOT NULL
             AND target_value IS NOT NULL
             AND unit         IS NOT NULL
             AND direction    IS NOT NULL)
        OR
        (goal_kind IN ('binary','staged')
             AND metric_name  IS NULL
             AND start_value  IS NULL
             AND target_value IS NULL
             AND unit         IS NULL
             AND direction    IS NULL)
    ),

    -- Uma meta sem métrica só pode medir progresso pelos degraus. Deixar
    -- 'metric' aqui seria pedir uma divisão por um alvo que não existe.
    CHECK (goal_kind = 'quantitative' OR progress_source = 'milestones')
);

INSERT INTO goal_details_new
    (node_id, goal_kind, metric_name, start_value, target_value, unit,
     direction, deadline, progress_source)
SELECT
    node_id, 'quantitative', metric_name, start_value, target_value, unit,
    direction, deadline, progress_source
FROM goal_details;

DROP TABLE goal_details;
ALTER TABLE goal_details_new RENAME TO goal_details;


-- =====================================================================
-- 2. Estudos: a matéria ganha TRILHA e ESTÁGIO (fase D)
-- =====================================================================
--
-- O bug relatado ("o Inglês criado em Idiomas aparece dentro de Faculdade") não
-- era um vazamento de filtro: era a AUSÊNCIA de filtro. As três seções eram o
-- mesmo componente rodando a mesma query — `kind='project'` + `area_id` —, sem
-- nada que dissesse a qual seção o item pertence. Não havia onde guardar essa
-- informação: `nodes` não tem subtipo e `project` não tem satélite.
--
-- A correção NÃO é um kind novo. É reconhecer que Idiomas, Faculdade e Cursos
-- sempre foram MATÉRIAS (`subject`), o kind que a 0013 criou exatamente para
-- "algo que se estuda e cujo progresso se computa": ele já tem sessões de
-- estudo ligadas (`study_sessions.subject_id`), progresso computado
-- (`subject_progress`), meta em minutos e o tracker de hábito plugável. As
-- seções ganham de graça tudo que o D1/D2/D3 pede em matéria de tempo e
-- constância.
--
-- Por que uma coluna `track` NOVA em vez de reusar `category`: `category` é
-- texto livre e é do USUÁRIO (ele agrupa como quiser — "Semestre 1", "Optativas").
-- Sobrecarregá-la como discriminante de seção faria a UI competir com o usuário
-- pelo mesmo campo, e um renome inocente ("Faculdade" -> "UFRJ") faria a matéria
-- sumir da tela. `track` é fechado, é do SISTEMA, e as duas coisas convivem.

ALTER TABLE subject_details ADD COLUMN track TEXT NOT NULL DEFAULT 'livre'
    CHECK (track IN ('livre','idioma','faculdade','curso'));

-- O estágio de um CURSO (D3): "quero fazer / fazendo / concluído". É do curso,
-- não da matéria em geral — daí ser NULL para toda outra trilha. Não usamos
-- `nodes.status` para isto porque 'active'/'done' já significam outra coisa (a
-- matéria está viva ou arquivada), e "quero fazer" não é nenhuma das duas: é um
-- curso ativo que ainda não começou.
ALTER TABLE subject_details ADD COLUMN course_stage TEXT
    CHECK (course_stage IS NULL OR course_stage IN ('quero_fazer','fazendo','concluido'));

-- A estimativa de conclusão de um curso (D3), dia local 'YYYY-MM-DD' como todo
-- dia do schema.
ALTER TABLE subject_details ADD COLUMN expected_end TEXT;

-- O nível atual de um IDIOMA (D1) é a meta 'staged' ligada a ele — não uma
-- coluna. Guardamos só QUAL é essa meta, para a tela do idioma achá-la sem
-- varrer `links`. NULL = o idioma ainda não tem escada montada.
ALTER TABLE subject_details ADD COLUMN level_goal_id TEXT REFERENCES nodes(id);

-- A seção abre filtrando por trilha; sem índice ela varre todas as matérias.
CREATE INDEX idx_subject_track ON subject_details(track);


-- =====================================================================
-- 3. Habilidades 2.0: o check-in mensal (fase E)
-- =====================================================================
--
-- O nível 1-10 de uma competência passa a ser CALCULADO a partir de um histórico
-- de check-ins mensais, em vez de escolhido num clique. O check-in é o FATO que
-- o usuário informa; o nível é DERIVAÇÃO (ADR-0037) — a mesma filosofia do XP, da
-- Saúde Financeira e do contador de sub-desafio.
--
-- Três perguntas, uma vez por mês, por competência:
--   studied  — estudou esta habilidade no mês? (0/1)
--   applied  — quantas vezes aplicou/desenvolveu na prática? (>= 0)
--   stars    — auto-avaliação da evolução (1..5)
--
-- PK (skill_id, month) com WITHOUT ROWID: a tabela vira B-tree clusterizada pela
-- chave, então "todos os check-ins da competência X em ordem" — que é
-- exatamente a leitura que a fórmula do nível faz, e a régua de evolução plota —
-- é um range scan sequencial. A mesma decisão de `habit_ticks` (§3 do DATA_MODEL).
--
-- Reinformar o mês CORRIGE, não empilha (INSERT OR REPLACE), como
-- `portfolio_snapshots` e `reading_goals`: um check-in é o retrato do mês, e um
-- mês só tem um retrato. A HISTÓRIA de ter respondido vai para o ledger, que é
-- append-only — corrigir o estado nunca reescreve o que aconteceu.
CREATE TABLE skill_checkins (
    skill_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    month    TEXT NOT NULL,                                   -- 'YYYY-MM' local
    studied  INTEGER NOT NULL CHECK (studied IN (0,1)),
    applied  INTEGER NOT NULL CHECK (applied >= 0),
    stars    INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
    noted_at INTEGER NOT NULL,
    PRIMARY KEY (skill_id, month)
) WITHOUT ROWID;
