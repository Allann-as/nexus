-- =====================================================================
-- 0018 — APAGAR UM HÁBITO VOLTA A SER POSSÍVEL (v1.3 COCKPIT, fase 3b)
-- =====================================================================
--
-- ===== O defeito, visto e não suposto =====
--
-- Ao escrever a tela da meta de CONSTÂNCIA (0017), o teste que provava a
-- promessa do ADR-0077 — *"apagar o hábito não pode apagar a META; a tela trata
-- `habit_id` órfão como 'constância sem hábito ligado' e oferece religar"* —
-- falhou assim:
--
--     Err(Storage("FOREIGN KEY constraint failed"))
--
-- O órfão que a 0017 desenhou **nunca pode acontecer**. `habit_id TEXT
-- REFERENCES nodes(id)` sem cláusula `ON DELETE` não é "sem CASCADE": é
-- NO ACTION, que RECUSA o DELETE do pai. A 0017 quis dizer "não leve a meta
-- junto" e o que o schema diz é "não deixe apagar o hábito".
--
-- E a sonda mostrou que **isto não nasceu na 0017**: a mesma forma de FK está em
-- `milestone_details.habit_id` desde a **0007** e em `challenge_details.habit_id`
-- desde a **0012**. Apagar um hábito ligado a um sub-desafio contado ("30 dias de
-- academia") ou a uma temporada já falhava — desde a 0007 — com aquele
-- `FOREIGN KEY constraint failed` na cara do usuário, que não diz nem qual é o
-- item que está segurando o hábito.
--
-- Isso contradiz de frente a fase B da BÚSSOLA (ADR-0056): *excluir é um
-- direito*. Um direito que a tela oferece e o banco recusa é pior que um direito
-- ausente — o botão existe, o usuário clica, e recebe uma mensagem de storage.
--
-- ===== A decisão: ON DELETE SET NULL nas TRÊS colunas =====
--
-- É a cláusula que diz exatamente o que as três queriam dizer: *o filho
-- sobrevive ao pai, com o vínculo desfeito*. A alternativa — limpar as
-- referências no código antes de cada DELETE de hábito — espalharia por
-- `NodeService::delete` o conhecimento de três satélites, e a quarta tabela a
-- ligar um hábito (um dia haverá) esqueceria de se registrar. `ON DELETE SET
-- NULL` é declarativo: quem cria a coluna declara o destino dela.
--
-- As três leituras JÁ tratam o NULL, e é por isso que a mudança é segura:
--   * `SELECT_MILESTONE` faz `CASE WHEN m.habit_id IS NULL THEN NULL ELSE (...)`
--     e `milestone_ratio` devolve 0.0 sem `current_count` — o sub-desafio para
--     de contar e não vira lixo;
--   * o placar de uma temporada 'habit_days' conta ticks de um hábito que não
--     existe: zero;
--   * a constância cai no ramo `habit_id IS NONE` da `constancia_view`, que é
--     literalmente a tela que o ADR-0077 descreveu.
--
-- O que se PERDE, e é aceito conscientemente: depois de apagado o hábito, o
-- vínculo não volta sozinho — o `habit_id` foi a NULL, não a um túmulo. A tela
-- diz "sem hábito ligado" e oferece ligar outro. Guardar o id de um node que não
-- existe mais para poder dizer "era o Academia" exigiria uma coluna de nome
-- congelado; o ledger já guarda essa história, e é lá que ela pertence.
--
-- ===== Por que três reconstruções, e por que são baratas =====
--
-- SQLite não altera uma FK com ALTER TABLE: trocar `ON DELETE` é recriar a
-- tabela. As três passam pelo mesmo teste do 12-step que a 0016 e a 0017 já
-- fizeram:
--   * nenhuma tem gatilho de FTS (o vínculo do FTS é com `nodes`);
--   * nada indexa nem referencia o rowid de nenhuma delas;
--   * quem as referencia aponta para a PK `node_id`, que volta idêntica;
--   * `nodes` NÃO é tocada — nenhum `kind` novo aqui (ADR-0077).
-- As FKs estão desligadas pelo runner durante a migration, e o
-- `foreign_key_check` roda depois sobre o banco inteiro.


-- =====================================================================
-- 1. milestone_details — o sub-desafio contado (0007 + 0009)
-- =====================================================================

CREATE TABLE milestone_details_new (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL DEFAULT 'simple'
                  CHECK (kind IN ('simple','counter')),
    -- A correção. O contador sobrevive ao hábito, parado em 0/N, e a tela
    -- oferece religar — em vez de o hábito ser indelével.
    habit_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    target_count INTEGER,
    weight       REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
    sort_order   REAL NOT NULL DEFAULT 0,
    counts_from  TEXT
);

INSERT INTO milestone_details_new
    (node_id, kind, habit_id, target_count, weight, sort_order, counts_from)
SELECT node_id, kind, habit_id, target_count, weight, sort_order, counts_from
FROM milestone_details;

DROP TABLE milestone_details;
ALTER TABLE milestone_details_new RENAME TO milestone_details;

CREATE INDEX idx_milestone_habit ON milestone_details(habit_id)
    WHERE habit_id IS NOT NULL;


-- =====================================================================
-- 2. challenge_details — a temporada por dias de hábito (0012)
-- =====================================================================

CREATE TABLE challenge_details_new (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    starts_on    TEXT NOT NULL,
    ends_on      TEXT NOT NULL,
    metric       TEXT NOT NULL CHECK (metric IN ('habit_days','manual')),
    habit_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    target_count INTEGER NOT NULL CHECK (target_count > 0),
    manual_count INTEGER NOT NULL DEFAULT 0
);

INSERT INTO challenge_details_new
    (node_id, starts_on, ends_on, metric, habit_id, target_count, manual_count)
SELECT node_id, starts_on, ends_on, metric, habit_id, target_count, manual_count
FROM challenge_details;

DROP TABLE challenge_details;
ALTER TABLE challenge_details_new RENAME TO challenge_details;

CREATE INDEX idx_challenge_habit ON challenge_details(habit_id)
    WHERE habit_id IS NOT NULL;


-- =====================================================================
-- 3. goal_details — a constância (0017), a que trouxe o defeito à luz
-- =====================================================================
--
-- Terceira reconstrução desta tabela (0016, 0017, 0018) e a mais barata das
-- três: nada muda além da cláusula `ON DELETE` de `habit_id`. Os dois CHECKs de
-- tipo e o de exclusividade voltam palavra por palavra — eles são a invariante,
-- e reescrevê-los "melhorados" aqui mudaria o contrato sem ADR que o diga.

CREATE TABLE goal_details_new (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,

    goal_kind    TEXT NOT NULL DEFAULT 'quantitative'
                 CHECK (goal_kind IN ('quantitative','binary','staged','constancia')),

    metric_name  TEXT,
    start_value  REAL,
    target_value REAL,
    unit         TEXT,
    direction    TEXT CHECK (direction IS NULL OR direction IN ('increase','decrease')),

    deadline     INTEGER,

    progress_source TEXT NOT NULL DEFAULT 'metric'
                 CHECK (progress_source IN ('metric','milestones')),

    -- A correção, e a única diferença para a 0017. Agora o comentário dela é
    -- verdade: apagar o hábito não apaga a meta — e passa a ser POSSÍVEL.
    habit_id     TEXT REFERENCES nodes(id) ON DELETE SET NULL,

    daily_target REAL CHECK (daily_target IS NULL OR daily_target > 0),

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
        OR
        (goal_kind = 'constancia'
             AND metric_name  IS NULL
             AND start_value  IS NULL
             AND target_value IS NOT NULL
             AND unit         IS NOT NULL
             AND direction    IS NOT NULL)
    ),

    CHECK (goal_kind IN ('quantitative','constancia') OR progress_source = 'milestones'),

    CHECK (goal_kind = 'constancia' OR (habit_id IS NULL AND daily_target IS NULL))
);

INSERT INTO goal_details_new
    (node_id, goal_kind, metric_name, start_value, target_value, unit,
     direction, deadline, progress_source, habit_id, daily_target)
SELECT
    node_id, goal_kind, metric_name, start_value, target_value, unit,
    direction, deadline, progress_source, habit_id, daily_target
FROM goal_details;

DROP TABLE goal_details;
ALTER TABLE goal_details_new RENAME TO goal_details;

CREATE INDEX idx_goal_habit ON goal_details(habit_id) WHERE habit_id IS NOT NULL;
