//! Recorrência de eventos — um subconjunto deliberado da RFC-5545.
//!
//! Puro: `chrono::NaiveDate` é um tipo-valor de data, não infraestrutura. Quem
//! diz "que dia é hoje" continua sendo o port `Clock`.
//!
//! # Por que um subconjunto, e não uma RRULE completa
//!
//! A RFC-5545 permite coisas como "a cada 2 meses, na terceira sexta, exceto em
//! dezembro, contando a partir da segunda semana ISO". Suportar tudo isso
//! significa carregar um parser e um motor de expansão para sempre — e o NEXUS
//! é um app pessoal, não um servidor CalDAV. O que uma vida real precisa é o que
//! está aqui: todo dia, alguns dias da semana, todo mês no dia N, todo ano.
//!
//! O JSON é gravado em `event_details.rrule` e fica no banco do usuário para
//! sempre. `tag` explícito para que um humano em 2056 leia a coluna sem este
//! código na mão — a mesma decisão do `Schedule` dos hábitos.

use chrono::{Datelike, Duration, NaiveDate};
use serde::{Deserialize, Serialize};

use crate::domain::errors::{NexusError, Result};
use crate::domain::schedule::weekday_index;

/// O teto de ocorrências que uma expansão pode gerar de uma vez.
///
/// Rede de segurança contra um `interval` bugado ou uma janela absurda gerando
/// milhões de linhas e travando o app. 18 meses de evento diário dá ~550; este
/// teto é uma ordem de grandeza acima de qualquer uso legítimo.
const MAX_OCCURRENCES: usize = 5_000;

/// Quando um evento se repete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Recurrence {
    /// A cada `interval` dias.
    Daily { interval: u32 },
    /// Nos dias da semana listados, a cada `interval` semanas.
    /// 0 = domingo … 6 = sábado, igual ao `strftime('%w')` do SQLite e ao
    /// `Schedule` dos hábitos — o BI agrupa os dois pelo mesmo índice.
    Weekly { interval: u32, days: Vec<u8> },
    /// Todo mês no mesmo dia do mês, a cada `interval` meses.
    Monthly { interval: u32 },
    /// Todo ano na mesma data.
    Yearly { interval: u32 },
}

impl Recurrence {
    pub fn parse_json(s: &str) -> Result<Self> {
        let parsed: Recurrence = serde_json::from_str(s)
            .map_err(|e| NexusError::Validation(format!("rrule inválida: {e}")))?;
        parsed.validate()?;
        Ok(parsed)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("Recurrence sempre serializa")
    }

    pub fn validate(&self) -> Result<()> {
        let interval = match self {
            Recurrence::Daily { interval }
            | Recurrence::Monthly { interval }
            | Recurrence::Yearly { interval } => *interval,
            Recurrence::Weekly { interval, days } => {
                if days.is_empty() {
                    return Err(NexusError::Validation(
                        "uma recorrência semanal precisa de ao menos um dia".into(),
                    ));
                }
                if let Some(bad) = days.iter().find(|d| **d > 6) {
                    return Err(NexusError::Validation(format!(
                        "dia da semana inválido: {bad} (esperado 0=domingo … 6=sábado)"
                    )));
                }
                *interval
            }
        };

        // Intervalo zero é a armadilha clássica: "a cada 0 dias" é uma repetição
        // infinita no mesmo instante, e o laço de expansão nunca sairia.
        if interval == 0 {
            return Err(NexusError::Validation(
                "o intervalo de uma recorrência não pode ser zero".into(),
            ));
        }
        if interval > 365 {
            return Err(NexusError::Validation(format!(
                "intervalo absurdo: {interval}"
            )));
        }
        Ok(())
    }

