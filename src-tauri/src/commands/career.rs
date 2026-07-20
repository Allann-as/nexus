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

/* ===== Competências (M4.6) ===== */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSkillDto {
    pub title: String,
    #[serde(default)]
    pub area_id: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub max_level: Option<i64>,
}

#[tauri::command]
pub fn create_skill(
    state: State<'_, AppState>,
    skill: NewSkillDto,
) -> Result<crate::application::ports::Skill> {
    state
        .career
        .create_skill(&skill.title, skill.area_id, skill.category, skill.max_level)
}

#[tauri::command]
pub fn level_up_skill(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::application::ports::Skill> {
    state.career.level_up_skill(&id)
}

#[tauri::command]
pub fn list_skills(
    state: State<'_, AppState>,
    area_id: Option<String>,
) -> Result<Vec<crate::application::ports::Skill>> {
    state.career.skills(area_id)
}

#[tauri::command]
pub fn skill_track(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<crate::application::use_cases::career::SkillPoint>> {
    state.career.skill_track(&id)
}

#[tauri::command]
pub fn skills_evolving(
    state: State<'_, AppState>,
    area_id: String,
) -> Result<Vec<crate::application::ports::Skill>> {
    state.career.skills_evolving(&area_id)
}

/// Exclui uma competência (BÚSSOLA, fase B). O node sai; a trilha de níveis
/// permanece no ledger (ADR-0056).
#[tauri::command]
pub fn delete_skill(state: State<'_, AppState>, id: String) -> Result<()> {
    state.career.delete_skill(&id)
}

/// Retrata um marco de carreira (BÚSSOLA, fase B).
///
/// Não é um DELETE, e o nome diz isso de propósito: um marco não tem estado, só
/// o evento (ADR-0032), e o ledger é append-only. A operação APENDA uma
/// retratação com o mesmo `entityId`; o painel para de mostrar o marco e a
/// história dos dois fatos fica. Ver `CareerService::delete_milestone`.
#[tauri::command]
pub fn delete_career_milestone(
    state: State<'_, AppState>,
    entity_id: String,
) -> Result<LedgerEntry> {
    state.career.delete_milestone(&entity_id)
}
