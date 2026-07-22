//! Agendamento de hábitos.
//!
//! Puro: `chrono::NaiveDate` é um tipo-valor de data, não infraestrutura. Quem
//! diz "que dia é hoje" continua sendo o port `Clock`.

use chrono::{Datelike, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};

use crate::domain::errors::{NexusError, Result};

/// Quando um hábito é esperado.
///
/// Serializado em `habit_details.schedule_json`. O `tag` fica explícito no JSON
/// para que a coluna seja legível por um humano em 2056 sem este código.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Schedule {
    /// Todo dia.
    Daily,
    /// Só nos dias da semana listados. 0 = domingo … 6 = sábado, igual ao
    /// `strftime('%w')` do SQLite — assim o BI agrupa por dia da semana sem
    /// precisar traduzir nada.
    Weekdays { days: Vec<u8> },
    /// N vezes por semana, sem dia fixo.
    TimesPerWeek { n: u8 },
}

impl Schedule {
    pub fn parse_json(s: &str) -> Result<Self> {
        let parsed: Schedule = serde_json::from_str(s)
            .map_err(|e| NexusError::Validation(format!("schedule_json inválido: {e}")))?;
        parsed.validate()?;
        Ok(parsed)
    }

    pub fn to_json(&self) -> String {
        // Um enum fechado sempre serializa; um erro aqui seria bug nosso, não
        // do usuário.
        serde_json::to_string(self).expect("Schedule sempre serializa")
    }

    pub fn validate(&self) -> Result<()> {
        match self {
            Schedule::Daily => Ok(()),
            Schedule::Weekdays { days } => {
                if days.is_empty() {
                    return Err(NexusError::Validation(
                        "um hábito por dias da semana precisa de ao menos um dia".into(),
                    ));
                }
                if let Some(bad) = days.iter().find(|d| **d > 6) {
                    return Err(NexusError::Validation(format!(
                        "dia da semana inválido: {bad} (esperado 0=domingo … 6=sábado)"
                    )));
                }
                Ok(())
            }
            Schedule::TimesPerWeek { n } => {
                if *n == 0 || *n > 7 {
                    return Err(NexusError::Validation(format!(
                        "vezes por semana fora do intervalo: {n} (esperado 1..=7)"
                    )));
                }
                Ok(())
            }
        }
    }

    /// O hábito é esperado neste dia?
    ///
    /// Para `TimesPerWeek` a resposta é `true` para todo dia: qualquer dia
    /// **serve**, nenhum é obrigatório. Por isso o streak dele não pode ser
    /// contado por dia — ver `streak.rs`.
    pub fn is_scheduled_on(&self, day: NaiveDate) -> bool {
        match self {
            Schedule::Daily => true,
            Schedule::Weekdays { days } => days.contains(&weekday_index(day)),
            Schedule::TimesPerWeek { .. } => true,
        }
    }

    /// O streak deste agendamento é contado por semana, não por dia.
    pub fn is_weekly(&self) -> bool {
        matches!(self, Schedule::TimesPerWeek { .. })
    }
}

/// 0 = domingo … 6 = sábado, igual ao `strftime('%w')` do SQLite.
///
/// O `num_days_from_sunday` do chrono já usa essa base; a função existe para o
/// acoplamento com o SQL ficar dito em algum lugar em vez de implícito.
pub fn weekday_index(day: NaiveDate) -> u8 {
    day.weekday().num_days_from_sunday() as u8
}

/// Segunda-feira da semana ISO do dia — a chave de agrupamento semanal.
pub fn week_start(day: NaiveDate) -> NaiveDate {
    let back = day.weekday().num_days_from_monday() as i64;
    day - chrono::Duration::days(back)
}

/// Converte 'YYYY-MM-DD' em data.
pub fn parse_day(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|e| NexusError::Validation(format!("dia inválido '{s}': {e}")))
}

pub fn format_day(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// O DIA LOCAL de um instante em epoch ms — 'YYYY-MM-DD'.
///
/// Local, não UTC, pela mesma razão do `Clock::today_local`: o dia de um fato é
/// o dia do usuário. Quem precisa disto é quem grava um evento cujo `ts` não é
/// "agora" — o `day` tem que acompanhar o instante, senão a Timeline mostra o
/// fato num dia e o `ts` diz outro.
pub fn day_of_ms(ms: i64) -> String {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|dt| dt.format("%Y-%m-%d").to_string())
        // Um instante que não existe no fuso (a hora que a DST pula) não deve
        // derrubar uma gravação: cai no dia de hoje, que é o comportamento que
        // já valeria se o chamador não tivesse passado instante nenhum.
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d").to_string())
}

