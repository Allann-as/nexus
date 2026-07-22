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
    /// Subir de nível numa competência da Carreira (M4.6). `entity_id` é o node
    /// 'skill'; a série destes eventos É a trilha de evolução (o nível é 1 + a
    /// contagem deles, ordenados por `ts`). Vale XP. Ver ADR-0045.
    SkillLevelUp,
    /// Uma sessão de estudo registrada (M4.6, item 7). `entity_id` é o id da
    /// linha em `study_sessions` (um LOG, não um node — como o aporte). Vale XP.
    /// Ver ADR-0047.
    StudySessionLogged,
    /// Um bloco de foco (pomodoro) concluído (M5). `entity_id` é o id da linha em
    /// `focus_sessions` (um LOG, não um node — como a sessão de estudo). Só um
    /// bloco COMPLETO vira este fato — abandonar o timer não loga nada. Vale XP.
    FocusSessionLogged,
    /// Um recorde pessoal batido (ARSENAL). `entity_id` é a CHAVE do recorde
    /// (`habit_streak`, `study_week`, …); o payload traz o novo valor e o
    /// anterior. A série destes eventos por chave É a história daquele recorde.
    /// Ver ADR-0060.
    RecordBroken,
    /// Um check-in mensal de competência (BÚSSOLA, fase E). `entity_id` é o node
    /// 'skill' e o payload traz o mês e as três respostas. É um FATO da vida do
    /// usuário — o nível 1-10 é DERIVAÇÃO dele (`domain::skill_level`), não o
    /// contrário. Reinformar o mês CORRIGE o estado em `skill_checkins`, mas
    /// acrescenta OUTRA linha aqui: o ledger é append-only, e a história de ter
    /// respondido (e corrigido) nunca é reescrita.
    SkillCheckin,
}

impl EventType {
    /// Todas as variantes, para quem precisa varrer o vocabulário inteiro.
    ///
    /// A Timeline traduz cada uma para um ícone e um rótulo em português
    /// (`src/features/timeline/ledgerMeta.ts`). Oito ficaram de fora por três
    /// versões e vazaram a chave crua para a tela — "Achievement unlocked" no
    /// meio do feed. O teste que conta esta lista é o aviso de que uma variante
    /// nova precisa de tradução do outro lado da fronteira. Ver ADR-0104.
    pub const ALL: &'static [EventType] = &[
        EventType::Created,
        EventType::Completed,
        EventType::Checked,
        EventType::Skipped,
        EventType::ValueRecorded,
        EventType::StatusChanged,
        EventType::Archived,
        EventType::GoalCheckpoint,
        EventType::NoteEdited,
        EventType::Triaged,
        EventType::Renamed,
        EventType::Deleted,
        EventType::WeeklyReviewCompleted,
        EventType::NexusScore,
        EventType::AchievementUnlocked,
        EventType::ChallengeStarted,
        EventType::ChallengeCompleted,
        EventType::SkillLevelUp,
        EventType::StudySessionLogged,
        EventType::FocusSessionLogged,
        EventType::RecordBroken,
        EventType::SkillCheckin,
    ];

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
            EventType::SkillLevelUp => "skill_level_up",
            EventType::StudySessionLogged => "study_session_logged",
            EventType::FocusSessionLogged => "focus_session_logged",
            EventType::RecordBroken => "record_broken",
            EventType::SkillCheckin => "skill_checkin",
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
    /// Uma sessão de estudo (M4.6, item 7) — um fato de alta frequência que vive
    /// em `study_sessions`, não em `nodes` (como o aporte, ADR-0027/0045). O
    /// `entity_id` é o id da sessão. Ver ADR-0047.
    StudySession,
    /// Um bloco de foco concluído (M5) — um fato de alta frequência que vive em
    /// `focus_sessions`, não em `nodes` (como a sessão de estudo). O `entity_id` é
    /// o id da linha de foco. Ver o ADR do Modo Foco.
    FocusSession,
    /// Um recorde pessoal (ARSENAL). Um fato sem node: o `entity_id` é a chave do
    /// recorde, e a última linha daquela chave é o recorde vigente. Ver ADR-0060.
    PersonalRecord,
    /// Uma Revisão Semanal concluída (M5) — um RITUAL, não um node. O `entity_id`
    /// é a segunda-feira daquela semana ('YYYY-MM-DD'): um review por semana, e é
    /// por ele que se sabe que a semana já foi revisada (idempotência). O evento só
    /// entra quando os 6 passos fecham — uma revisão abandonada não vira fato.
    WeeklyReview,
    /// Um check-in mensal de competência (BÚSSOLA, fase E) — um fato de baixa
    /// frequência que vive em `skill_checkins`, não em `nodes`. O `entity_id` é o
    /// node 'skill' a que o check-in se refere (e não a linha do check-in, que
    /// não tem id próprio: a PK é (skill_id, month)), para a Timeline e a tela da
    /// competência acharem a história pelo `idx_ledger_entity`.
    SkillCheckin,
}

impl LedgerEntityKind {
    pub fn as_str(self) -> &'static str {
        match self {
            LedgerEntityKind::Node(k) => k.as_str(),
            LedgerEntityKind::Contribution => "contribution",
            LedgerEntityKind::CareerMilestone => "career_milestone",
            LedgerEntityKind::Achievement => "achievement",
            LedgerEntityKind::DailyScore => "daily_score",
            LedgerEntityKind::StudySession => "study_session",
            LedgerEntityKind::FocusSession => "focus_session",
            LedgerEntityKind::WeeklyReview => "weekly_review",
            LedgerEntityKind::PersonalRecord => "personal_record",
            LedgerEntityKind::SkillCheckin => "skill_checkin",
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
        assert_eq!(EventType::SkillLevelUp.as_str(), "skill_level_up");
        assert_eq!(
            EventType::StudySessionLogged.as_str(),
            "study_session_logged"
        );
        assert_eq!(
            EventType::FocusSessionLogged.as_str(),
            "focus_session_logged"
        );
        assert_eq!(EventType::SkillCheckin.as_str(), "skill_checkin");
        assert_eq!(LedgerEntityKind::SkillCheckin.as_str(), "skill_checkin");
    }

    #[test]
    fn all_lists_every_event_type() {
        // `EventType::ALL` é escrita à mão; sem este teste ela poderia esquecer
        // uma variante em silêncio, e a varredura de quem a usa ficaria curta.
        let mut seen: Vec<&str> = EventType::ALL.iter().map(|e| e.as_str()).collect();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), EventType::ALL.len(), "variante repetida em ALL");

        // Se este número mudou, você acabou de criar (ou remover) um tipo de
        // evento: TRADUZA-O em `src/features/timeline/ledgerMeta.ts`
        // (`ALL_EVENT_TYPES` + `EVENT_META`), senão a Timeline vai escrever a
        // chave crua em inglês na tela do usuário. Ver ADR-0104.
        assert_eq!(
            EventType::ALL.len(),
            22,
            "o vocabulário do ledger mudou — atualize a tradução da Timeline"
        );
    }
}
