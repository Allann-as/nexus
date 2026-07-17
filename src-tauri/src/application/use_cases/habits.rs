//! Casos de uso de Hábitos e Rotinas.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AreaRepository, Clock, Habit, HabitRepository, IdGen, NewHabitDetails, NewNode, NodeRepository,
    Tick,
};
use crate::domain::entities::{validate_title, Kind};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day, weekday_label, Schedule};
use crate::domain::streak::{self, Streaks, TickStatus, Ticks};

/// Um hábito com tudo que a tela de detalhe precisa.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitWithStats {
    #[serde(flatten)]
    pub habit: Habit,
    pub streaks: Streaks,
    /// Status de hoje, se já marcado.
    pub today: Option<TickStatus>,
    pub today_value: Option<f64>,
}

/// Uma célula do heatmap anual.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapCell {
    pub day: String,
    pub status: Option<TickStatus>,
    pub value: Option<f64>,
    pub scheduled: bool,
}

/// Taxa de falha por dia da semana — os "ofensores".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekdayStat {
    pub weekday: u8,
    pub label: String,
    pub done: u32,
    pub total: u32,
    pub failure_rate: f64,
}

pub struct HabitService {
    pub habits: Arc<dyn HabitRepository>,
    pub nodes: Arc<dyn NodeRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl HabitService {
    /// Cria um hábito: o node e o satélite, na mesma transação lógica.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        title: &str,
        area_id: Option<&str>,
        schedule: Schedule,
        target_value: Option<f64>,
        unit: Option<String>,
        routine_id: Option<String>,
        reminder_time: Option<String>,
    ) -> Result<Habit> {
        let title = validate_title(title)?;
        schedule.validate()?;

        if let Some(aid) = area_id {
            if !self.areas.exists(aid)? {
                return Err(NexusError::NotFound(format!("área {aid} não existe")));
            }
        }
        if let Some(rid) = &routine_id {
            let routine = self.nodes.get(rid)?;
            if routine.kind != Kind::Routine {
                return Err(NexusError::Validation(
                    "um hábito só pode pertencer a uma rotina".into(),
                ));
            }
        }
        if let Some(t) = &reminder_time {
            validate_time(t)?;
        }

        let id = self.ids.new_id();
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: Kind::Habit.into(),
            event_type: EventType::Created,
            payload: json!({ "schedule": schedule.to_json() }),
            title_snapshot: title.clone(),
        };