    /// Os dias em que o evento cai, de `from` até `until` (ambos inclusivos).
    ///
    /// `anchor` é a data do evento original: é ela que define "o dia do mês" de
    /// uma mensal e a fase de uma semanal com `interval > 1`. Sem âncora, "a
    /// cada 2 semanas" não teria como saber qual das duas semanas é a certa.
    pub fn expand(&self, anchor: NaiveDate, from: NaiveDate, until: NaiveDate) -> Vec<NaiveDate> {
        if until < from || until < anchor {
            return Vec::new();
        }
        let mut out = Vec::new();
        // Nunca antes da âncora: um evento não acontece antes de existir.
        let start = from.max(anchor);

        match self {
            Recurrence::Daily { interval } => {
                let step = i64::from(*interval);
                // Alinha à fase da âncora em vez de varrer dia a dia: para um
                // "a cada 3 dias" consultado 5 anos depois, varrer seria ~1800
                // iterações para achar a primeira.
                //
                // O arredondamento é PARA CIMA (o primeiro múltiplo >= offset),
                // escrito à mão porque `div_ceil` ainda é instável. `offset` é
                // sempre >= 0 aqui — `start` é `from.max(anchor)`.
                let offset = (start - anchor).num_days();
                let steps = (offset + step - 1) / step;
                let mut d = anchor + Duration::days(steps * step);
                while d <= until && out.len() < MAX_OCCURRENCES {
                    out.push(d);
                    d += Duration::days(step);
                }
            }

            Recurrence::Weekly { interval, days } => {
                // A semana da âncora é a fase. `interval = 2` significa "nas
                // semanas com paridade igual à da âncora".
                let anchor_week = crate::domain::schedule::week_start(anchor);
                let mut d = start;
                while d <= until && out.len() < MAX_OCCURRENCES {
                    if days.contains(&weekday_index(d)) {
                        let weeks =
                            (crate::domain::schedule::week_start(d) - anchor_week).num_days() / 7;
                        if weeks >= 0 && weeks % i64::from(*interval) == 0 {
                            out.push(d);
                        }
                    }
                    d += Duration::days(1);
                }
            }

            // Mensal e anual são o MESMO laço com passo diferente — um ano é
            // doze meses, e `add_months` já resolve a virada. Mantê-los
            // separados duplicaria a regra do dia 31 em dois lugares que
            // precisariam concordar para sempre.
            Recurrence::Monthly { interval } | Recurrence::Yearly { interval } => {
                let step = match self {
                    Recurrence::Yearly { .. } => interval * 12,
                    _ => *interval,
                };
                let mut n = 0u32;
                while let Some(d) = add_months(anchor, n * step) {
                    if d > until || out.len() >= MAX_OCCURRENCES {
                        break;
                    }
                    if d >= start {
                        out.push(d);
                    }
                    n += 1;
                }
            }
        }
        out
    }
}

/// `date` + `months` meses, grudando no último dia quando o mês é mais curto.
///
/// O caso que importa: um evento no dia 31 repetido mensalmente. Em fevereiro o
/// dia 31 não existe. As duas opções são pular o mês ou cair no dia 28 — e
/// pular é pior: "todo mês" que some em fevereiro é um lembrete que falha
/// justamente onde o usuário confiou nele. É o mesmo que o Google Agenda faz.
fn add_months(date: NaiveDate, months: u32) -> Option<NaiveDate> {
    let total = date.month0() as i64 + i64::from(months);
    let year = date.year() + (total / 12) as i32;
    let month0 = (total % 12) as u32;

    let last = last_day_of_month(year, month0 + 1)?;
    NaiveDate::from_ymd_opt(year, month0 + 1, date.day().min(last))
}

fn last_day_of_month(year: i32, month: u32) -> Option<u32> {
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let first_next = NaiveDate::from_ymd_opt(ny, nm, 1)?;
    Some((first_next - Duration::days(1)).day())
}

