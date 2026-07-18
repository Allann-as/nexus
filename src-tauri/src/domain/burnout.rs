//! Guarda anti-burnout — a carga da semana contra a média das anteriores.
//!
//! O NEXUS gamifica a constância, então tem o dever de avisar quando ela vira
//! excesso. A regra (DATA_MODEL §5): somar a carga da semana (minutos de hábitos
//! e duração de eventos) e comparar com a média móvel de 8 semanas. Passou de
//! 1,25×? Um alerta — não um bloqueio. O app avisa; quem decide é o usuário.
//!
//! Puro e explicável: nada de "a IA achou que você está cansado". É uma razão
//! entre dois números que a tela mostra.

use serde::Serialize;

/// Acima disto, a semana está pesada demais em relação à linha de base.
pub const BURNOUT_RATIO: f64 = 1.25;
/// Quantas semanas anteriores formam a linha de base ideal.
pub const BASELINE_WEEKS: usize = 8;
/// Menos que isto de histórico não dá uma média confiável — a guarda cala.
pub const MIN_BASELINE_WEEKS: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workload {
    /// Carga da semana corrente (a mesma unidade das `prior_weeks`).
    pub current: f64,
    /// Média móvel das semanas anteriores (até 8).
    pub baseline: f64,
    /// current / baseline.
    pub ratio: f64,
    /// `true` quando `ratio > BURNOUT_RATIO`.
    pub alert: bool,
    /// Quantas semanas entraram na linha de base.
    pub baseline_weeks: usize,
    pub formula: String,
}

/// Avalia a carga da semana corrente contra a linha de base.
///
/// `prior_weeks` vem da mais recente para a mais antiga (ou o contrário — a média
/// não se importa); o chamador passa até 8. Devolve `None` quando não há base
/// suficiente ou quando ela é zero: sem semanas para comparar, "1,25×" não
/// significa nada, e inventar um alerta seria o app gritando no escuro.
pub fn assess(current_week: f64, prior_weeks: &[f64]) -> Option<Workload> {
    let sample: Vec<f64> = prior_weeks.iter().copied().take(BASELINE_WEEKS).collect();
    if sample.len() < MIN_BASELINE_WEEKS {
        return None;
    }

    let baseline = sample.iter().sum::<f64>() / sample.len() as f64;
    if baseline <= 0.0 {
        return None;
    }

    let ratio = current_week / baseline;
    Some(Workload {
        current: current_week,
        baseline,
        ratio,
        alert: ratio > BURNOUT_RATIO,
        baseline_weeks: sample.len(),
        formula: format!(
            "carga desta semana ({:.0}) ÷ média de {} semanas ({:.0}) = {:.2}× \
             (alerta acima de {:.2}×)",
            current_week,
            sample.len(),
            baseline,
            ratio,
            BURNOUT_RATIO
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn too_little_history_stays_silent() {
        // 3 semanas de base < mínimo de 4.
        assert!(assess(1000.0, &[500.0, 500.0, 500.0]).is_none());
    }

    #[test]
    fn a_spike_over_1_25x_alerts() {
        // Base 400; semana em 600 = 1,5×.
        let w = assess(600.0, &[400.0, 400.0, 400.0, 400.0]).unwrap();
        assert!((w.baseline - 400.0).abs() < 1e-9);
        assert!((w.ratio - 1.5).abs() < 1e-9);
        assert!(w.alert);
        assert!(w.formula.contains("1.50×") || w.formula.contains("1.5"));
    }

    #[test]
    fn a_normal_week_does_not_alert() {
        // 1,25× exato NÃO alerta (o limiar é estritamente maior).
        let w = assess(500.0, &[400.0, 400.0, 400.0, 400.0]).unwrap();
        assert!((w.ratio - 1.25).abs() < 1e-9);
        assert!(!w.alert, "exatamente 1,25× ainda é aceitável");
    }

    #[test]
    fn a_zero_baseline_is_not_a_division() {
        // Oito semanas de férias: base zero. Não há alerta a dar.
        assert!(assess(300.0, &[0.0, 0.0, 0.0, 0.0, 0.0]).is_none());
    }

    #[test]
    fn only_the_last_eight_weeks_count() {
        // Passa 12 semanas; só as 8 primeiras entram na média.
        let weeks = vec![800.0; 12];
        let w = assess(1000.0, &weeks).unwrap();
        assert_eq!(w.baseline_weeks, BASELINE_WEEKS);
        assert!((w.baseline - 800.0).abs() < 1e-9);
    }
}