        self.nodes.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Habit,
                title,
                area_id: area_id.map(str::to_string),
                parent_id: None,
            },
            &event,
        )?;

        self.habits.create_details(
            &id,
            &NewHabitDetails {
                schedule,
                target_value,
                unit,
                routine_id,
                reminder_time,
            },
        )?;

        self.habits.get(&id)
    }

    pub fn create_routine(&self, title: &str, area_id: Option<&str>) -> Result<String> {
        let title = validate_title(title)?;
        let id = self.ids.new_id();
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: Kind::Routine.into(),
            event_type: EventType::Created,
            payload: json!({}),
            title_snapshot: title.clone(),
        };
        self.nodes.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Routine,
                title,
                area_id: area_id.map(str::to_string),
                parent_id: None,
            },
            &event,
        )?;
        Ok(id)
    }

    pub fn list(&self, area_id: Option<&str>) -> Result<Vec<Habit>> {
        self.habits.list(area_id, false)
    }

    /// Marca um hábito num dia.
    ///
    /// Idempotente por (habit_id, day): remarcar sobrescreve o status em vez de
    /// duplicar. A PK da tabela garante isso, mas o ledger registra **cada**
    /// marcação — o estado atual é o último, a história é toda.
    pub fn tick(
        &self,
        habit_id: &str,
        day: Option<&str>,
        status: TickStatus,
        value: Option<f64>,
    ) -> Result<Streaks> {
        let habit = self.habits.get(habit_id)?;
        let day = self.resolve_day(day)?;

        if let Some(v) = value {
            if !v.is_finite() || v < 0.0 {
                return Err(NexusError::Validation(format!(
                    "valor inválido para um hábito quantitativo: {v}"
                )));
            }
        }

        let ts = self.clock.now_ms();
        let event_type = match status {
            TickStatus::Done if value.is_some() => EventType::ValueRecorded,
            TickStatus::Done => EventType::Checked,
            TickStatus::Skipped => EventType::Skipped,
            TickStatus::Failed => EventType::StatusChanged,
        };

        let event = NewLedgerEvent {
            ts,
            day: day.clone(),
            entity_id: habit_id.to_string(),
            entity_kind: Kind::Habit.into(),
            event_type,
            payload: json!({ "status": status.as_str(), "value": value, "day": day }),
            title_snapshot: habit.title.clone(),
        };

        self.habits
            .tick_with_event(habit_id, &day, Tick { status, value }, ts, &event)?;

        self.streaks(habit_id)
    }

    pub fn untick(&self, habit_id: &str, day: Option<&str>) -> Result<Streaks> {
        let habit = self.habits.get(habit_id)?;
        let day = self.resolve_day(day)?;

        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: day.clone(),
            entity_id: habit_id.to_string(),
            entity_kind: Kind::Habit.into(),
            // Desmarcar é a correção de um clique errado, não um fato novo na
            // vida do usuário. Mas a história registra que houve a correção.
            event_type: EventType::StatusChanged,
            payload: json!({ "unticked": true, "day": day }),
            title_snapshot: habit.title.clone(),
        };

        self.habits.untick_with_event(habit_id, &day, &event)?;
        self.streaks(habit_id)
    }

    /// Conclui uma rotina inteira: marca todos os hábitos dela em cascata.
    ///
    /// N ticks + N eventos numa **única** transação. Metade de uma rotina
    /// marcada seria pior que nenhuma: o usuário confiaria num número errado.
    pub fn complete_routine(&self, routine_id: &str, day: Option<&str>) -> Result<u32> {
        let routine = self.nodes.get(routine_id)?;
        if routine.kind != Kind::Routine {
            return Err(NexusError::Validation(format!(
                "'{}' não é uma rotina",
                routine.title
            )));
        }

        let day = self.resolve_day(day)?;
        let members = self.habits.list_in_routine(routine_id)?;
        if members.is_empty() {
            return Err(NexusError::Validation(format!(
                "a rotina '{}' não tem hábitos",
                routine.title
            )));
        }

        let ts = self.clock.now_ms();
        let events: Vec<(String, NewLedgerEvent)> = members
            .iter()
            .map(|h| {
                (
                    h.id.clone(),
                    NewLedgerEvent {
                        ts,
                        day: day.clone(),
                        entity_id: h.id.clone(),
                        entity_kind: Kind::Habit.into(),
                        event_type: EventType::Checked,
                        payload: json!({
                            "status": "done",
                            "day": day,
                            "via_routine": routine_id,
                        }),
                        title_snapshot: h.title.clone(),
                    },
                )
            })
            .collect();

        self.habits.complete_routine(routine_id, &day, ts, &events)
    }

    /// Sequência atual e recorde.
    ///
    /// Janela de 2 anos: um streak de 700+ dias é irrelevante na prática, e ler
    /// 30 anos de ticks a cada clique num hábito seria caro. `WITHOUT ROWID`
    /// torna esse range scan sequencial.
    pub fn streaks(&self, habit_id: &str) -> Result<Streaks> {
        let habit = self.habits.get(habit_id)?;
        let today = parse_day(&self.clock.today_local())?;
        let from = today - chrono::Duration::days(730);

        let rows = self
            .habits
            .ticks_in_range(habit_id, &format_day(from), &format_day(today))?;

        let ticks: Ticks = rows
            .into_iter()
            .filter_map(|(day, tick)| parse_day(&day).ok().map(|d| (d, tick.status)))
            .collect();

        Ok(streak::compute(&habit.schedule, &ticks, today))
    }

    /// Os hábitos agendados para hoje, já com streaks e o status do dia.
    ///
    /// Uma query para os hábitos + uma para os ticks do dia — não N+1. É a tela
    /// mais aberta do app; ela não pode fazer uma query por hábito.
    pub fn today(&self) -> Result<Vec<HabitWithStats>> {
        let today_str = self.clock.today_local();
        let today = parse_day(&today_str)?;

        let habits = self.habits.list(None, false)?;
        let ticks_today: BTreeMap<String, Tick> =
            self.habits.ticks_on_day(&today_str)?.into_iter().collect();

        let mut out = Vec::new();
        for habit in habits {
            if !habit.schedule.is_scheduled_on(today) {
                continue;
            }
            let tick = ticks_today.get(&habit.id);
            let streaks = self.streaks(&habit.id)?;
            out.push(HabitWithStats {
                today: tick.map(|t| t.status),
                today_value: tick.and_then(|t| t.value),
                streaks,
                habit,
            });
        }
        Ok(out)
    }

    /// O heatmap anual: 365 células.
    pub fn heatmap(&self, habit_id: &str, days: i64) -> Result<Vec<HeatmapCell>> {
        let habit = self.habits.get(habit_id)?;
        let today = parse_day(&self.clock.today_local())?;
        let from = today - chrono::Duration::days(days.clamp(1, 730) - 1);

        let ticks: BTreeMap<String, Tick> = self
            .habits
            .ticks_in_range(habit_id, &format_day(from), &format_day(today))?
            .into_iter()
            .collect();

        let mut cells = Vec::new();
        let mut d = from;
        while d <= today {
            let key = format_day(d);
            let tick = ticks.get(&key);
            cells.push(HeatmapCell {
                status: tick.map(|t| t.status),
                value: tick.and_then(|t| t.value),
                scheduled: habit.schedule.is_scheduled_on(d),
                day: key,
            });
            d += chrono::Duration::days(1);
        }
        Ok(cells)
    }

    /// Ofensores: taxa de falha por dia da semana.
    pub fn weekday_stats(&self, habit_id: &str, days: i64) -> Result<Vec<WeekdayStat>> {
        let today = parse_day(&self.clock.today_local())?;
        let since = format_day(today - chrono::Duration::days(days.clamp(1, 730)));

        Ok(self
            .habits
            .failure_rate_by_weekday(habit_id, &since)?
            .into_iter()
            .map(|(weekday, done, total)| WeekdayStat {
                weekday,
                label: weekday_label(weekday).to_string(),
                done,
                total,
                failure_rate: if total == 0 {
                    0.0
                } else {
                    f64::from(total - done) / f64::from(total)
                },
            })
            .collect())
    }

    pub fn set_schedule(&self, habit_id: &str, schedule: Schedule) -> Result<()> {
        schedule.validate()?;
        self.habits.update_schedule(habit_id, &schedule)
    }

    /// Aceita um dia explícito (marcar ontem) ou usa hoje.
    ///
    /// O futuro é recusado: marcar amanhã como feito não é um dado, é um erro —
    /// e envenenaria streaks e score em silêncio.
    fn resolve_day(&self, day: Option<&str>) -> Result<String> {
        match day {
            None => Ok(self.clock.today_local()),
            Some(d) => {
                let parsed = parse_day(d)?;
                let today = parse_day(&self.clock.today_local())?;
                if parsed > today {
                    return Err(NexusError::Validation(
                        "não dá para marcar um hábito no futuro".into(),
                    ));
                }
                Ok(format_day(parsed))
            }
        }
    }
}

/// "HH:MM" em 24h.
fn validate_time(s: &str) -> Result<()> {
    let bad = || NexusError::Validation(format!("horário inválido: {s} (esperado HH:MM)"));
    let (h, m) = s.split_once(':').ok_or_else(bad)?;
    let (h, m): (u32, u32) = (h.parse().map_err(|_| bad())?, m.parse().map_err(|_| bad())?);
    if h > 23 || m > 59 {
        return Err(bad());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reminder_times_are_validated() {
        assert!(validate_time("07:30").is_ok());
        assert!(validate_time("00:00").is_ok());
        assert!(validate_time("23:59").is_ok());
        assert!(validate_time("24:00").is_err(), "hora fora do relógio");
        assert!(validate_time("07:60").is_err(), "minuto fora do relógio");
        assert!(validate_time("7h30").is_err());
        assert!(validate_time("").is_err());
    }
}
