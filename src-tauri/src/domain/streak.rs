//! Cálculo de streaks — sequência atual e recorde.
//!
//! Função pura sobre (agendamento, ticks, hoje). Sem banco, sem relógio: é o
//! que permite testar "o que acontece na virada do ano" sem esperar dezembro.
//!
//! As regras, todas deliberadas:
//!
//!   * **Dia não agendado não quebra streak.** Um hábito de segunda/quarta/sexta
//!     não é "perdido" no domingo. Sem isso, todo hábito que não é diário teria
//!     streak permanentemente 1 — e o número perderia o sentido.
//!   * **`skipped` é neutro.** É a folga assumida: não conta e não quebra.
//!     `failed` é que quebra — a diferença entre decidir não fazer e falhar.
//!   * **Hoje sem tick não quebra.** O dia não acabou. Sem essa carência, todo
//!     usuário abriria o app de manhã e veria seu streak zerado.
//!   * **`TimesPerWeek` conta por SEMANA.** "3x por semana" não tem dia certo;
//!     medir por dia produziria streak 1 sempre. A unidade é a semana que
//!     atingiu a meta, e a semana corrente ainda em curso também tem carência.

use std::collections::BTreeMap;

use chrono::{Duration, NaiveDate};
use serde::Serialize;

use crate::domain::schedule::{week_start, Schedule};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TickStatus {
    Done,
    Skipped,
    Failed,
}

