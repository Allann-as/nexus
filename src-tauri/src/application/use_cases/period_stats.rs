//! Comparativo de períodos (ARSENAL) — mês vs mês anterior, ano vs ano anterior.
//!
//! A comparação é JUSTA: mês-até-a-data contra o MESMO trecho do mês anterior
//! (1º ao mesmo dia), e ano-até-a-data contra o mesmo trecho do ano anterior. Um
//! mês cheio contra um mês pela metade mentiria a variação. As setas mostram o
//! ritmo, não um placar torto. Ver ADR-0062.
//!
//! Cinco métricas: estudo (min), foco (min), aportes (centavos), tarefas
//! concluídas e o score médio. As quatro primeiras vêm de uma query só
//! (`PeriodStatsRepository`); o score médio é somado do ledger aqui, parseando o
//! payload — o padrão do resto do código.

use std::sync::Arc;

use chrono::{Datelike, Duration, NaiveDate};
use serde::Serialize;

use crate::application::ports::{Clock, LedgerRepository, PeriodStatsRepository};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::LedgerEntityKind;
use crate::domain::schedule::{format_day, parse_day};

pub struct PeriodStatsService {
    pub period: Arc<dyn PeriodStatsRepository>,
    pub ledger: Arc<dyn LedgerRepository>,
    pub clock: Arc<dyn Clock>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodStats {
    pub study_minutes: i64,
    pub focus_minutes: i64,
    pub contribution_cents: i64,
    pub tasks_completed: i64,
    /// Média do Nexus Score congelado no período — `None` sem dias com score.
    pub score_avg: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    /// "month" ou "year".
    pub mode: String,
    pub current: PeriodStats,
    pub previous: PeriodStats,
    pub current_label: String,
    pub previous_label: String,
}

impl PeriodStatsService {
    pub fn compare(&self, mode: &str) -> Result<Comparison> {
        let today = parse_day(&self.clock.today_local())?;
        let r = ranges(mode, today)?;
        Ok(Comparison {
            mode: mode.to_string(),
            current: self.stats(&format_day(r.cur_from), &format_day(r.cur_to))?,
            previous: self.stats(&format_day(r.prev_from), &format_day(r.prev_to))?,
            current_label: r.cur_label,
            previous_label: r.prev_label,
        })
    }

    fn stats(&self, from: &str, to: &str) -> Result<PeriodStats> {
        let raw = self.period.range_stats(from, to)?;
        Ok(PeriodStats {
            study_minutes: raw.study_minutes,
            focus_minutes: raw.focus_minutes,
            contribution_cents: raw.contribution_cents,
            tasks_completed: raw.tasks_completed,
            score_avg: self.avg_score(from, to)?,
        })
    }

    /// A média dos scores congelados no intervalo — lê o ledger e parseia o
    /// payload (o padrão do `ScoreHistoryService`/`RecordsService`).
    fn avg_score(&self, from: &str, to: &str) -> Result<Option<f64>> {
        let mut sum = 0.0;
        let mut n = 0u32;
        for e in self
            .ledger
            .by_entity_kind(LedgerEntityKind::DailyScore.as_str(), 100_000)?
        {
            if e.day.as_str() < from || e.day.as_str() > to {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&e.payload) {
                if let Some(value) = v.get("value").and_then(|x| x.as_f64()) {
                    sum += value;
                    n += 1;
                }
            }
        }
        Ok((n > 0).then(|| sum / n as f64))
    }
}

/// Os quatro dias e os dois rótulos de um comparativo. Puro e testado.
struct Ranges {
    cur_from: NaiveDate,
    cur_to: NaiveDate,
    prev_from: NaiveDate,
    prev_to: NaiveDate,
    cur_label: String,
    prev_label: String,
}

const MESES: [&str; 12] = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
];

