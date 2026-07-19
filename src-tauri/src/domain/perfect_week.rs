//! Semana perfeita — a semana em que 100% do que estava agendado foi CUMPRIDO.
//!
//! Função pura sobre (agendamento, ticks, janela da semana). Sem banco, sem
//! relógio — testável na virada do ano sem esperar dezembro, como o `streak`.
//!
//! As regras, deliberadas e **sem abono**:
//!
//!   * **Só `done` conta.** `skipped` NÃO abona: pular é não cumprir. `failed` e
//!     um dia agendado sem tick também quebram. A semana perfeita é exigente por
//!     definição — é o que a torna rara e valiosa.
//!   * **Um hábito por-dia (Daily/Weekdays)** exige que TODO dia agendado da
//!     semana tenha `done`. Um hábito por-semana (`TimesPerWeek n`) exige `n`
//!     `done` na semana — a mesma unidade do streak semanal.
//!   * **Antes do primeiro tick, o hábito não existe para a semana.** Uma semana
//!     anterior ao início do rastreio do hábito não é "quebrada" por ele — é como
//!     o dia não agendado do streak. Sem isso, todo hábito novo tornaria todo o
//!     passado imperfeito.
//!   * **Semana vazia é NEUTRA.** Uma semana sem nenhum hábito aplicável não é
//!     perfeita nem quebrada: ela não conta e não zera a sequência.

use chrono::{Duration, NaiveDate};
use serde::Serialize;

use crate::domain::schedule::{week_start, Schedule};
use crate::domain::streak::{TickStatus, Ticks};

/// O desfecho de UM hábito numa semana.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HabitWeek {
    /// O hábito não estava sendo rastreado nesta semana (ou nada agendado).
    NotApplicable,
    /// Tudo que devia ser cumprido, foi.
    Satisfied,
    /// Faltou pelo menos um.
    Broken,
}

/// O estado de uma semana no calendário anual.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WeekStatus {
    /// Nenhum hábito aplicável — neutra.
    Empty,
    /// 100% do agendado cumprido.
    Perfect,
    /// Faltou algo.
    Broken,
}

/// Um hábito e seus dados para o cálculo de uma semana.
pub struct HabitInput<'a> {
    pub schedule: &'a Schedule,
    pub ticks: &'a Ticks,
    /// O dia do primeiro tick de sempre — o hábito não existe para semanas antes
    /// disto. `None` = nunca teve tick (não aplicável a semana nenhuma).
    pub earliest: Option<NaiveDate>,
}

/// O desfecho de um hábito numa semana COMPLETA (`week_start`..`week_start+6`).
fn outcome(h: &HabitInput, ws: NaiveDate, we: NaiveDate) -> HabitWeek {
    let Some(earliest) = h.earliest else {
        return HabitWeek::NotApplicable;
    };
    if earliest > we {
        return HabitWeek::NotApplicable; // começou depois desta semana
    }

    match h.schedule {
        Schedule::TimesPerWeek { n } => {
            // A meta semanal só vale a partir da semana em que o rastreio começou
            // por inteiro; uma primeira semana parcial não é cobrada.
            if earliest > ws {
                return HabitWeek::NotApplicable;
            }
            let done = count_done(h.ticks, ws, we);
            if done >= u32::from(*n) {
                HabitWeek::Satisfied
            } else {
                HabitWeek::Broken
            }
        }
        _ => {
            // Daily / Weekdays: cada dia agendado (a partir do início do rastreio)
            // tem que ter `done`.
            let mut applicable = false;
            let mut day = ws.max(earliest);
            while day <= we {
                if h.schedule.is_scheduled_on(day) {
                    applicable = true;
                    if h.ticks.get(&day) != Some(&TickStatus::Done) {
                        return HabitWeek::Broken;
                    }
                }
                day += Duration::days(1);
            }
            if applicable {
                HabitWeek::Satisfied
            } else {
                HabitWeek::NotApplicable
            }
        }
    }
}

fn count_done(ticks: &Ticks, from: NaiveDate, to: NaiveDate) -> u32 {
    ticks
        .range(from..=to)
        .filter(|(_, s)| **s == TickStatus::Done)
        .count() as u32
}

