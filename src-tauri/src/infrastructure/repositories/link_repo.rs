//! Links entre nodes em SQLite (M4.6).
//!
//! A tabela `links` é a relação N:N universal (§2 do DATA_MODEL). Este repo é o
//! acesso GENÉRICO a ela — criar/remover/ler resolvido — separado do uso que as
//! notas fazem (wiki-links, no `note_repo`). O 'contributes_to' (ADR-0046) é o
//! primeiro consumidor: uma meta de carreira que conta para uma Meta Anual.

use std::sync::Arc;

use rusqlite::{params, Row};

use crate::application::ports::{LinkEnd, LinkRepository, NodeLinks};
use crate::domain::entities::Kind;
use crate::domain::errors::Result;
use crate::infrastructure::db::Db;

pub struct SqliteLinkRepository {
    db: Arc<Db>,
}

impl SqliteLinkRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

fn map_end(row: &Row) -> rusqlite::Result<LinkEnd> {
    let kind_str: String = row.get(1)?;
    Ok(LinkEnd {
        node_id: row.get(0)?,
        // O kind vem do node do outro lado; um valor fora do vocabulário aqui seria
        // corrupção de schema, então o `unwrap_or` cai num kind neutro em vez de
        // derrubar a leitura.
        kind: Kind::parse(&kind_str).unwrap_or(Kind::Note),
        title: row.get(2)?,
        area_id: row.get(3)?,
        link_type: row.get(4)?,
    })
}

impl LinkRepository for SqliteLinkRepository {
    fn create(&self, source: &str, target: &str, link_type: &str, created_at: i64) -> Result<()> {
        self.db.with_write(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO links (source_id, target_id, link_type, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![source, target, link_type, created_at],
            )?;
            Ok(())
        })
    }

    fn remove(&self, source: &str, target: &str, link_type: &str) -> Result<()> {
        self.db.with_write(|conn| {
            conn.execute(
                "DELETE FROM links WHERE source_id = ?1 AND target_id = ?2 AND link_type = ?3",
                params![source, target, link_type],
            )?;
            Ok(())
        })
    }

    fn links_of(&self, node_id: &str) -> Result<NodeLinks> {
        self.db.with_read(|c| {
            // Saída: este node é o SOURCE; o outro lado é o TARGET.
            let mut out_stmt = c.prepare_cached(
                "SELECT n.id, n.kind, n.title, n.area_id, l.link_type
                   FROM links l JOIN nodes n ON n.id = l.target_id
                  WHERE l.source_id = ?1
                  ORDER BY l.created_at DESC",
            )?;
            let outgoing = out_stmt
                .query_map(params![node_id], map_end)?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            // Entrada (backlinks): este node é o TARGET; o outro lado é o SOURCE.
            // Usa `idx_links_target`.
            let mut in_stmt = c.prepare_cached(
                "SELECT n.id, n.kind, n.title, n.area_id, l.link_type
                   FROM links l JOIN nodes n ON n.id = l.source_id
                  WHERE l.target_id = ?1
                  ORDER BY l.created_at DESC",
            )?;
            let incoming = in_stmt
                .query_map(params![node_id], map_end)?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            Ok(NodeLinks { outgoing, incoming })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteLinkRepository, Arc<Db>) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (dir, SqliteLinkRepository::new(db.clone()), db)
    }

    fn seed(db: &Db) {
        db.with_write(|c| {
            c.execute_batch(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('g1', 'goal', 'Virar Staff', 0, 0),
                             ('ag1', 'annual_goal', 'Crescer em 2026', 0, 0);",
            )?;
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn a_link_shows_up_on_both_sides() {
        let (_d, repo, db) = fixture();
        seed(&db);
        repo.create("g1", "ag1", "contributes_to", 100).unwrap();

        // Do lado da meta de carreira: um link de SAÍDA para a meta anual.
        let g = repo.links_of("g1").unwrap();
        assert_eq!(g.outgoing.len(), 1);
        assert_eq!(g.outgoing[0].node_id, "ag1");
        assert_eq!(g.outgoing[0].link_type, "contributes_to");
        assert!(g.incoming.is_empty());

        // Do lado da meta anual: o mesmo link, agora de ENTRADA (o backlink).
        let ag = repo.links_of("ag1").unwrap();
        assert_eq!(ag.incoming.len(), 1);
        assert_eq!(ag.incoming[0].node_id, "g1");
        assert!(ag.outgoing.is_empty());
    }

    #[test]
    fn creating_the_same_link_twice_is_idempotent() {
        let (_d, repo, db) = fixture();
        seed(&db);
        repo.create("g1", "ag1", "contributes_to", 100).unwrap();
        repo.create("g1", "ag1", "contributes_to", 200).unwrap();
        assert_eq!(repo.links_of("g1").unwrap().outgoing.len(), 1);
    }

    #[test]
    fn removing_a_link_takes_it_from_both_sides() {
        let (_d, repo, db) = fixture();
        seed(&db);
        repo.create("g1", "ag1", "contributes_to", 100).unwrap();
        repo.remove("g1", "ag1", "contributes_to").unwrap();
        assert!(repo.links_of("g1").unwrap().outgoing.is_empty());
        assert!(repo.links_of("ag1").unwrap().incoming.is_empty());
    }
}
