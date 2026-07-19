//! Commands de backup (M5) — a seção "Backup & Dados" das Configurações.
//!
//! O RESTAURO não substitui o banco na hora: o `nexus.db` está aberto enquanto o
//! app roda. `restore_backup` MARCA o restauro; o boot seguinte o aplica antes de
//! abrir o banco (ver `lib::run` e `infrastructure::backup::apply_pending_restore`).
//! Por isso a UI, depois de marcar, pede um reinício.

use tauri::State;

use crate::domain::errors::Result;
use crate::infrastructure::backup::{stage_reset, stage_restore, BackupInfo, BackupStatus};
use crate::infrastructure::export::ExportInfo;
use crate::state::AppState;

/// Cria um backup agora, com a configuração corrente (cifra e copia p/ sync se
/// configurados). É o botão "fazer backup agora".
#[tauri::command]
pub fn create_backup(state: State<'_, AppState>) -> Result<BackupInfo> {
    state.backups.create_configured()
}

/// O auto-backup diário — chamado na abertura do app (`useBootTasks`). Cria só se
/// hoje ainda não tem backup e a auto-cópia está ligada; senão, no-op.
#[tauri::command]
pub fn auto_backup(state: State<'_, AppState>) -> Result<Option<BackupInfo>> {
    state.backups.auto_backup_if_due()
}

/// Os backups existentes, do mais recente ao mais antigo.
#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupInfo>> {
    state.backups.list()
}

/// O resumo para o indicador de "último backup" e o estado da seção. NUNCA
/// devolve a senha — só se existe uma.
#[tauri::command]
pub fn backup_status(state: State<'_, AppState>) -> Result<BackupStatus> {
    state.backups.status()
}

/// Grava a configuração de backup.
///
/// A senha é tri-estado de propósito (a UI nunca recebe a senha de volta, então
/// não pode reenviá-la): `None` = mantém a atual; `Some("")` = remove a cifra;
/// `Some(nova)` = troca a senha.
#[tauri::command]
pub fn set_backup_config(
    state: State<'_, AppState>,
    enabled: bool,
    sync_dir: Option<String>,
    password: Option<String>,
) -> Result<()> {
    let mut cfg = state.backups.config()?;
    cfg.enabled = enabled;
    cfg.sync_dir = sync_dir.filter(|s| !s.trim().is_empty());
    match password {
        None => {}                                      // mantém a senha atual
        Some(p) if p.is_empty() => cfg.password = None, // desliga a cifra
        Some(p) => cfg.password = Some(p),              // nova senha
    }
    state.backups.set_config(&cfg)
}

/// Marca um backup para restaurar no PRÓXIMO boot. A UI deve, em seguida, pedir
/// que o usuário reinicie o app — a troca do arquivo só acontece com o banco
/// fechado (ver o módulo).
///
/// `password` é necessário se aquele backup foi cifrado. Uma senha errada não
/// destrói nada: a validação (quick_check) roda no boot, antes de qualquer troca.
#[tauri::command]
pub fn restore_backup(
    state: State<'_, AppState>,
    name: String,
    password: Option<String>,
) -> Result<()> {
    stage_restore(&state.paths, &name, password)
}

/// "Começar do zero" (v1.1 D1): faz um backup COMPLETO agora (com a config
/// corrente, na pasta `backups/`) e MARCA o zeramento para o próximo boot, que
/// recria um banco vazio antes de abrir. PIN e preferências ficam fora do banco e
/// sobrevivem. Devolve o backup criado para a UI dizer onde ele ficou — o seguro
/// contra o arrependimento. A UI então chama `restart_app` para aplicar.
#[tauri::command]
pub fn reset_to_zero(state: State<'_, AppState>) -> Result<BackupInfo> {
    let info = state.backups.create_configured()?;
    stage_reset(&state.paths)?;
    Ok(info)
}

/// Reinicia o app — é o que faz o boot seguinte aplicar o restauro/zeramento
/// pendente (o banco só troca com nenhuma conexão segurando o arquivo). Não
/// retorna: `restart()` relança o processo.
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

/// Exportação humana: escreve a pasta `exports/nexus-export-AAAA-MM-DD/` com um
/// JSON por tabela, os CSVs, a mídia e o README. Devolve o caminho e as contagens.
#[tauri::command]
pub fn export_data(state: State<'_, AppState>) -> Result<ExportInfo> {
    state.exports.export()
}
