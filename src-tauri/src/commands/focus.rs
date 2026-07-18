//! Commands do Modo Foco (M5): registrar um bloco concluído e as estatísticas.

use serde::Deserialize;
use tauri::State;

use crate::application::ports::FocusSession;
use crate::application::use_cases::focus::FocusStats;
use crate::domain::errors::Result;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFocusSessionDto {
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    pub minutes: i64,
    #[serde(default)]
    pub day: Option<String>,
}

/// Registra um bloco de foco CONCLUÍDO. O timer só chama isto ao zerar — abandonar
/// não loga nada.
#[tauri::command]
pub fn log_focus_session(
    state: State<'_, AppState>,
    session: NewFocusSessionDto,
) -> Result<FocusSession> {
    state
        .focus
        .log_session(session.task_id, session.label, session.minutes, session.day)
}

#[tauri::command]
pub fn recent_focus_sessions(
    state: State<'_, AppState>,
    area_id: Option<String>,
) -> Result<Vec<FocusSession>> {
    state.focus.recent_sessions(area_id)
}

#[tauri::command]
pub fn focus_stats(state: State<'_, AppState>, area_id: Option<String>) -> Result<FocusStats> {
    state.focus.focus_stats(area_id)
}

/// Apaga um bloco registrado por engano. Corrige o estado; o ledger fica.
#[tauri::command]
pub fn delete_focus_session(state: State<'_, AppState>, id: String) -> Result<()> {
    state.focus.delete_session(&id)
}
