-- 0002_fts.sql — Busca Universal (FTS5)
--
-- IMMUTABLE ONCE COMMITTED.
--
-- Design notes:
--
--   * content='' (contentless): o índice NÃO duplica os dados. Sem isso, cada
--     nota viveria duas vezes no arquivo e o banco dobraria de tamanho.
--   * contentless_delete=1: permite DELETE/UPDATE direto na tabela FTS
--     (SQLite >= 3.43; o rusqlite `bundled` embarca bem acima disso).
--   * remove_diacritics 2: 'saude' encontra 'saúde'. Inegociável em português.
--
-- O VÍNCULO É O ROWID, e isso não é escolha de estilo.
--
-- Numa tabela contentless o FTS5 não armazena valor de coluna nenhum — nem os
-- UNINDEXED. Ler qualquer coluna de volta devolve NULL; só o rowid sobrevive.
-- Portanto NÃO existe uma coluna `node_id` aqui: ela seria sempre NULL e um
-- JOIN por ela casaria zero linhas, silenciosamente. Quem liga o índice ao
-- conteúdo é `search_index.rowid = nodes.rowid`.
--
-- Isso funciona porque `nodes` tem PRIMARY KEY TEXT mas continua sendo tabela
-- COM rowid — o vínculo é estável e não custa uma tabela de mapeamento.

CREATE VIRTUAL TABLE search_index USING fts5(
    title,
    body,
    tags,
    content='',
    contentless_delete=1,
    tokenize = "unicode61 remove_diacritics 2"
);

-- ===== Sincronização =====
--
-- FTS5 contentless não aceita UPDATE de coluna isolada: a linha inteira é
-- reescrita (DELETE + INSERT). Cada gatilho abaixo reconstrói a linha completa
-- a partir do estado atual, então a origem da mudança (título, corpo ou tags)
-- não importa — o resultado converge para o mesmo índice.

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

CREATE TRIGGER note_fts_ai AFTER INSERT ON note_details BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT rowid FROM nodes WHERE id = new.node_id);
    INSERT INTO search_index(rowid, title, body, tags)
    SELECT n.rowid,
           n.title,
           new.body_md,
           COALESCE((SELECT group_concat(t.name, ' ')
                       FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
                      WHERE nt.node_id = n.id), '')
      FROM nodes n WHERE n.id = new.node_id;
END;

CREATE TRIGGER note_fts_au AFTER UPDATE OF body_md ON note_details BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT rowid FROM nodes WHERE id = new.node_id);
    INSERT INTO search_index(rowid, title, body, tags)
    SELECT n.rowid,
           n.title,
           new.body_md,
           COALESCE((SELECT group_concat(t.name, ' ')
                       FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
                      WHERE nt.node_id = n.id), '')
      FROM nodes n WHERE n.id = new.node_id;
END;

-- note_details não tem gatilho de DELETE: ele só desaparece via ON DELETE
-- CASCADE de `nodes`, e nodes_fts_ad já removeu a linha do índice.

CREATE TRIGGER node_tags_fts_ai AFTER INSERT ON node_tags BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT rowid FROM nodes WHERE id = new.node_id);
    INSERT INTO search_index(rowid, title, body, tags)
    SELECT n.rowid,
           n.title,
           COALESCE((SELECT body_md FROM note_details WHERE node_id = n.id), ''),
           COALESCE((SELECT group_concat(t.name, ' ')
                       FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
                      WHERE nt.node_id = n.id), '')
      FROM nodes n WHERE n.id = new.node_id;
END;

-- O DELETE de node_tags dispara em dois cenários: desmarcar uma tag (o node
-- continua existindo e precisa ser reindexado) e o CASCADE do delete do node
-- (o node já sumiu). O SELECT interno não encontra nada no segundo caso, então
-- o INSERT simplesmente não insere nada — sem linha órfã.
CREATE TRIGGER node_tags_fts_ad AFTER DELETE ON node_tags BEGIN
    DELETE FROM search_index WHERE rowid = (SELECT rowid FROM nodes WHERE id = old.node_id);
    INSERT INTO search_index(rowid, title, body, tags)
    SELECT n.rowid,
           n.title,
           COALESCE((SELECT body_md FROM note_details WHERE node_id = n.id), ''),
           COALESCE((SELECT group_concat(t.name, ' ')
                       FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
                      WHERE nt.node_id = n.id), '')
      FROM nodes n WHERE n.id = old.node_id;
END;
