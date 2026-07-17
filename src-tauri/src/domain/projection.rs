//! Projeção linear de uma meta — quando o ritmo atual chega lá.
//!
//! Puro: `chrono::NaiveDate` é um tipo-valor de data, não infraestrutura.
//!
//! # Por que uma reta, e nada além disso
//!
//! Constituição §2: zero IA. Todo insight é estatística descritiva que se
//! explica sozinha. Uma regressão por mínimos quadrados sobre os checkpoints é
//! a conta que um humano faria no papel — e a `formula` devolve exatamente essa
//! conta, do jeito que `score.rs` faz com os pesos do dia.
//!
//! O que ela NÃO é: uma previsão. A reta diz "se o ritmo medido continuar, o
//! alvo cai neste dia". Ela não sabe de festa de fim de ano, lesão nem promoção,
//! e não tenta saber.

use chrono::{Duration, NaiveDate};
use serde::Serialize;

/// Menos que isto não é uma tendência.
///
/// Dois pontos definem uma reta; um ponto define um ponto. Projetar de um
/// checkpoint só exigiria inventar a inclinação — e um número inventado com
/// cara de projeção é pior que projeção nenhuma.
const MIN_POINTS: usize = 2;

/// Abaixo disto, o denominador virou ruído de ponto flutuante e a divisão
/// devolveria um infinito com cara de resposta.
const EPS: f64 = 1e-12;

/// Uma medição da métrica num dia.
#[derive(Debug, Clone, Copy)]
pub struct Point {
    pub day: NaiveDate,
    pub value: f64,
}

/// O que a reta diz, com a conta inteira à vista.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    /// A inclinação da reta, na unidade da métrica por dia.
    pub rate_per_day: f64,
    /// O dia em que a reta cruza o alvo, 'YYYY-MM-DD'.
    /// `None` quando o ritmo medido não leva até lá.
    pub eta: Option<String>,
    /// Quantos checkpoints entraram na conta. A UI mostra isto ao lado da data
    /// porque uma reta sobre 3 pontos e uma sobre 300 não merecem a mesma fé.
    pub sample_size: usize,
    pub formula: String,
}

/// Projeta o dia em que `target` é atingido, pelo ritmo dos `points`.
///
/// `None` — e não um chute — quando os dados não sustentam uma reta.
pub fn project(points: &[Point], target: f64, unit: &str) -> Option<Projection> {
    if points.len() < MIN_POINTS {
        return None;
    }

    // Ordenado aqui dentro para a resposta não depender da ordem em que as
    // linhas voltaram do banco: a mesma série tem que dar sempre a mesma reta.
    let mut pts = points.to_vec();
    pts.sort_by_key(|p| p.day);

    let first = pts[0].day;
    let xs: Vec<f64> = pts
        .iter()
        .map(|p| (p.day - first).num_days() as f64)
        .collect();
    let ys: Vec<f64> = pts.iter().map(|p| p.value).collect();

    let n = pts.len() as f64;
    let sum_x: f64 = xs.iter().sum();
    let sum_y: f64 = ys.iter().sum();
    let sum_xx: f64 = xs.iter().map(|x| x * x).sum();
    let sum_xy: f64 = xs.iter().zip(&ys).map(|(x, y)| x * y).sum();

    // Zero quando todos os checkpoints caem no MESMO dia. Três pesagens numa
    // terça não dizem ritmo nenhum: não há tempo decorrido para dividir.
    let denom = n * sum_xx - sum_x * sum_x;
    if denom.abs() < EPS || !denom.is_finite() {
        return None;
    }

    let rate = (n * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - rate * sum_x) / n;
    if !rate.is_finite() || !intercept.is_finite() {
        return None;
    }

    let span = format!("{} → {}", first, pts[pts.len() - 1].day);
    let eta = solve(rate, intercept, target, &xs, first);

    let formula = match &eta {
        Some(day) => format!(
            "regressão linear sobre {} checkpoints ({span}): ritmo de {:+.3} {unit}/dia \
             → alvo {} {unit} em {day}",
            pts.len(),
            rate,
            trim(target),
        ),
        None => format!(
            "regressão linear sobre {} checkpoints ({span}): ritmo de {:+.3} {unit}/dia \
             não leva ao alvo {} {unit}",
            pts.len(),
            rate,
            trim(target),
        ),
    };

    Some(Projection {
        rate_per_day: rate,
        eta,
        sample_size: pts.len(),
        formula,
    })
}

