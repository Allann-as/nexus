//! Casos de uso das Metas Anuais (§2.3).
//!
//! Metas organizadas por ANO. O app sabe a data: cria para o ano corrente e para
//! anos futuros (planejar 2027 em 2026). Uma binária conclui virando 'done'; uma
//! quantitativa mede `current_value / target_value`, e cada atualização é um
//! checkpoint no ledger (ADR-0036). A visão do ano cruza o progresso com o
//! quanto do ano já passou.

use std::sync::Arc;

use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AnnualGoal, AnnualGoalRepository, AreaRepository, Clock, IdGen, NewAnnualGoal, NewNode,
};
use crate::domain::entities::{validate_title, AnnualGoalKind, Kind};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};

/// Uma meta anual com o progresso pronto para a tela.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualGoalCard {
    #[serde(flatten)]
    pub goal: AnnualGoal,
    /// 0.0..=1.0. Binária: 1 se 'done', senão 0. Quantitativa: current/target.
    pub progress_ratio: f64,
}

/// A visão de um ano: as metas + o quanto do ano já passou vs o quanto delas
/// foi cumprido ("você está em 54% do ano com 40% das metas").
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearOverview {
    pub year: i64,
    pub goals: Vec<AnnualGoalCard>,
    /// Fração do ano decorrida (0 para ano futuro, 1 para ano passado).
    pub year_elapsed_ratio: f64,
    /// Média do progresso das metas do ano (0 se não há metas).
    pub aggregate_progress: f64,
    pub active_count: usize,
    pub done_count: usize,
}

pub struct AnnualGoalService {
    pub annual_goals: Arc<dyn AnnualGoalRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl AnnualGoalService {
    fn current_year(&self) -> Result<i64> {
        Ok(self.today()?.year() as i64)
    }

    fn today(&self) -> Result<NaiveDate> {
        crate::domain::schedule::parse_day(&self.clock.today_local())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        title: &str,
        area_id: Option<String>,
        year: i64,
        goal_kind: &str,
        metric_name: Option<String>,
        target_value: Option<f64>,
        unit: Option<String>,
    ) -> Result<AnnualGoalCard> {
        let title = validate_title(title)?;
        let goal_kind = AnnualGoalKind::parse(goal_kind)?;

        // O ano corrente e os futuros são permitidos; o passado não — não se
        // planeja um ano que já foi (§2.3).
        let current = self.current_year()?;
        if year < current {
            return Err(NexusError::Validation(format!(
                "não dá para criar uma meta para {year}: o ano já passou"
            )));
        }

        // Uma quantitativa precisa de métrica e alvo positivo; uma binária os ignora.
        let (metric_name, target_value, unit) = match goal_kind {
            AnnualGoalKind::Quantitative => {
                let target = target_value.ok_or_else(|| {
                    NexusError::Validation("uma meta quantitativa precisa de um alvo".into())
                })?;
                if target <= 0.0 {
                    return Err(NexusError::Validation("o alvo precisa ser positivo".into()));
                }
                let metric = metric_name
                    .map(|m| m.trim().to_string())
                    .filter(|m| !m.is_empty())
                    .ok_or_else(|| {
                        NexusError::Validation(
                            "uma meta quantitativa precisa de uma métrica".into(),
                        )
                    })?;
                (Some(metric), Some(target), unit)
            }
            AnnualGoalKind::Binary => (None, None, None),
        };

        if let Some(ref a) = area_id {
            if !self.areas.exists(a)? {
                return Err(NexusError::NotFound(format!("esfera {a} não existe")));
            }
        }

        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::AnnualGoal),
            event_type: EventType::Created,
            payload: json!({ "year": year, "goalKind": goal_kind.as_str() }),
            title_snapshot: title.clone(),
        };

