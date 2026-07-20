//! O NÍVEL de uma competência — DERIVADO do check-in mensal (BÚSSOLA, fase E).
//!
//! Até a v1.1 o nível 1-10 era escolhido num clique ("subir de nível"). Ele passa
//! a ser CALCULADO a partir de um histórico de check-ins mensais: o check-in é o
//! FATO que o usuário informa; o nível é DERIVAÇÃO (ADR-0037) — a mesma filosofia
//! do XP, da Saúde Financeira e do contador de sub-desafio.
//!
//! Módulo PURO: nada de `rusqlite`, nada de `tauri`, nada de relógio. Ele recebe
//! os check-ins e o mês de referência e devolve um número — testável sem banco.
//!
//! # A fórmula, por extenso
//!
//! Para cada mês com check-in, uma nota mensal `s` em 0..=1:
//!
//! ```text
//! s = 0.35 * studied
//!   + 0.35 * min(applied / 4, 1)
//!   + 0.30 * (stars - 1) / 4
//! ```
//!
//! * `studied` é 0 ou 1 — estudou ou não estudou, sem meio-termo.
//! * `applied` é TETADO em 4: um mês prolífico não pode dominar o histórico
//!   inteiro. Aplicar 20 vezes num mês não é cinco vezes melhor que aplicar 4.
//! * `stars` (1..5) vira 0..1: 1 estrela é o piso da escala, não um zero.
//!
//! Consideram-se os últimos [`WINDOW_MONTHS`] meses contando de trás para a
//! frente a partir do mês de referência. Dentro dessa janela:
//!
//! * um mês SEM check-in que seja IGUAL OU POSTERIOR ao primeiro check-in conta
//!   como `s = 0` — é o decaimento suave de abandonar a habilidade;
//! * um mês ANTERIOR ao primeiro check-in fica de FORA da conta — não se pune uma
//!   competência por ainda não existir.
//!
//! O peso de recência: um mês `k` meses antes da referência pesa
//! [`DECAY`]`^k`. O que aconteceu neste mês manda mais que o de um ano atrás.
//!
//! ```text
//! weighted_avg = Σ(w · s) / Σ(w)
//! level        = clamp(1 + round(9 · weighted_avg), 1, 10)
//! ```
//!
//! **Sem nenhum check-in, o resultado é `None` — não é nível 1.** Inventar um
//! nível para quem nunca fez check-in seria o app inventando um número, o que a
//! constituição proíbe. Quem chama é que decide o que mostrar (a Carreira usa o
//! `level` gravado como fallback — ver `Skill::computed_level`).

use crate::domain::errors::{NexusError, Result};

/// Quantos meses a janela olha para trás, o mês de referência incluso.
pub const WINDOW_MONTHS: i32 = 12;

/// O fator de recência por mês de distância: um mês atrás pesa 0.85, dois meses
/// 0.7225, e assim por diante. Nem tão agressivo que só o mês corrente conte,
/// nem tão suave que um ano atrás pese igual a hoje.
pub const DECAY: f64 = 0.85;

/// O teto de `applied` — ver a nota da fórmula no topo do módulo.
pub const APPLIED_CAP: f64 = 4.0;

/// Os três pesos da nota mensal. Somam 1.0 (a nota nunca sai de 0..=1).
pub const W_STUDIED: f64 = 0.35;
pub const W_APPLIED: f64 = 0.35;
pub const W_STARS: f64 = 0.30;

/// O nível mínimo e o máximo da escala mostrada ao usuário.
pub const MIN_LEVEL: i64 = 1;
pub const MAX_LEVEL: i64 = 10;

/// Um check-in mensal, como o domínio o enxerga (sem `noted_at`, que é
/// auditoria, não insumo da fórmula).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MonthlyCheckin {
    /// 'YYYY-MM' local.
    pub month: String,
    /// Estudou esta habilidade no mês?
    pub studied: bool,
    /// Quantas vezes aplicou/desenvolveu na prática (>= 0).
    pub applied: i64,
    /// Auto-avaliação da evolução no mês (1..5).
    pub stars: i64,
}

