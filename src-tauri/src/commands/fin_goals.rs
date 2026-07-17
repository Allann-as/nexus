//! Commands dos Objetivos Financeiros (as "caixinhas").

use serde::Deserialize;
use tauri::State;

use crate::application::ports::{FinGoal, FinGoalDeposit};
use crate::application::use_cases::fin_goals::{DepositOutcome, FinGoalCard};
use crate::domain::errors::Result;
use crate::state::AppState;

/// A caixinha vinda da UI.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFinGoalDto {
    pub title: String,
    #[serde(default)]
    pub area_id: Option<String>,
    pub target_cents: i64,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub deadline: Option<String>,
    #[serde(default)]
    pub emoji: Option<String>,
}

#[tauri::command]
pub fn create_fin_goal(state: State<'_, AppState>, goal: NewFinGoalDto) -> Result<FinGoal> {
    state.fin_goals.create(
        &goal.title,
        goal.area_id,
        goal.target_cents,
        goal.account_id,
        goal.deadline,
        goal.emoji,
    )
}

/// As caixinhas de uma Esfera (ou todas, com `areaId` ausente), com a projeção.
#[tauri::command]
pub fn list_fin_goals(
    state: State<'_, AppState>,
    area_id: Option<String>,
) -> Result<Vec<FinGoalCard>> {
    state.fin_goals.list(area_id.as_deref())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDepositDto {
    pub goal_id: String,
    /// Centavos. Negativo é um saque da caixinha.
    pub amount_cents: i64,
    #[serde(default)]
    pub happened_on: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[tauri::command]
pub fn deposit_fin_goal(
    state: State<'_, AppState>,
    deposit: NewDepositDto,
) -> Result<DepositOutcome> {
    state.fin_goals.deposit(
        &deposit.goal_id,
        deposit.amount_cents,
        deposit.happened_on,
        deposit.note,
    )
}

#[tauri::command]
pub fn fin_goal_deposits(
    state: State<'_, AppState>,
    goal_id: String,
) -> Result<Vec<FinGoalDeposit>> {
    state.fin_goals.deposits(&goal_id)
}
