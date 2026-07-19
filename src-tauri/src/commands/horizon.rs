//! Commands do Horizonte (ARSENAL).

use tauri::State;

use crate::application::use_cases::horizon::HorizonItem;
use crate::domain::errors::Result;
use crate::state::AppState;

/// Os próximos marcos (padrão: 90 dias) com D-dias e pendências ligadas.
#[tauri::command]
pub fn horizon(state: State<'_, AppState>, days: Option<i64>) -> Result<Vec<HorizonItem>> {
    state.horizon.upcoming(days.unwrap_or(90))
}
