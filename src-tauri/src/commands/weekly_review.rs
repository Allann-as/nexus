//! Commands da Revisão Semanal (M5).

use tauri::State;

use crate::application::use_cases::weekly_review::{HabitWeek, WeeklyReviewState};
use crate::domain::errors::Result;
use crate::domain::ledger::LedgerEntry;
use crate::state::AppState;

/// O estado da revisão da semana: em que passo o rascunho parou e se a semana já
/// foi revisada. A tela abre no lugar certo a partir daqui.
#[tauri::command]
pub fn weekly_review_state(state: State<'_, AppState>) -> Result<WeeklyReviewState> {
    state.weekly_review.state()
}

/// Salva o progresso do rascunho (passo + reflexão). Retomável: fechar aqui e
/// voltar continua deste ponto.
#[tauri::command]
pub fn save_weekly_review_progress(
    state: State<'_, AppState>,
    step: i64,
    reflection: String,
) -> Result<()> {
    state.weekly_review.save_progress(step, reflection)
}

/// O desempenho real de cada hábito nesta semana (agendados × cumpridos).
#[tauri::command]
pub fn weekly_review_habits(state: State<'_, AppState>) -> Result<Vec<HabitWeek>> {
    state.weekly_review.habits_this_week()
}

/// Conclui a revisão: grava o evento no ledger e apaga o rascunho. Recusa se a
/// semana já foi revisada.
#[tauri::command]
pub fn complete_weekly_review(
    state: State<'_, AppState>,
    reflection: String,
) -> Result<LedgerEntry> {
    state.weekly_review.complete(reflection)
}
