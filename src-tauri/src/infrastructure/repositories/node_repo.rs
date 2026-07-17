//! Nodes em SQLite.
//!
//! É aqui que a regra de ouro do ledger vira código: estado atual e história na
//! MESMA transação, sempre.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{NewNode, NodeFilter, NodePatch, NodeRepository};
use crate::domain::entities::{Kind, Node, Status};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;

pub struct SqliteNodeRepository {
    db: Arc<Db>,
}

impl SqliteNodeRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT: &str =
    "SELECT id, kind, title, area_id, parent_id, status, created_at, updated_at, archived_at
     FROM nodes";

fn map_node(row: &Row) -> rusqlite::Result<Node> {
    let kind: String = row.get(1)?;
    let status: String = row.get(5)?;

    // O CHECK da tabela já garante que só valores válidos entram; se algo
    // inválido saiu, o banco foi editado por fora e queremos saber, não
    // adivinhar. FromSqlConversionFailure carrega a causa até a UI.
    let to_sql_err = |e: NexusError| {
        rusqlite::Error::FromSqlConversionFailure(1, rusqlite::types::Type::Text, Box::new(e))
    };

    Ok(Node {
        id: row.get(0)?,
        kind: Kind::parse(&kind).map_err(to_sql_err)?,
        title: row.get(2)?,
        area_id: row.get(3)?,
        parent_id: row.get(4)?,
        status: Status::parse(&status).map_err(to_sql_err)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        archived_at: row.get(8)?,
    })
}

/// Monta o WHERE do filtro.
///
/// Devolve SQL + params na mesma ordem, porque montar os dois em lugares
/// separados é como se desalinham. Nenhum valor é interpolado: tudo vira `?N`.
fn build_filter(filter: &NodeFilter) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(kind) = filter.kind {
        params.push(Box::new(kind.as_str()));
        clauses.push(format!("kind = ?{}", params.len()));
    }
    if let Some(status) = filter.status {
        params.push(Box::new(status.as_str()));
        clauses.push(format!("status = ?{}", params.len()));
    }
    if let Some(ref area_id) = filter.area_id {
        params.push(Box::new(area_id.clone()));
        clauses.push(format!("area_id = ?{}", params.len()));
    }
    if let Some(ref parent_id) = filter.parent_id {
        params.push(Box::new(parent_id.clone()));
        clauses.push(format!("parent_id = ?{}", params.len()));
    }

    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    (where_sql, params)
}

impl NodeRepository for SqliteNodeRepository {
    fn create_with_event(&self, id: &str, node: &NewNode, event: &NewLedgerEvent) -> Result<Node> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            let now = event.ts;
            tx.execute(
                "INSERT INTO nodes (id, kind, title, area_id, parent_id, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)",
                params![id, node.kind.as_str(), node.title, node.area_id, node.parent_id, now],
            )?;

            // Mesma transação. Ou os dois acontecem, ou nenhum — nunca um node
            // sem história nem história sem node.
            append_in_tx(&tx, event)?;

            let created = tx.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], map_node)?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn get(&self, id: &str) -> Result<Node> {
        self.db.with_read(|c| {
            c.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], map_node)
                .optional()?
                .ok_or_else(|| NexusError::NotFound(format!("node {id}")))
        })
    }

    fn list(&self, filter: &NodeFilter) -> Result<Vec<Node>> {
        self.db.with_read(|c| {
            let (where_sql, mut params) = build_filter(filter);

            params.push(Box::new(filter.limit.max(1)));
            let limit_idx = params.len();
            params.push(Box::new(filter.offset.max(0)));
            let offset_idx = params.len();

            // created_at DESC, id DESC: `id` é UUIDv7, então desempata na ordem
            // de criação real. Sem o desempate, dois nodes criados no mesmo ms
            // trocariam de lugar entre páginas e a lista "pularia" ao paginar.
            let sql = format!(
                "{SELECT}{where_sql} ORDER BY created_at DESC, id DESC LIMIT ?{limit_idx} OFFSET ?{offset_idx}"
            );

            let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
            let mut stmt = c.prepare_cached(&sql)?;
            let rows = stmt.query_map(refs.as_slice(), map_node)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn count(&self, filter: &NodeFilter) -> Result<i64> {
        self.db.with_read(|c| {
            let (where_sql, params) = build_filter(filter);
            let sql = format!("SELECT COUNT(*) FROM nodes{where_sql}");
            let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| b.as_ref()).collect();
            Ok(c.query_row(&sql, refs.as_slice(), |r| r.get(0))?)
        })
    }

    fn update_with_event(
        &self,
        id: &str,
        patch: &NodePatch<'_>,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Node> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // `area_id` é Option<Option<_>>: fora = "mexer ou não", dentro =
            // "o valor, que pode ser NULL". COALESCE não distingue os dois
            // (ambos chegam como NULL), então a área precisa de um flag
            // explícito. Os demais campos não são anuláveis e COALESCE basta.
            let set_area = patch.area_id.is_some();
            let area_val = patch.area_id.flatten();

            let changed = tx.execute(
                "UPDATE nodes SET
                    title      = COALESCE(?2, title),
                    status     = COALESCE(?3, status),
                    kind       = COALESCE(?4, kind),
                    area_id    = CASE WHEN ?5 THEN ?6 ELSE area_id END,
                    updated_at = ?7
                 WHERE id = ?1",
                params![
                    id,
                    patch.title,
                    patch.status.map(|s| s.as_str()),
                    patch.kind.map(|k| k.as_str()),
                    set_area,
                    area_val,
                    updated_at,
                ],
            )?;

            if changed == 0 {
                return Err(NexusError::NotFound(format!("node {id}")));
            }

            append_in_tx(&tx, event)?;

            let updated =
                tx.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], map_node)?;
            tx.commit()?;
            Ok(updated)
        })
    }

    fn delete_with_event(&self, id: &str, event: &NewLedgerEvent) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // Ordem importa: o evento é gravado ANTES do DELETE. Depois o node
            // não existe mais para ler o título — e `ledger.entity_id` não tem
            // FK justamente para o evento sobreviver a esta linha sumir.
            append_in_tx(&tx, event)?;

            let changed = tx.execute("DELETE FROM nodes WHERE id = ?1", params![id])?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("node {id}")));
            }

            tx.commit()?;
            Ok(())
        })
    }
}