/// Dois intervalos se sobrepõem?
///
/// Meio-aberto (`[start, end)`) de propósito: um evento que acaba às 10h e
/// outro que começa às 10h **não** conflitam. É a regra que todo calendário usa,
/// e a alternativa acusaria conflito em toda agenda encostada.
pub fn overlaps(a_start: i64, a_end: i64, b_start: i64, b_end: i64) -> bool {
    a_start < b_end && b_start < a_end
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::schedule::parse_day;

    fn d(s: &str) -> NaiveDate {
        parse_day(s).unwrap()
    }

    // ===== Daily =====

    #[test]
    fn daily_hits_every_day() {
        let r = Recurrence::Daily { interval: 1 };
        let out = r.expand(d("2026-07-13"), d("2026-07-13"), d("2026-07-16"));
        assert_eq!(
            out,
            vec![
                d("2026-07-13"),
                d("2026-07-14"),
                d("2026-07-15"),
                d("2026-07-16")
            ]
        );
    }

    #[test]
    fn daily_with_interval_keeps_the_anchors_phase() {
        // A cada 3 dias a partir de 13/07. Consultando uma janela que começa
        // DEPOIS da âncora, a fase tem que continuar sendo a dela — não a do
        // começo da janela.
        let r = Recurrence::Daily { interval: 3 };
        let out = r.expand(d("2026-07-13"), d("2026-07-17"), d("2026-07-25"));
        assert_eq!(out, vec![d("2026-07-19"), d("2026-07-22"), d("2026-07-25")]);
    }

    #[test]
    fn nothing_happens_before_the_anchor() {
        // Um evento não acontece antes de existir.
        let r = Recurrence::Daily { interval: 1 };
        let out = r.expand(d("2026-07-13"), d("2026-07-01"), d("2026-07-14"));
        assert_eq!(out, vec![d("2026-07-13"), d("2026-07-14")]);
    }

    // ===== Weekly =====

    #[test]
    fn weekly_hits_only_the_listed_days() {
        // Segunda e quarta.
        let r = Recurrence::Weekly {
            interval: 1,
            days: vec![1, 3],
        };
        let out = r.expand(d("2026-07-13"), d("2026-07-13"), d("2026-07-26"));
        assert_eq!(
            out,
            vec![
                d("2026-07-13"), // seg
                d("2026-07-15"), // qua
                d("2026-07-20"), // seg
                d("2026-07-22"), // qua
            ]
        );
    }

    #[test]
    fn fortnightly_skips_the_odd_weeks() {
        // A cada 2 semanas, às segundas. A semana da âncora é a fase.
        let r = Recurrence::Weekly {
            interval: 2,
            days: vec![1],
        };
        let out = r.expand(d("2026-07-13"), d("2026-07-13"), d("2026-08-11"));
        assert_eq!(
            out,
            vec![d("2026-07-13"), d("2026-07-27"), d("2026-08-10")],
            "20/07 e 03/08 caem nas semanas ímpares e ficam de fora"
        );
    }

    // ===== Monthly — o caso do dia 31 =====

    #[test]
    fn monthly_on_the_31st_sticks_to_the_last_day_of_short_months() {
        // A regra que importa: "todo dia 31" não pode SUMIR em fevereiro. Um
        // lembrete mensal que falha justamente no mês curto é pior que um
        // lembrete um dia adiantado.
        let r = Recurrence::Monthly { interval: 1 };
        let out = r.expand(d("2026-01-31"), d("2026-01-01"), d("2026-05-01"));
        assert_eq!(
            out,
            vec![
                d("2026-01-31"),
                d("2026-02-28"), // fevereiro de 2026 não é bissexto
                d("2026-03-31"),
                d("2026-04-30"),
            ]
        );
    }

    #[test]
    fn monthly_on_the_31st_finds_february_29_in_a_leap_year() {
        // 2028 é bissexto.
        let r = Recurrence::Monthly { interval: 1 };
        let out = r.expand(d("2028-01-31"), d("2028-02-01"), d("2028-02-29"));
        assert_eq!(out, vec![d("2028-02-29")]);
    }

    #[test]
    fn monthly_does_not_drift_after_a_short_month() {
        // A armadilha do "grudar no último dia": se março partisse de 28/02 em
        // vez da ÂNCORA, a série viraria 31, 28, 28, 28… e o evento migraria
        // para sempre. Toda ocorrência é calculada a partir da âncora.
        let r = Recurrence::Monthly { interval: 1 };
        let out = r.expand(d("2026-01-31"), d("2026-03-01"), d("2026-03-31"));
        assert_eq!(out, vec![d("2026-03-31")], "março volta para o 31");
    }

    #[test]
    fn quarterly_works() {
        let r = Recurrence::Monthly { interval: 3 };
        let out = r.expand(d("2026-01-15"), d("2026-01-01"), d("2026-12-31"));
        assert_eq!(
            out,
            vec![
                d("2026-01-15"),
                d("2026-04-15"),
                d("2026-07-15"),
                d("2026-10-15")
            ]
        );
    }

    // ===== Yearly =====

    #[test]
    fn yearly_crosses_the_year_boundary() {
        let r = Recurrence::Yearly { interval: 1 };
        let out = r.expand(d("2026-03-10"), d("2026-01-01"), d("2029-01-01"));
        assert_eq!(out, vec![d("2026-03-10"), d("2027-03-10"), d("2028-03-10")]);
    }

    #[test]
    fn a_birthday_on_february_29_lands_on_the_28th_in_common_years() {
        let r = Recurrence::Yearly { interval: 1 };
        let out = r.expand(d("2028-02-29"), d("2029-01-01"), d("2029-12-31"));
        assert_eq!(out, vec![d("2029-02-28")]);
    }

    // ===== Janelas =====

    #[test]
    fn an_empty_window_yields_nothing() {
        let r = Recurrence::Daily { interval: 1 };
        assert!(r
            .expand(d("2026-07-13"), d("2026-07-20"), d("2026-07-19"))
            .is_empty());
    }

    #[test]
    fn the_expansion_is_capped() {
        // Rede de segurança: uma janela absurda não pode gerar milhões de
        // linhas e travar o app.
        let r = Recurrence::Daily { interval: 1 };
        let out = r.expand(d("2000-01-01"), d("2000-01-01"), d("2100-01-01"));
        assert_eq!(out.len(), MAX_OCCURRENCES);
    }

    // ===== Validação =====

    #[test]
    fn a_zero_interval_is_rejected() {
        // "A cada 0 dias" é uma repetição infinita no mesmo instante: o laço de
        // expansão nunca sairia. Barrado na porta, não no laço.
        assert!(Recurrence::Daily { interval: 0 }.validate().is_err());
        assert!(Recurrence::Weekly {
            interval: 0,
            days: vec![1]
        }
        .validate()
        .is_err());
        assert!(Recurrence::Monthly { interval: 0 }.validate().is_err());
    }

    #[test]
    fn a_weekly_without_days_is_rejected() {
        assert!(Recurrence::Weekly {
            interval: 1,
            days: vec![]
        }
        .validate()
        .is_err());
    }

    #[test]
    fn an_invalid_weekday_is_rejected() {
        assert!(Recurrence::Weekly {
            interval: 1,
            days: vec![7]
        }
        .validate()
        .is_err());
    }

    #[test]
    fn json_round_trips() {
        for r in [
            Recurrence::Daily { interval: 1 },
            Recurrence::Weekly {
                interval: 2,
                days: vec![1, 3, 5],
            },
            Recurrence::Monthly { interval: 3 },
            Recurrence::Yearly { interval: 1 },
        ] {
            assert_eq!(Recurrence::parse_json(&r.to_json()).unwrap(), r);
        }
    }

    #[test]
    fn json_shape_is_readable_and_stable() {
        // Este JSON fica no banco do usuário para sempre; um humano precisa
        // conseguir ler sem este código na mão.
        assert_eq!(
            Recurrence::Daily { interval: 1 }.to_json(),
            r#"{"type":"daily","interval":1}"#
        );
        assert_eq!(
            Recurrence::Weekly {
                interval: 2,
                days: vec![1, 3]
            }
            .to_json(),
            r#"{"type":"weekly","interval":2,"days":[1,3]}"#
        );
    }

    #[test]
    fn garbage_json_is_rejected_not_guessed() {
        assert!(Recurrence::parse_json("não é json").is_err());
        assert!(Recurrence::parse_json(r#"{"type":"a_cada_lua_cheia"}"#).is_err());
        assert!(Recurrence::parse_json(r#"{"type":"daily","interval":0}"#).is_err());
    }

    // ===== Conflito =====

    #[test]
    fn touching_events_do_not_conflict() {
        // Um acaba às 10h, o outro começa às 10h. Todo calendário do mundo trata
        // isso como "encostado", não "conflitante" — o contrário acusaria
        // conflito em toda agenda cheia.
        assert!(!overlaps(0, 10, 10, 20));
        assert!(!overlaps(10, 20, 0, 10));
    }

    #[test]
    fn real_overlaps_are_detected() {
        assert!(overlaps(0, 10, 5, 15), "parcial");
        assert!(overlaps(0, 10, 2, 8), "contido");
        assert!(overlaps(2, 8, 0, 10), "contém");
        assert!(overlaps(0, 10, 0, 10), "idêntico");
    }

    #[test]
    fn disjoint_events_do_not_conflict() {
        assert!(!overlaps(0, 10, 20, 30));
        assert!(!overlaps(20, 30, 0, 10));
    }
}
