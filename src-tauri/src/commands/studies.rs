//! Commands dos Estudos (M4.6, item 7): matérias, sessões e estatísticas.

use serde::Deserialize;
use tauri::State;

use crate::application::ports::{StudySession, Subject};
use crate::application::use_cases::studies::{StudyStats, SubjectProgress};
use crate::domain::errors::Result;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSubjectDto {
    pub title: String,
    #[serde(default)]
    pub area_id: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub target_minutes: Option<i64>,
}

#[tauri::command]
pub fn create_subject(state: State<'_, AppState>, subject: NewSubjectDto) -> Result<Subject> {
    state.studies.create_subject(
        &subject.title,
        subject.area_id,
        subject.category,
        subject.target_minutes,
    )
}

#[tauri::command]
pub fn list_subjects(state: State<'_, AppState>, area_id: Option<String>) -> Result<Vec<Subject>> {
    state.studies.subjects(area_id)
}

#[tauri::command]
pub fn set_subject_target(
    state: State<'_, AppState>,
    id: String,
    target_minutes: Option<i64>,
) -> Result<Subject> {
    state.studies.set_subject_target(&id, target_minutes)
}

#[tauri::command]
pub fn archive_subject(state: State<'_, AppState>, id: String) -> Result<()> {
    state.studies.archive_subject(&id)
}

#[tauri::command]
pub fn subject_progress(state: State<'_, AppState>, id: String) -> Result<SubjectProgress> {
    state.studies.subject_progress(&id)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewStudySessionDto {
    #[serde(default)]
    pub subject_id: Option<String>,
    #[serde(default)]
    pub book_id: Option<String>,
    #[serde(default)]
    pub skill_id: Option<String>,
    #[serde(default)]
    pub topic: Option<String>,
    pub minutes: i64,
    #[serde(default)]
    pub day: Option<String>,
}

#[tauri::command]
pub fn log_study_session(
    state: State<'_, AppState>,
    session: NewStudySessionDto,
) -> Result<StudySession> {
    state.studies.log_session(
        session.subject_id,
        session.book_id,
        session.skill_id,
        session.topic,
        session.minutes,
        session.day,
    )
}

#[tauri::command]
pub fn recent_study_sessions(
    state: State<'_, AppState>,
    area_id: Option<String>,
) -> Result<Vec<StudySession>> {
    state.studies.recent_sessions(area_id)
}

#[tauri::command]
pub fn study_stats(state: State<'_, AppState>, area_id: Option<String>) -> Result<StudyStats> {
    state.studies.study_stats(area_id)
}
