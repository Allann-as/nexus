-- 0003_ledger.sql — A Máquina do Tempo
--
-- IMMUTABLE ONCE COMMITTED.
--
-- CQRS pragmático: as tabelas do 0001 são o ESTADO ATUAL (mutáveis, rápidas,
-- otimizadas para a leitura de hoje). A história vive aqui, num ledger
-- append-only que NUNCA participa das queries do dia a dia.
--
-- É essa separação que permite a história crescer para milhões de linhas sem
-- tornar o Dashboard mais lento: tabelas diferentes, índices diferentes,
-- caminhos de acesso diferentes.

CREATE TABLE ledger (
    -- INTEGER PRIMARY KEY é alias do rowid: ordem total, monotônica, de graça.
    seq            INTEGER PRIMARY KEY,
    ts             INTEGER NOT NULL,
    day            TEXT NOT NULL,
    -- SEM FK, de propósito: o evento histórico sobrevive ao apagamento da
    -- entidade. A sua história não some porque você deletou uma nota.
    entity_id      TEXT NOT NULL,
    entity_kind    TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    payload        TEXT NOT NULL DEFAULT '{}',
    -- O título na época. Junto com um payload autossuficiente, faz a timeline
    -- renderizar SEM JOIN com `nodes`: renomear um projeto hoje não reescreve
    -- o passado.
    title_snapshot TEXT NOT NULL
);

-- A timeline pergunta sempre por intervalo de dias. Com este índice o custo
-- depende do intervalo pedido, não do tamanho total da tabela.
CREATE INDEX idx_ledger_day    ON ledger(day);
CREATE INDEX idx_ledger_entity ON ledger(entity_id, ts);

-- ===== Append-only, garantido pelo banco =====
--
-- Uma convenção de código seria esquecida em algum caso de uso, algum dia.
-- Aqui a garantia é do motor: nem o próprio NEXUS consegue reescrever a
-- história, nem por bug nem por migration descuidada.

CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN
    SELECT RAISE(ABORT, 'ledger é append-only: UPDATE é proibido');
END;

CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN
    SELECT RAISE(ABORT, 'ledger é append-only: DELETE é proibido');
END;

-- ===== habit_ticks — a série mais consultada pelo BI =====
--
-- WITHOUT ROWID não é detalhe de estilo: a tabela vira uma B-tree clusterizada
-- pela PK (habit_id, day). "Todos os ticks do hábito X no último ano" vira um
-- range scan SEQUENCIAL em vez de 365 buscas aleatórias. É o que faz o heatmap
-- anual abrir instantâneo.
CREATE TABLE habit_ticks (
    habit_id TEXT NOT NULL,
    day      TEXT NOT NULL,
    status   TEXT NOT NULL CHECK (status IN ('done','skipped','failed')),
    value    REAL,
    ts       INTEGER NOT NULL,
    PRIMARY KEY (habit_id, day)
) WITHOUT ROWID;

-- ===== timeline_rollups — meses congelados =====
--
-- Meses encerrados são pré-agregados pelo bi_engine (job mensal). A visão "ano"
-- lê SÓ isto; a visão "mês/dia" lê o ledger paginado. É assim que a timeline de
-- 5 anos atrás abre em < 100 ms.
CREATE TABLE timeline_rollups (
    month       TEXT NOT NULL,
    metric      TEXT NOT NULL,
    value       REAL NOT NULL,
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (month, metric)
) WITHOUT ROWID;

-- ===== insight_cache =====
--
-- O frontend SEMPRE lê daqui (instantâneo). O bi_engine recomputa em background
-- quando input_hash (hash dos contadores das tabelas-fonte) muda.
CREATE TABLE insight_cache (
    insight_key  TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    input_hash   TEXT NOT NULL,
    computed_at  INTEGER NOT NULL
) WITHOUT ROWID;
