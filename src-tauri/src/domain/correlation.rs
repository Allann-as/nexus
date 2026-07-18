//! Correlação entre hábitos — a tabela de contingência 2×2, com guardas.
//!
//! Pergunta: *"fazer o hábito A muda a minha chance de cumprir o B?"* A resposta
//! é estatística DESCRITIVA — lift e coeficiente phi (φ) — não IA, não inferência
//! causal. O card diz "nos dias em que você faz A, cumprir B sobe de X% para Y%",
//! e nunca "A causa B".
//!
//! **Só entram dias em que AMBOS estavam agendados** (o chamador filtra): comparar
//! um dia em que B nem era para acontecer com um em que era mediria a agenda, não
//! o hábito.
//!
//! As guardas são obrigatórias (constituição §2, DATA_MODEL §5):
//!   * amostra `n >= 30` dias — abaixo disso o número é ruído com cara de fato;
//!   * lift entre 0,9 e 1,1 é "sem efeito" e nunca vira card — quase todo par de
//!     hábitos tem um lift ligeiramente ≠ 1 por acaso, e mostrá-los afogaria os
//!     poucos que importam.

use std::collections::HashSet;

use chrono::NaiveDate;
use serde::Serialize;

use crate::domain::schedule::Schedule;

/// O tamanho mínimo de amostra para uma correlação ser exibível.
pub const MIN_SAMPLE: u32 = 30;
/// Abaixo deste lift (e acima do simétrico `2 - x`... na prática usamos a faixa
/// morta abaixo), o efeito é ruído. A faixa morta é [LIFT_DEAD_LOW, LIFT_DEAD_HIGH].
pub const LIFT_DEAD_LOW: f64 = 0.9;
pub const LIFT_DEAD_HIGH: f64 = 1.1;
/// O piso de phi e de lift para o TEMPLATE positivo ("subir de X% para Y%").
/// Abaixo disso há relação, mas fraca demais para uma frase afirmativa.
pub const PHI_TEMPLATE_MIN: f64 = 0.25;
pub const LIFT_TEMPLATE_MIN: f64 = 1.3;

/// A tabela 2×2: em cada dia (com ambos agendados), A foi feito? B foi feito?
///
/// ```text
///                 B feito   B não
///   A feito         a         b
///   A não           c         d
/// ```
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Contingency {
    pub a: u32,
    pub b: u32,
    pub c: u32,
    pub d: u32,
}

impl Contingency {
    pub fn total(&self) -> u32 {
        self.a + self.b + self.c + self.d
    }
}

/// O resultado de uma análise de correlação, com a explicação embutida.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Correlation {
    /// P(B | A): chance de cumprir B nos dias em que A foi feito.
    pub p_b_given_a: f64,
    /// P(B | ¬A): chance de cumprir B nos dias em que A NÃO foi feito.
    pub p_b_given_not_a: f64,
    /// lift = P(B|A) / P(B|¬A). > 1 = A ajuda B; < 1 = A atrapalha B.
    pub lift: f64,
    /// Coeficiente phi, -1..=1. A "força" da associação.
    pub phi: f64,
    pub sample_size: u32,
    pub formula: String,
}