/// Rótulo curto do dia da semana, para os "ofensores" do BI.
pub fn weekday_label(idx: u8) -> &'static str {
    match idx {
        0 => "domingo",
        1 => "segunda",
        2 => "terça",
        3 => "quarta",
        4 => "quinta",
        5 => "sexta",
        _ => "sábado",
    }
}

/// Dia da semana do chrono a partir do índice base-domingo.
pub fn weekday_from_index(idx: u8) -> Weekday {
    match idx {
        0 => Weekday::Sun,
        1 => Weekday::Mon,
        2 => Weekday::Tue,
        3 => Weekday::Wed,
        4 => Weekday::Thu,
        5 => Weekday::Fri,
        _ => Weekday::Sat,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        parse_day(s).unwrap()
    }

    #[test]
    fn weekday_index_matches_sqlite_strftime_w() {
        // 2026-07-12 é um domingo. O SQLite diria '0'.
        assert_eq!(weekday_index(d("2026-07-12")), 0, "domingo");
        assert_eq!(weekday_index(d("2026-07-13")), 1, "segunda");
        assert_eq!(weekday_index(d("2026-07-17")), 5, "sexta");
        assert_eq!(weekday_index(d("2026-07-18")), 6, "sábado");
    }

    #[test]
    fn daily_is_scheduled_every_day() {
        for day in ["2026-07-12", "2026-07-13", "2026-07-18"] {
            assert!(Schedule::Daily.is_scheduled_on(d(day)));
        }
    }

    #[test]
    fn weekdays_only_on_listed_days() {
        // Segunda, quarta, sexta.
        let s = Schedule::Weekdays {
            days: vec![1, 3, 5],
        };
        assert!(s.is_scheduled_on(d("2026-07-13")), "segunda");
        assert!(!s.is_scheduled_on(d("2026-07-14")), "terça");
        assert!(s.is_scheduled_on(d("2026-07-15")), "quarta");
        assert!(s.is_scheduled_on(d("2026-07-17")), "sexta");
        assert!(!s.is_scheduled_on(d("2026-07-18")), "sábado");
    }

    #[test]
    fn times_per_week_accepts_any_day() {
        let s = Schedule::TimesPerWeek { n: 3 };
        assert!(s.is_scheduled_on(d("2026-07-12")));
        assert!(s.is_scheduled_on(d("2026-07-15")));
        assert!(s.is_weekly(), "o streak dele é semanal");
    }

    #[test]
    fn json_round_trips() {
        for s in [
            Schedule::Daily,
            Schedule::Weekdays {
                days: vec![1, 3, 5],
            },
            Schedule::TimesPerWeek { n: 3 },
        ] {
            assert_eq!(Schedule::parse_json(&s.to_json()).unwrap(), s);
        }
    }

    #[test]
    fn json_shape_is_readable_and_stable() {
        // Este JSON fica gravado no banco do usuário para sempre; um humano
        // precisa conseguir ler sem este código na mão.
        assert_eq!(Schedule::Daily.to_json(), r#"{"type":"daily"}"#);
        assert_eq!(
            Schedule::Weekdays {
                days: vec![1, 3, 5]
            }
            .to_json(),
            r#"{"type":"weekdays","days":[1,3,5]}"#
        );
        assert_eq!(
            Schedule::TimesPerWeek { n: 3 }.to_json(),
            r#"{"type":"times_per_week","n":3}"#
        );
    }

    #[test]
    fn invalid_schedules_are_rejected() {
        assert!(Schedule::parse_json(r#"{"type":"weekdays","days":[]}"#).is_err());
        assert!(Schedule::parse_json(r#"{"type":"weekdays","days":[7]}"#).is_err());
        assert!(Schedule::parse_json(r#"{"type":"times_per_week","n":0}"#).is_err());
        assert!(Schedule::parse_json(r#"{"type":"times_per_week","n":8}"#).is_err());
        assert!(Schedule::parse_json(r#"{"type":"mensal"}"#).is_err());
        assert!(Schedule::parse_json("não é json").is_err());
    }

    #[test]
    fn week_start_is_monday() {
        // Semana de 13/07/2026 (segunda) a 19/07 (domingo).
        assert_eq!(
            week_start(d("2026-07-13")),
            d("2026-07-13"),
            "segunda -> ela mesma"
        );
        assert_eq!(week_start(d("2026-07-17")), d("2026-07-13"), "sexta");
        assert_eq!(
            week_start(d("2026-07-19")),
            d("2026-07-13"),
            "domingo fecha a semana"
        );
        assert_eq!(
            week_start(d("2026-07-20")),
            d("2026-07-20"),
            "próxima segunda"
        );
    }
}