/// O dia em que a reta cruza `target`, se ele estiver à frente da série.
///
/// Uma travessia ANTES do último checkpoint não é uma projeção, é uma
/// contradição com o dado: se a reta diz que o alvo caiu no mês passado e o
/// usuário continua medindo, a reta está errada, não o usuário. Devolver a data
/// passada faria a UI anunciar uma meta batida que não foi.
fn solve(rate: f64, intercept: f64, target: f64, xs: &[f64], first: NaiveDate) -> Option<String> {
    if rate.abs() < EPS {
        return None; // série parada: nunca chega.
    }
    let x = (target - intercept) / rate;
    if !x.is_finite() {
        return None;
    }

    let last_x = xs[xs.len() - 1];
    if x < last_x {
        return None;
    }

    // Teto e não arredondamento: cruzar às 14h do dia 11 significa que o alvo
    // cai no dia 11, não no 10.
    let days = x.ceil();
    // Um ritmo quase nulo empurra a travessia para daqui a milhões de anos, e
    // cada degrau desta escada estoura de um jeito diferente: o cast de f64 para
    // i64 satura em silêncio, `Duration::days` entra em pânico fora de faixa, e
    // só `checked_add_signed` recusa educadamente. Os três precisam da rede —
    // uma data impossível não é resposta, e um panic é menos resposta ainda.
    if !(i64::MIN as f64..=i64::MAX as f64).contains(&days) {
        return None;
    }
    Duration::try_days(days as i64)
        .and_then(|d| first.checked_add_signed(d))
        .map(|d| d.to_string())
}

