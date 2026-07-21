-- =====================================================================
-- 0019 — A CLASSE DO DEFEITO DA 0018 (v1.3 COCKPIT, fase 3c)
-- =====================================================================
--
-- IMMUTABLE ONCE COMMITTED.
--
-- ===== O que a 0018 consertou, e o que ela não viu =====
--
-- A 0018 corrigiu três colunas `habit_id` que recusavam apagar um hábito. Mas o
-- defeito nunca foi das três colunas: era da FORMA
--
--     coluna TEXT REFERENCES nodes(id)          -- sem cláusula ON DELETE
--
-- que o SQLite lê como NO ACTION — *"recuse apagar o pai"* — e que quem a
-- escreveu leu como *"não leve o filho junto"*. As duas leituras só divergem no
-- dia em que alguém aperta "excluir", e aí o app devolve
-- `FOREIGN KEY constraint failed` na cara do usuário, sem dizer sequer qual item
-- está segurando o outro.
--
-- Uma varredura do schema por essa FORMA (o teste `no_foreign_key_to_a_node_
-- refuses_the_delete`, em `tests/deletion.rs`, que roda `PRAGMA foreign_key_list`
-- em todas as tabelas) achou as três que sobraram vivas:
--
--   * `nodes.parent_id`             — desde a **0001**, a de maior alcance
--   * `habit_details.routine_id`    — desde a **0001**
--   * `subject_details.level_goal_id` — desde a **0016**
--
-- E as três reproduzem, com o erro de storage na tela:
--
--   * apagar um PROJETO com tarefas dentro; apagar uma MATÉRIA com temas
--     (ADR-0077 — o tema é uma `task` filha); apagar um OBJETIVO com
--     sub-desafios (a `milestone` é filha pelo mesmo `parent_id`);
--   * apagar uma ROTINA que tem hábitos dentro;
--   * apagar, pela tela de Metas, a meta que é a escada de um IDIOMA.
--
-- ===== A decisão: ON DELETE SET NULL nas três, e por que não CASCADE =====
--
-- `routine_id` e `level_goal_id` são vínculos frouxos, e SET NULL diz exatamente
-- o que elas querem: *o filho sobrevive ao pai, sem o vínculo*. Apagar a "Rotina
-- da manhã" não pode apagar "Beber água" — o hábito existe fora dela. Apagar a
-- meta-escada de um idioma deixa o idioma sem escada, não sem idioma. É a mesma
-- cláusula, pelo mesmo motivo, da 0018.
--
-- `nodes.parent_id` é o caso interessante, porque ali a resposta CERTA para o
-- usuário é a contrária: apagar o projeto DEVE levar as tarefas. E mesmo assim a
-- FK vai a SET NULL, não a CASCADE. O motivo é o ADR-0056:
--
--     um CASCADE apagaria os filhos SEM UM EVENTO NO LEDGER.
--
-- As tarefas sumiriam junto com a história de terem existido — que é a metade da
-- regra que o CASCADE não sabe cumprir, porque ele roda dentro do banco, abaixo
-- da camada que sabe apendar. Quem leva os filhos é o `NodeService::delete`, que
-- desce a árvore e apenda um `deleted` por node, tudo na mesma transação.
--
-- Então para que mexer na FK, se o serviço já resolve? Porque a FK é o PISO, e o
-- serviço é o comportamento. Se algum caminho futuro apagar um node sem descer a
-- árvore, com SET NULL ele deixa um órfão VISÍVEL na lista de tarefas — feio,
-- corrigível, e com o ledger intacto. Com NO ACTION ele devolve um erro de
-- storage; com CASCADE ele apaga em silêncio e a história vai junto. Das três
-- formas de errar, SET NULL é a única que o usuário consegue enxergar e desfazer.
--
-- ===== Três reconstruções, e a cara delas =====
--
-- SQLite não altera uma FK com ALTER TABLE: trocar `ON DELETE` é recriar a
-- tabela (0007/ADR-0020). `nodes` é a QUINTA recriação (0007, 0011, 0012, 0013,
-- esta) e a única cara: ela carrega os três gatilhos de FTS, que voltam palavra
-- por palavra do 0013, e o `rowid` preservado no INSERT — sem ele o
-- `search_index` inteiro passa a apontar para as linhas erradas, e falha em
-- SILÊNCIO. O `kind` volta com as MESMAS 16 espécies: nenhum kind novo aqui
-- (ADR-0077 continua valendo).
--
-- As FKs estão desligadas pelo runner durante a migration, e o
-- `foreign_key_check` roda depois sobre o banco inteiro.


-- =====================================================================
-- 1. nodes — a árvore (0001, e a FK mais antiga do schema)
-- =====================================================================
PRAGMA legacy_alter_table = ON;

CREATE TABLE nodes_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN
                 ('note','task','project','goal','habit','routine',
                  'event','file','inbox_item','milestone','fin_goal','book',
                  'annual_goal','challenge','skill','subject')),
    title       TEXT NOT NULL,
    area_id     TEXT REFERENCES areas(id),
    -- A correção. Ver o cabeçalho: quem leva os filhos é o serviço, com um
    -- evento por filho; esta cláusula é só a garantia de que nenhum caminho
    -- devolve `FOREIGN KEY constraint failed`.
    parent_id   TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','done','archived','dropped')),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived_at INTEGER
);

