//! Casos de uso de Nodes — inclui a captura e a triagem do Inbox.

use std::sync::Arc;

use serde_json::json;

use crate::application::ports::{
    AreaRepository, Clock, IdGen, NewNode, NodeFilter, NodePatch, NodeRepository,
};
use crate::domain::entities::{validate_title, Kind, Node, Status};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, NewLedgerEvent};

pub struct NodeService {
    pub nodes: Arc<dyn NodeRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl NodeService {
    pub fn create(
        &self,
        kind: Kind,
        title: &str,
        area_id: Option<&str>,
        parent_id: Option<&str>,
    ) -> Result<Node> {
        let title = validate_title(title)?;

        // A FK do banco já barraria uma área inexistente, mas com um erro de
        // storage cru. Checar aqui devolve uma mensagem que a UI sabe explicar.
        if let Some(aid) = area_id {
            if !self.areas.exists(aid)? {
                return Err(NexusError::NotFound(format!("área {aid} não existe")));
            }
        }

        let id = self.ids.new_id();
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: kind.into(),
            event_type: EventType::Created,
            payload: json!({ "kind": kind.as_str() }),
            title_snapshot: title.clone(),
        };

        self.nodes.create_with_event(
            &id,
            &NewNode {
                kind,
                title,
                area_id: area_id.map(str::to_string),
                parent_id: parent_id.map(str::to_string),
            },
            &event,
        )
    }

    /// Captura no Inbox: um `inbox_item` sem área, com zero fricção.
    ///
    /// Sem área de propósito — decidir onde algo vive é justamente o trabalho
    /// que a captura adia. Exigir a decisão no momento da captura é o que faz
    /// as pessoas não capturarem.
    pub fn capture_inbox(&self, title: &str) -> Result<Node> {
        self.create(Kind::InboxItem, title, None, None)
    }

    /// Triagem: transforma um `inbox_item` no que ele realmente é.
    ///
    /// Muda `kind` e atribui a Área numa única transação, junto do evento
    /// `triaged`. O id é preservado: a linha de `created` no ledger continua
    /// apontando para a mesma entidade, então a história da captura sobrevive
    /// à triagem.
    pub fn triage(&self, id: &str, into: Kind, area_id: Option<&str>) -> Result<Node> {
        let node = self.nodes.get(id)?;

        if node.kind != Kind::InboxItem {
            return Err(NexusError::Validation(format!(
                "só itens do Inbox podem ser triados (este é '{}')",
                node.kind.as_str()
            )));
        }
        if into == Kind::InboxItem {
            return Err(NexusError::Validation(
                "triar para 'inbox_item' não faz sentido".into(),
            ));
        }
        if let Some(aid) = area_id {
            if !self.areas.exists(aid)? {
                return Err(NexusError::NotFound(format!("área {aid} não existe")));
            }
        }

        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: into.into(),
            event_type: EventType::Triaged,
            payload: json!({ "from": node.kind.as_str(), "to": into.as_str() }),
            title_snapshot: node.title.clone(),
        };

        self.nodes.update_with_event(
            id,
            &NodePatch {
                kind: Some(into),
                area_id: Some(area_id),
                ..Default::default()
            },
            now,
            &event,
        )
    }

    pub fn rename(&self, id: &str, title: &str) -> Result<Node> {
        let node = self.nodes.get(id)?;
        let title = validate_title(title)?;
        let now = self.clock.now_ms();

        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: node.kind.into(),
            event_type: EventType::Renamed,
            payload: json!({ "from": node.title, "to": title }),
            title_snapshot: title.clone(),
        };

        self.nodes.update_with_event(
            id,
            &NodePatch {
                title: Some(&title),
                ..Default::default()
            },
            now,
            &event,
        )
    }

    pub fn set_status(&self, id: &str, status: Status) -> Result<Node> {
        let node = self.nodes.get(id)?;
        let now = self.clock.now_ms();

        // 'done' é o evento que o BI conta como conclusão; os demais são só
        // mudanças de estado. Distinguir aqui evita o BI ter que interpretar
        // payloads depois.
        let event_type = match status {
            Status::Done => EventType::Completed,
            Status::Archived => EventType::Archived,
            _ => EventType::StatusChanged,
        };

        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: node.kind.into(),
            event_type,
            payload: json!({ "from": node.status.as_str(), "to": status.as_str() }),
            title_snapshot: node.title.clone(),
        };

        self.nodes.update_with_event(
            id,
            &NodePatch {
                status: Some(status),
                ..Default::default()
            },
            now,
            &event,
        )
    }

    /// Descarta de vez.
    ///
    /// O node some, mas o ledger guarda o `deleted` — e como `ledger.entity_id`
    /// não tem FK, os eventos anteriores dele continuam lá. Você perde o item,
    /// não a história de que ele existiu.
    pub fn delete(&self, id: &str) -> Result<()> {
        let node = self.nodes.get(id)?;
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: node.kind.into(),
            event_type: EventType::Deleted,
            payload: json!({ "kind": node.kind.as_str() }),
            title_snapshot: node.title.clone(),
        };
        self.nodes.delete_with_event(id, &event)
    }

    pub fn get(&self, id: &str) -> Result<Node> {
        self.nodes.get(id)
    }

    pub fn list(&self, filter: &NodeFilter) -> Result<Vec<Node>> {
        self.nodes.list(filter)
    }

    pub fn count(&self, filter: &NodeFilter) -> Result<i64> {
        self.nodes.count(filter)
    }
}