/// Número sem zeros decorativos: "80" em vez de "80.000".
fn trim(v: f64) -> String {
    let s = format!("{v:.3}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(day: &str, value: f64) -> Point {
        Point {
            day: NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap(),
            value,
        }
    }

    #[test]
    fn fewer_than_two_checkpoints_yield_no_projection_not_a_guess() {
        // Um ponto não tem inclinação. Inventar uma e chamar de projeção seria
        // exatamente a caixa-preta que a constituição proíbe.
        assert!(project(&[], 80.0, "kg").is_none());
        assert!(project(&[p("2026-01-01", 90.0)], 80.0, "kg").is_none());
    }

    #[test]
    fn checkpoints_all_on_the_same_day_yield_no_projection() {
        // Três pesagens numa terça não dizem ritmo nenhum: não há tempo
        // decorrido para dividir, e a divisão seria por zero.
        let pts = [
            p("2026-01-01", 90.0),
            p("2026-01-01", 89.0),
            p("2026-01-01", 91.0),
        ];
        assert!(project(&pts, 80.0, "kg").is_none());
    }

    #[test]
    fn a_decreasing_goal_projects_the_exact_day() {
        // 100 -> 90 em 10 dias = -1/dia. Faltam 10 até 80: dia 20 da série.
        let pts = [p("2026-01-01", 100.0), p("2026-01-11", 90.0)];
        let proj = project(&pts, 80.0, "kg").unwrap();
        assert_eq!(proj.eta.as_deref(), Some("2026-01-21"));
        assert!((proj.rate_per_day + 1.0).abs() < 1e-9);
        assert_eq!(proj.sample_size, 2);
    }

    #[test]
    fn an_increasing_goal_projects_forward_too() {
        let pts = [p("2026-01-01", 0.0), p("2026-01-05", 20.0)];
        let proj = project(&pts, 100.0, "páginas").unwrap();
        assert_eq!(proj.eta.as_deref(), Some("2026-01-21"), "5/dia até 100");
    }

    #[test]
    fn the_result_does_not_depend_on_the_order_the_rows_arrive() {
        // Determinismo: a mesma série tem que dar sempre a mesma reta, venha ela
        // do banco ordenada ou não.
        let a = [
            p("2026-01-01", 100.0),
            p("2026-01-11", 90.0),
            p("2026-01-21", 80.0),
        ];
        let b = [
            p("2026-01-21", 80.0),
            p("2026-01-01", 100.0),
            p("2026-01-11", 90.0),
        ];
        assert_eq!(
            project(&a, 70.0, "kg").unwrap().formula,
            project(&b, 70.0, "kg").unwrap().formula
        );
    }

    #[test]
    fn a_rate_moving_away_from_the_target_has_a_rate_but_no_eta() {
        // O usuário está engordando e a meta é emagrecer. A honestidade é dizer
        // o ritmo e não dar data — não existe data.
        let pts = [p("2026-01-01", 90.0), p("2026-01-11", 95.0)];
        let proj = project(&pts, 80.0, "kg").unwrap();
        assert!(proj.rate_per_day > 0.0);
        assert_eq!(proj.eta, None);
        assert!(proj.formula.contains("não leva ao alvo"));
    }

    #[test]
    fn a_flat_series_never_arrives() {
        // Ritmo zero: a reta é paralela ao alvo e nunca o cruza. Sem o teste de
        // EPS isto viraria uma divisão por zero e uma data infinita.
        let pts = [
            p("2026-01-01", 90.0),
            p("2026-01-11", 90.0),
            p("2026-01-21", 90.0),
        ];
        let proj = project(&pts, 80.0, "kg").unwrap();
        assert_eq!(proj.rate_per_day, 0.0);
        assert_eq!(proj.eta, None);
    }

    #[test]
    fn a_target_already_crossed_gives_no_eta_in_the_past() {
        // A reta cruza 90 no dia 5, mas a série vai até o dia 10. Uma data
        // passada faria a UI anunciar uma meta batida que não foi.
        let pts = [p("2026-01-01", 100.0), p("2026-01-11", 80.0)];
        let proj = project(&pts, 90.0, "kg").unwrap();
        assert_eq!(proj.eta, None);
    }

    #[test]
    fn least_squares_survives_a_noisy_series() {
        // O peso oscila com a água do corpo; a reta tem que atravessar o ruído
        // em vez de seguir o último ponto. Uma projeção que só olha o começo e o
        // fim daria -0,5/dia aqui.
        let pts = [
            p("2026-01-01", 100.0),
            p("2026-01-08", 99.5),
            p("2026-01-15", 98.0),
            p("2026-01-22", 98.5),
            p("2026-01-29", 96.0),
        ];
        let proj = project(&pts, 90.0, "kg").unwrap();
        assert_eq!(proj.sample_size, 5);
        assert!(
            proj.rate_per_day < -0.1 && proj.rate_per_day > -0.2,
            "ritmo fora do esperado: {}",
            proj.rate_per_day
        );
        assert!(proj.eta.is_some());
    }

    #[test]
    fn an_almost_flat_rate_does_not_overflow_the_calendar() {
        // 0,001 kg/dia até 10 kg de distância = 10 mil dias. Cabe. Mas um ritmo
        // um passo menor projeta para além do calendário, e a resposta tem que
        // ser None em vez de um panic ou uma data absurda.
        let pts = [p("2026-01-01", 90.0), p("2036-01-01", 89.999_999_9)];
        let proj = project(&pts, 80.0, "kg").unwrap();
        assert!(
            proj.eta.is_none() || proj.eta.as_deref().unwrap() > "2100-01-01",
            "eta: {:?}",
            proj.eta
        );
    }

    #[test]
    fn the_formula_states_the_sample_size_the_span_and_the_rate() {
        // Regra da constituição: todo insight responde "como você calculou?".
        let pts = [
            p("2026-01-01", 100.0),
            p("2026-01-11", 95.0),
            p("2026-01-21", 90.0),
        ];
        let proj = project(&pts, 80.0, "kg").unwrap();
        assert!(proj.formula.contains("3 checkpoints"));
        assert!(proj.formula.contains("2026-01-01 → 2026-01-21"));
        assert!(proj.formula.contains("-0.500 kg/dia"));
        assert!(proj.formula.contains("alvo 80 kg"));
    }
}
