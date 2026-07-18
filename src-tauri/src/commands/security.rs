//! Commands da tela de bloqueio por PIN (M5.5 §3.5).
//!
//! Finos como todos: chamam `SecurityService` e mapeiam o erro. O hash e o salt
//! nunca cruzam esta fronteira — só o veredito (`bool`) e o estado (`enabled`).

use tauri::State;

use crate::domain::errors::Result;
use crate::infrastructure::security::LockStatus;
use crate::state::AppState;

/// A tela de boot lê isto: o app deve abrir bloqueado?
#[tauri::command]
pub fn lock_status(state: State<'_, AppState>) -> Result<LockStatus> {
    state.security.status()
}

/// Confere um PIN. Só um `bool` volta — o hash fica no backend.
#[tauri::command]
pub fn verify_pin(state: State<'_, AppState>, pin: String) -> Result<bool> {
    state.security.verify(&pin)
}

/// Troca (ou define) o PIN. `current` é exigido quando já há um PIN ativo.
#[tauri::command]
pub fn set_pin(state: State<'_, AppState>, current: Option<String>, new_pin: String) -> Result<()> {
    state.security.set_pin(current.as_deref(), &new_pin)
}

/// Desliga a tela de bloqueio — exige o PIN atual.
#[tauri::command]
pub fn disable_pin(state: State<'_, AppState>, current: String) -> Result<()> {
    state.security.disable(&current)
}
