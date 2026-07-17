-- 0011_studies_fin_goals.sql — Esferas II: as caixinhas e a estante
--
-- IMMUTABLE ONCE COMMITTED.
--
-- O M4 traz DOIS tipos novos de node: 'fin_goal' (as "caixinhas" dos Objetivos
-- Financeiros) e 'book' (a Biblioteca dos Estudos). Cada um exigiria, sozinho, a
-- recriação da tabela `nodes` — o SQLite não sabe alterar um `CHECK` (ver 0007 e
-- ADR-0020). Recriar `nodes`, a tabela mais referenciada do schema, é a operação
-- mais cara e mais perigosa que temos.
--
-- Por isso ela é paga UMA vez para o milestone inteiro: os dois kinds entram na
-- mesma recriação. Dois arquivos separados custariam dois DROP/CREATE de `nodes`
-- com o dado do usuário dentro, sem ganho nenhum. Ver ADR-0029.
--
-- Quatro blocos:
--   1. `nodes.kind` ganha 'fin_goal' e 'book' (recriação — as 3 armadilhas do 0007).
--   2. `fin_goal_details` + `fin_goal_deposits` — as caixinhas e seus depósitos.
--   3. `book_details` — a estante.
--   4. `reading_goals` — a meta anual de leitura.

-- =====================================================================
-- 1. O vocabulário de `nodes.kind` ganha 'fin_goal' e 'book'
-- =====================================================================
--
-- Por que cada um é um kind NOVO, e não um existente reaproveitado (ADR-0020):
--
--   * 'fin_goal' — uma caixinha ("PS5", "Viagem") tem alvo em CENTAVOS e um banco
--     onde o dinheiro mora. Enfiá-la em 'goal' pediria métrica, unidade e direção
--     que ela não tem, e a faria vazar para a tela de Metas.
--   * 'book' — um livro tem autor, páginas, status de leitura e nota. Não é
--     nenhum dos kinds existentes.
--
-- As três armadilhas da recriação (todas falham em SILÊNCIO) estão documentadas
-- no 0007 e cobertas por teste em `migrations.rs`:
--   (a) CASCADE  — FK desligada no runner (`migrations.rs`), não aqui.
--   (b) rowid    — o INSERT copia o rowid, senão a busca FTS aponta para a linha
--                  errada.
--   (c) rename   — `legacy_alter_table=ON` para o RENAME não reparsar os gatilhos
--                  de FTS que falam de `nodes`.
PRAGMA legacy_alter_table = ON;

CREATE TABLE nodes_new (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN
                 ('note','task','project','goal','habit','routine',
                  'event','file','inbox_item','milestone','fin_goal','book')),
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

-- Os índices e os gatilhos que MORAVAM em `nodes` foram junto no DROP. Recriados
-- EXATAMENTE como no 0001/0002/0007 — divergir aqui seria uma busca que se
-- comporta diferente conforme a idade do banco do usuário.
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
-- 2. As caixinhas (Objetivos Financeiros)
-- =====================================================================
--
-- Cada objetivo é um node 'fin_goal'. O satélite guarda só o que o node não tem:
-- o alvo em centavos, o banco onde o dinheiro está guardado e o prazo.
--
-- Um sub-desafio de um objetivo é um node 'milestone' com `parent_id` = o
-- objetivo (a mesma árvore do M3), então ele NÃO mora aqui.
CREATE TABLE fin_goal_details (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    -- Dinheiro é SEMPRE centavo inteiro, nunca float (constituição §1).
    target_cents INTEGER NOT NULL,
    -- Em qual banco o dinheiro está guardado. Opcional: uma caixinha pode ser só
    -- uma intenção antes de ter conta destino.
    account_id   TEXT REFERENCES accounts(id),
    -- 'YYYY-MM-DD' local, como todo dia no NEXUS. Opcional: nem toda meta tem prazo.
    deadline     TEXT,
    emoji        TEXT NOT NULL DEFAULT '🎯'
);

-- Cada depósito na caixinha. Um resgate é um depósito NEGATIVO — a mesma decisão
-- de `contributions` (0010): a soma acumulada já faz a conta, sem tabela nem
-- coluna de sinal a mais.
CREATE TABLE fin_goal_deposits (
    id           TEXT PRIMARY KEY,
    goal_id      TEXT NOT NULL REFERENCES fin_goal_details(node_id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    -- 'YYYY-MM-DD' local. A projeção pergunta "quanto entrou nos últimos 3 meses":
    -- um range scan por data, igual a `contributions.happened_on`.
    happened_on  TEXT NOT NULL,
    note         TEXT,
    created_at   INTEGER NOT NULL
);

-- "Os depósitos desta caixinha, por data" — o total guardado e a média dos
-- últimos 3 meses (a projeção). A PK sozinha não serve: ela ordena por id.
CREATE INDEX idx_fin_deposit_goal ON fin_goal_deposits(goal_id, happened_on);

-- =====================================================================
-- 3. A estante (Biblioteca dos Estudos)
-- =====================================================================
--
-- Cada livro é um node 'book'. O título e a área (a Esfera Estudos) já moram no
-- node; o satélite guarda o resto.
CREATE TABLE book_details (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    author       TEXT,
    total_pages  INTEGER,
    current_page INTEGER NOT NULL DEFAULT 0,
    -- O ciclo de vida de um livro. Fechado num CHECK porque é o eixo dos filtros
    -- e do painel ("livros lendo agora").
    status       TEXT NOT NULL DEFAULT 'fila'
                  CHECK (status IN ('fila','lendo','lido','abandonado')),
    -- Estrelas. NULL = ainda não avaliado; 0–5 quando avaliado.
    rating       INTEGER CHECK (rating BETWEEN 0 AND 5),
    -- A prateleira: 'carreira','idiomas','ficcao','pessoal'… Texto livre de
    -- propósito — a estante é do usuário, não um eixo de gráfico que precise fechar.
    shelf        TEXT,
    started_on   TEXT,
    finished_on  TEXT
);

-- O painel pergunta "o que estou lendo" e os filtros agrupam por status.
CREATE INDEX idx_book_status ON book_details(status);

-- =====================================================================
-- 4. A meta anual de leitura
-- =====================================================================
--
-- "12 livros em 2026". PK = `year` ('YYYY'): uma meta por ano. Reinformar o ano
-- corrige (o `INSERT OR REPLACE` do serviço), como `portfolio_snapshots`.
--
-- Não é um node: uma meta anual não tem título, área, busca nem timeline — é uma
-- configuração numérica, como o retrato do patrimônio. Meter isso num node só
-- para reusar a tabela seria o padrão Node virando martelo.
CREATE TABLE reading_goals (
    year        TEXT PRIMARY KEY,
    target      INTEGER NOT NULL,
    noted_at    INTEGER NOT NULL
);
