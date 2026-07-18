//! Commands da gamificação.

use tauri::State;

use crate::application::use_cases::gamification::{
    GamificationOverview, GamificationService, Unlocked, XpReference,
};
use crate::domain::errors::Result;
use crate::state::AppState;

/// XP e nível por Esfera, o nível geral e a galeria de conquistas.
#[tauri::command]
pub fn gamification_overview(state: State<'_, AppState>) -> Result<GamificationOverview> {
    state.gamification.overview()
}

/// A tabela de pontos e a curva de nível — a transparência das Configurações.
/// Não toca o banco; é a referência do domínio.
#[tauri::command]
pub fn xp_reference(_state: State<'_, AppState>) -> XpReference {
    GamificationService::reference()
}

/// Desbloqueia o que os contadores já satisfazem (idempotente) e devolve o que
/// caiu agora, para a UI celebrar. A UI chama na abertura do app.
#[tauri::command]
pub fn sync_achievements(state: State<'_, AppState>) -> Result<Vec<Unlocked>> {
    state.gamification.sync_achievements()
}
