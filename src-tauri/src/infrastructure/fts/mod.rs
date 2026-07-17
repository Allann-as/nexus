//! Busca FTS5.

pub mod query;

use std::sync::Arc;

use rusqlite::params;

use crate::application::ports::{SearchHit, SearchRepository};
use crate::domain::errors::Result;
use crate::infrastructure::db::Db;

use query::{build_match_query, make_snippet};

pub struct SqliteSearchRepository {
    db: Arc<Db>,
}

impl SqliteSearchRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

impl SearchRepository for SqliteSearchRepository {
    fn search(&self, raw_query: &str, limit: i64, offset: i64) -> Result<Vec<SearchHit>> {
        let Some(match_query) = build_match_query(raw_query) else {
            // Busca vazia (ou só pontuação) não é erro — é "nada a procurar".
            return Ok(Vec::new());
        };

        self.db.with_read(|c| {
            // O JOIN é por ROWID, não por node_id. Numa tabela contentless o
            // FTS5 não guarda valor de coluna nenhum (nem UNINDEXED): ler
            // qualquer coluna devolve NULL, e um JOIN por ela casaria zero
            // linhas — em silêncio, sem erro. Só o rowid sobrevive.
            //
            // snippet()/highlight() também não existem aqui, pelo mesmo motivo:
            // não há texto armazenado para recortar. Por isso juntamos de volta
            // com `nodes`/`note_details` e montamos o trecho em Rust.
            //
            // `search_index MATCH` usa o NOME da tabela mesmo com alias: com o
            // alias (`s MATCH`) o SQLite não resolve.
            //
            // `rank` do FTS5 é bm25: valores NEGATIVOS, quanto menor mais
            // relevante. ORDER BY rank ASC já traz o melhor primeiro.
            let mut stmt = c.prepare_cached(
                "SELECT n.id,
                        n.kind,
                        n.title,
                        COALESCE(nd.body_md, ''),
                        s.rank
                   FROM search_index s
                   JOIN nodes n ON n.rowid = s.rowid
                   LEFT JOIN note_details nd ON nd.node_id = n.id
                  WHERE search_index MATCH ?1
                  ORDER BY s.rank
                  LIMIT ?2 OFFSET ?3",
            )?;

            let rows =
                stmt.query_map(params![match_query, limit.max(1), offset.max(0)], |row| {
                    let title: String = row.get(2)?;
                    let body: String = row.get(3)?;
                    Ok(SearchHit {
                        node_id: row.get(0)?,
                        kind: row.get(1)?,
                        snippet: make_snippet(&body, raw_query, &title),
                        title,
                        rank: row.get(4)?,
                    })
                })?;

            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    /// Reconstrói o índice do zero a partir do estado atual.
    ///
    /// Existe como válvula de escape: se um gatilho falhar num upgrade futuro,
    /// ou o banco for editado por fora, o índice pode divergir do conteúdo. Sem
    /// isto, a única saída seria recriar o banco.
    fn rebuild(&self) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM search_index", [])?;
            tx.execute(
                "INSERT INTO search_index(rowid, title, body, tags)
                 SELECT n.rowid,
                        n.title,
                        COALESCE(nd.body_md, ''),
                        COALESCE((SELECT group_concat(t.name, ' ')
                                    FROM node_tags nt JOIN tags t ON t.id = nt.tag_id
                                   WHERE nt.node_id = n.id), '')
                   FROM nodes n
                   LEFT JOIN note_details nd ON nd.node_id = n.id",
                [],
            )?;
            tx.commit()?;
            Ok(())
        })
    }
}
