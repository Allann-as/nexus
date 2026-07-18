//! Commands das Metas Anuais.

use tauri::State;

use crate::application::use_cases::annual_goals::{AnnualGoalCard, YearOverview};
use crate::domain::errors::Result;
use crate::state::AppState;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_annual_goal(
    state: State<'_, AppState>,
    title: String,
    area_id: Option<String>,
    year: i64,
    goal_kind: String,
    metric_name: Option<String>,
    target_value: Option<f64>,
    unit: Option<String>,
) -> Result<AnnualGoalCard> {
    state.annual_goals.create(
        &title,
        area_id,
        year,
        &goal_kind,
        metric_name,
        target_value,
        unit,
    )
}

/// A visão de um ano: metas + % do ano decorrido vs progresso.
#[tauri::command]
pub fn annual_goal_year(state: State<'_, AppState>, year: i64) -> Result<YearOverview> {
    state.annual_goals.year_overview(year)
}

/// Os anos que têm meta (o corrente sempre incluído).
#[tauri::command]
pub fn annual_goal_years(state: State<'_, AppState>) -> Result<Vec<i64>> {
    state.annual_goals.years()
}

#[tauri::command]
pub fn update_annual_goal_progress(
    state: State<'_, AppState>,
    id: String,
    current_value: f64,
) -> Result<AnnualGoalCard> {
    state.annual_goals.update_progress(&id, current_value)
}

#[tauri::command]
pub fn complete_annual_goal(state: State<'_, AppState>, id: String) -> Result<AnnualGoalCard> {
    state.annual_goals.complete(&id)
}

#[tauri::command]
pub fn abandon_annual_goal(state: State<'_, AppState>, id: String) -> Result<AnnualGoalCard> {
    state.annual_goals.abandon(&id)
}

#[tauri::command]
pub fn archive_annual_goal(state: State<'_, AppState>, id: String) -> Result<AnnualGoalCard> {
    state.annual_goals.archive(&id)
}

#[tauri::command]
pub fn delete_annual_goal(state: State<'_, AppState>, id: String) -> Result<()> {
    state.annual_goals.delete(&id)
}
