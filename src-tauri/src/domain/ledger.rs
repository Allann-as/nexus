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
    /// O Nexus Score do dia, congelado (M4.5). A história é o que você viu na
    /// época: o passado nunca é recomputado. O payload carrega o valor e a VERSÃO
    /// da fórmula — se ela evoluir, muda daí para frente. Ver ADR-0039.
    NexusScore,
    /// Uma conquista desbloqueada (M4.5). `entity_id` é a chave estável da
    /// conquista no catálogo (`domain::achievements`); a linha entra uma vez só,
    /// e a galeria a lê daqui. Ver ADR-0038.
    AchievementUnlocked,
    /// Uma temporada/desafio começou.
    ChallengeStarted,
    /// Uma temporada/desafio foi concluído (o placar bateu o alvo).
    ChallengeCompleted,
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
            EventType::NexusScore => "nexus_score",
            EventType::AchievementUnlocked => "achievement_unlocked",
            EventType::ChallengeStarted => "challenge_started",
            EventType::ChallengeCompleted => "challenge_completed",
        }
    }
}

/// De que a linha do ledger fala.
///
/// Até o M3 toda história era sobre um node — por isso `entity_kind` era um
/// `Kind`. O aporte (M3.5) é o primeiro FATO que não é um node: ele vive na
/// tabela `contributions`, não em `nodes`. Forçá-lo a um `Kind` gravaria uma
/// mentira na coluna (`entity_kind = 'note'`?), e o BI que filtra por ela
/// pegaria o aporte junto com as notas.
///
/// `Node(Kind)` cobre tudo que era; as variantes soltas são os fatos sem node.
/// O `From<Kind>` deixa os 26 call sites antigos escreverem `Kind::X.into()` sem
/// mais cerimônia. Ver ADR-0027.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerEntityKind {
    Node(Kind),
    /// Um aporte ou resgate — um fato financeiro, não um node.
    Contribution,
    /// Um marco de carreira (promoção, certificação, novo emprego) — um fato da
    /// vida do usuário que não é um node (§2.3, ADR-0027): ele não tem tela nem
    /// satélite, só existe na história. A Timeline o desenha com destaque.
    CareerMilestone,
    /// Uma conquista desbloqueada (M4.5) — um fato sem node. O `entity_id` é a
    /// chave estável do catálogo (`domain::achievements`), não um id de linha: é
    /// por ele que a galeria sabe o que já foi desbloqueado e que a segunda
    /// tentativa de desbloquear a mesma conquista é ignorada. Ver ADR-0038.
    Achievement,
    /// O Nexus Score de um dia, congelado (M4.5). O `entity_id` é o próprio dia
    /// ('YYYY-MM-DD'): um score por dia, e a UNIQUE lógica é "um por dia". Ver
    /// ADR-0039.
    DailyScore,
}

impl LedgerEntityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LedgerEntityKind::Node(k) => k.as_str(),
            LedgerEntityKind::Contribution => "contribution",
            LedgerEntityKind::CareerMilestone => "career_milestone",
            LedgerEntityKind::Achievement => "achievement",
            LedgerEntityKind::DailyScore => "daily_score",
        }
    }
}

impl From<Kind> for LedgerEntityKind {
    fn from(k: Kind) -> Self {
        LedgerEntityKind::Node(k)
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
    pub entity_kind: LedgerEntityKind,
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
