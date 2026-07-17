//! O ledger — a história imutável.

use serde::{Deserialize, Serialize};

use crate::domain::entities::Kind;

/// O que aconteceu. Um vocabulário fechado, não texto livre: a timeline e o BI
/// filtram por isto, e um `event_type` digitado errado seria um evento que
/// nunca mais aparece em lugar nenhum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    Created,
    Completed,
    Checked,
    Skipped,
    ValueRecorded,
    StatusChanged,
    Archived,
    GoalCheckpoint,
    NoteEdited,
    Triaged,
    Renamed,
    Deleted,
    WeeklyReviewCompleted,
}

impl EventType {
    pub fn as_str(self) -> &'static str {
        match self {
            EventType::Created => "created",
            EventType::Completed => "completed",
            EventType::Checked => "checked",
            EventType::Skipped => "skipped",
            EventType::ValueRecorded => "value_recorded",
            EventType::StatusChanged => "status_changed",
            EventType::Archived => "archived",
            EventType::GoalCheckpoint => "goal_checkpoint",
            EventType::NoteEdited => "note_edited",
            EventType::Triaged => "triaged",
            EventType::Renamed => "renamed",
            EventType::Deleted => "deleted",
            EventType::WeeklyReviewCompleted => "weekly_review_completed",
        }
    }
}

/// Um evento a ser acrescentado ao ledger.
///
/// Sem `seq`: quem numera é o banco (rowid), e a ordem total é dele. O domínio
/// descreve o que aconteceu; a posição na história não é dele para inventar.
#[derive(Debug, Clone)]
pub struct NewLedgerEvent {
    pub ts: i64,
    pub day: String,
    pub entity_id: String,
    pub entity_kind: Kind,
    pub event_type: EventType,
    pub payload: serde_json::Value,
    /// O título na época. A timeline renderiza sem JOIN com `nodes`, então
    /// renomear amanhã não reescreve o que esta linha diz hoje.
    pub title_snapshot: String,
}

/// Uma linha lida do ledger.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub seq: i64,
    pub ts: i64,
    pub day: String,
    pub entity_id: String,
    pub entity_kind: String,
    pub event_type: String,
    pub payload: String,
    pub title_snapshot: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_type_strings_are_stable() {
        // Estas strings estão gravadas no banco do usuário para sempre.
        // Mudar qualquer uma aqui é reescrever o passado dele — se um dia for
        // preciso, faça por migration, não editando esta linha.
        assert_eq!(EventType::Created.as_str(), "created");
        assert_eq!(EventType::ValueRecorded.as_str(), "value_recorded");
        assert_eq!(EventType::GoalCheckpoint.as_str(), "goal_checkpoint");
        assert_eq!(
            EventType::WeeklyReviewCompleted.as_str(),
            "weekly_review_completed"
        );
    }
}