/// O nível calculado, com tudo que a UI precisa para o "ⓘ como calculamos".
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputedLevel {
    /// 1..=10.
    pub level: i64,
    /// A média ponderada das notas mensais, 0..=1 — o número antes da escala.
    pub weighted_avg: f64,
    /// Quantos meses entraram na conta (com e sem check-in). É o tamanho da
    /// amostra: a UI pode avisar que um nível de 1 mês ainda é provisório.
    pub sample_size: i64,
    /// A fórmula com os NÚMEROS de verdade, em português.
    pub formula: String,
}

/// A nota de um mês, 0..=1. Pública porque a UI mostra a nota do mês no
/// histórico, e porque é a peça que os testes cercam de perto.
///
/// `studied` fora de 0/1, `applied` negativo e `stars` fora de 1..5 são recusados
/// pelo CHECK da tabela; aqui eles são apenas saturados, para uma linha
/// corrompida jamais produzir uma nota fora de 0..=1.
pub fn monthly_score(studied: bool, applied: i64, stars: i64) -> f64 {
    let studied_part = if studied { W_STUDIED } else { 0.0 };
    let applied_part = W_APPLIED * (applied.max(0) as f64 / APPLIED_CAP).min(1.0);
    let stars_part = W_STARS * ((stars.clamp(1, 5) - 1) as f64 / 4.0);
    studied_part + applied_part + stars_part
}

/// Converte 'YYYY-MM' num índice absoluto de meses (`ano * 12 + mês - 1`), para
/// a distância entre dois meses ser uma subtração.
pub fn parse_month(s: &str) -> Result<i32> {
    let bad = || NexusError::Validation(format!("mês inválido '{s}' (esperado 'AAAA-MM')"));
    let (y, m) = s.split_once('-').ok_or_else(bad)?;
    if y.len() != 4 || m.len() != 2 {
        return Err(bad());
    }
    let year: i32 = y.parse().map_err(|_| bad())?;
    let month: i32 = m.parse().map_err(|_| bad())?;
    if !(1..=12).contains(&month) {
        return Err(bad());
    }
    Ok(year * 12 + month - 1)
}

/// O caminho de volta: o índice absoluto vira 'YYYY-MM'.
pub fn format_month(index: i32) -> String {
    let year = index.div_euclid(12);
    let month = index.rem_euclid(12) + 1;
    format!("{year:04}-{month:02}")
}

/// O mês de um dia local 'YYYY-MM-DD' — os primeiros 7 caracteres, validados.
pub fn month_of_day(day: &str) -> Result<String> {
    if day.len() < 7 {
        return Err(NexusError::Validation(format!(
            "dia inválido '{day}' (esperado 'AAAA-MM-DD')"
        )));
    }
    let month = &day[..7];
    parse_month(month)?;
    Ok(month.to_string())
}

/// Um número com 3 casas e vírgula decimal — a fórmula é lida por um humano
/// brasileiro, e "0.675" numa frase em português é ruído.
fn ptbr(v: f64) -> String {
    format!("{v:.3}").replace('.', ",")
}