/// Constrói os intervalos ATÉ-A-DATA de cada período. `today` é a âncora.
fn ranges(mode: &str, today: NaiveDate) -> Result<Ranges> {
    match mode {
        "month" => {
            let cur_from = first_of_month(today);
            // Mês anterior: recua um dia antes do 1º deste mês, depois vai ao 1º.
            let prev_last = cur_from - Duration::days(1);
            let prev_from = first_of_month(prev_last);
            // O mesmo dia-do-mês, sem estourar o fim do mês anterior.
            let prev_to = clamp_day(prev_from, today.day());
            Ok(Ranges {
                cur_from,
                cur_to: today,
                prev_from,
                prev_to,
                cur_label: MESES[today.month0() as usize].to_string(),
                prev_label: MESES[prev_from.month0() as usize].to_string(),
            })
        }
        "year" => {
            let cur_from = NaiveDate::from_ymd_opt(today.year(), 1, 1).unwrap();
            let prev_from = NaiveDate::from_ymd_opt(today.year() - 1, 1, 1).unwrap();
            // Mesmo mês/dia do ano anterior, com o 29/02 caindo para 28/02.
            let prev_to = NaiveDate::from_ymd_opt(today.year() - 1, today.month(), today.day())
                .unwrap_or_else(|| {
                    clamp_day(first_of_month_ymd(today.year() - 1, today.month()), 28)
                });
            Ok(Ranges {
                cur_from,
                cur_to: today,
                prev_from,
                prev_to,
                cur_label: today.year().to_string(),
                prev_label: (today.year() - 1).to_string(),
            })
        }
        other => Err(NexusError::Validation(format!(
            "período inválido: {other} (use 'month' ou 'year')"
        ))),
    }
}

fn first_of_month(d: NaiveDate) -> NaiveDate {
    NaiveDate::from_ymd_opt(d.year(), d.month(), 1).unwrap()
}

fn first_of_month_ymd(year: i32, month: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, 1).unwrap()
}

/// O dia `day` do mês de `first`, sem passar do último dia daquele mês.
fn clamp_day(first: NaiveDate, day: u32) -> NaiveDate {
    let mut d = day;
    loop {
        if let Some(nd) = NaiveDate::from_ymd_opt(first.year(), first.month(), d) {
            return nd;
        }
        d -= 1; // 31 num mês de 30, ou 29/30/31 em fevereiro
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        parse_day(s).unwrap()
    }

    #[test]
    fn month_compares_the_same_stretch() {
        // 15 de julho → jul 1..15 vs jun 1..15.
        let r = ranges("month", d("2026-07-15")).unwrap();
        assert_eq!(r.cur_from, d("2026-07-01"));
        assert_eq!(r.cur_to, d("2026-07-15"));
        assert_eq!(r.prev_from, d("2026-06-01"));
        assert_eq!(r.prev_to, d("2026-06-15"));
        assert_eq!(r.cur_label, "Julho");
        assert_eq!(r.prev_label, "Junho");
    }

    #[test]
    fn month_clamps_when_the_previous_month_is_shorter() {
        // 31 de março → o "31" não existe em fevereiro; cai para 28 (2026 não bissexto).
        let r = ranges("month", d("2026-03-31")).unwrap();
        assert_eq!(r.prev_from, d("2026-02-01"));
        assert_eq!(r.prev_to, d("2026-02-28"));
    }

    #[test]
    fn year_compares_year_to_date() {
        let r = ranges("year", d("2026-07-15")).unwrap();
        assert_eq!(r.cur_from, d("2026-01-01"));
        assert_eq!(r.cur_to, d("2026-07-15"));
        assert_eq!(r.prev_from, d("2025-01-01"));
        assert_eq!(r.prev_to, d("2025-07-15"));
    }

    #[test]
    fn a_leap_day_anchor_falls_back_to_feb_28_last_year() {
        // 29/02/2028 (bissexto) → 2027 não tem 29/02: cai para 28/02.
        let r = ranges("year", d("2028-02-29")).unwrap();
        assert_eq!(r.prev_to, d("2027-02-28"));
    }

    #[test]
    fn an_unknown_mode_is_rejected() {
        assert!(ranges("decade", d("2026-07-15")).is_err());
    }
}
