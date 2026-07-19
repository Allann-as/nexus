//! O Horizonte (ARSENAL) — os próximos marcos com D-dias e as pendências ligadas.
//!
//! Uma faixa curta do Hub: o que está vindo e o que ainda falta fazer para chegar
//! lá. Reúne dois tipos de marco DATADO — os eventos do calendário e as temporadas
//! que terminam — dentro de uma janela (90 dias), cada um com o D-dias e a
//! contagem de tarefas em aberto ligadas por `links` ("Viagem · 12 dias · 2
//! tarefas abertas"). Read-only, agrega o que já existe; nenhum tipo novo. Ver
//! ADR-0063.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::Duration;
use serde::Serialize;

use crate::application::ports::{ChallengeRepository, Clock, EventRepository, HorizonRepository};
use crate::domain::errors::Result;
use crate::domain::schedule::{format_day, parse_day};

pub struct HorizonService {
    pub events: Arc<dyn EventRepository>,
    pub challenges: Arc<dyn ChallengeRepository>,
    pub horizon: Arc<dyn HorizonRepository>,
    pub clock: Arc<dyn Clock>,
}

/// Um marco no horizonte, pronto para a faixa.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HorizonItem {
    pub id: String,
    pub title: String,
    /// "event" | "challenge".
    pub kind: String,
    pub area_id: Option<String>,
    pub day: String,
    /// Dias até o marco (0 = hoje).
    pub days_until: i64,
    /// Tarefas em aberto ligadas por `links`.
    pub open_tasks: i64,
}

impl HorizonService {
    /// Os marcos dos próximos `days` dias, do mais próximo ao mais distante.
    pub fn upcoming(&self, days: i64) -> Result<Vec<HorizonItem>> {
        let today_s = self.clock.today_local();
        let today = parse_day(&today_s)?;
        let horizon = days.clamp(1, 400);
        let to_s = format_day(today + Duration::days(horizon));

        let mut items: Vec<HorizonItem> = Vec::new();

        // 1) Eventos do calendário: a ocorrência mais próxima de cada evento na
        //    janela (uma linha por evento, não por ocorrência).
        let mut nearest: HashMap<String, (i64, crate::application::ports::Occurrence)> =
            HashMap::new();
        for occ in self.events.range(&today_s, &to_s)? {
            if occ.status == "cancelled" {
                continue;
            }
            let e = nearest.entry(occ.event_id.clone());
            match e {
                std::collections::hash_map::Entry::Occupied(mut slot) => {
                    if occ.starts_at < slot.get().0 {
                        slot.insert((occ.starts_at, occ));
                    }
                }
                std::collections::hash_map::Entry::Vacant(slot) => {
                    slot.insert((occ.starts_at, occ));
                }
            }
        }
        for (_, (_, occ)) in nearest {
            let days_until = days_between(&today, &occ.day);
            items.push(HorizonItem {
                open_tasks: self.horizon.open_linked_task_count(&occ.event_id)?,
                id: occ.event_id,
                title: occ.title,
                kind: "event".into(),
                area_id: occ.area_id,
                day: occ.day,
                days_until,
            });
        }

        // 2) Temporadas que terminam na janela (ainda ativas).
        for ch in self.challenges.list(None)? {
            if ch.status != "active" {
                continue;
            }
            if ch.ends_on.as_str() < today_s.as_str() || ch.ends_on.as_str() > to_s.as_str() {
                continue;
            }
            let days_until = days_between(&today, &ch.ends_on);
            items.push(HorizonItem {
                open_tasks: self.horizon.open_linked_task_count(&ch.id)?,
                id: ch.id,
                title: ch.title,
                kind: "challenge".into(),
                area_id: ch.area_id,
                day: ch.ends_on,
                days_until,
            });
        }

        // O mais próximo primeiro; empate desfeito pelo título.
        items.sort_by(|a, b| a.day.cmp(&b.day).then_with(|| a.title.cmp(&b.title)));
        items.truncate(10);
        Ok(items)
    }
}

/// Dias de `today` até `day` ('YYYY-MM-DD'); negativo se no passado, 0 se hoje.
fn days_between(today: &chrono::NaiveDate, day: &str) -> i64 {
    parse_day(day).map(|d| (d - *today).num_days()).unwrap_or(0)
}
