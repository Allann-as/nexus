//! Commands das Finanças.

use serde::Deserialize;
use tauri::State;

use crate::application::ports::{Account, Contribution, NewContribution};
use crate::application::use_cases::finance::FinanceOverview;
use crate::domain::entities::AssetClass;
use crate::domain::errors::Result;
use crate::state::AppState;

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> Result<Vec<Account>> {
    state.finance.accounts()
}

/// O aporte vindo da UI.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewContributionDto {
    pub account_id: String,
    /// O serde recusa uma classe fora do vocabulário antes de chegar ao serviço.
    pub asset_class: AssetClass,
    /// Centavos. Negativo é resgate.
    pub amount_cents: i64,
    pub happened_on: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[tauri::command]
pub fn add_contribution(
    state: State<'_, AppState>,
    contribution: NewContributionDto,
) -> Result<Contribution> {
    state.finance.contribute(&NewContribution {
        account_id: contribution.account_id,
        asset_class: contribution.asset_class,
        amount_cents: contribution.amount_cents,
        happened_on: contribution.happened_on,
        note: contribution.note,
    })
}

#[tauri::command]
pub fn recent_contributions(state: State<'_, AppState>, limit: i64) -> Result<Vec<Contribution>> {
    state.finance.recent(limit)
}

/// Exclui um aporte lançado por engano (REFINO R6). Corrige o estado; o ledger
/// ganha um evento de correção, sem reescrever o original.
#[tauri::command]
pub fn delete_contribution(state: State<'_, AppState>, id: String) -> Result<()> {
    state.finance.delete_contribution(&id)
}

/// O dashboard inteiro das Finanças — total, alocação, bancos, série e a Saúde
/// Financeira, numa chamada.
#[tauri::command]
pub fn finance_overview(state: State<'_, AppState>) -> Result<FinanceOverview> {
    state.finance.overview()
}

/// O patrimônio informado à mão para um mês ('AAAA-MM').
#[tauri::command]
pub fn set_portfolio_snapshot(
    state: State<'_, AppState>,
    month: String,
    total_cents: i64,
) -> Result<()> {
    state.finance.set_snapshot(&month, total_cents)
}
