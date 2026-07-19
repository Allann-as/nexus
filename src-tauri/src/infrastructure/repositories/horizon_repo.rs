//! O Horizonte em SQLite (ARSENAL) — as pendências ligadas a um marco.
//!
//! Uma pergunta só: quantas tarefas em aberto estão ligadas a este node por
//! `links` (nos dois sentidos). É o "2 tarefas abertas" da faixa. Ver ADR-0063.

use std::sync::Arc;

use rusqlite::params;

use crate::application::ports::HorizonRepository;
use crate::domain::errors::Result;
use crate::infrastructure::db::Db;

pub struct SqliteHorizonRepository {
    db: Arc<Db>,
}

impl SqliteHorizonRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

impl HorizonRepository for SqliteHorizonRepository {
    fn open_linked_task_count(&self, node_id: &str) -> Result<i64> {
        self.db.with_read(|c| {
            let n = c.query_row(
                "SELECT COUNT(*) FROM nodes n
                  WHERE n.kind = 'task' AND n.status = 'active'
                    AND n.id IN (
                      SELECT target_id FROM links WHERE source_id = ?1
                      UNION
                      SELECT source_id FROM links WHERE target_id = ?1
                    )",
                params![node_id],
                |r| r.get::<_, i64>(0),
            )?;
            Ok(n)
        })
    }
}
