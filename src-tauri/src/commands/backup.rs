//! Commands de backup (M5) — a seção "Backup & Dados" das Configurações.
//!
//! Por ora: criar um backup sob demanda e listar os existentes. O auto-backup
//! diário, a cópia para a pasta de sync e o RESTAURO (que precisa ser aplicado no
//! boot, antes de o banco abrir) chegam nos passos seguintes do M5.

use tauri::State;

use crate::domain::errors::Result;
use crate::infrastructure::backup::BackupInfo;
use crate::state::AppState;

/// Cria um backup agora. `password` opcional liga o AES-256 do zip.
///
/// **Aviso que a UI tem que repetir com todas as letras:** com senha, PERDER a
/// senha é perder o backup — não há recuperação (ver a seção Backup & Dados).
#[tauri::command]
pub fn create_backup(state: State<'_, AppState>, password: Option<String>) -> Result<BackupInfo> {
    state.backups.create(password.as_deref())
}

/// Os backups na pasta, do mais recente ao mais antigo.
#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupInfo>> {
    state.backups.list()
}
