//! Commands das Temporadas / Desafios.

use tauri::State;

use crate::application::use_cases::challenges::{ChallengeCard, CompletedChallenge};
use crate::domain::errors::Result;
use crate::state::AppState;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_challenge(
    state: State<'_, AppState>,
    title: String,
    area_id: Option<String>,
    starts_on: String,
    ends_on: String,
    metric: String,
    habit_id: Option<String>,
    target_count: i64,
) -> Result<ChallengeCard> {
    state.challenges.create(
        &title,
        area_id,
        &starts_on,
        &ends_on,
        &metric,
        habit_id,
        target_count,
    )
}

/// As temporadas de uma Esfera (ou todas), com estado e placar.
#[tauri::command]
pub fn list_challenges(
    state: State<'_, AppState>,
    area_id: Option<String>,
) -> Result<Vec<ChallengeCard>> {
    state.challenges.list(area_id.as_deref())
}

/// Marca +/- um dia numa temporada de contador manual.
#[tauri::command]
pub fn increment_challenge(
    state: State<'_, AppState>,
    id: String,
    delta: i64,
) -> Result<ChallengeCard> {
    state.challenges.increment(&id, delta)
}

/// Abandona uma temporada (vira 'dropped').
#[tauri::command]
pub fn abandon_challenge(state: State<'_, AppState>, id: String) -> Result<ChallengeCard> {
    state.challenges.abandon(&id)
}

/// Fecha as temporadas que bateram o alvo; devolve as vencidas para celebrar. A
/// UI chama na abertura e depois de marcar hábitos.
#[tauri::command]
pub fn sync_challenges(state: State<'_, AppState>) -> Result<Vec<CompletedChallenge>> {
    state.challenges.sync()
}
