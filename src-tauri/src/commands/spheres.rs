//! Commands das Esferas. Finos: sem lógica, só delegação.

use tauri::State;

use crate::application::use_cases::spheres::SphereCard;
use crate::domain::errors::Result;
use crate::state::AppState;

/// Todos os cards do Hub, com estatística real. Uma chamada para a tela toda.
#[tauri::command]
pub fn sphere_overview(state: State<'_, AppState>) -> Result<Vec<SphereCard>> {
    state.spheres.overview()
}
