//! Projeção de uma "caixinha" — quando ela fecha, no ritmo dos últimos meses.
//!
//! Puro: `chrono::NaiveDate` é um tipo-valor, não infraestrutura.
//!
//! # Por que a média, e não os mínimos quadrados
//!
//! A `projection.rs` das metas ajusta uma reta a uma série de MEDIÇÕES ruidosas
//! (o peso oscila com a água do corpo). Um depósito numa caixinha não é uma
//! medição: é um ato. A pergunta certa não é "que reta atravessa o ruído" e sim
//! "no ritmo em que venho guardando, quando fecho?". A resposta honesta é a
//! média mensal recente — e o §2.1 do plano a pede por nome: "no ritmo dos
//! últimos 3 meses, você conclui em nov/2026".
//!
//! Determinística e explicável (constituição §2): a `formula` devolve a conta
//! inteira, como `score.rs` e `financial_health.rs`.

use chrono::{Datelike, Months, NaiveDate};
use serde::Serialize;

/// O que a projeção diz, com a conta à vista.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SavingsProjection {
    /// O mês em que a caixinha fecha, 'YYYY-MM'. `None` quando não dá para
    /// projetar: já fechou, ou o ritmo recente é zero (nada foi guardado).
    pub eta_month: Option<String>,
    /// Quantos meses ainda faltam, no ritmo atual. `Some(0)` = já fechou.
    pub months_remaining: Option<u32>,
    /// A média mensal usada na conta, em centavos.
    pub monthly_rate_cents: i64,
    pub formula: String,
}

/// O número de meses cuja média define o "ritmo recente".
///
/// Três: curto o bastante para refletir o hábito de agora (um aporte grande de
/// um ano atrás não deveria prometer uma data que o presente não sustenta), e
/// longo o bastante para um mês pulado não zerar a projeção.
pub const RATE_MONTHS: u32 = 3;

/// Projeta o mês de conclusão de uma caixinha.
///
/// `recent_deposits_cents` é o total depositado nos últimos [`RATE_MONTHS`]
/// meses (o serviço soma via SQL); a média mensal é essa soma dividida por
/// [`RATE_MONTHS`] — dividir pelos meses ATIVOS mediria "quanto guardo quando
/// guardo", e a pergunta é "quanto guardo por mês", então um mês pulado tem que
/// puxar o ritmo para baixo (a mesma decisão de `average_last_6m` das Finanças).
pub fn project(
    saved_cents: i64,
    target_cents: i64,
    recent_deposits_cents: i64,
    today: NaiveDate,
) -> SavingsProjection {
    let remaining = target_cents - saved_cents;
    let monthly_rate_cents = recent_deposits_cents / i64::from(RATE_MONTHS);

    // Já fechou (ou passou): não há o que projetar, e uma data no futuro seria
    // mentira — o dinheiro já está lá.
    if remaining <= 0 {
        return SavingsProjection {
            eta_month: None,
            months_remaining: Some(0),
            monthly_rate_cents,
            formula: "Objetivo alcançado.".into(),
        };
    }

    // Sem ritmo, sem data. Prometer uma conclusão de quem não guardou nada nos
    // últimos meses seria inventar a inclinação que a `projection.rs` se recusa a
    // inventar.
    if monthly_rate_cents <= 0 {
        return SavingsProjection {
            eta_month: None,
            months_remaining: None,
            monthly_rate_cents,
            formula: format!(
                "Sem depósitos nos últimos {RATE_MONTHS} meses — sem ritmo para projetar."
            ),
        };
    }

    // Teto: faltando R$ 100 e guardando R$ 90/mês, faltam 2 meses, não 1.
    // À mão porque `i64::div_ceil` ainda é instável; ambos são > 0 aqui.
    let months = (remaining + monthly_rate_cents - 1) / monthly_rate_cents;
    // `Months::new` quer u32; um alvo distante a um ritmo ínfimo estoura. Nesse
    // caso a resposta honesta é "não dá para prever", não uma data absurda.
    let months_u32 = u32::try_from(months).ok();

    let eta_month = months_u32
        .and_then(|m| today.checked_add_months(Months::new(m)))
        .map(|d| format!("{:04}-{:02}", d.year(), d.month()));

    let formula = match &eta_month {
        Some(month) => format!(
            "no ritmo dos últimos {RATE_MONTHS} meses (R$ {:.2}/mês), faltam R$ {:.2} \
             → conclui em {month}",
            monthly_rate_cents as f64 / 100.0,
            remaining as f64 / 100.0,
        ),
        None => format!(
            "no ritmo dos últimos {RATE_MONTHS} meses (R$ {:.2}/mês), a conclusão está \
             longe demais para uma data",
            monthly_rate_cents as f64 / 100.0,
        ),
    };

    SavingsProjection {
        eta_month,
        months_remaining: months_u32,
        monthly_rate_cents,
        formula,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 15).unwrap()
    }

    #[test]
    fn a_steady_saver_gets_a_month() {
        // Alvo 2500, guardado 1000, faltam 1500. Nos últimos 3 meses guardou
        // 900 → 300/mês. 1500/300 = 5 meses → dez/2026.
        let p = project(100_000, 250_000, 90_000, today());
        assert_eq!(p.eta_month.as_deref(), Some("2026-12"));
        assert_eq!(p.months_remaining, Some(5));
        assert_eq!(p.monthly_rate_cents, 30_000);
    }

    #[test]
    fn a_completed_box_has_no_eta_and_zero_remaining() {
        let p = project(250_000, 250_000, 90_000, today());
        assert_eq!(p.eta_month, None);
        assert_eq!(p.months_remaining, Some(0));
        assert!(p.formula.contains("alcançado"));
    }

    #[test]
    fn overshooting_the_target_still_reads_as_done() {
        let p = project(300_000, 250_000, 90_000, today());
        assert_eq!(p.months_remaining, Some(0));
    }

    #[test]
    fn no_recent_deposits_means_no_projection_not_a_guess() {
        // Nada guardado nos últimos 3 meses: a projeção não inventa uma data.
        let p = project(100_000, 250_000, 0, today());
        assert_eq!(p.eta_month, None);
        assert_eq!(p.months_remaining, None);
        assert!(p.formula.contains("Sem depósitos"));
    }

    #[test]
    fn the_average_divides_by_three_so_a_skipped_month_slows_it_down() {
        // Guardou 900 num só dos 3 meses: o ritmo é 300/mês (900/3), não 900.
        // Faltam 900 → 3 meses, não 1.
        let p = project(0, 90_000, 90_000, today());
        assert_eq!(p.monthly_rate_cents, 30_000);
        assert_eq!(p.months_remaining, Some(3));
    }

    #[test]
    fn the_ceiling_does_not_finish_early() {
        // Faltam 1000, ritmo 900/mês: 2 meses, não 1 — no fim do 1º ainda falta.
        let p = project(0, 100_000, 270_000, today());
        assert_eq!(p.monthly_rate_cents, 90_000);
        assert_eq!(p.months_remaining, Some(2));
    }

    #[test]
    fn the_formula_states_the_rhythm_and_the_gap() {
        let p = project(100_000, 250_000, 90_000, today());
        assert!(p.formula.contains("últimos 3 meses"));
        assert!(p.formula.contains("R$ 300.00/mês"));
        assert!(p.formula.contains("R$ 1500.00"));
    }
}
