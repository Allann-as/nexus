//! Commands de busca e da timeline.

use tauri::State;

use crate::application::ports::SearchHit;
use crate::domain::errors::Result;
use crate::domain::ledger::LedgerEntry;
use crate::state::AppState;

const MAX_LIMIT: i64 = 200;

#[tauri::command]
pub fn search(
    state: State<'_, AppState>,
    query: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<SearchHit>> {
    state.search.search(
        &query,
        limit.unwrap_or(20).clamp(1, MAX_LIMIT),
        offset.unwrap_or(0).max(0),
    )
}

/// Manutenção: reconstrói o índice FTS a partir do estado atual.
#[tauri::command]
pub fn rebuild_search_index(state: State<'_, AppState>) -> Result<()> {
    state.search.rebuild()
}

/// Feed da timeline por intervalo de dias ('YYYY-MM-DD').
#[tauri::command]
pub fn ledger_range(
    state: State<'_, AppState>,
    from_day: String,
    to_day: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<LedgerEntry>> {
    state.ledger.range(
        &from_day,
        &to_day,
        limit.unwrap_or(100).clamp(1, MAX_LIMIT),
        offset.unwrap_or(0).max(0),
    )
}

/// A história de uma entidade específica.
#[tauri::command]
pub fn ledger_for_entity(
    state: State<'_, AppState>,
    entity_id: String,
    limit: Option<i64>,
) -> Result<Vec<LedgerEntry>> {
    state
        .ledger
        .for_entity(&entity_id, limit.unwrap_or(50).clamp(1, MAX_LIMIT))
}
