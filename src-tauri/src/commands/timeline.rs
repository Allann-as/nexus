//! Commands da Timeline.

use tauri::State;

use crate::application::ports::MonthRollup;
use crate::domain::errors::Result;
use crate::domain::ledger::LedgerEntry;
use crate::state::AppState;

/// A visão MÊS: os eventos entre dois dias, paginados.
#[tauri::command]
pub fn timeline_range(
    state: State<'_, AppState>,
    from_day: String,
    to_day: String,
    limit: i64,
    offset: i64,
) -> Result<Vec<LedgerEntry>> {
    state.timeline.range(&from_day, &to_day, limit, offset)
}

/// A visão ANO: um resumo por mês.
#[tauri::command]
pub fn timeline_year(state: State<'_, AppState>, year: String) -> Result<Vec<MonthRollup>> {
    state.timeline.year(&year)
}

/// "Neste dia": o que aconteceu no mesmo dia de anos anteriores.
#[tauri::command]
pub fn on_this_day(state: State<'_, AppState>) -> Result<Vec<LedgerEntry>> {
    state.timeline.on_this_day()
}

/// Congela os meses completos ainda pendentes. A UI chama ao abrir a Timeline.
#[tauri::command]
pub fn ensure_timeline_rollups(state: State<'_, AppState>) -> Result<usize> {
    state.timeline.ensure_rollups()
}