        let goal = self.annual_goals.create_with_event(
            &id,
            &NewNode {
                kind: Kind::AnnualGoal,
                title: title.clone(),
                area_id: area_id.clone(),
                parent_id: None,
            },
            &NewAnnualGoal {
                title,
                area_id,
                year,
                goal_kind,
                metric_name,
                target_value,
                unit,
            },
            &event,
        )?;
        Ok(to_card(goal))
    }

    /// A visão de um ano inteiro.
    pub fn year_overview(&self, year: i64) -> Result<YearOverview> {
        let goals: Vec<AnnualGoalCard> = self
            .annual_goals
            .list_by_year(year)?
            .into_iter()
            .map(to_card)
            .collect();

        let active_count = goals.iter().filter(|g| g.goal.status == "active").count();
        let done_count = goals.iter().filter(|g| g.goal.status == "done").count();
        let aggregate_progress = if goals.is_empty() {
            0.0
        } else {
            goals.iter().map(|g| g.progress_ratio).sum::<f64>() / goals.len() as f64
        };

        Ok(YearOverview {
            year,
            year_elapsed_ratio: year_elapsed_ratio(year, self.today()?),
            aggregate_progress,
            active_count,
            done_count,
            goals,
        })
    }

    /// Os anos que já têm meta, garantindo que o ano corrente sempre apareça
    /// (para o usuário começar a planejar mesmo sem nada ainda).
    pub fn years(&self) -> Result<Vec<i64>> {
        let current = self.current_year()?;
        let mut years = self.annual_goals.years()?;
        if !years.contains(&current) {
            years.push(current);
            years.sort_unstable_by(|a, b| b.cmp(a));
        }
        Ok(years)
    }

    /// Atualiza o progresso de uma quantitativa. Cada atualização é um checkpoint
    /// no ledger; cruzar o alvo fecha a meta (conquista + XP alto).
    pub fn update_progress(&self, id: &str, current_value: f64) -> Result<AnnualGoalCard> {
        if current_value < 0.0 {
            return Err(NexusError::Validation(
                "o progresso não pode ser negativo".into(),
            ));
        }
        let goal = self.annual_goals.get(id)?;
        let target = goal.target_value.unwrap_or(0.0);
        let now = self.clock.now_ms();
        let day = self.clock.today_local();

        let checkpoint = NewLedgerEvent {
            ts: now,
            day: day.clone(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::AnnualGoal),
            event_type: EventType::GoalCheckpoint,
            payload: json!({ "value": current_value, "target": target }),
            title_snapshot: goal.title.clone(),
        };

        // Cruzou o alvo agora e ainda estava ativa: fecha.
        let just_completed = goal.status == "active"
            && target > 0.0
            && goal.current_value < target
            && current_value >= target;
        let completion = just_completed.then(|| completion_event(id, &goal.title, now, &day));

        let updated = self.annual_goals.set_progress(
            id,
            current_value,
            now,
            &checkpoint,
            completion.as_ref(),
        )?;
        Ok(to_card(updated))
    }

    /// Conclui uma meta binária ("fiz X"). Uma quantitativa se conclui pelo
    /// progresso, mas fechar à mão também é aceito.
    pub fn complete(&self, id: &str) -> Result<AnnualGoalCard> {
        let goal = self.annual_goals.get(id)?;
        let now = self.clock.now_ms();
        let event = completion_event(id, &goal.title, now, &self.clock.today_local());
        Ok(to_card(
            self.annual_goals.set_status(id, "done", now, &event)?,
        ))
    }

    /// Abandona uma meta (vira 'dropped') — uma decisão da vida do usuário.
    pub fn abandon(&self, id: &str) -> Result<AnnualGoalCard> {
        self.change_status(
            id,
            "dropped",
            EventType::StatusChanged,
            json!({ "to": "dropped" }),
        )
    }

    /// Arquiva uma meta (some da visão sem apagar a história).
    pub fn archive(&self, id: &str) -> Result<AnnualGoalCard> {
        self.change_status(id, "archived", EventType::Archived, json!({}))
    }

    fn change_status(
        &self,
        id: &str,
        status: &str,
        event_type: EventType,
        payload: serde_json::Value,
    ) -> Result<AnnualGoalCard> {
        let goal = self.annual_goals.get(id)?;
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::AnnualGoal),
            event_type,
            payload,
            title_snapshot: goal.title.clone(),
        };
        Ok(to_card(
            self.annual_goals.set_status(id, status, now, &event)?,
        ))
    }

    /// Exclui uma meta de vez (o node; o satélite vai por CASCADE).
    pub fn delete(&self, id: &str) -> Result<()> {
        let goal = self.annual_goals.get(id)?;
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::AnnualGoal),
            event_type: EventType::Deleted,
            payload: json!({}),
            title_snapshot: goal.title,
        };
        self.annual_goals.delete_with_event(id, &event)
    }
}

