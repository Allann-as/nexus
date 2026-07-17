//! Casos de uso da Carreira — os marcos profissionais.
//!
//! Um marco de carreira (promoção, certificação, novo emprego) é um FATO da vida
//! do usuário que NÃO é um node (§2.3, ADR-0027): ele não tem tela nem satélite,
//! só existe na história. Por isso o "serviço" é fino — ele fala direto com o
//! ledger, sem repositório de domínio próprio.

use std::sync::Arc;

use serde_json::json;

use crate::application::ports::{Clock, IdGen, LedgerRepository};
use crate::domain::entities::{validate_title, CareerMilestoneKind};
use crate::domain::errors::Result;
use crate::domain::ledger::{EventType, LedgerEntityKind, LedgerEntry, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day};

/// Quantos marcos o painel da Carreira mostra por vez.
const MILESTONE_LIMIT: i64 = 50;

pub struct CareerService {
    pub ledger: Arc<dyn LedgerRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
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
}