/// Analisa uma tabela 2×2. Devolve `None` quando as guardas reprovam — sem
/// amostra, sem denominador ou com lift na faixa morta. Um `None` é a resposta
/// certa: "não há o que afirmar", não "afirmo que zero".
pub fn analyze(t: Contingency) -> Option<Correlation> {
    let n = t.total();
    if n < MIN_SAMPLE {
        return None;
    }

    let a_done = t.a + t.b; // dias com A feito
    let a_not = t.c + t.d; // dias sem A
    if a_done == 0 || a_not == 0 {
        // Sem variação em A não há o que comparar: A foi feito todo dia, ou
        // nenhum. O lift não tem denominador dos dois lados.
        return None;
    }

    let p_b_given_a = f64::from(t.a) / f64::from(a_done);
    let p_b_given_not_a = f64::from(t.c) / f64::from(a_not);

    if p_b_given_not_a == 0.0 {
        // B nunca aconteceu sem A: o lift dispararia para o infinito. Descritivo
        // demais para uma frase honesta — a amostra é pequena nesse canto.
        return None;
    }

    let lift = p_b_given_a / p_b_given_not_a;
    if (LIFT_DEAD_LOW..=LIFT_DEAD_HIGH).contains(&lift) {
        return None; // faixa morta: efeito indistinguível de acaso.
    }

    let phi = phi_coefficient(t);

    Some(Correlation {
        p_b_given_a,
        p_b_given_not_a,
        lift,
        phi,
        sample_size: n,
        formula: format!(
            "φ = (ad − bc) / √((a+b)(c+d)(a+c)(b+d)) com a={}, b={}, c={}, d={}; \
             lift = P(B|A)/P(B|¬A) = {:.0}%/{:.0}% = {:.2}",
            t.a,
            t.b,
            t.c,
            t.d,
            p_b_given_a * 100.0,
            p_b_given_not_a * 100.0,
            lift
        ),
    })
}

/// Constrói a tabela 2×2 de A × B sobre uma janela de dias.
///
/// **Só entram dias em que AMBOS estavam agendados** — a regra do DATA_MODEL §5.
/// Um dia em que B nem era para acontecer não diz nada sobre "A ajuda B?"; contá-lo
/// mediria a agenda, não o hábito. `done_a`/`done_b` são os dias com tick 'done'
/// (o chamador os traz do repositório); a ausência num dia agendado é "não fez".
///
/// Puro e testável: recebe agendas, conjuntos de dias-feitos e a janela — nada de
/// banco. É aqui que a intersecção "ambos agendados" acontece, então o
/// `is_scheduled_on` de cada agenda é a única verdade sobre o que era esperado.
pub fn build_contingency(
    schedule_a: &Schedule,
    done_a: &HashSet<NaiveDate>,
    schedule_b: &Schedule,
    done_b: &HashSet<NaiveDate>,
    from: NaiveDate,
    to: NaiveDate,
) -> Contingency {
    let mut t = Contingency::default();
    let mut day = from;
    while day <= to {
        if schedule_a.is_scheduled_on(day) && schedule_b.is_scheduled_on(day) {
            match (done_a.contains(&day), done_b.contains(&day)) {
                (true, true) => t.a += 1,
                (true, false) => t.b += 1,
                (false, true) => t.c += 1,
                (false, false) => t.d += 1,
            }
        }
        match day.succ_opt() {
            Some(next) => day = next,
            None => break, // fim do calendário representável — inalcançável na vida real.
        }
    }
    t
}

/// φ = (ad − bc) / √((a+b)(c+d)(a+c)(b+d)). O denominador zero (uma margem
/// inteira vazia) devolve 0: sem variação numa das margens, não há associação
/// a medir.
fn phi_coefficient(t: Contingency) -> f64 {
    let (a, b, c, d) = (
        f64::from(t.a),
        f64::from(t.b),
        f64::from(t.c),
        f64::from(t.d),
    );
    let num = a * d - b * c;
    let denom = ((a + b) * (c + d) * (a + c) * (b + d)).sqrt();
    if denom == 0.0 {
        0.0
    } else {
        num / denom
    }
}

