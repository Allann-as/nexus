-- 0014_contributes_to_link.sql — M4.6 "Aurora 2.0": metas de carreira linkáveis
--
-- IMMUTABLE ONCE COMMITTED.
--
-- Uma meta de carreira "conta para" uma Meta Anual (ou um item de Estudos): uma
-- relação DIRECIONAL (source contribui para target). O vocabulário de
-- `links.link_type` era fechado ('related','blocks','references','attached_to') —
-- adicionar 'contributes_to' exige recriar a tabela, porque o SQLite não sabe
-- alterar um CHECK (ver 0007/ADR-0020). Ver ADR-0046.
--
-- `links` é MUITO mais simples de recriar que `nodes`: sem gatilhos de FTS, sem
-- dependência de rowid (a PK é (source_id, target_id, link_type)), e NADA a
-- referencia (ela é a ponta filha das FKs para `nodes`). Então não há as três
-- armadilhas do 12-step de `nodes` — é copiar, dropar, renomear, reindexar. As FKs
-- ficam desligadas pelo runner (`migrations.rs`), como em toda migration.

CREATE TABLE links_new (
    source_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id  TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    link_type  TEXT NOT NULL DEFAULT 'related'
                 CHECK (link_type IN
                   ('related','blocks','references','attached_to','contributes_to')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (source_id, target_id, link_type)
);

INSERT INTO links_new (source_id, target_id, link_type, created_at)
     SELECT source_id, target_id, link_type, created_at FROM links;

DROP TABLE links;
ALTER TABLE links_new RENAME TO links;

-- O índice de backlink (`links` já tem PK em source_id) morava na tabela dropada.
CREATE INDEX idx_links_target ON links(target_id);
