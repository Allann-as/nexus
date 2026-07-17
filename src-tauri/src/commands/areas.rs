//! Commands de Áreas. Finos: sem lógica, só delegação.

use tauri::State;

use crate::domain::entities::Area;
use crate::domain::errors::Result;
use crate::state::AppState;

#[tauri::command]
pub fn create_area(
    state: State<'_, AppState>,
    name: String,
    icon: String,
    color: String,
) -> Result<Area> {
    state.areas.create(&name, &icon, &color)
}

#[tauri::command]
pub fn list_areas(state: State<'_, AppState>, include_archived: bool) -> Result<Vec<Area>> {
    state.areas.list(include_archived)
}

#[tauri::command]
pub fn get_area(state: State<'_, AppState>, id: String) -> Result<Area> {
    state.areas.get(&id)
}

#[tauri::command]
pub fn update_area(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    sort_order: Option<i64>,
) -> Result<Area> {
    state.areas.update(
        &id,
        name.as_deref(),
        icon.as_deref(),
        color.as_deref(),
        sort_order,
    )
}

#[tauri::command]
pub fn archive_area(state: State<'_, AppState>, id: String) -> Result<()> {
    state.areas.archive(&id)
}
