//! Commands das Notas.

use tauri::State;

use crate::application::ports::{Attachment, NoteFull, NoteSummary};
use crate::domain::errors::Result;
use crate::state::AppState;

/// A raiz de dados (`%APPDATA%/Nexus`), para o front montar a URL de um anexo.
///
/// O `appDataDir()` do Tauri aponta para a pasta do IDENTIFICADOR do bundle, não
/// para a raiz que o NEXUS escolheu (`.../Nexus`). Os anexos moram sob esta
/// raiz, então é ela que a URL do asset precisa — não a do Tauri.
#[tauri::command]
pub fn data_root(state: State<'_, AppState>) -> String {
    state.paths.root.to_string_lossy().to_string()
}

#[tauri::command]
pub fn list_notes(state: State<'_, AppState>, area_id: Option<String>) -> Result<Vec<NoteSummary>> {
    state.notes.list(area_id.as_deref())
}

#[tauri::command]
pub fn get_note(state: State<'_, AppState>, id: String) -> Result<NoteFull> {
    state.notes.get(&id)
}

#[tauri::command]
pub fn create_note(
    state: State<'_, AppState>,
    title: String,
    area_id: Option<String>,
) -> Result<NoteFull> {
    state.notes.create(&title, area_id)
}

/// Salva o corpo e resincroniza os wiki-links. A UI chama debounced.
#[tauri::command]
pub fn save_note_body(state: State<'_, AppState>, id: String, body_md: String) -> Result<NoteFull> {
    state.notes.save_body(&id, &body_md)
}

#[tauri::command]
pub fn pin_note(state: State<'_, AppState>, id: String, pinned: bool) -> Result<()> {
    state.notes.set_pinned(&id, pinned)
}

/// Anexa um arquivo (ou imagem colada) à nota. `bytes` são os bytes crus.
#[tauri::command]
pub fn attach_to_note(
    state: State<'_, AppState>,
    note_id: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<Attachment> {
    state.notes.attach(&note_id, &filename, &bytes)
}
