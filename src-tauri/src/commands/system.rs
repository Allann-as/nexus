//! System-level commands backing the Settings > "Your data" page.

use serde::Serialize;
use tauri::State;

use crate::domain::errors::Result;
use crate::infrastructure::db::Db;
use crate::infrastructure::paths::Paths;

pub struct AppState {
    pub db: Db,
    pub paths: Paths,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub schema_version: i64,
    pub db_size_bytes: u64,
    pub node_count: i64,
    pub area_count: i64,
    pub data_dir: String,
    pub app_version: String,
}

/// Reports database health and size. Cheap enough to call on every Settings
/// mount: both counts are index-only scans.
#[tauri::command]
pub fn system_info(state: State<'_, AppState>) -> Result<SystemInfo> {
    let (schema_version, node_count, area_count) = state.db.with_read(|c| {
        Ok((
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
            c.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get::<_, i64>(0))?,
            c.query_row("SELECT COUNT(*) FROM areas", [], |r| r.get::<_, i64>(0))?,
        ))
    })?;

    // The -wal file holds committed pages not yet checkpointed, so honest
    // "size on disk" has to count it alongside the main database.
    let db_size_bytes =
        file_len(&state.paths.db) + file_len(&state.paths.db.with_extension("db-wal"));

    Ok(SystemInfo {
        schema_version,
        db_size_bytes,
        node_count,
        area_count,
        data_dir: state.paths.root.display().to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

fn file_len(p: &std::path::Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}
