//! Áreas em SQLite.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{AreaPatch, AreaRepository, NewArea};
use crate::domain::entities::Area;
use crate::domain::errors::{NexusError, Result};
use crate::infrastructure::db::Db;

pub struct SqliteAreaRepository {
    db: Arc<Db>,
}

impl SqliteAreaRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT: &str = "SELECT id, name, icon, color, sort_order, archived_at FROM areas";

fn map_area(row: &Row) -> rusqlite::Result<Area> {
    Ok(Area {
        id: row.get(0)?,
        name: row.get(1)?,
        icon: row.get(2)?,
        color: row.get(3)?,
        sort_order: row.get(4)?,
        archived_at: row.get(5)?,
    })
}

impl AreaRepository for SqliteAreaRepository {
    fn create(&self, id: &str, area: &NewArea) -> Result<Area> {
        self.db.with_write(|c| {
            // Nova área vai para o fim da lista. COALESCE cobre a primeira,
            // quando MAX devolve NULL.
            let next: i64 = c.query_row(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM areas",
                [],
                |r| r.get(0),
            )?;

            c.execute(
                "INSERT INTO areas (id, name, icon, color, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, area.name, area.icon, area.color, next],
            )?;

            Ok(Area {
                id: id.to_string(),
                name: area.name.clone(),
                icon: area.icon.clone(),
                color: area.color.clone(),
                sort_order: next,
                archived_at: None,
            })
        })
    }

    fn get(&self, id: &str) -> Result<Area> {
        self.db.with_read(|c| {
            c.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], map_area)
                .optional()?
                .ok_or_else(|| NexusError::NotFound(format!("área {id}")))
        })
    }

    fn list(&self, include_archived: bool) -> Result<Vec<Area>> {
        self.db.with_read(|c| {
            let sql = if include_archived {
                format!("{SELECT} ORDER BY sort_order, name")
            } else {
                format!("{SELECT} WHERE archived_at IS NULL ORDER BY sort_order, name")
            };
            let mut stmt = c.prepare_cached(&sql)?;
            let rows = stmt.query_map([], map_area)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn update(&self, id: &str, patch: &AreaPatch) -> Result<Area> {
        self.db.with_write(|c| {
            // COALESCE(?, coluna): um patch parcial não precisa de SQL dinâmico
            // nem de ler-modificar-escrever. Campo ausente = NULL = mantém o
            // valor atual, atomicamente.
            let changed = c.execute(
                "UPDATE areas SET
                    name       = COALESCE(?2, name),
                    icon       = COALESCE(?3, icon),
                    color      = COALESCE(?4, color),
                    sort_order = COALESCE(?5, sort_order)
                 WHERE id = ?1",
                params![id, patch.name, patch.icon, patch.color, patch.sort_order],
            )?;

            if changed == 0 {
                return Err(NexusError::NotFound(format!("área {id}")));
            }
            c.query_row(&format!("{SELECT} WHERE id = ?1"), params![id], map_area)
                .map_err(Into::into)
        })
    }

    fn archive(&self, id: &str, at: i64) -> Result<()> {
        self.db.with_write(|c| {
            let changed = c.execute(
                "UPDATE areas SET archived_at = ?2 WHERE id = ?1 AND archived_at IS NULL",
                params![id, at],
            )?;
            if changed == 0 {
                // Ou não existe, ou já estava arquivada. Distinguir dá uma
                // mensagem honesta em vez de um "não encontrado" enganoso.
                let exists: bool = c.query_row(
                    "SELECT EXISTS(SELECT 1 FROM areas WHERE id = ?1)",
                    params![id],
                    |r| r.get(0),
                )?;
                return if exists {
                    Err(NexusError::Validation(format!(
                        "área {id} já está arquivada"
                    )))
                } else {
                    Err(NexusError::NotFound(format!("área {id}")))
                };
            }
            Ok(())
        })
    }

    fn exists(&self, id: &str) -> Result<bool> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT EXISTS(SELECT 1 FROM areas WHERE id = ?1)",
                params![id],
                |r| r.get(0),
            )?)
        })
    }
}