fn completion_event(id: &str, title: &str, now: i64, day: &str) -> NewLedgerEvent {
    NewLedgerEvent {
        ts: now,
        day: day.to_string(),
        entity_id: id.to_string(),
        entity_kind: LedgerEntityKind::Node(Kind::AnnualGoal),
        event_type: EventType::Completed,
        payload: json!({ "achievement": "annual_goal_complete" }),
        title_snapshot: format!("Meta anual concluída: {title}"),
    }
}

fn to_card(goal: AnnualGoal) -> AnnualGoalCard {
    // O valor efetivo: se há hábito ligado (ADR-0058), o número vem dos ticks
    // (`tracked_count`), não da coluna manual. A barra e o ritmo leem daqui.
    let effective = goal.tracked_count.unwrap_or(goal.current_value);
    let progress_ratio = if goal.status == "done" {
        1.0
    } else if goal.goal_kind == "quantitative" {
        match goal.target_value {
            Some(t) if t > 0.0 => (effective / t).clamp(0.0, 1.0),
            _ => 0.0,
        }
    } else {
        0.0 // binária ainda não concluída
    };
    AnnualGoalCard {
        goal,
        progress_ratio,
    }
}

/// Fração do ano já decorrida em `today`. Ano passado → 1; futuro → 0; corrente →
/// dias decorridos / dias no ano. Puro e testado.
fn year_elapsed_ratio(year: i64, today: NaiveDate) -> f64 {
    let this_year = today.year() as i64;
    if this_year > year {
        return 1.0;
    }
    if this_year < year {
        return 0.0;
    }
    let days_in_year = if is_leap(year) { 366.0 } else { 365.0 };
    // ordinal0() = dias desde 1º de janeiro (0-based); +1 conta o dia corrente.
    ((today.ordinal0() as f64 + 1.0) / days_in_year).clamp(0.0, 1.0)
}

fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn a_past_year_is_fully_elapsed() {
        assert_eq!(year_elapsed_ratio(2025, d("2026-07-17")), 1.0);
    }

    #[test]
    fn a_future_year_has_not_started() {
        assert_eq!(year_elapsed_ratio(2027, d("2026-07-17")), 0.0);
    }

    #[test]
    fn mid_year_is_about_half() {
        // 2 de julho de 2026 é o 183º dia de 365 → ~0,50.
        let r = year_elapsed_ratio(2026, d("2026-07-02"));
        assert!((r - 0.5).abs() < 0.01, "veio {r}");
    }

    #[test]
    fn the_first_of_january_is_one_day_in_not_zero() {
        let r = year_elapsed_ratio(2026, d("2026-01-01"));
        assert!(r > 0.0 && r < 0.01, "1º de janeiro é 1/365, não zero: {r}");
    }

    #[test]
    fn a_leap_year_has_366_days() {
        // 31 de dezembro de 2028 (bissexto) = dia 366/366 = 1.0.
        assert!((year_elapsed_ratio(2028, d("2028-12-31")) - 1.0).abs() < 1e-9);
    }
}
