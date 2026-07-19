//! Commands dos recordes pessoais (ARSENAL).

use tauri::State;

use crate::application::use_cases::records::PersonalRecord;
use crate::domain::errors::Result;
use crate::state::AppState;

/// Sincroniza os recordes (apenda no ledger o que subiu) e devolve a lista para a
/// tela. Leitura-e-escrita, como `sync_achievements` — a UI chama ao abrir a tela.
#[tauri::command]
pub fn personal_records(state: State<'_, AppState>) -> Result<Vec<PersonalRecord>> {
    state.records.sync_and_list()
}
