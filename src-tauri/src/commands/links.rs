//! Commands de links entre nodes (M4.6).

use tauri::State;

use crate::application::ports::NodeLinks;
use crate::domain::errors::Result;
use crate::state::AppState;

#[tauri::command]
pub fn link_nodes(
    state: State<'_, AppState>,
    source_id: String,
    target_id: String,
    link_type: String,
) -> Result<NodeLinks> {
    state.links.link(&source_id, &target_id, &link_type)
}

#[tauri::command]
pub fn unlink_nodes(
    state: State<'_, AppState>,
    source_id: String,
    target_id: String,
    link_type: String,
) -> Result<NodeLinks> {
    state.links.unlink(&source_id, &target_id, &link_type)
}

#[tauri::command]
pub fn node_links(state: State<'_, AppState>, node_id: String) -> Result<NodeLinks> {
    state.links.links_of(&node_id)
}
