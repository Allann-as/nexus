//! Commands do Nexus Score congelado.

use tauri::State;

use crate::application::use_cases::score_history::{ScoreCell, ScorePoint};
use crate::domain::errors::Result;
use crate::state::AppState;

/// Congela o score dos dias fechados ainda sem linha. A UI chama na abertura.
#[tauri::command]
pub fn freeze_daily_scores(state: State<'_, AppState>) -> Result<usize> {
    state.score_history.freeze()
}

/// A série congelada dos últimos `days` dias — o gráfico de evolução do score.
#[tauri::command]
pub fn score_history(state: State<'_, AppState>, days: i64) -> Result<Vec<ScorePoint>> {
    state.score_history.history(days)
}

/// O ano em pixels (ARSENAL): 365 células pelo Nexus Score do dia.
#[tauri::command]
pub fn year_in_pixels(state: State<'_, AppState>, year: i64) -> Result<Vec<ScoreCell>> {
    state.score_history.year_pixels(year)
}