impl TickStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TickStatus::Done => "done",
            TickStatus::Skipped => "skipped",
            TickStatus::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "done" => Some(TickStatus::Done),
            "skipped" => Some(TickStatus::Skipped),
            "failed" => Some(TickStatus::Failed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Streaks {
    /// Sequência em curso, contando para trás a partir de hoje.
    pub current: u32,
    /// Melhor sequência de toda a história.
    pub record: u32,
    /// `true` quando `current` é o melhor já alcançado — a UI comemora isso.
    pub is_record: bool,
}

pub type Ticks = BTreeMap<NaiveDate, TickStatus>;

/// Calcula sequência atual e recorde.
pub fn compute(schedule: &Schedule, ticks: &Ticks, today: NaiveDate) -> Streaks {
    if ticks.is_empty() {
        return Streaks::default();
    }
    if schedule.is_weekly() {
        weekly(schedule, ticks, today)
    } else {
        daily(schedule, ticks, today)
    }
}

/// Streak por dia (Daily / Weekdays).
fn daily(schedule: &Schedule, ticks: &Ticks, today: NaiveDate) -> Streaks {
    // Limite da varredura: nada anterior ao primeiro tick importa.
    let earliest = *ticks.keys().next().expect("ticks não vazio");

    // ===== atual: para trás a partir de hoje =====
    let mut current: u32 = 0;
    let mut day = today;
    while day >= earliest {
        if !schedule.is_scheduled_on(day) {
            // Dia não agendado: nem conta, nem quebra. Só não existe.
            day -= Duration::days(1);
            continue;
        }
        match ticks.get(&day) {
            Some(TickStatus::Done) => current += 1,
            Some(TickStatus::Skipped) => {} // folga assumida: neutro
            Some(TickStatus::Failed) => break,
            None => {
                // Hoje ainda não acabou; um dia passado sem tick é falta.
                if day != today {
                    break;
                }
            }
        }
        day -= Duration::days(1);
    }

    // ===== recorde: para frente, do primeiro tick até hoje =====
    let mut record: u32 = 0;
    let mut run: u32 = 0;
    let mut d = earliest;
    while d <= today {
        if !schedule.is_scheduled_on(d) {
            d += Duration::days(1);
            continue;
        }
        match ticks.get(&d) {
            Some(TickStatus::Done) => {
                run += 1;
                record = record.max(run);
            }
            Some(TickStatus::Skipped) => {}
            Some(TickStatus::Failed) => run = 0,
            None => {
                if d != today {
                    run = 0;
                }
            }
        }
        d += Duration::days(1);
    }

    finish(current, record)
}

/// Streak por semana (TimesPerWeek).
fn weekly(schedule: &Schedule, ticks: &Ticks, today: NaiveDate) -> Streaks {
    let Schedule::TimesPerWeek { n } = schedule else {
        return Streaks::default();
    };
    let target = u32::from(*n);

    // Quantos 'done' em cada semana. `skipped`/`failed` não contam para a meta:
    // a pergunta é "fez n vezes?", e só fazer conta.
    let mut per_week: BTreeMap<NaiveDate, u32> = BTreeMap::new();
    for (day, status) in ticks {
        if *status == TickStatus::Done {
            *per_week.entry(week_start(*day)).or_insert(0) += 1;
        }
    }

    let this_week = week_start(today);
    let earliest_week = ticks
        .keys()
        .next()
        .map(|d| week_start(*d))
        .unwrap_or(this_week);

    // ===== atual: para trás a partir da semana corrente =====
    let mut current: u32 = 0;
    let mut w = this_week;
    while w >= earliest_week {
        let hit = per_week.get(&w).copied().unwrap_or(0) >= target;
        if hit {
            current += 1;
        } else if w == this_week {
            // A semana corrente ainda está em curso: não conta, mas também não
            // quebra. Sem isso, o streak zeraria toda segunda-feira de manhã.
        } else {
            break;
        }
        w -= Duration::weeks(1);
    }

    // ===== recorde: para frente =====
    let mut record: u32 = 0;
    let mut run: u32 = 0;
    let mut w = earliest_week;
    while w <= this_week {
        let hit = per_week.get(&w).copied().unwrap_or(0) >= target;
        if hit {
            run += 1;
            record = record.max(run);
        } else if w != this_week {
            run = 0;
        }
        w += Duration::weeks(1);
    }

    finish(current, record)
}

fn finish(current: u32, record: u32) -> Streaks {
    let record = record.max(current);
    Streaks {
        current,
        record,
        is_record: current > 0 && current == record,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::schedule::parse_day;

    fn d(s: &str) -> NaiveDate {
        parse_day(s).unwrap()
    }

    fn ticks(entries: &[(&str, TickStatus)]) -> Ticks {
        entries.iter().map(|(day, s)| (d(day), *s)).collect()
    }

    // ===== A regra que o documento exige explicitamente =====

    #[test]
    fn an_unscheduled_day_does_not_break_the_streak() {
        // Segunda/quarta/sexta. Fez seg 13, qua 15, sex 17. Sábado e domingo
        // não são agendados — não podem quebrar nada.
        let schedule = Schedule::Weekdays {
            days: vec![1, 3, 5],
        };
        let t = ticks(&[
            ("2026-07-13", TickStatus::Done),
            ("2026-07-15", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
        ]);

        // Consultando no domingo 19: o fim de semana inteiro passou sem tick.
        let s = compute(&schedule, &t, d("2026-07-19"));
        assert_eq!(s.current, 3, "sáb/dom não são agendados; a sequência segue");
        assert_eq!(s.record, 3);
    }

    #[test]
    fn missing_a_scheduled_day_does_break_the_streak() {
        // Mesma agenda, mas a quarta foi pulada sem registro.
        let schedule = Schedule::Weekdays {
            days: vec![1, 3, 5],
        };
        let t = ticks(&[
            ("2026-07-13", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
        ]);

        let s = compute(&schedule, &t, d("2026-07-17"));
        assert_eq!(s.current, 1, "a quarta agendada ficou sem tick: quebrou");
    }

    // ===== Carência de hoje =====

    #[test]
    fn today_without_a_tick_does_not_break_the_streak() {
        // Sem isto, abrir o app de manhã zeraria o streak de todo mundo.
        let t = ticks(&[
            ("2026-07-15", TickStatus::Done),
            ("2026-07-16", TickStatus::Done),
        ]);
        let s = compute(&Schedule::Daily, &t, d("2026-07-17"));
        assert_eq!(s.current, 2, "hoje ainda não acabou");
    }

    #[test]
    fn doing_it_today_extends_the_streak() {
        let t = ticks(&[
            ("2026-07-15", TickStatus::Done),
            ("2026-07-16", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
        ]);
        let s = compute(&Schedule::Daily, &t, d("2026-07-17"));
        assert_eq!(s.current, 3);
        assert!(s.is_record);
    }

    #[test]
    fn yesterday_missed_breaks_even_with_todays_grace() {
        let t = ticks(&[("2026-07-14", TickStatus::Done)]);
        let s = compute(&Schedule::Daily, &t, d("2026-07-17"));
        assert_eq!(s.current, 0, "15 e 16 ficaram sem tick");
        assert_eq!(s.record, 1);
    }

    // ===== skipped vs failed =====

    #[test]
    fn skipped_is_neutral_but_failed_breaks() {
        // A folga assumida não conta e não quebra.
        let t = ticks(&[
            ("2026-07-14", TickStatus::Done),
            ("2026-07-15", TickStatus::Skipped),
            ("2026-07-16", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
        ]);
        let s = compute(&Schedule::Daily, &t, d("2026-07-17"));
        assert_eq!(s.current, 3, "skipped não conta nem quebra");

        // Já falhar, quebra.
        let t2 = ticks(&[
            ("2026-07-14", TickStatus::Done),
            ("2026-07-15", TickStatus::Failed),
            ("2026-07-16", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
        ]);
        let s2 = compute(&Schedule::Daily, &t2, d("2026-07-17"));
        assert_eq!(s2.current, 2, "failed quebra a sequência");
    }

    // ===== Recorde =====

    #[test]
    fn record_remembers_the_best_run_even_after_it_breaks() {
        let t = ticks(&[
            // Sequência de 4…
            ("2026-07-01", TickStatus::Done),
            ("2026-07-02", TickStatus::Done),
            ("2026-07-03", TickStatus::Done),
            ("2026-07-04", TickStatus::Done),
            // …quebrada (05 e 06 sem tick)…
            // …e uma nova de 2.
            ("2026-07-07", TickStatus::Done),
            ("2026-07-08", TickStatus::Done),
        ]);
        let s = compute(&Schedule::Daily, &t, d("2026-07-08"));
        assert_eq!(s.current, 2);
        assert_eq!(s.record, 4, "o recorde não some quando a sequência quebra");
        assert!(!s.is_record);
    }

    #[test]
    fn record_is_never_below_current() {
        let t = ticks(&[
            ("2026-07-16", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
        ]);
        let s = compute(&Schedule::Daily, &t, d("2026-07-17"));
        assert_eq!(s.current, 2);
        assert_eq!(s.record, 2);
        assert!(s.is_record);
    }

    #[test]
    fn no_ticks_means_no_streak() {
        let s = compute(&Schedule::Daily, &Ticks::new(), d("2026-07-17"));
        assert_eq!(s, Streaks::default());
        assert!(!s.is_record, "zero não é recorde");
    }

    // ===== TimesPerWeek: streak semanal =====

    #[test]
    fn times_per_week_counts_weeks_not_days() {
        // 3x/semana. Semana de 06/07 e semana de 13/07, ambas com 3.
        let schedule = Schedule::TimesPerWeek { n: 3 };
        let t = ticks(&[
            ("2026-07-06", TickStatus::Done),
            ("2026-07-08", TickStatus::Done),
            ("2026-07-10", TickStatus::Done),
            ("2026-07-13", TickStatus::Done),
            ("2026-07-15", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
        ]);
        let s = compute(&schedule, &t, d("2026-07-17"));
        assert_eq!(s.current, 2, "duas semanas batendo a meta");
        assert_eq!(s.record, 2);
    }

    #[test]
    fn times_per_week_breaks_on_a_week_below_target() {
        let schedule = Schedule::TimesPerWeek { n: 3 };
        let t = ticks(&[
            // Semana de 29/06: 3 (meta batida)
            ("2026-06-29", TickStatus::Done),
            ("2026-07-01", TickStatus::Done),
            ("2026-07-03", TickStatus::Done),
            // Semana de 06/07: só 1 (falhou)
            ("2026-07-06", TickStatus::Done),
            // Semana de 13/07: 3 (bateu)
            ("2026-07-13", TickStatus::Done),
            ("2026-07-15", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
        ]);
        let s = compute(&schedule, &t, d("2026-07-17"));
        assert_eq!(s.current, 1, "a semana fraca quebrou a sequência");
        assert_eq!(s.record, 1);
    }

    #[test]
    fn the_current_week_in_progress_does_not_break_the_streak() {
        // Semana passada bateu; a atual só tem 1 de 3 — mas ainda é terça.
        let schedule = Schedule::TimesPerWeek { n: 3 };
        let t = ticks(&[
            ("2026-07-06", TickStatus::Done),
            ("2026-07-08", TickStatus::Done),
            ("2026-07-10", TickStatus::Done),
            ("2026-07-14", TickStatus::Done),
        ]);
        let s = compute(&schedule, &t, d("2026-07-14"));
        assert_eq!(
            s.current, 1,
            "a semana em curso não conta ainda, mas não pode zerar o passado"
        );
    }

    #[test]
    fn times_per_week_ignores_skipped_towards_the_target() {
        // A meta é fazer n vezes; só 'done' conta para ela.
        let schedule = Schedule::TimesPerWeek { n: 2 };
        let t = ticks(&[
            ("2026-07-13", TickStatus::Done),
            ("2026-07-14", TickStatus::Skipped),
            ("2026-07-15", TickStatus::Done),
        ]);
        let s = compute(&schedule, &t, d("2026-07-19"));
        assert_eq!(
            s.current, 1,
            "2 'done' bateram a meta; o 'skipped' é ignorado"
        );
    }

    // ===== Fronteiras =====

    #[test]
    fn streaks_cross_month_and_year_boundaries() {
        let t = ticks(&[
            ("2025-12-30", TickStatus::Done),
            ("2025-12-31", TickStatus::Done),
            ("2026-01-01", TickStatus::Done),
            ("2026-01-02", TickStatus::Done),
        ]);
        let s = compute(&Schedule::Daily, &t, d("2026-01-02"));
        assert_eq!(
            s.current, 4,
            "a virada do ano não é um evento para o streak"
        );
    }

    #[test]
    fn a_single_tick_today_is_a_streak_of_one() {
        let t = ticks(&[("2026-07-17", TickStatus::Done)]);
        let s = compute(&Schedule::Daily, &t, d("2026-07-17"));
        assert_eq!(s.current, 1);
        assert!(s.is_record);
    }

    #[test]
    fn future_ticks_do_not_inflate_the_current_streak() {
        // Não deve acontecer, mas um relógio mexido ou um import podem criar.
        // A sequência é contada a partir de HOJE, para trás.
        let t = ticks(&[
            ("2026-07-17", TickStatus::Done),
            ("2026-07-18", TickStatus::Done),
            ("2026-07-19", TickStatus::Done),
        ]);
        let s = compute(&Schedule::Daily, &t, d("2026-07-17"));
        assert_eq!(s.current, 1, "o futuro não conta para a sequência de hoje");
    }
}
