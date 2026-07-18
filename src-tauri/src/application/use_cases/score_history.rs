//! O Nexus Score congelado — a história do score, dia a dia (ADR-0039).
//!
//! Congelar, nunca recomputar o passado: o score de um dia vira um evento
//! `nexus_score` no ledger, com o valor e a versão da fórmula. A abertura do app
//! congela os dias FECHADOS ainda sem linha (o mesmo padrão "a navegação paga a
//! escrita" do ADR-0026/0034). É idempotente: um dia já gravado é pulado.
//!
//! O score congelado é COMPORTAMENTAL (hábitos + tarefas do dia) — os sinais que
//! a história reconstrói. Ver `domain::score::behavioural` e o ADR-0039.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{Duration, NaiveDate};
use serde::Serialize;
use serde_json::json;

use crate::application::ports::{Clock, InsightRepository, LedgerRepository};
use crate::domain::errors::Result;
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day, Schedule};
use crate::domain::score::{self, FROZEN_FORMULA_VERSION};

/// Quantos dias fechados o congelamento olha para trás numa passada. Um teto: o
/// primeiro boot não varre anos, e os dias mais antigos que isso ficam sem score
/// congelado (aceitável — a história de score começa quando o M4.5 chega).
const BACKFILL_DAYS: i64 = 60;

pub struct ScoreHistoryService {
    pub insights: Arc<dyn InsightRepository>,
    pub ledger: Arc<dyn LedgerRepository>,
    pub clock: Arc<dyn Clock>,
}

/// Um ponto da série do score.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScorePoint {
    pub day: String,
    pub value: u8,
}

impl ScoreHistoryService {
    /// Congela o score dos dias FECHADOS ainda não gravados. Idempotente. Devolve
    /// quantos dias congelou. A UI chama na abertura do app.
    pub fn freeze(&self) -> Result<usize> {
        let today = parse_day(&self.clock.today_local())?;
        let from = today - Duration::days(BACKFILL_DAYS);
        let from_s = format_day(from);
        let yesterday_s = format_day(today - Duration::days(1));

        // Os dias que já têm score congelado, no ledger.
        let frozen: HashSet<String> = self
            .ledger
            .by_entity_kind(LedgerEntityKind::DailyScore.as_str(), 2000)?
            .into_iter()
            .map(|e| e.entity_id)
            .collect();

        // Hábitos ativos: agenda + dias cumpridos (a agenda ATUAL aplicada ao
        // passado — mudanças de agenda não são versionadas; aproximação documentada).
        let habits: Vec<(Schedule, HashSet<NaiveDate>)> = self
            .insights
            .active_habit_series()?
            .into_iter()
            .map(|s| {
                let done: HashSet<NaiveDate> = s
                    .done_days
                    .iter()
                    .filter_map(|d| parse_day(d).ok())
                    .collect();
                (s.schedule, done)
            })
            .collect();

        // Tarefas planejadas e concluídas por dia.
        let planned = to_map(
            self.insights
                .scheduled_tasks_by_day(&from_s, &yesterday_s)?,
        );
        let done = to_map(
            self.insights
                .completed_tasks_by_day(&from_s, &yesterday_s)?,
        );

        let now = self.clock.now_ms();
        let mut count = 0usize;
        let mut day = from;
        while day < today {
            let day_s = format_day(day);
            if frozen.contains(&day_s) {
                day += Duration::days(1);
                continue;
            }

            let habits_scheduled = habits
                .iter()
                .filter(|(sched, _)| sched.is_scheduled_on(day))
                .count() as u32;
            let habits_done = habits
                .iter()
                .filter(|(sched, done)| sched.is_scheduled_on(day) && done.contains(&day))
                .count() as u32;
            let tasks_planned = *planned.get(&day_s).unwrap_or(&0) as u32;
            let tasks_done = *done.get(&day_s).unwrap_or(&0) as u32;

            if let Some(value) =
                score::behavioural(habits_scheduled, habits_done, tasks_planned, tasks_done)
            {
                self.ledger.append(&NewLedgerEvent {
                    ts: now,
                    day: day_s.clone(),
                    entity_id: day_s.clone(),
                    entity_kind: LedgerEntityKind::DailyScore,
                    event_type: EventType::NexusScore,
                    payload: json!({
                        "value": value,
                        "formulaVersion": FROZEN_FORMULA_VERSION,
                    }),
                    title_snapshot: format!("Nexus Score: {value}"),
                })?;
                count += 1;
            }
            day += Duration::days(1);
        }
        Ok(count)
    }

    /// A série congelada dos últimos `days` dias, do mais antigo ao mais recente —
    /// para o gráfico de evolução do score.
    pub fn history(&self, days: i64) -> Result<Vec<ScorePoint>> {
        let today = parse_day(&self.clock.today_local())?;
        let floor = format_day(today - Duration::days(days.max(1)));

        let mut points: Vec<ScorePoint> = self
            .ledger
            .by_entity_kind(LedgerEntityKind::DailyScore.as_str(), days.max(1) + 8)?
            .into_iter()
            .filter(|e| e.day >= floor)
            .filter_map(|e| {
                let value = serde_json::from_str::<serde_json::Value>(&e.payload)
                    .ok()?
                    .get("value")?
                    .as_u64()? as u8;
                Some(ScorePoint {
                    day: e.entity_id,
                    value,
                })
            })
            .collect();
        points.sort_by(|a, b| a.day.cmp(&b.day));
        Ok(points)
    }
}

fn to_map(rows: Vec<(String, i64)>) -> HashMap<String, i64> {
    rows.into_iter().collect()
}
