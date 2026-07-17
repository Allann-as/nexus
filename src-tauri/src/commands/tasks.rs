//! Commands de Tarefas e Projetos.

use serde::Deserialize;
use tauri::State;

use crate::application::ports::{Progress, Task, TaskPatch};
use crate::application::use_cases::dashboard::Today;
use crate::domain::errors::Result;
use crate::state::AppState;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_task(
    state: State<'_, AppState>,
    title: String,
    area_id: Option<String>,
    project_id: Option<String>,
    due_at: Option<i64>,
    scheduled_at: Option<i64>,
    duration_min: Option<i64>,
    priority: Option<i64>,
    energy: Option<String>,
) -> Result<Task> {
    state.tasks.create(
        &title,
        area_id.as_deref(),
        project_id.as_deref(),
        due_at,
        scheduled_at,
        duration_min,
        priority.unwrap_or(2),
        energy,
    )
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    title: String,
    area_id: Option<String>,
) -> Result<String> {
    state.tasks.create_project(&title, area_id.as_deref())
}

#[tauri::command]
pub fn list_project_tasks(
    state: State<'_, AppState>,
    project_id: String,
    include_done: Option<bool>,
) -> Result<Vec<Task>> {
    state
        .tasks
        .list_for_project(&project_id, include_done.unwrap_or(false))
}

#[tauri::command]
pub fn get_task(state: State<'_, AppState>, id: String) -> Result<Task> {
    state.tasks.get(&id)
}

#[tauri::command]
pub fn set_task_completed(state: State<'_, AppState>, id: String, done: bool) -> Result<Task> {
    state.tasks.set_completed(&id, done)
}

/// Patch parcial vindo da UI.
///
/// Struct e não parâmetros soltos porque os campos anuláveis precisam de
/// `double_option`, e atributos serde não existem em parâmetro de função.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatchDto {
    #[serde(default, deserialize_with = "double_option")]
    pub due_at: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub scheduled_at: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub duration_min: Option<Option<i64>>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default, deserialize_with = "double_option")]
    pub energy: Option<Option<String>>,
}

/// Distingue "campo ausente" de "campo presente valendo null".
///
/// O `Option<Option<T>>` padrão do serde colapsa os dois em `None`, e aí não dá
/// para dizer "não mexa nisso" e "apague isso" — que são pedidos diferentes.
/// Com `#[serde(default)]` + este `deserialize_with`:
///
///   campo ausente     -> None            (não mexer)
///   `"dueAt": null`   -> Some(None)      (limpar)
///   `"dueAt": 123`    -> Some(Some(123)) (definir)
pub(crate) fn double_option<'de, T, D>(de: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    Deserialize::deserialize(de).map(Some)
}

#[tauri::command]
pub fn update_task(state: State<'_, AppState>, id: String, patch: TaskPatchDto) -> Result<Task> {
    state.tasks.update(
        &id,
        &TaskPatch {
            due_at: patch.due_at,
            scheduled_at: patch.scheduled_at,
            duration_min: patch.duration_min,
            priority: patch.priority,
            energy: patch.energy,
        },
    )
}

/// Move uma tarefa para `to_index` dentro do projeto (drag reorder).
#[tauri::command]
pub fn move_task(
    state: State<'_, AppState>,
    id: String,
    project_id: String,
    to_index: usize,
) -> Result<()> {
    state.tasks.move_to(&id, &project_id, to_index)
}

#[tauri::command]
pub fn project_progress(state: State<'_, AppState>, project_id: String) -> Result<Progress> {
    state.tasks.progress(&project_id)
}

/// Tudo que o Dashboard precisa, numa chamada só.
#[tauri::command]
pub fn dashboard_today(state: State<'_, AppState>) -> Result<Today> {
    state.dashboard.today()
}

#[cfg(test)]
mod tests {
    use super::*;

    // O contrato do patch é sutil demais para ficar por conta da intenção:
    // se 'ausente' e 'null' colapsarem, editar a prioridade de uma tarefa
    // apagaria silenciosamente a data dela.

    #[test]
    fn an_absent_field_means_do_not_touch() {
        let dto: TaskPatchDto = serde_json::from_str("{}").unwrap();
        assert_eq!(dto.due_at, None);
        assert_eq!(dto.scheduled_at, None);
        assert_eq!(dto.energy, None);
    }

    #[test]
    fn an_explicit_null_means_clear() {
        let dto: TaskPatchDto = serde_json::from_str(r#"{"dueAt": null}"#).unwrap();
        assert_eq!(dto.due_at, Some(None), "presente e null = limpar");
    }

    #[test]
    fn a_value_means_set() {
        let dto: TaskPatchDto = serde_json::from_str(r#"{"dueAt": 1234}"#).unwrap();
        assert_eq!(dto.due_at, Some(Some(1234)));
    }

    #[test]
    fn clearing_one_field_leaves_the_others_untouched() {
        let dto: TaskPatchDto = serde_json::from_str(r#"{"dueAt": null, "priority": 1}"#).unwrap();
        assert_eq!(dto.due_at, Some(None), "limpar");
        assert_eq!(dto.priority, Some(1), "definir");
        assert_eq!(dto.scheduled_at, None, "não mexer");
        assert_eq!(dto.duration_min, None, "não mexer");
        assert_eq!(dto.energy, None, "não mexer");
    }

    #[test]
    fn energy_round_trips_through_the_double_option() {
        let set: TaskPatchDto = serde_json::from_str(r#"{"energy": "deep"}"#).unwrap();
        assert_eq!(set.energy, Some(Some("deep".to_string())));

        let cleared: TaskPatchDto = serde_json::from_str(r#"{"energy": null}"#).unwrap();
        assert_eq!(cleared.energy, Some(None));
    }
}
