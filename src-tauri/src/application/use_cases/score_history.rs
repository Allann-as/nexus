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

/// Uma célula do "ano em pixels": o dia, o score (0..=100 ou `None` se nada
/// estava agendado) e se veio do congelado (canônico) ou foi computado agora.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreCell {
    pub day: String,
    pub value: Option<u8>,
    pub frozen: bool,
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

    /// O ANO EM PIXELS (ARSENAL): 365 células com o score de cada dia. Prefere o
    /// valor CONGELADO (o que o usuário viu na época — canônico); onde não há
    /// congelado, COMPUTA o comportamental na hora (a mesma fórmula sobre entradas
    /// imutáveis — a aproximação "agenda atual no passado" já assumida pelo
    /// `freeze`), marcando `frozen=false`. Não grava nada — é uma visão derivada.
    /// `None` num dia em que nada estava agendado (célula sem cor). Ver ADR-0061.
    pub fn year_pixels(&self, year: i64) -> Result<Vec<ScoreCell>> {
        let today = parse_day(&self.clock.today_local())?;
        let jan1 = NaiveDate::from_ymd_opt(year as i32, 1, 1)
            .ok_or_else(|| crate::domain::errors::NexusError::Validation(format!("ano {year}")))?;
        let dec31 = NaiveDate::from_ymd_opt(year as i32, 12, 31).unwrap();
        let to = dec31.min(today);
        if jan1 > to {
            return Ok(Vec::new()); // ano futuro: nada ainda
        }
        let from_s = format_day(jan1);
        let to_s = format_day(to);

        // Os scores já congelados deste ano — canônicos.
        let year_prefix = format!("{year:04}-");
        let frozen: HashMap<String, u8> = self
            .ledger
            .by_entity_kind(LedgerEntityKind::DailyScore.as_str(), 100_000)?
            .into_iter()
            .filter(|e| e.entity_id.starts_with(&year_prefix))
            .filter_map(|e| {
                let value = serde_json::from_str::<serde_json::Value>(&e.payload)
                    .ok()?
                    .get("value")?
                    .as_u64()? as u8;
                Some((e.entity_id, value))
            })
            .collect();

        // As entradas para computar os dias ainda não congelados.
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
        let planned = to_map(self.insights.scheduled_tasks_by_day(&from_s, &to_s)?);
        let done = to_map(self.insights.completed_tasks_by_day(&from_s, &to_s)?);

        let mut out = Vec::new();
        let mut day = jan1;
        while day <= to {
            let day_s = format_day(day);
            let (value, is_frozen) = if let Some(&v) = frozen.get(&day_s) {
                (Some(v), true)
            } else {
                let habits_scheduled = habits
                    .iter()
                    .filter(|(sched, _)| sched.is_scheduled_on(day))
                    .count() as u32;
                let habits_done = habits
                    .iter()
                    .filter(|(sched, dn)| sched.is_scheduled_on(day) && dn.contains(&day))
                    .count() as u32;
                let tasks_planned = *planned.get(&day_s).unwrap_or(&0) as u32;
                let tasks_done = *done.get(&day_s).unwrap_or(&0) as u32;
                (
                    score::behavioural(habits_scheduled, habits_done, tasks_planned, tasks_done),
                    false,
                )
            };
            out.push(ScoreCell {
                day: day_s,
                value,
                frozen: is_frozen,
            });
            day += Duration::days(1);
        }
        Ok(out)
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
