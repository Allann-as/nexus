//! Commands das preferências de SO (ARSENAL) — a bandeja.

use tauri::State;

use crate::domain::errors::Result;
use crate::infrastructure::settings::AppSettings;
use crate::state::AppState;

/// As preferências atuais (para a tela de Configurações).
#[tauri::command]
pub fn app_settings(state: State<'_, AppState>) -> AppSettings {
    state.settings.get()
}

/// Liga/desliga o "fechar a janela minimiza para a bandeja".
#[tauri::command]
pub fn set_close_to_tray(state: State<'_, AppState>, value: bool) -> Result<AppSettings> {
    state.settings.set_close_to_tray(value)
}

/// Troca o nome que as saudações usam (Hub e tela de bloqueio). Ver ADR-0075.
#[tauri::command]
pub fn set_display_name(state: State<'_, AppState>, value: String) -> Result<AppSettings> {
    state.settings.set_display_name(&value)
}