/// O nível de uma competência no mês `reference_month`, a partir do histórico.
///
/// Devolve `None` quando não há check-in nenhum a considerar — ver a nota do
/// topo do módulo. Check-ins POSTERIORES ao mês de referência são ignorados: o
/// histórico é reconstruído mês a mês para o gráfico de evolução, e o passado
/// não pode enxergar o futuro.
pub fn compute_level(
    checkins: &[MonthlyCheckin],
    reference_month: &str,
) -> Result<Option<ComputedLevel>> {
    let reference = parse_month(reference_month)?;

    // (índice do mês, nota) — só o que já aconteceu do ponto de vista da referência.
    let mut scored: Vec<(i32, f64)> = Vec::with_capacity(checkins.len());
    for c in checkins {
        let idx = parse_month(&c.month)?;
        if idx <= reference {
            scored.push((idx, monthly_score(c.studied, c.applied, c.stars)));
        }
    }
    let Some(first) = scored.iter().map(|(i, _)| *i).min() else {
        return Ok(None);
    };

    let mut sum_ws = 0.0;
    let mut sum_w = 0.0;
    let mut sample_size = 0i64;
    let mut months_with_checkin = 0i64;

    for k in 0..WINDOW_MONTHS {
        let idx = reference - k;
        // Antes do primeiro check-in a competência não existia — fica de fora.
        if idx < first {
            continue;
        }
        // Sem check-in no mês, a nota é 0: o decaimento suave do abandono.
        let s = match scored.iter().find(|(i, _)| *i == idx) {
            Some((_, s)) => {
                months_with_checkin += 1;
                *s
            }
            None => 0.0,
        };
        let w = DECAY.powi(k);
        sum_ws += w * s;
        sum_w += w;
        sample_size += 1;
    }

    if sum_w == 0.0 {
        return Ok(None);
    }

    let weighted_avg = sum_ws / sum_w;
    let level = (1.0 + 9.0 * weighted_avg).round() as i64;
    let level = level.clamp(MIN_LEVEL, MAX_LEVEL);

    let formula = format!(
        "Nível = 1 + arredondar(9 × média ponderada) = 1 + arredondar(9 × {avg}) = {level}. \
         A nota de cada mês é 0,35 × estudou + 0,35 × mín(aplicou ÷ 4; 1) + 0,30 × (estrelas − 1) ÷ 4. \
         Os últimos {WINDOW_MONTHS} meses entram com peso {decay} elevado à distância em meses \
         (o mês atual pesa 1; o de 11 meses atrás, {oldest}). \
         Meses considerados: {sample_size}, desde o primeiro check-in ({first_month}); \
         com check-in: {months_with_checkin} — os demais contam como zero.",
        avg = ptbr(weighted_avg),
        decay = ptbr(DECAY),
        oldest = ptbr(DECAY.powi(WINDOW_MONTHS - 1)),
        first_month = format_month(first),
    );

    Ok(Some(ComputedLevel {
        level,
        weighted_avg,
        sample_size,
        formula,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn checkin(month: &str, studied: bool, applied: i64, stars: i64) -> MonthlyCheckin {
        MonthlyCheckin {
            month: month.into(),
            studied,
            applied,
            stars,
        }
    }

    /* ===== A nota mensal ===== */

    #[test]
    fn a_perfect_month_scores_one() {
        // Estudou, aplicou o teto, cinco estrelas: 0.35 + 0.35 + 0.30.
        assert!((monthly_score(true, 4, 5) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn an_empty_month_scores_zero() {
        // Não estudou, não aplicou, e a estrela mínima é o PISO da escala (não
        // um crédito): 1 estrela vale 0.
        assert!((monthly_score(false, 0, 1) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn the_three_parts_carry_their_documented_weights() {
        assert!((monthly_score(true, 0, 1) - 0.35).abs() < 1e-9);
        assert!((monthly_score(false, 4, 1) - 0.35).abs() < 1e-9);
        assert!((monthly_score(false, 0, 5) - 0.30).abs() < 1e-9);
        // Metade do teto de aplicações é metade daquele peso.
        assert!((monthly_score(false, 2, 1) - 0.175).abs() < 1e-9);
        // 3 estrelas é o meio da escala 1..5.
        assert!((monthly_score(false, 0, 3) - 0.15).abs() < 1e-9);
    }

    #[test]
    fn applied_is_capped_so_one_prolific_month_cannot_dominate() {
        let at_cap = monthly_score(true, 4, 5);
        assert!((monthly_score(true, 40, 5) - at_cap).abs() < 1e-9);
        assert!((monthly_score(true, 400, 5) - at_cap).abs() < 1e-9);
        // E abaixo do teto ainda cresce.
        assert!(monthly_score(true, 3, 5) < at_cap);
    }

    #[test]
    fn corrupt_rows_never_escape_the_zero_to_one_range() {
        // O CHECK da tabela já recusa isto; a saturação é o cinto de segurança.
        for s in [monthly_score(true, -5, 0), monthly_score(true, 999, 99)] {
            assert!((0.0..=1.0).contains(&s), "nota fora de 0..=1: {s}");
        }
    }

    /* ===== Os meses ===== */

    #[test]
    fn months_round_trip_through_their_index() {
        for m in ["2026-01", "2026-07", "2026-12", "1999-11"] {
            assert_eq!(format_month(parse_month(m).unwrap()), m);
        }
        // A distância entre dois meses é uma subtração — inclusive virando o ano.
        assert_eq!(
            parse_month("2027-01").unwrap() - parse_month("2026-12").unwrap(),
            1
        );
        assert_eq!(
            parse_month("2026-07").unwrap() - parse_month("2025-07").unwrap(),
            12
        );
    }

    #[test]
    fn a_malformed_month_is_refused() {
        for bad in [
            "2026",
            "2026-13",
            "2026-00",
            "26-07",
            "2026-7",
            "julho",
            "2026-07-18",
        ] {
            assert!(parse_month(bad).is_err(), "deveria recusar {bad}");
        }
    }

    #[test]
    fn month_of_day_takes_the_first_seven_chars() {
        assert_eq!(month_of_day("2026-07-18").unwrap(), "2026-07");
        assert!(month_of_day("2026-1").is_err());
        assert!(month_of_day("2026-13-01").is_err());
    }

    /* ===== O nível ===== */

    #[test]
    fn no_checkins_at_all_returns_none_not_level_one() {
        // O app não inventa números: sem fato, sem derivação.
        assert_eq!(compute_level(&[], "2026-07").unwrap(), None);
    }

    #[test]
    fn a_single_perfect_month_reaches_level_ten() {
        let r = compute_level(&[checkin("2026-07", true, 4, 5)], "2026-07")
            .unwrap()
            .unwrap();
        assert_eq!(r.level, 10);
        assert!((r.weighted_avg - 1.0).abs() < 1e-9);
        assert_eq!(r.sample_size, 1);
        assert!(r.formula.contains("Nível = 1"));
    }

    #[test]
    fn a_single_empty_month_bottoms_out_at_level_one() {
        // O clamp inferior: 1 + round(9 * 0) = 1, e nunca menos.
        let r = compute_level(&[checkin("2026-07", false, 0, 1)], "2026-07")
            .unwrap()
            .unwrap();
        assert_eq!(r.level, MIN_LEVEL);
        assert_eq!(r.weighted_avg, 0.0);
    }

    #[test]
    fn months_before_the_first_checkin_are_excluded_not_punished() {
        // Um único check-in perfeito no mês corrente dá 10 — os 11 meses
        // anteriores NÃO entram, porque a competência ainda não existia.
        let r = compute_level(&[checkin("2026-07", true, 4, 5)], "2026-07")
            .unwrap()
            .unwrap();
        assert_eq!(r.sample_size, 1);
        assert_eq!(r.level, 10);
    }

    #[test]
    fn missing_months_after_the_first_checkin_decay_the_level() {
        // Um mês perfeito e depois seis meses de silêncio: os seis contam 0.
        let history = [checkin("2026-01", true, 4, 5)];
        let fresh = compute_level(&history, "2026-01").unwrap().unwrap();
        let stale = compute_level(&history, "2026-07").unwrap().unwrap();

        assert_eq!(fresh.level, 10);
        assert!(
            stale.level < fresh.level,
            "abandonar a habilidade tem que baixar o nível: {} vs {}",
            stale.level,
            fresh.level
        );
        assert_eq!(stale.sample_size, 7, "jan..jul = 7 meses considerados");
        // E o mês perfeito, já distante, pesa pouco: 0.85^6 / Σ(0.85^0..6).
        assert!(stale.weighted_avg < 0.25, "avg = {}", stale.weighted_avg);
    }

    #[test]
    fn the_window_never_looks_past_twelve_months() {
        // Um check-in perfeito de dois anos atrás está FORA da janela: os 12
        // meses considerados são todos posteriores ao primeiro check-in e todos
        // vazios, então o nível decai até o piso. A habilidade não é esquecida
        // (ainda existe, e o resultado não é `None`) — ela está no nível 1.
        let r = compute_level(&[checkin("2024-07", true, 4, 5)], "2026-07")
            .unwrap()
            .unwrap();
        assert_eq!(r.level, MIN_LEVEL);
        assert_eq!(r.weighted_avg, 0.0);
        assert_eq!(r.sample_size, WINDOW_MONTHS as i64);

        // Com um check-in recente, a janela para em 12 meses mesmo havendo
        // histórico mais antigo.
        let r = compute_level(
            &[
                checkin("2020-01", true, 4, 5),
                checkin("2026-07", true, 4, 5),
            ],
            "2026-07",
        )
        .unwrap()
        .unwrap();
        assert_eq!(r.sample_size, WINDOW_MONTHS as i64);
    }

    #[test]
    fn recency_weighting_favours_the_recent_month() {
        // Mesmo par de meses, notas trocadas: o cenário com o mês BOM mais perto
        // da referência tem que valer mais.
        let recent_good = [
            checkin("2026-06", false, 0, 1),
            checkin("2026-07", true, 4, 5),
        ];
        let recent_bad = [
            checkin("2026-06", true, 4, 5),
            checkin("2026-07", false, 0, 1),
        ];

        let a = compute_level(&recent_good, "2026-07").unwrap().unwrap();
        let b = compute_level(&recent_bad, "2026-07").unwrap().unwrap();

        assert!(
            a.weighted_avg > b.weighted_avg,
            "o mês recente tem que pesar mais: {} vs {}",
            a.weighted_avg,
            b.weighted_avg
        );
        // A mesma amostra dos dois lados — o que muda é só o peso.
        assert_eq!(a.sample_size, b.sample_size);
        // Σ(w·s)/Σ(w) com w = [1, 0.85]: 1/1.85 e 0.85/1.85.
        assert!((a.weighted_avg - 1.0 / 1.85).abs() < 1e-9);
        assert!((b.weighted_avg - 0.85 / 1.85).abs() < 1e-9);
    }

    #[test]
    fn twelve_perfect_months_clamp_at_ten_and_never_above() {
        let history: Vec<_> = (1..=12)
            .map(|m| checkin(&format!("2026-{m:02}"), true, 4, 5))
            .collect();
        let r = compute_level(&history, "2026-12").unwrap().unwrap();
        assert_eq!(r.level, MAX_LEVEL);
        assert!((r.weighted_avg - 1.0).abs() < 1e-9);
        assert_eq!(r.sample_size, 12);
    }

    #[test]
    fn twelve_empty_months_clamp_at_one_and_never_below() {
        let history: Vec<_> = (1..=12)
            .map(|m| checkin(&format!("2026-{m:02}"), false, 0, 1))
            .collect();
        let r = compute_level(&history, "2026-12").unwrap().unwrap();
        assert_eq!(r.level, MIN_LEVEL);
        assert_eq!(r.weighted_avg, 0.0);
    }

    #[test]
    fn a_middling_history_lands_in_the_middle_of_the_scale() {
        // Todo mês igual: estudou, aplicou 2 de 4, 3 estrelas -> s = 0.675.
        // A média ponderada de uma constante é a própria constante, qualquer que
        // seja o peso — 1 + round(9 * 0.675) = 1 + 6 = 7.
        let history: Vec<_> = (1..=6)
            .map(|m| checkin(&format!("2026-{m:02}"), true, 2, 3))
            .collect();
        let r = compute_level(&history, "2026-06").unwrap().unwrap();
        assert!((r.weighted_avg - 0.675).abs() < 1e-9);
        assert_eq!(r.level, 7);
    }

    #[test]
    fn checkins_after_the_reference_month_are_ignored() {
        // O gráfico de evolução recalcula o nível mês a mês; o passado não pode
        // enxergar o futuro.
        let history = [
            checkin("2026-07", true, 4, 5),
            checkin("2026-08", true, 4, 5),
        ];
        let r = compute_level(&history, "2026-07").unwrap().unwrap();
        assert_eq!(r.sample_size, 1);
        // E um histórico que só tem meses futuros não computa nada.
        assert_eq!(
            compute_level(&[checkin("2026-08", true, 4, 5)], "2026-07").unwrap(),
            None
        );
    }

    #[test]
    fn the_formula_shows_the_real_numbers() {
        // Todo número derivado é exibível pelo "ⓘ como calculamos".
        let r = compute_level(&[checkin("2026-07", true, 2, 3)], "2026-07")
            .unwrap()
            .unwrap();
        assert!(r.formula.contains("0,675"), "fórmula: {}", r.formula);
        assert!(r.formula.contains("2026-07"), "fórmula: {}", r.formula);
        assert!(
            r.formula.contains("Meses considerados: 1"),
            "fórmula: {}",
            r.formula
        );
    }

    #[test]
    fn a_malformed_month_in_the_history_is_an_error_not_a_wrong_level() {
        assert!(compute_level(&[checkin("julho", true, 4, 5)], "2026-07").is_err());
        assert!(compute_level(&[checkin("2026-07", true, 4, 5)], "2026").is_err());
    }
}
