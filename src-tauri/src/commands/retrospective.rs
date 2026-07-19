//! Commands da retrospectiva anual (ARSENAL).

use tauri::State;

use crate::application::use_cases::retrospective::{RetroFile, Retrospective};
use crate::domain::errors::Result;
use crate::state::AppState;

/// O ano num quadro — totais, score, semanas perfeitas e destaques.
#[tauri::command]
pub fn annual_retrospective(state: State<'_, AppState>, year: i64) -> Result<Retrospective> {
    state.retrospective.retrospective(year)
}

/// Gera o arquivo Markdown da retrospectiva (e poda os antigos). Devolve o caminho.
#[tauri::command]
pub fn export_retrospective(state: State<'_, AppState>, year: i64) -> Result<RetroFile> {
    state.retrospective.export(year)
}
