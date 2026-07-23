//! Commands de sistema — sustentam a página "Seus dados" das Configurações.

use std::time::Instant;

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

/// A telemetria que a barra HUD da tela de bloqueio digita ao vivo (fase 9 §2).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootTelemetry {
    /// Latência LOCAL medida — não é rede. O tempo, em ms, de uma consulta real
    /// ao núcleo (um COUNT no ledger). A tela rotula "ping" porque é a palavra
    /// que o dono gosta, mas por baixo é uma métrica verdadeira do sistema, nunca
    /// um número inventado nem uma requisição externa (a regra do offline
    /// absoluto). Ver ADR-0109 e a "lente das três lições".
    pub ping_ms: f64,
    /// O instante do último snapshot local, ou `None` se nunca houve um. A barra
    /// diz "último backup há X".
    pub last_backup_ms: Option<i64>,
    pub app_version: String,
}

/// Mede a latência local do núcleo e junta o último backup — o que a barra HUD do
/// bloqueio mostra. O "ping" é o tempo de UMA leitura real ao ledger; num app
/// 100% offline não existe ping de rede, e este número é o análogo honesto: quão
/// rápido o núcleo responde neste computador, agora.
#[tauri::command]
pub fn boot_telemetry(state: State<'_, AppState>) -> Result<BootTelemetry> {
    // A medição É a consulta: cronometra um COUNT no ledger (uma varredura real,
    // não um `SELECT 1` que o SQLite responde do nada). O valor cresce com o
    // volume — é essa a graça: é a latência do SEU núcleo, com os SEUS dados.
    let t0 = Instant::now();
    let _ = state.ledger.count()?;
    let ping_ms = t0.elapsed().as_secs_f64() * 1000.0;

    let last_backup_ms = state.backups.status()?.last_backup_ms;

    Ok(BootTelemetry {
        ping_ms,
        last_backup_ms,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    })
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