/// O estado de uma semana COMPLETA a partir dos hábitos.
pub fn week_status(habits: &[HabitInput], ws: NaiveDate) -> WeekStatus {
    let we = ws + Duration::days(6);
    let mut any_satisfied = false;
    for h in habits {
        match outcome(h, ws, we) {
            HabitWeek::Broken => return WeekStatus::Broken,
            HabitWeek::Satisfied => any_satisfied = true,
            HabitWeek::NotApplicable => {}
        }
    }
    if any_satisfied {
        WeekStatus::Perfect
    } else {
        WeekStatus::Empty
    }
}

/// A sequência de semanas perfeitas: atual (contando para trás da última semana
/// COMPLETA) e recorde. `Empty` é neutra (nem conta, nem quebra) — como o dia não
/// agendado do streak.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerfectStreak {
    pub current: u32,
    pub record: u32,
    /// Total de semanas perfeitas em toda a história.
    pub total: u32,
}

/// Percorre as semanas COMPLETAS de `first_week` até `last_complete_week`
/// (inclusive), computando cada estado por `status_of`. Genérico para não
/// duplicar a varredura entre "o ano" e "a história".
pub fn streak_from_statuses(statuses: &[WeekStatus]) -> PerfectStreak {
    let mut total = 0;
    let mut record = 0;
    let mut run = 0;
    for s in statuses {
        match s {
            WeekStatus::Perfect => {
                total += 1;
                run += 1;
                record = record.max(run);
            }
            WeekStatus::Broken => run = 0,
            WeekStatus::Empty => {} // neutra
        }
    }
    // A atual: para trás, do fim, parando na primeira Broken.
    let mut current = 0;
    for s in statuses.iter().rev() {
        match s {
            WeekStatus::Perfect => current += 1,
            WeekStatus::Broken => break,
            WeekStatus::Empty => {}
        }
    }
    PerfectStreak {
        current,
        record: record.max(current),
        total,
    }
}

