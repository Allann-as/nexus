//! Commands do `bi_engine`.

use tauri::State;

use crate::domain::errors::Result;
use crate::state::AppState;

/// A leitura instantânea: o pacote de insights do cache. `null` se o motor ainda
/// não rodou (o primeiríssimo boot, antes do worker aquecer).
#[tauri::command]
pub fn get_insights(state: State<'_, AppState>) -> Result<Option<serde_json::Value>> {
    state.insights.get()
}

/// Recomputa se as fontes mudaram e devolve o pacote fresco. Barato quando nada
/// mudou (a assinatura bate e o cache é reusado). Também cutuca o worker para
/// reverificar depois que escritas concorrentes assentarem.
#[tauri::command]
pub fn recompute_insights(state: State<'_, AppState>) -> Result<serde_json::Value> {
    state.insights_worker.mark_dirty();
    state.insights.refresh_if_stale()
}
