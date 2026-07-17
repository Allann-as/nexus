//! Ledger em SQLite.

use std::sync::Arc;

use rusqlite::{params, Connection, Row};

use crate::application::ports::LedgerRepository;
use crate::domain::errors::Result;
use crate::domain::ledger::{LedgerEntry, NewLedgerEvent};
use crate::infrastructure::db::Db;

pub struct SqliteLedgerRepository {
    db: Arc<Db>,
}

impl SqliteLedgerRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

/// Acrescenta um evento usando uma conexão/transação já existente.
///
/// Livre — e não método — de propósito: é isto que permite ao
/// `SqliteNodeRepository` gravar estado atual e história DENTRO da mesma
/// transação. Se fosse método de um repositório com pool próprio, cada um
/// pegaria sua conexão e a atomicidade se perderia.
pub fn append_in_tx(conn: &Connection, event: &NewLedgerEvent) -> Result<i64> {
    conn.execute(
        "INSERT INTO ledger (ts, day, entity_id, entity_kind, event_type, payload, title_snapshot)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            event.ts,
            event.day,
            event.entity_id,
            event.entity_kind.as_str(),
            event.event_type.as_str(),
            event.payload.to_string(),
            event.title_snapshot,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

fn map_entry(row: &Row) -> rusqlite::Result<LedgerEntry> {
    Ok(LedgerEntry {
        seq: row.get(0)?,
        ts: row.get(1)?,
        day: row.get(2)?,
        entity_id: row.get(3)?,
        entity_kind: row.get(4)?,
        event_type: row.get(5)?,
        payload: row.get(6)?,
        title_snapshot: row.get(7)?,
    })
}

const SELECT: &str =
    "SELECT seq, ts, day, entity_id, entity_kind, event_type, payload, title_snapshot FROM ledger";

impl LedgerRepository for SqliteLedgerRepository {
    fn append(&self, event: &NewLedgerEvent) -> Result<i64> {
        self.db.with_write(|c| append_in_tx(c, event))
    }

    fn range(
        &self,
        from_day: &str,
        to_day: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LedgerEntry>> {
        self.db.with_read(|c| {
            // Filtra por `day` (não por `ts`) para acertar idx_ledger_day: o
            // custo passa a depender do intervalo pedido, não do tamanho total
            // da tabela. Um BETWEEN em `ts` faria full scan.
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT} WHERE day BETWEEN ?1 AND ?2 ORDER BY seq DESC LIMIT ?3 OFFSET ?4"
            ))?;
            let rows = stmt.query_map(params![from_day, to_day, limit, offset], map_entry)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn for_entity(&self, entity_id: &str, limit: i64) -> Result<Vec<LedgerEntry>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT} WHERE entity_id = ?1 ORDER BY ts DESC LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![entity_id, limit], map_entry)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn by_entity_kind(&self, entity_kind: &str, limit: i64) -> Result<Vec<LedgerEntry>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT} WHERE entity_kind = ?1 ORDER BY ts DESC LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![entity_kind, limit], map_entry)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn count(&self) -> Result<i64> {
        self.db
            .with_read(|c| Ok(c.query_row("SELECT COUNT(*) FROM ledger", [], |r| r.get(0))?))
    }
}
