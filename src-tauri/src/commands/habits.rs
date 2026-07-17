//! Commands de Hábitos e Rotinas.

use tauri::State;

use crate::application::ports::Habit;
use crate::application::use_cases::habits::{HabitWithStats, HeatmapCell, WeekdayStat};
use crate::domain::errors::{NexusError, Result};
use crate::domain::schedule::Schedule;
use crate::domain::streak::{Streaks, TickStatus};
use crate::state::AppState;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn create_habit(
    state: State<'_, AppState>,
    title: String,
    area_id: Option<String>,
    schedule_json: String,
    target_value: Option<f64>,
    unit: Option<String>,
    routine_id: Option<String>,
    reminder_time: Option<String>,
) -> Result<Habit> {
    let schedule = Schedule::parse_json(&schedule_json)?;
    state.habits.create(
        &title,
        area_id.as_deref(),
        schedule,
        target_value,
        unit,
        routine_id,
        reminder_time,
    )
}

#[tauri::command]
pub fn create_routine(
    state: State<'_, AppState>,
    title: String,
    area_id: Option<String>,
) -> Result<String> {
    state.habits.create_routine(&title, area_id.as_deref())
}

#[tauri::command]
pub fn list_habits(state: State<'_, AppState>, area_id: Option<String>) -> Result<Vec<Habit>> {
    state.habits.list(area_id.as_deref())
}

#[tauri::command]
pub fn get_habit(state: State<'_, AppState>, id: String) -> Result<Habit> {
    state.habits.habits.get(&id)
}

/// Marca um hábito. `day` ausente = hoje.
#[tauri::command]
pub fn tick_habit(
    state: State<'_, AppState>,
    id: String,
    status: String,
    day: Option<String>,
    value: Option<f64>,
) -> Result<Streaks> {
    let status = TickStatus::parse(&status)
        .ok_or_else(|| NexusError::Validation(format!("status inválido: {status}")))?;
    state.habits.tick(&id, day.as_deref(), status, value)
}

#[tauri::command]
pub fn untick_habit(
    state: State<'_, AppState>,
    id: String,
    day: Option<String>,
) -> Result<Streaks> {
    state.habits.untick(&id, day.as_deref())
}

/// Marca a rotina inteira em cascata — uma transação.
#[tauri::command]
pub fn complete_routine(
    state: State<'_, AppState>,
    id: String,
    day: Option<String>,
) -> Result<u32> {
    state.habits.complete_routine(&id, day.as_deref())
}

#[tauri::command]
pub fn habit_streaks(state: State<'_, AppState>, id: String) -> Result<Streaks> {
    state.habits.streaks(&id)
}

#[tauri::command]
pub fn habits_today(state: State<'_, AppState>) -> Result<Vec<HabitWithStats>> {
    state.habits.today()
}

#[tauri::command]
pub fn habit_heatmap(
    state: State<'_, AppState>,
    id: String,
    days: Option<i64>,
) -> Result<Vec<HeatmapCell>> {
    state.habits.heatmap(&id, days.unwrap_or(365))
}

#[tauri::command]
pub fn habit_weekday_stats(
    state: State<'_, AppState>,
    id: String,
    days: Option<i64>,
) -> Result<Vec<WeekdayStat>> {
    state.habits.weekday_stats(&id, days.unwrap_or(180))
}

#[tauri::command]
pub fn set_habit_schedule(
    state: State<'_, AppState>,
    id: String,
    schedule_json: String,
) -> Result<()> {
    state
        .habits
        .set_schedule(&id, Schedule::parse_json(&schedule_json)?)
}