INSERT INTO nodes_new (rowid, id, kind, title, area_id, parent_id, status,
                       created_at, updated_at, archived_at)
     SELECT rowid, id, kind, title, area_id, parent_id, status,
            created_at, updated_at, archived_at
       FROM nodes;

DROP TABLE nodes;
ALTER TABLE nodes_new RENAME TO nodes;

PRAGMA legacy_alter_table = OFF;

-- Índices e gatilhos que MORAVAM em `nodes` — recriados EXATAMENTE como no
-- 0001/0002/0007/0011/0012/0013.
CREATE INDEX idx_nodes_kind_status ON nodes(kind, status);
CREATE INDEX idx_nodes_area   ON nodes(area_id)   WHERE area_id   IS NOT NULL;
CREATE INDEX idx_nodes_parent ON nodes(parent_id) WHERE parent_id IS NOT NULL;

CREATE TRIGGER nodes_fts_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO search_index(rowid, title, body, tags)
    VALUES (new.rowid, new.title, '', '');
END;

CREATE TRIGGER nodes_fts_ad AFTER DELETE ON nodes BEGIN
    DELETE FROM search_index WHERE rowid = old.rowid;
END;

CREATE TRIGGER nodes_fts_au AFTER UPDATE OF title ON nodes BEGIN
    DELETE FROM search_index WHERE rowid = old.rowid;
    INSERT INTO search_index(rowid, title, body, tags)
    SELECT new.rowid,
           new.title,
           COALESCE((SELECT body_md FROM note_details WHERE node_id = new.id), ''),
           COALESCE((SELECT group_concat(t.name, ' ')
                       FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
                      WHERE nt.node_id = new.id), '');
END;


-- =====================================================================
-- 2. habit_details — a rotina que agrupa hábitos (0001)
-- =====================================================================
--
-- Primeira reconstrução desta tabela. Nada muda além da cláusula `ON DELETE` de
-- `routine_id`; as demais colunas voltam idênticas à 0001.
--
-- A leitura JÁ trata o NULL, e é por isso que a mudança é segura: `routine_id`
-- sempre foi opcional (um hábito solto é o caso comum), e `list_in_routine` só
-- é chamada com o id de uma rotina que existe. Um hábito que perde a rotina
-- volta a ser o que a maioria dos hábitos é.

CREATE TABLE habit_details_new (
    node_id       TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    schedule_json TEXT NOT NULL,
    target_value  REAL,
    unit          TEXT,
    routine_id    TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    routine_order INTEGER,
    reminder_time TEXT
);

INSERT INTO habit_details_new
    (node_id, schedule_json, target_value, unit, routine_id, routine_order, reminder_time)
SELECT node_id, schedule_json, target_value, unit, routine_id, routine_order, reminder_time
FROM habit_details;

DROP TABLE habit_details;
ALTER TABLE habit_details_new RENAME TO habit_details;

CREATE INDEX idx_habit_routine ON habit_details(routine_id, routine_order)
    WHERE routine_id IS NOT NULL;


-- =====================================================================
-- 3. subject_details — a escada de um idioma (0013 + as colunas da 0016)
-- =====================================================================
--
-- A tabela nasceu na 0013 com três colunas e ganhou mais cinco por ALTER — quatro
-- na 0016 e a `summary` na 0017. A reconstrução as junta na ordem em que o
-- `PRAGMA table_info` as devolve hoje, e o teste `the_rebuilt_tables_keep_every_
-- column` compara as duas listas coluna a coluna: uma reconstrução que esquece
-- uma coluna adicionada por ALTER falha em SILÊNCIO — o SELECT do repositório é
-- por nome, então o erro só aparece no dia em que alguém lê aquele campo.
--
-- `level_goal_id` a NULL é um estado que a tela do idioma JÁ conhece: é o idioma
-- que ainda não tem escada montada, e a seção oferece montá-la. Apagar a meta
-- devolve o idioma a esse estado, em vez de tornar a meta indelével.

CREATE TABLE subject_details_new (
    node_id        TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    category       TEXT,
    target_minutes INTEGER CHECK (target_minutes IS NULL OR target_minutes > 0),
    track          TEXT NOT NULL DEFAULT 'livre'
                    CHECK (track IN ('livre','idioma','faculdade','curso')),
    course_stage   TEXT
                    CHECK (course_stage IS NULL
                           OR course_stage IN ('quero_fazer','fazendo','concluido')),
    expected_end   TEXT,
    level_goal_id  TEXT REFERENCES nodes(id) ON DELETE SET NULL,
    -- O texto curto do que o curso ensina (0017). Quase perdida nesta
    -- reconstrução: foi um teste da 0017 que a cobrou de volta.
    summary        TEXT
);

INSERT INTO subject_details_new
    (node_id, category, target_minutes, track, course_stage, expected_end,
     level_goal_id, summary)
SELECT node_id, category, target_minutes, track, course_stage, expected_end,
       level_goal_id, summary
FROM subject_details;

DROP TABLE subject_details;
ALTER TABLE subject_details_new RENAME TO subject_details;

CREATE INDEX idx_subject_category ON subject_details(category) WHERE category IS NOT NULL;
CREATE INDEX idx_subject_track    ON subject_details(track);
