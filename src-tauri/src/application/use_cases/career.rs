//! Casos de uso da Carreira — os marcos profissionais.
//!
//! Um marco de carreira (promoção, certificação, novo emprego) é um FATO da vida
//! do usuário que NÃO é um node (§2.3, ADR-0027): ele não tem tela nem satélite,
//! só existe na história. Por isso o "serviço" é fino — ele fala direto com o
//! ledger, sem repositório de domínio próprio.

use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AreaRepository, Clock, IdGen, LedgerRepository, NewNode, NewSkill, Skill, SkillRepository,
};
use crate::domain::entities::{validate_title, CareerMilestoneKind, Kind};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, LedgerEntry, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day};

/// Quantos marcos o painel da Carreira mostra por vez.
const MILESTONE_LIMIT: i64 = 50;

pub struct CareerService {
    pub skills: Arc<dyn SkillRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ledger: Arc<dyn LedgerRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

/// Um ponto da trilha de evolução de uma competência.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPoint {
    /// 'YYYY-MM-DD' local.
    pub day: String,
    pub level: i64,
}

impl CareerService {
    /// Registra um marco de carreira no ledger.
    pub fn record_milestone(
        &self,
        title: &str,
        kind: CareerMilestoneKind,
        happened_on: Option<String>,
        note: Option<String>,
    ) -> Result<LedgerEntry> {
        let title = validate_title(title)?;
        // O dia é do usuário (um marco pode ser retroativo); o `ts` é agora.
        let day = match happened_on {
            Some(d) => format_day(parse_day(&d)?),
            None => self.clock.today_local(),
        };
        let id = self.ids.new_id();
        let now = self.clock.now_ms();

        let event = NewLedgerEvent {
            ts: now,
            day,
            entity_id: id,
            entity_kind: LedgerEntityKind::CareerMilestone,
            event_type: EventType::Created,
            payload: json!({ "kind": kind.as_str(), "note": note }),
            title_snapshot: title,
        };
        let seq = self.ledger.append(&event)?;

        // Devolve a linha como ela ficou gravada, para a UI inserir sem refetch.
        Ok(LedgerEntry {
            seq,
            ts: event.ts,
            day: event.day,
            entity_id: event.entity_id,
            entity_kind: event.entity_kind.as_str().to_string(),
            event_type: event.event_type.as_str().to_string(),
            payload: event.payload.to_string(),
            title_snapshot: event.title_snapshot,
        })
    }

    /// Os marcos de carreira, do mais recente ao mais antigo.
    pub fn milestones(&self) -> Result<Vec<LedgerEntry>> {
        self.ledger
            .by_entity_kind("career_milestone", MILESTONE_LIMIT)
    }

    /* ===== Competências (M4.6) ===== */

    /// Cria uma competência (nível 1) numa Esfera, gravando o `created` no ledger.
    pub fn create_skill(
        &self,
        title: &str,
        area_id: Option<String>,
        category: Option<String>,
        max_level: Option<i64>,
    ) -> Result<Skill> {
        let title = validate_title(title)?;
        if let Some(a) = &area_id {
            if !self.areas.exists(a)? {
                return Err(NexusError::NotFound(format!("esfera {a}")));
            }
        }
        if let Some(m) = max_level {
            if m < 1 {
                return Err(NexusError::Validation(
                    "o nível máximo tem que ser ao menos 1".into(),
                ));
            }
        }
        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::Skill),
            event_type: EventType::Created,
            payload: json!({ "category": category }),
            title_snapshot: title.clone(),
        };
        self.skills.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Skill,
                title,
                area_id,
                parent_id: None,
            },
            &NewSkill {
                title: String::new(), // o título já está no node; o satélite não o repete
                area_id: None,
                category,
                max_level,
            },
            &event,
        )
    }

    /// Sobe uma competência de nível — um FATO no ledger que vale XP (ADR-0037/0045).
    pub fn level_up_skill(&self, id: &str) -> Result<Skill> {
        // Lê o título atual para o snapshot honesto do evento (o node pode ter sido
        // renomeado desde a criação).
        let current = self.skills.get(id)?;
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::Skill),
            event_type: EventType::SkillLevelUp,
            payload: json!({}),
            title_snapshot: current.title,
        };
        self.skills.level_up_with_event(id, now, &event)
    }

    /// As competências de uma Esfera (ou todas).
    pub fn skills(&self, area_id: Option<String>) -> Result<Vec<Skill>> {
        self.skills.list(area_id.as_deref())
    }

    /// A trilha de evolução de uma competência: (dia, nível). Um ponto só = nova.
    pub fn skill_track(&self, id: &str) -> Result<Vec<SkillPoint>> {
        Ok(self
            .skills
            .level_history(id)?
            .into_iter()
            .map(|(day, level)| SkillPoint { day, level })
            .collect())
    }

    /// As competências "em evolução" do painel: as que subiram de nível nos últimos
    /// 90 dias. A janela é fixa — o painel quer "o que está esquentando agora".
    pub fn skills_evolving(&self, area_id: &str) -> Result<Vec<Skill>> {
        let today = parse_day(&self.clock.today_local())?;
        let since = format_day(today - chrono::Duration::days(90));
        self.skills.evolving_since(area_id, &since)
    }
}
