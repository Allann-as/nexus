//! Commands do comparativo de períodos (ARSENAL).

use tauri::State;

use crate::application::use_cases::period_stats::Comparison;
use crate::domain::errors::Result;
use crate::state::AppState;

/// Mês-até-a-data vs mês anterior, ou ano-até-a-data vs ano anterior.
#[tauri::command]
pub fn period_comparison(state: State<'_, AppState>, mode: String) -> Result<Comparison> {
    state.period_stats.compare(&mode)
}
