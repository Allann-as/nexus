-- 0013_career_studies.sql — M4.6 "Aurora 2.0": Carreira (item 6) e Estudos (item 7)
--
-- IMMUTABLE ONCE COMMITTED.
--
-- Dois kinds novos, numa recriação SÓ — a QUARTA vez que este projeto executa o
-- 12-step, a terceira sobre dado já existente. Ver ADR-0045.
--
--   * 'skill'   (Carreira, item 6) — uma competência com NÍVEL e uma trilha de
--                evolução. Não é 'project': um projeto é um entregável com tarefas;
--                uma competência é uma capacidade com um nível que sobe. Subir de
--                nível é um FATO do usuário no ledger (ADR-0037), não derivação.
--   * 'subject' (Estudos, item 7) — uma matéria/disciplina que as sessões de estudo
--                registram contra e que agrega sessões/livros/notas num progresso
--                próprio. Não é 'project' (que Idiomas/Faculdade/Cursos já reusam):
--                a matéria é a espinha do rastreio de estudo, com satélite próprio.
--
-- Por que os DOIS agora, mesmo o Estudos só ganhando repo/comandos no sub-commit
-- seguinte: a recriação de `nodes` é a operação cara do schema (o SQLite não sabe
-- alterar um CHECK — ver 0007/ADR-0020). Pagá-la uma vez para os dois kinds é a
-- regra dos ADR-0029/0036, olhando o item 7 ANTES de escrever a migration do 6.
--
-- O que NÃO é kind, e por quê:
--   * Sessão de estudo — é um LOG de alta frequência (como `contributions` e
--     `habit_ticks`), não um node: não tem tela própria nem entra na busca. Vive em
--     `study_sessions` e pode emitir evento de ledger sem ser node. Ver ADR-0027/0045.
--   * Cargo/promoção — continua sendo um FATO do ledger sem node (career_milestone,
--     ADR-0032). O item 6 dá forma de trajetória ao que já existe, sem duplicar.
--   * Subir de nível de competência — um evento no ledger ('skill_level_up'),
--     agregado como XP; o nível ATUAL é estado em `skill_details.level`, gravado na
--     mesma transação. Ver ADR-0037/0045.
--
-- As três armadilhas da recriação (CASCADE, rowid, rename — todas falham em
-- SILÊNCIO) estão documentadas no 0007/0011/0012 e cobertas por teste em
-- `migrations.rs`.

-- =====================================================================
-- 1. O vocabulário de `nodes.kind` ganha 'skill' e 'subject'
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
    parent_id   TEXT REFERENCES nodes(id),
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
-- 0001/0002/0007/0011/0012.
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
-- 2. As competências (Carreira, item 6)
-- =====================================================================
--
-- Cada competência é um node 'skill'. Título e Esfera moram no node; o status
-- (ativa/arquivada) É o `nodes.status`. O satélite guarda o nível ATUAL e o resto.
--
-- Subir de nível NÃO é derivação: é um fato que o usuário registra, gravado no
-- ledger ('skill_level_up') na MESMA transação que incrementa `level` (ADR-0037).
-- A trilha de evolução é a série desses eventos; `level` é só o estado de agora.
CREATE TABLE skill_details (
    node_id   TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    -- O nível atual. Começa em 1. O `level >= 1` é o piso; o teto é `max_level`.
    level     INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
    -- Categoria livre para agrupar a trilha (ex.: "Backend", "Liderança"). Texto,
    -- não CHECK: as competências são do usuário, não eixo de gráfico fechado.
    category  TEXT,
    -- Um teto opcional de nível (ex.: escala 1–5). NULL = sem teto. O CHECK compara
    -- coluna a coluna: subir `level` acima de `max_level` é recusado pelo próprio
    -- banco, além da guarda no repositório.
    max_level INTEGER CHECK (max_level IS NULL OR max_level >= level)
);

-- "As competências desta categoria" — o agrupamento da trilha.
CREATE INDEX idx_skill_category ON skill_details(category) WHERE category IS NOT NULL;

-- =====================================================================
-- 3. As matérias (Estudos, item 7 — tabela agora, repo/comandos depois)
-- =====================================================================
--
-- Cada matéria é um node 'subject'. O progresso é COMPUTADO (agrega sessões/livros/
-- notas), então o satélite guarda só identidade e configuração.
CREATE TABLE subject_details (
    node_id        TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    -- Categoria/curso livre para agrupar (ex.: "Faculdade", "Concurso"). Texto.
    category       TEXT,
    -- Meta de estudo em minutos, se houver (inteiro, como as sessões). NULL = sem meta.
    target_minutes INTEGER CHECK (target_minutes IS NULL OR target_minutes > 0)
);

CREATE INDEX idx_subject_category ON subject_details(category) WHERE category IS NOT NULL;

-- =====================================================================
-- 4. As sessões de estudo (Estudos, item 7 — um LOG, não um node)
-- =====================================================================
--
-- Um registro por sessão: "estudei 40 min de Cálculo, do livro X". Como
-- `contributions` (0010), é um fato de alta frequência que não merece ser node.
-- As três ligações são opcionais e independentes: uma sessão pode ser só um tópico
-- livre, ou ligada a uma matéria, a um livro e/ou a uma competência. ON DELETE SET
-- NULL — a sessão aconteceu; apagar a matéria não apaga a hora estudada, só desliga
-- o vínculo.
CREATE TABLE study_sessions (
    id         TEXT PRIMARY KEY,                                  -- UUIDv7
    subject_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,      -- a matéria (node 'subject')
    book_id    TEXT REFERENCES nodes(id) ON DELETE SET NULL,      -- o livro lido na sessão
    skill_id   TEXT REFERENCES nodes(id) ON DELETE SET NULL,      -- a competência praticada
    topic      TEXT,                                              -- tópico livre da sessão
    minutes    INTEGER NOT NULL CHECK (minutes > 0),
    day        TEXT NOT NULL,                                     -- 'YYYY-MM-DD' local
    ts         INTEGER NOT NULL
);

-- "Quanto estudei em julho" é um range scan por dia; "o progresso da matéria X"
-- varre as sessões dela. Índices parciais: sessões sem matéria não pesam no segundo.
CREATE INDEX idx_study_session_day     ON study_sessions(day);
CREATE INDEX idx_study_session_subject ON study_sessions(subject_id) WHERE subject_id IS NOT NULL;
