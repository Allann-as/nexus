//! Commands da semana perfeita (ARSENAL).

use tauri::State;

use crate::application::use_cases::perfect_weeks::PerfectWeekView;
use crate::domain::errors::Result;
use crate::state::AppState;

/// O calendário anual das semanas perfeitas + a sequência e os totais.
#[tauri::command]
pub fn perfect_week_view(state: State<'_, AppState>, year: i64) -> Result<PerfectWeekView> {
    state.perfect_weeks.view(year)
}
