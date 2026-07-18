-- 0012_life.sql — M4.5 "Vida": Metas Anuais e Temporadas
--
-- IMMUTABLE ONCE COMMITTED.
--
-- O M4.5 traz DOIS tipos novos de node — 'annual_goal' (a seção Metas Anuais) e
-- 'challenge' (as Temporadas/Desafios). Como no M4 (ADR-0029), cada um exigiria,
-- sozinho, a recriação de `nodes` (o SQLite não sabe alterar um CHECK — ver 0007
-- e ADR-0020). Então a recriação é paga UMA vez para os dois — a TERCEIRA vez que
-- este projeto executa o 12-step, e a segunda sobre dado já existente. Ver ADR-0036.
--
-- O que NÃO ganha tabela aqui, e por quê:
--   * XP e níveis por Esfera — DERIVADOS do estado (ticks, tarefas concluídas,
--     checkpoints), recomputáveis, nunca estado sagrado novo. Ver ADR-0037.
--   * Conquistas — o catálogo vive no código (`domain::achievements`); o
--     desbloqueio é um evento no ledger (`achievement_unlocked`), não uma tabela.
--     Ver ADR-0038.
--   * Nexus Score congelado — um evento diário no ledger (`nexus_score`), agregado
--     em `timeline_rollups` (que já existe desde a 0003). Sem tabela nova.
--
-- Três blocos:
--   1. `nodes.kind` ganha 'annual_goal' e 'challenge' (recriação — as 3 armadilhas).
--   2. `annual_goal_details` — a meta anual.
--   3. `challenge_details` — a temporada.

-- =====================================================================
-- 1. O vocabulário de `nodes.kind` ganha 'annual_goal' e 'challenge'
-- =====================================================================
--
-- Por que cada um é um kind NOVO, e não um existente reaproveitado (ADR-0020):
--
--   * 'annual_goal' — uma meta anual pertence a um ANO e a uma visão própria
--     (metas de 2026, 2027…). Enfiá-la em 'goal' a faria vazar para a tela de
--     Metas e misturar o horizonte anual com metas de prazo aberto. Ela reusa o
--     PADRÃO de goal (métrica/alvo/progresso), não a tabela — ver ADR-0036.
--   * 'challenge' — uma temporada tem uma janela de datas, uma fonte de progresso
--     (um hábito ligado ou um contador manual) e um alvo. Não é nenhum dos kinds
--     existentes.
--
-- As três armadilhas da recriação (todas falham em SILÊNCIO) estão documentadas
-- no 0007/0011 e cobertas por teste em `migrations.rs`:
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
                  'event','file','inbox_item','milestone','fin_goal','book',
                  'annual_goal','challenge')),
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
-- EXATAMENTE como no 0001/0002/0007/0011 — divergir aqui seria uma busca que se
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
-- 2. As Metas Anuais
-- =====================================================================
--
-- Cada meta anual é um node 'annual_goal'. O título e a Esfera (opcional) já moram
-- no node; o status (ativa/concluída/abandonada/arquivada) É o `nodes.status`
-- (active/done/dropped/archived). O satélite guarda o resto.
--
-- Ela REUSA o padrão de goal (ADR-0036), não a tabela `goal_details`: uma binária
-- ("fazer X") não tem métrica; uma quantitativa tem métrica/alvo/atual como a meta
-- comum. Os checkpoints de uma quantitativa vivem no LEDGER (cada atualização de
-- `current_value` é um evento `goal_checkpoint`), não numa tabela — a meta anual é
-- um horizonte, não um diário de medições diárias como uma meta de peso.
CREATE TABLE annual_goal_details (
    node_id       TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    -- O ano ao qual a meta pertence. INTEGER: o eixo da visão por ano e o alvo do
    -- índice. O app permite o ano corrente e anos futuros (planejar 2027 em 2026).
    year          INTEGER NOT NULL,
    -- 'binary'       = "fazer X": concluída é `nodes.status = 'done'`, e pronto.
    -- 'quantitative' = "ler 12 livros": progresso é current_value / target_value.
    goal_kind     TEXT NOT NULL DEFAULT 'binary'
                   CHECK (goal_kind IN ('binary','quantitative')),
    -- Só para 'quantitative'. NULL numa binária.
    metric_name   TEXT,
    target_value  REAL,
    current_value REAL NOT NULL DEFAULT 0,
    unit          TEXT
);

-- "As metas de 2027" — a query central da seção. Sem o índice, cada abertura da
-- visão do ano varreria todos os nodes 'annual_goal' de todos os anos.
CREATE INDEX idx_annual_goal_year ON annual_goal_details(year);

-- =====================================================================
-- 3. As Temporadas (Desafios)
-- =====================================================================
--
-- Cada temporada é um node 'challenge' ("90 dias de treino", "Q3 sem faltar
-- inglês"). Uma "fase de jogo": janela de datas, alvo mensurável e um placar.
--
-- O estado (ativo/concluído/abandonado) É o `nodes.status`. "Vencido" (a janela
-- fechou sem bater o alvo) NÃO é uma quarta coluna: é DERIVADO (`ends_on < hoje`
-- e ainda 'active') — gravar um estado que depende só da passagem do tempo criaria
-- um estado que mente até alguém rodar um job para corrigi-lo.
--
-- A fonte do progresso é fechada num CHECK porque decide como o placar conta:
--   'habit_days' — conta os ticks 'done' do `habit_id` ligado dentro da janela.
--                  Reusa `habit_ticks`, a série que o BI já lê — nada a manter à mão.
--   'manual'     — um contador que o usuário incrementa. Cobre qualquer objetivo
--                  que não seja um hábito ("Q3 sem faltar inglês" marcado à mão).
CREATE TABLE challenge_details (
    node_id      TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
    -- Janela local 'YYYY-MM-DD', como todo dia no NEXUS. `ends_on` é gravado (não
    -- derivado de starts_on + N) porque a UI oferece 30/90 mas o usuário pode
    -- ajustar, e o placar pergunta "quantos ticks ATÉ ends_on".
    starts_on    TEXT NOT NULL,
    ends_on      TEXT NOT NULL,
    metric       TEXT NOT NULL CHECK (metric IN ('habit_days','manual')),
    -- O hábito que alimenta 'habit_days'. NULL em 'manual'.
    habit_id     TEXT REFERENCES nodes(id),
    -- O alvo do placar (ex.: 90). O progresso é count/alvo, saturado em 1.
    target_count INTEGER NOT NULL CHECK (target_count > 0),
    -- O contador de 'manual'. Ignorado por 'habit_days' (o placar vem dos ticks).
    manual_count INTEGER NOT NULL DEFAULT 0
);

-- "As temporadas que tocam este hábito" e o placar por hábito ligado.
CREATE INDEX idx_challenge_habit ON challenge_details(habit_id)
    WHERE habit_id IS NOT NULL;
