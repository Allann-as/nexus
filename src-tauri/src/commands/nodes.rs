//! Commands de Nodes e do Inbox.

use tauri::State;

use crate::application::ports::NodeFilter;
use crate::domain::entities::{Kind, Node, Status};
use crate::domain::errors::Result;
use crate::state::AppState;

/// Teto de página. Existe para que um bug no front (ou um `limit` esquecido)
/// não tente materializar 100 mil linhas e congelar a UI. Listas grandes são
/// paginadas + virtualizadas.
const MAX_LIMIT: i64 = 500;

#[tauri::command]
pub fn create_node(
    state: State<'_, AppState>,
    kind: String,
    title: String,
    area_id: Option<String>,
    parent_id: Option<String>,
) -> Result<Node> {
    let kind = Kind::parse(&kind)?;
    state
        .nodes
        .create(kind, &title, area_id.as_deref(), parent_id.as_deref())
}

/// Captura no Inbox — o caminho de menor fricção do app.
#[tauri::command]
pub fn capture_inbox(state: State<'_, AppState>, title: String) -> Result<Node> {
    state.nodes.capture_inbox(&title)
}

/// Triagem: `inbox_item` vira o que ele realmente é.
#[tauri::command]
pub fn triage_inbox_item(
    state: State<'_, AppState>,
    id: String,
    into: String,
    area_id: Option<String>,
) -> Result<Node> {
    let into = Kind::parse(&into)?;
    state.nodes.triage(&id, into, area_id.as_deref())
}

#[tauri::command]
pub fn get_node(state: State<'_, AppState>, id: String) -> Result<Node> {
    state.nodes.get(&id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn list_nodes(
    state: State<'_, AppState>,
    kind: Option<String>,
    status: Option<String>,
    area_id: Option<String>,
    parent_id: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Node>> {
    let filter = build_filter(kind, status, area_id, parent_id, limit, offset)?;
    state.nodes.list(&filter)
}

#[tauri::command]
pub fn count_nodes(
    state: State<'_, AppState>,
    kind: Option<String>,
    status: Option<String>,
    area_id: Option<String>,
    parent_id: Option<String>,
) -> Result<i64> {
    let filter = build_filter(kind, status, area_id, parent_id, None, None)?;
    state.nodes.count(&filter)
}

#[tauri::command]
pub fn rename_node(state: State<'_, AppState>, id: String, title: String) -> Result<Node> {
    state.nodes.rename(&id, &title)
}

#[tauri::command]
pub fn set_node_status(state: State<'_, AppState>, id: String, status: String) -> Result<Node> {
    state.nodes.set_status(&id, Status::parse(&status)?)
}

#[tauri::command]
pub fn delete_node(state: State<'_, AppState>, id: String) -> Result<()> {
    state.nodes.delete(&id)
}

fn build_filter(
    kind: Option<String>,
    status: Option<String>,
    area_id: Option<String>,
    parent_id: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<NodeFilter> {
    Ok(NodeFilter {
        kind: kind.as_deref().map(Kind::parse).transpose()?,
        status: status.as_deref().map(Status::parse).transpose()?,
        area_id,
        parent_id,
        limit: limit.unwrap_or(100).clamp(1, MAX_LIMIT),
        offset: offset.unwrap_or(0).max(0),
    })
}