impl Correlation {
    /// Passa o crivo do template afirmativo ("nos dias em que você faz A, cumprir
    /// B sobe de X% para Y%")? Só um efeito positivo e forte o suficiente vira
    /// frase — o resto fica em "há uma relação fraca", sem afirmar direção.
    pub fn qualifies_for_positive_template(&self) -> bool {
        self.phi >= PHI_TEMPLATE_MIN && self.lift >= LIFT_TEMPLATE_MIN
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_small_sample_never_speaks() {
        // 29 dias: forte no papel, mas ruído — a guarda cala.
        let t = Contingency {
            a: 20,
            b: 1,
            c: 2,
            d: 6,
        };
        assert!(t.total() < MIN_SAMPLE);
        assert!(analyze(t).is_none());
    }

    #[test]
    fn a_clear_positive_lift_is_reported_and_qualifies() {
        // A feito: 30 dias, B em 27 -> 90%. A não: 30 dias, B em 9 -> 30%.
        let t = Contingency {
            a: 27,
            b: 3,
            c: 9,
            d: 21,
        };
        let r = analyze(t).expect("amostra 60, lift alto");
        assert!((r.p_b_given_a - 0.9).abs() < 1e-9);
        assert!((r.p_b_given_not_a - 0.3).abs() < 1e-9);
        assert!((r.lift - 3.0).abs() < 1e-9);
        assert!(r.phi > 0.25);
        assert!(r.qualifies_for_positive_template());
        assert!(r.formula.contains("lift"));
    }

    #[test]
    fn the_dead_band_is_silent() {
        // lift ~1.05: há um numerozinho, mas é acaso. Não vira card.
        // A: 40 dias, B em 21 -> 52,5%. ¬A: 40 dias, B em 20 -> 50%. lift = 1.05.
        let t = Contingency {
            a: 21,
            b: 19,
            c: 20,
            d: 20,
        };
        let r = analyze(t);
        assert!(r.is_none(), "lift na faixa morta não fala");
    }

    #[test]
    fn a_negative_lift_is_reported_but_does_not_qualify_for_the_positive_template() {
        // A atrapalha B: P(B|A) baixo, P(B|¬A) alto. lift < 1.
        let t = Contingency {
            a: 6,
            b: 24,
            c: 24,
            d: 6,
        };
        let r = analyze(t).expect("lift bem abaixo de 0.9");
        assert!(r.lift < 0.9);
        assert!(!r.qualifies_for_positive_template());
    }

    #[test]
    fn no_variation_in_a_returns_none() {
        // A foi feito TODO dia da amostra: não há "dias sem A" para comparar.
        let t = Contingency {
            a: 30,
            b: 10,
            c: 0,
            d: 0,
        };
        assert!(analyze(t).is_none());
    }

    #[test]
    fn the_contingency_only_counts_days_both_were_scheduled() {
        use chrono::NaiveDate;
        // A é diário; B só nas segundas (weekday 1). Só as segundas contam.
        let a = Schedule::Daily;
        let b = Schedule::Weekdays { days: vec![1] };
        let d = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap();

        // Janela: 2026-01-05 (segunda) a 2026-01-19 (segunda) — 3 segundas.
        let mut done_a = HashSet::new();
        let mut done_b = HashSet::new();
        done_a.insert(d("2026-01-05")); // seg: A feito
        done_b.insert(d("2026-01-05")); // seg: B feito  -> a
        done_a.insert(d("2026-01-12")); // seg: A feito, B não -> b
        done_b.insert(d("2026-01-19")); // seg: B feito, A não -> c
                                        // Um monte de dias no meio (terças etc.) com A feito não deve contar.
        done_a.insert(d("2026-01-06"));
        done_a.insert(d("2026-01-07"));

        let t = build_contingency(&a, &done_a, &b, &done_b, d("2026-01-05"), d("2026-01-19"));
        assert_eq!(t.a, 1, "05: ambos feitos");
        assert_eq!(t.b, 1, "12: A sim, B não");
        assert_eq!(t.c, 1, "19: A não, B sim");
        assert_eq!(t.d, 0);
        assert_eq!(t.total(), 3, "só as três segundas entram");
    }

    #[test]
    fn phi_is_symmetric_in_sign_with_the_association() {
        // Associação perfeita positiva -> phi = 1.
        let perfect = Contingency {
            a: 30,
            b: 0,
            c: 0,
            d: 30,
        };
        assert!((phi_coefficient(perfect) - 1.0).abs() < 1e-9);
        // Associação perfeita negativa -> phi = -1.
        let inverse = Contingency {
            a: 0,
            b: 30,
            c: 30,
            d: 0,
        };
        assert!((phi_coefficient(inverse) + 1.0).abs() < 1e-9);
    }
}
