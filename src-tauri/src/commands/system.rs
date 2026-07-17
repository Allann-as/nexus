//! Commands de sistema — sustentam a página "Seus dados" das Configurações.

use serde::Serialize;
use tauri::State;

use crate::domain::errors::Result;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub schema_version: i64,
    pub db_size_bytes: u64,
    pub node_count: i64,
    pub area_count: i64,
    pub ledger_count: i64,
    pub data_dir: String,
    pub app_version: String,
}

/// Saúde e tamanho do banco. Barato o bastante para rodar a cada montagem das
/// Configurações: todos os COUNTs são varreduras de índice.
#[tauri::command]
pub fn system_info(state: State<'_, AppState>) -> Result<SystemInfo> {
    let (schema_version, node_count, area_count) = state.db.with_read(|c| {
        Ok((
            c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
            c.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get::<_, i64>(0))?,
            c.query_row("SELECT COUNT(*) FROM areas", [], |r| r.get::<_, i64>(0))?,
        ))
    })?;

    let ledger_count = state.ledger.count()?;

    // O -wal guarda páginas já commitadas ainda não integradas ao arquivo
    // principal, então "tamanho em disco" honesto tem que somar os dois.
    let db_size_bytes =
        file_len(&state.paths.db) + file_len(&state.paths.db.with_extension("db-wal"));

    Ok(SystemInfo {
        schema_version,
        db_size_bytes,
        node_count,
        area_count,
        ledger_count,
        data_dir: state.paths.root.display().to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

fn file_len(p: &std::path::Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}
