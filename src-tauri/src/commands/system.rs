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
    /// `true` quando o app roda com `NEXUS_DATA_DIR` (dados de teste, não o
    /// `%APPDATA%` real) — a UI mostra o aviso de modo dev (ADR-0048).
    pub is_custom_data_dir: bool,
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
        is_custom_data_dir: std::env::var_os("NEXUS_DATA_DIR").is_some(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

fn file_len(p: &std::path::Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

/// Manutenção: `PRAGMA quick_check`. Devolve "ok" se o banco está íntegro, ou a
/// primeira linha do problema. Barato (não é o `integrity_check` completo) — o
/// mesmo que roda na abertura antes das migrations (ARCHITECTURE §4).
#[tauri::command]
pub fn quick_check(state: State<'_, AppState>) -> Result<String> {
    state.db.with_read(|c| {
        let msg: String = c.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        Ok(msg)
    })
}

/// Manutenção: `VACUUM` — reescreve o arquivo compactado, devolvendo ao disco o
/// espaço de linhas apagadas. Roda fora de transação (o SQLite exige). Devolve o
/// tamanho do banco DEPOIS, para a UI mostrar o quanto encolheu.
#[tauri::command]
pub fn vacuum_db(state: State<'_, AppState>) -> Result<u64> {
    state.db.with_write(|c| {
        // Integra o WAL primeiro: VACUUM sozinho não recupera o que está só no -wal.
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        Ok(())
    })?;
    Ok(file_len(&state.paths.db) + file_len(&state.paths.db.with_extension("db-wal")))
}
