//! Semana perfeita (ARSENAL) — o calendário anual, a sequência e o total.
//!
//! Tudo DERIVADO das séries de hábito (schedule + dias cumpridos), como o streak
//! e o XP: nada é gravado. Um evento não é congelado no ledger de propósito —
//! desmarcar um tick tem que poder desfazer uma semana perfeita, e um fato
//! congelado mentiria. A régua vive em `domain::perfect_week`; aqui é só a cola
//! entre o repositório de leitura e o domínio puro.

use std::sync::Arc;

use chrono::{Datelike, NaiveDate};
use serde::Serialize;

use crate::application::ports::{Clock, HabitSeries, InsightRepository};
use crate::domain::errors::Result;
use crate::domain::perfect_week::{
    complete_weeks, streak_from_statuses, week_status, HabitInput, PerfectStreak, WeekStatus,
};
use crate::domain::schedule::{format_day, parse_day};
use crate::domain::streak::{TickStatus, Ticks};

pub struct PerfectWeekService {
    pub insights: Arc<dyn InsightRepository>,
    pub clock: Arc<dyn Clock>,
}

/// Uma célula do calendário: a segunda-feira da semana e o seu estado.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekCell {
    pub week_start: String,
    pub status: WeekStatus,
}

/// A visão de semanas perfeitas de um ano — o calendário + os números.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfectWeekView {
    pub year: i64,
    /// As semanas COMPLETAS cuja segunda cai no ano.
    pub weeks: Vec<WeekCell>,
    /// A sequência de toda a história (atual, recorde, total).
    pub streak: PerfectStreak,
    /// Quantas semanas perfeitas neste ano.
    pub total_year: u32,
}

impl PerfectWeekService {
    pub fn view(&self, year: i64) -> Result<PerfectWeekView> {
        let today = parse_day(&self.clock.today_local())?;
        let series = self.insights.active_habit_series()?;
        let prepared = prepare(series);
        let statuses = all_statuses(&prepared, today);

        let weeks: Vec<WeekCell> = statuses
            .iter()
            .filter(|(ws, _)| ws.year() as i64 == year)
            .map(|(ws, status)| WeekCell {
                week_start: format_day(*ws),
                status: *status,
            })
            .collect();
        let total_year = weeks
            .iter()
            .filter(|w| w.status == WeekStatus::Perfect)
            .count() as u32;

        let streak = streak_from_statuses(&statuses.iter().map(|(_, s)| *s).collect::<Vec<_>>());

        Ok(PerfectWeekView {
            year,
            weeks,
            streak,
            total_year,
        })
    }

    /// O total de semanas perfeitas de toda a história — o contador que alimenta
    /// as conquistas (4/12/26).
    pub fn total_all_time(&self) -> Result<u32> {
        let today = parse_day(&self.clock.today_local())?;
        let prepared = prepare(self.insights.active_habit_series()?);
        Ok(all_statuses(&prepared, today)
            .into_iter()
            .filter(|(_, s)| *s == WeekStatus::Perfect)
            .count() as u32)
    }
}

/// O total de semanas perfeitas de uma lista de séries — a versão livre de
/// serviço, para o contador de conquistas (que já tem as séries em mãos).
pub fn total_from_series(series: Vec<HabitSeries>, today: NaiveDate) -> u32 {
    let prepared = prepare(series);
    all_statuses(&prepared, today)
        .into_iter()
        .filter(|(_, s)| *s == WeekStatus::Perfect)
        .count() as u32
}

/// As semanas perfeitas cuja segunda cai num ANO — para a retrospectiva (ADR-0064).
pub fn year_total_from_series(series: Vec<HabitSeries>, year: i64, today: NaiveDate) -> u32 {
    let prepared = prepare(series);
    all_statuses(&prepared, today)
        .into_iter()
        .filter(|(ws, s)| ws.year() as i64 == year && *s == WeekStatus::Perfect)
        .count() as u32
}

/// Um hábito preparado para o domínio: agenda + os dias cumpridos (como `Ticks`
/// só de `Done`, que é tudo que a semana perfeita observa) + o primeiro tick.
struct Prepared {
    schedule: crate::domain::schedule::Schedule,
    ticks: Ticks,
    earliest: Option<NaiveDate>,
}

fn prepare(series: Vec<HabitSeries>) -> Vec<Prepared> {
    series
        .into_iter()
        .map(|s| {
            let ticks: Ticks = s
                .done_days
                .iter()
                .filter_map(|d| parse_day(d).ok().map(|day| (day, TickStatus::Done)))
                .collect();
            let earliest = ticks.keys().next().copied();
            Prepared {
                schedule: s.schedule,
                ticks,
                earliest,
            }
        })
        .collect()
}

/// O estado de cada semana COMPLETA, da primeira com algum tick até a última já
/// encerrada. A lista sai ordenada no tempo — pronta para a sequência e o filtro
/// por ano.
fn all_statuses(prepared: &[Prepared], today: NaiveDate) -> Vec<(NaiveDate, WeekStatus)> {
    let Some(earliest) = prepared.iter().filter_map(|p| p.earliest).min() else {
        return Vec::new();
    };
    let inputs: Vec<HabitInput> = prepared
        .iter()
        .map(|p| HabitInput {
            schedule: &p.schedule,
            ticks: &p.ticks,
            earliest: p.earliest,
        })
        .collect();

    complete_weeks(earliest, today)
        .into_iter()
        .map(|ws| (ws, week_status(&inputs, ws)))
        .collect()
}
