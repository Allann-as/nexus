//! Commands dos Estudos (M4.6, item 7): matérias, sessões e estatísticas.

use serde::Deserialize;
use tauri::State;

use crate::application::ports::{StudySession, Subject, SubjectItem};
use crate::application::use_cases::studies::{StudyStats, SubjectProgress};
use crate::domain::entities::{CourseStage, SubjectTrack};
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
    /// A seção de Estudos (BÚSSOLA, fase D). Ausente = 'livre'.
    #[serde(default)]
    pub track: Option<SubjectTrack>,
    #[serde(default)]
    pub course_stage: Option<CourseStage>,
    #[serde(default)]
    pub expected_end: Option<String>,
}

#[tauri::command]
pub fn create_subject(state: State<'_, AppState>, subject: NewSubjectDto) -> Result<Subject> {
    state.studies.create_subject(
        &subject.title,
        subject.area_id,
        subject.category,
        subject.target_minutes,
        subject.track,
        subject.course_stage,
        subject.expected_end,
    )
}

/// As matérias de uma Esfera e/ou trilha. `track` ausente = todas (a aba
/// "Matérias"); com trilha, a seção vê só o que é dela.
#[tauri::command]
pub fn list_subjects(
    state: State<'_, AppState>,
    area_id: Option<String>,
    track: Option<SubjectTrack>,
) -> Result<Vec<Subject>> {
    state.studies.subjects(area_id, track)
}

/// Muda o estágio de um CURSO. Recusa em qualquer outra trilha.
#[tauri::command]
pub fn set_course_stage(
    state: State<'_, AppState>,
    id: String,
    stage: Option<CourseStage>,
) -> Result<Subject> {
    state.studies.set_course_stage(&id, stage)
}

/// Ajusta a previsão de conclusão ('YYYY-MM-DD'). `null` remove.
#[tauri::command]
pub fn set_subject_expected_end(
    state: State<'_, AppState>,
    id: String,
    day: Option<String>,
) -> Result<Subject> {
    state.studies.set_subject_expected_end(&id, day)
}

/// Liga a matéria à meta 'staged' que descreve o nível dela (um idioma).
#[tauri::command]
pub fn set_subject_level_goal(
    state: State<'_, AppState>,
    subject_id: String,
    goal_id: Option<String>,
) -> Result<Subject> {
    state.studies.set_subject_level_goal(&subject_id, goal_id)
}

#[tauri::command]
pub fn set_subject_target(
    state: State<'_, AppState>,
    id: String,
    target_minutes: Option<i64>,
) -> Result<Subject> {
    state.studies.set_subject_target(&id, target_minutes)
}

/// Grava o texto curto do que o curso ensina. `null` (ou em branco) limpa.
#[tauri::command]
pub fn set_subject_summary(
    state: State<'_, AppState>,
    id: String,
    summary: Option<String>,
) -> Result<Subject> {
    state.studies.set_subject_summary(&id, summary)
}

#[tauri::command]
pub fn archive_subject(state: State<'_, AppState>, id: String) -> Result<()> {
    state.studies.archive_subject(&id)
}

/* ===== Os itens de uma matéria (0020): temas e checklist ===== */

#[tauri::command]
pub fn add_subject_item(
    state: State<'_, AppState>,
    subject_id: String,
    title: String,
) -> Result<SubjectItem> {
    state.studies.add_subject_item(&subject_id, &title)
}

#[tauri::command]
pub fn subject_items(state: State<'_, AppState>, subject_id: String) -> Result<Vec<SubjectItem>> {
    state.studies.subject_items(&subject_id)
}

#[tauri::command]
pub fn set_subject_item_done(
    state: State<'_, AppState>,
    id: String,
    done: bool,
) -> Result<SubjectItem> {
    state.studies.set_subject_item_done(&id, done)
}

#[tauri::command]
pub fn delete_subject_item(state: State<'_, AppState>, id: String) -> Result<()> {
    state.studies.delete_subject_item(&id)
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

/// Apaga uma sessão registrada por engano. Corrige o estado; o ledger fica.
#[tauri::command]
pub fn delete_study_session(state: State<'_, AppState>, id: String) -> Result<()> {
    state.studies.delete_session(&id)
}
