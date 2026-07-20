//! Casos de uso das Temporadas / Desafios (§2.2).
//!
//! Uma temporada é uma "fase de jogo" com design sério: janela de datas, alvo
//! mensurável (um hábito ligado ou um contador manual) e um placar. O estado é o
//! `nodes.status`; "vencida" é DERIVADO da passagem do tempo (ADR-0036), nunca
//! gravado. Fechar uma temporada é um fato da vida — vai para o ledger.

use std::sync::Arc;

use chrono::NaiveDate;
use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AreaRepository, Challenge, ChallengeRepository, Clock, HabitRepository, IdGen, NewChallenge,
    NewNode, NodeRepository,
};
use crate::domain::entities::{validate_title, ChallengeMetric, Kind};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day};

/// Uma temporada com o estado e o placar prontos para a tela.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChallengeCard {
    #[serde(flatten)]
    pub challenge: Challenge,
    /// active | done | dropped | expired — o último é derivado (ADR-0036).
    pub state: String,
    /// 0.0..=1.0.
    pub progress_ratio: f64,
    /// Dias até o fim (negativo se já passou).
    pub days_left: i64,
}

/// Uma temporada recém-vencida, para a celebração da UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedChallenge {
    pub id: String,
    pub title: String,
}

pub struct ChallengeService {
    pub challenges: Arc<dyn ChallengeRepository>,
    /// Para EXCLUIR: uma temporada é um node, e apagar um node é a mesma
    /// operação para todos eles (ADR-0056). Ver `ChallengeService::delete`.
    pub nodes: Arc<dyn NodeRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub habits: Arc<dyn HabitRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl ChallengeService {
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        title: &str,
        area_id: Option<String>,
        starts_on: &str,
        ends_on: &str,
        metric: &str,
        habit_id: Option<String>,
        target_count: i64,
    ) -> Result<ChallengeCard> {
        let title = validate_title(title)?;
        if target_count <= 0 {
            return Err(NexusError::Validation(
                "o alvo de uma temporada precisa ser positivo".into(),
            ));
        }
        let start = parse_day(starts_on)?;
        let end = parse_day(ends_on)?;
        if end < start {
            return Err(NexusError::Validation(
                "a temporada não pode terminar antes de começar".into(),
            ));
        }
        if let Some(ref a) = area_id {
            if !self.areas.exists(a)? {
                return Err(NexusError::NotFound(format!("esfera {a} não existe")));
            }
        }

        let metric = ChallengeMetric::parse(metric)?;
        // Uma temporada de hábito precisa de um hábito que exista; uma manual
        // ignora o campo (o placar vem do contador).
        let habit_id = match metric {
            ChallengeMetric::HabitDays => {
                let hid = habit_id.ok_or_else(|| {
                    NexusError::Validation(
                        "uma temporada por hábito precisa de um hábito ligado".into(),
                    )
                })?;
                // `get` erra se o hábito não existe — a FK também barraria, mas a
                // mensagem daqui é a que o usuário entende.
                self.habits.get(&hid)?;
                Some(hid)
            }
            ChallengeMetric::Manual => None,
        };

        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::Challenge),
            event_type: EventType::ChallengeStarted,
            payload: json!({
                "metric": metric.as_str(),
                "targetCount": target_count,
                "startsOn": format_day(start),
                "endsOn": format_day(end),
            }),
            title_snapshot: title.clone(),
        };

        let challenge = self.challenges.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Challenge,
                title: title.clone(),
                area_id: area_id.clone(),
                parent_id: None,
            },
            &NewChallenge {
                title,
                area_id,
                starts_on: format_day(start),
                ends_on: format_day(end),
                metric,
                habit_id,
                target_count,
            },
            &event,
        )?;

        let today = parse_day(&self.clock.today_local())?;
        Ok(to_card(challenge, today))
    }

    pub fn list(&self, area_id: Option<&str>) -> Result<Vec<ChallengeCard>> {
        let today = parse_day(&self.clock.today_local())?;
        Ok(self
            .challenges
            .list(area_id)?
            .into_iter()
            .map(|c| to_card(c, today))
            .collect())
    }

    /// Incrementa (ou decrementa) o contador de uma temporada manual. Marcar mais
    /// um dia é um fato — vai para o ledger como `checked`.
    pub fn increment(&self, id: &str, delta: i64) -> Result<ChallengeCard> {
        if delta == 0 {
            return Err(NexusError::Validation(
                "incremento de zero não faz nada".into(),
            ));
        }
        let now = self.clock.now_ms();
        // O título vem antes do bump: a Timeline lê `title_snapshot`, e uma linha
        // sem nome seria um evento que ninguém reconhece.
        let current = self.challenges.get(id)?;
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::Challenge),
            event_type: EventType::Checked,
            payload: json!({ "delta": delta }),
            title_snapshot: current.title.clone(),
        };
        let challenge = self.challenges.bump_manual(id, delta, now, &event)?;
        let today = parse_day(&self.clock.today_local())?;
        Ok(to_card(challenge, today))
    }

    /// Abandona uma temporada — uma decisão da vida do usuário, não um ajuste de
    /// mesa: vira 'dropped' e grava no ledger.
    pub fn abandon(&self, id: &str) -> Result<ChallengeCard> {
        let now = self.clock.now_ms();
        let current = self.challenges.get(id)?;
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::Challenge),
            event_type: EventType::StatusChanged,
            payload: json!({ "to": "dropped" }),
            title_snapshot: current.title.clone(),
        };
        let challenge = self.challenges.set_status(id, "dropped", now, &event)?;
        let today = parse_day(&self.clock.today_local())?;
        Ok(to_card(challenge, today))
    }

    /// EXCLUI uma temporada (BÚSSOLA, fase B).
    ///
    /// Não é o mesmo que `abandon`, e a diferença importa: abandonar é um FATO
    /// da vida ("tentei e larguei"), e a temporada continua na lista, marcada
    /// 'dropped'. Excluir é dizer que ela nunca deveria ter existido — um erro
    /// de digitação, uma duplicata. As duas precisam existir; oferecer só o
    /// abandono obriga o usuário a conviver com o próprio engano.
    ///
    /// A regra do ADR-0056 continua valendo: o evento `Deleted` entra na mesma
    /// transação do DELETE, e a história de que a temporada existiu fica.
    pub fn delete(&self, id: &str) -> Result<()> {
        // Pelo repositório da temporada, para um id de outro kind não ser apagado
        // por um command chamado `delete_challenge`.
        let current = self.challenges.get(id)?;
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::Challenge),
            event_type: EventType::Deleted,
            payload: json!({
                "metric": current.metric.as_str(),
                "startsOn": current.starts_on,
                "endsOn": current.ends_on,
            }),
            title_snapshot: current.title.clone(),
        };
        self.nodes.delete_with_event(id, &event)
    }

    /// Fecha toda temporada ATIVA cujo placar já bateu o alvo. Idempotente — a UI
    /// chama na abertura e depois de marcar hábitos. Devolve as recém-vencidas
    /// para a celebração.
    pub fn sync(&self) -> Result<Vec<CompletedChallenge>> {
        let now = self.clock.now_ms();
        let day = self.clock.today_local();
        let mut completed: Vec<CompletedChallenge> = Vec::new();
        for c in self.challenges.active_reached()? {
            let event = NewLedgerEvent {
                ts: now,
                day: day.clone(),
                entity_id: c.id.clone(),
                entity_kind: LedgerEntityKind::Node(Kind::Challenge),
                event_type: EventType::ChallengeCompleted,
                payload: json!({
                    "targetCount": c.target_count,
                    "progress": c.progress_count,
                }),
                title_snapshot: format!("Temporada vencida: {}", c.title),
            };
            self.challenges.complete(&c.id, now, &event)?;
            completed.push(CompletedChallenge {
                id: c.id,
                title: c.title,
            });
        }
        Ok(completed)
    }
}

/// Deriva o estado visível e o placar a partir do node + do relógio.
fn to_card(challenge: Challenge, today: NaiveDate) -> ChallengeCard {
    let state = match challenge.status.as_str() {
        "done" => "done",
        "dropped" => "dropped",
        _ => {
            // "vencida": a janela fechou e ainda estava ativa (ADR-0036).
            match parse_day(&challenge.ends_on) {
                Ok(end) if end < today => "expired",
                _ => "active",
            }
        }
    }
    .to_string();

    let progress_ratio = if challenge.target_count > 0 {
        (challenge.progress_count as f64 / challenge.target_count as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let days_left = parse_day(&challenge.ends_on)
        .map(|end| (end - today).num_days())
        .unwrap_or(0);

    ChallengeCard {
        challenge,
        state,
        progress_ratio,
        days_left,
    }
}