/// A lista das segundas-feiras das semanas COMPLETAS de um intervalo [de, ate].
/// `ate` é o último dia já vivido (hoje); a semana corrente (incompleta) fica de
/// fora — uma semana só pode ser julgada quando termina.
pub fn complete_weeks(from: NaiveDate, through: NaiveDate) -> Vec<NaiveDate> {
    let mut out = Vec::new();
    let mut w = week_start(from);
    // Só as semanas cujo domingo (w+6) já passou por `through`.
    while w + Duration::days(6) <= through {
        out.push(w);
        w += Duration::weeks(1);
    }
    out
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

    // A semana de referência: 2026-07-13 (seg) a 2026-07-19 (dom).
    const WS: &str = "2026-07-13";

    #[test]
    fn a_weekdays_habit_all_done_is_perfect() {
        let sched = Schedule::Weekdays {
            days: vec![1, 3, 5],
        }; // seg/qua/sex
        let t = ticks(&[
            ("2026-07-13", TickStatus::Done),
            ("2026-07-15", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
        ]);
        let h = HabitInput {
            schedule: &sched,
            ticks: &t,
            earliest: Some(d("2026-07-13")),
        };
        assert_eq!(week_status(&[h], d(WS)), WeekStatus::Perfect);
    }

    #[test]
    fn a_skipped_day_breaks_the_perfect_week_no_abono() {
        let sched = Schedule::Weekdays {
            days: vec![1, 3, 5],
        };
        let t = ticks(&[
            ("2026-07-13", TickStatus::Done),
            ("2026-07-15", TickStatus::Skipped), // pular NÃO abona
            ("2026-07-17", TickStatus::Done),
        ]);
        let h = HabitInput {
            schedule: &sched,
            ticks: &t,
            earliest: Some(d("2026-07-13")),
        };
        assert_eq!(week_status(&[h], d(WS)), WeekStatus::Broken);
    }

    #[test]
    fn a_missing_scheduled_day_breaks_it() {
        let sched = Schedule::Weekdays {
            days: vec![1, 3, 5],
        };
        let t = ticks(&[
            ("2026-07-13", TickStatus::Done),
            ("2026-07-17", TickStatus::Done), // faltou a quarta
        ]);
        let h = HabitInput {
            schedule: &sched,
            ticks: &t,
            earliest: Some(d("2026-07-13")),
        };
        assert_eq!(week_status(&[h], d(WS)), WeekStatus::Broken);
    }

    #[test]
    fn times_per_week_needs_n_done() {
        let sched = Schedule::TimesPerWeek { n: 3 };
        let two = ticks(&[
            ("2026-07-13", TickStatus::Done),
            ("2026-07-15", TickStatus::Done),
        ]);
        let three = ticks(&[
            ("2026-07-13", TickStatus::Done),
            ("2026-07-15", TickStatus::Done),
            ("2026-07-18", TickStatus::Done),
        ]);
        let e = Some(d("2026-07-01"));
        assert_eq!(
            week_status(
                &[HabitInput {
                    schedule: &sched,
                    ticks: &two,
                    earliest: e
                }],
                d(WS)
            ),
            WeekStatus::Broken
        );
        assert_eq!(
            week_status(
                &[HabitInput {
                    schedule: &sched,
                    ticks: &three,
                    earliest: e
                }],
                d(WS)
            ),
            WeekStatus::Perfect
        );
    }

    #[test]
    fn a_habit_not_yet_tracked_does_not_break_the_week() {
        let sched = Schedule::Daily;
        let t = ticks(&[("2026-07-20", TickStatus::Done)]); // começa DEPOIS da semana
        let h = HabitInput {
            schedule: &sched,
            ticks: &t,
            earliest: Some(d("2026-07-20")),
        };
        // Nenhum hábito aplicável → vazia, não quebrada.
        assert_eq!(week_status(&[h], d(WS)), WeekStatus::Empty);
    }

    #[test]
    fn one_broken_habit_breaks_the_whole_week() {
        let daily = Schedule::Daily;
        let good = ticks(&[
            ("2026-07-13", TickStatus::Done),
            ("2026-07-14", TickStatus::Done),
            ("2026-07-15", TickStatus::Done),
            ("2026-07-16", TickStatus::Done),
            ("2026-07-17", TickStatus::Done),
            ("2026-07-18", TickStatus::Done),
            ("2026-07-19", TickStatus::Done),
        ]);
        let bad = ticks(&[("2026-07-13", TickStatus::Done)]); // faltou o resto
        let e = Some(d("2026-07-01"));
        let status = week_status(
            &[
                HabitInput {
                    schedule: &daily,
                    ticks: &good,
                    earliest: e,
                },
                HabitInput {
                    schedule: &daily,
                    ticks: &bad,
                    earliest: e,
                },
            ],
            d(WS),
        );
        assert_eq!(
            status,
            WeekStatus::Broken,
            "um hábito falho reprova a semana"
        );
    }

    #[test]
    fn streak_counts_perfect_and_neutral_empty() {
        use WeekStatus::*;
        // P P Broken P Empty P  → recorde 2, atual 2 (a Empty do fim é neutra),
        // total 4.
        let s = streak_from_statuses(&[Perfect, Perfect, Broken, Perfect, Empty, Perfect]);
        assert_eq!(s.total, 4);
        assert_eq!(s.record, 2);
        assert_eq!(
            s.current, 2,
            "empty do fim é neutra; conta as duas perfeitas"
        );
    }

    #[test]
    fn a_broken_at_the_end_zeroes_the_current_streak() {
        use WeekStatus::*;
        let s = streak_from_statuses(&[Perfect, Perfect, Broken]);
        assert_eq!(s.current, 0);
        assert_eq!(s.record, 2);
    }

    #[test]
    fn complete_weeks_excludes_the_in_progress_week() {
        // Hoje é quinta 2026-07-16: a semana de 13/07 ainda não terminou.
        let weeks = complete_weeks(d("2026-06-01"), d("2026-07-16"));
        assert!(
            !weeks.contains(&d("2026-07-13")),
            "a semana corrente (incompleta) fica de fora"
        );
        assert!(
            weeks.contains(&d("2026-07-06")),
            "a de 06/07 terminou no dia 12"
        );
    }
}
