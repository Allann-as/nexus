//! Commands da Carreira — os marcos profissionais.

use serde::Deserialize;
use tauri::State;

use crate::domain::entities::CareerMilestoneKind;
use crate::domain::errors::Result;
use crate::domain::ledger::LedgerEntry;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCareerMilestoneDto {
    pub title: String,
    /// O serde recusa um tipo fora do vocabulário antes de chegar ao serviço.
    pub kind: CareerMilestoneKind,
    #[serde(default)]
    pub happened_on: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[tauri::command]
pub fn record_career_milestone(
    state: State<'_, AppState>,
    milestone: NewCareerMilestoneDto,
) -> Result<LedgerEntry> {
    state.career.record_milestone(
        &milestone.title,
        milestone.kind,
        milestone.happened_on,
        milestone.note,
    )
}

#[tauri::command]
pub fn career_milestones(state: State<'_, AppState>) -> Result<Vec<LedgerEntry>> {
    state.career.milestones()
}
