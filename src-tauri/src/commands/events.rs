//! Commands do Calendário.

use serde::Deserialize;
use tauri::State;

use crate::application::ports::{Event, EventPatch, NewEvent, NewEventDetails, Occurrence};
use crate::application::use_cases::events::Conflict;
use crate::domain::errors::Result;
use crate::domain::recurrence::Recurrence;
use crate::state::AppState;

/// O evento vindo da UI.
///
/// Struct e não parâmetros soltos: nove `Option<i64>` em sequência é o tipo de
/// assinatura em que dois argumentos trocam de lugar e nada acusa.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEventDto {
    pub title: String,
    #[serde(default)]
    pub area_id: Option<String>,
    pub starts_at: i64,
    pub ends_at: i64,
    #[serde(default)]
    pub all_day: bool,
    /// A recorrência, no formato de `domain::recurrence::Recurrence`. O backend
    /// a valida de novo: o front é conveniência, não a autoridade.
    #[serde(default)]
    pub rrule: Option<Recurrence>,
    #[serde(default)]
    pub recurrence_end: Option<i64>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
}

#[tauri::command]
pub fn create_event(state: State<'_, AppState>, event: NewEventDto) -> Result<Event> {
    state.events.create(&NewEvent {
        title: event.title,
        area_id: event.area_id,
        details: NewEventDetails {
            starts_at: event.starts_at,
            ends_at: event.ends_at,
            all_day: event.all_day,
            rrule: event.rrule,
            recurrence_end: event.recurrence_end,
            location: event.location,
            category: event.category,
        },
    })
}

#[tauri::command]
pub fn get_event(state: State<'_, AppState>, id: String) -> Result<Event> {
    state.events.get(&id)
}

/// A tela do calendário: tudo que cai entre dois dias LOCAIS.
#[tauri::command]
pub fn events_range(
    state: State<'_, AppState>,
    from_day: String,
    to_day: String,
) -> Result<Vec<Occurrence>> {
    state.events.range(&from_day, &to_day)
}

/// Patch parcial de um evento.
///
/// Chave ausente = não mexer; chave presente valendo `null` = limpar. Ver o
/// `TaskPatchDto`, de onde o `double_option` vem.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPatchDto {
    #[serde(default, deserialize_with = "crate::commands::tasks::double_option")]
    pub location: Option<Option<String>>,
    #[serde(default, deserialize_with = "crate::commands::tasks::double_option")]
    pub category: Option<Option<String>>,
}

#[tauri::command]
pub fn update_event(state: State<'_, AppState>, id: String, patch: EventPatchDto) -> Result<Event> {
    state.events.update(
        &id,
        &EventPatch {
            location: patch.location,
            category: patch.category,
        },
    )
}

/// Arrasta UMA ocorrência (o timeblocking).
///
/// `occurrenceStart` porque a chave de uma ocorrência é (evento, início): o id
/// do evento sozinho não diz qual das 78 terças o usuário pegou.
#[tauri::command]
pub fn move_event(
    state: State<'_, AppState>,
    id: String,
    occurrence_start: i64,
    new_start: i64,
) -> Result<Occurrence> {
    state.events.move_event(&id, occurrence_start, new_start)
}

#[tauri::command]
pub fn cancel_occurrence(
    state: State<'_, AppState>,
    id: String,
    occurrence_start: i64,
) -> Result<()> {
    state.events.cancel_occurrence(&id, occurrence_start)
}

#[tauri::command]
pub fn delete_event(state: State<'_, AppState>, id: String) -> Result<()> {
    state.events.delete(&id)
}

/// Os choques de horário de uma janela. Só avisa — nunca barra uma escrita.
#[tauri::command]
pub fn event_conflicts(
    state: State<'_, AppState>,
    from_ms: i64,
    to_ms: i64,
) -> Result<Vec<Conflict>> {
    state.events.conflicts(from_ms, to_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_event_without_a_recurrence_deserialises_without_one() {
        // Todo campo opcional tem `#[serde(default)]`: sem ele, criar um almoço
        // exigiria mandar `rrule: null` explicitamente, e a UI quebraria no
        // primeiro campo esquecido.
        let dto: NewEventDto =
            serde_json::from_str(r#"{"title":"Almoço","startsAt":1,"endsAt":2}"#).unwrap();
        assert!(dto.rrule.is_none());
        assert!(!dto.all_day);
        assert!(dto.area_id.is_none());
    }

    #[test]
    fn the_rrule_arrives_as_the_domain_enum_not_as_a_string() {
        // O front manda o objeto; o serde recusa o que não for do vocabulário,
        // antes de qualquer coisa chegar ao banco.
        let dto: NewEventDto = serde_json::from_str(
            r#"{"title":"Treino","startsAt":1,"endsAt":2,
                "rrule":{"type":"weekly","interval":1,"days":[1,3]}}"#,
        )
        .unwrap();
        assert_eq!(
            dto.rrule,
            Some(Recurrence::Weekly {
                interval: 1,
                days: vec![1, 3]
            })
        );

        assert!(
            serde_json::from_str::<NewEventDto>(
                r#"{"title":"X","startsAt":1,"endsAt":2,"rrule":{"type":"a_cada_lua_cheia"}}"#
            )
            .is_err(),
            "uma regra fora do vocabulário não pode chegar ao serviço"
        );
    }

    #[test]
    fn clearing_the_location_is_not_the_same_as_leaving_it_alone() {
        let untouched: EventPatchDto = serde_json::from_str("{}").unwrap();
        assert_eq!(untouched.location, None, "ausente = não mexer");

        let cleared: EventPatchDto = serde_json::from_str(r#"{"location":null}"#).unwrap();
        assert_eq!(cleared.location, Some(None), "null = limpar");

        let set: EventPatchDto = serde_json::from_str(r#"{"location":"Sala 3"}"#).unwrap();
        assert_eq!(set.location, Some(Some("Sala 3".into())));
    }
}
