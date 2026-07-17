//! Saúde Financeira — o número 0–100 que resume a carteira (§3.2).
//!
//! Determinístico e explicável, como o Nexus Score: a UI mostra "ⓘ como
//! calculamos" e a resposta é esta função. Zero IA, zero cotação, zero rede — só
//! aritmética sobre o que o usuário aportou.
//!
//! Quatro parcelas (§3.2 do plano):
//!
//!   30 pts  regularidade   — meses com aporte nos últimos 12, linear
//!   25 pts  diversificação — 1 − Herfindahl das classes
//!   25 pts  progresso      — média dos objetivos financeiros ativos
//!   20 pts  consistência   — aporte do mês ≥ 80% da média de 6 meses
//!
//! **Pesos redistribuídos entre o que se aplica**, exatamente como o Nexus Score
//! (ADR-0014). No M3.5 os objetivos financeiros ainda não existem (são do M4):
//! os 25 pontos deles se diluem nas outras três parcelas, em vez de zerar a nota
//! de quem ainda não tem uma caixinha. Quando o M4 os entregar, a parcela entra
//! sozinha — nada aqui muda.

use serde::Serialize;

use crate::domain::entities::AssetClass;

const W_REGULARITY: f64 = 30.0;
const W_DIVERSIFICATION: f64 = 25.0;
const W_GOALS: f64 = 25.0;
const W_CONSISTENCY: f64 = 20.0;

/// A fração do aporte do mês sobre a média de 6 meses que já vale nota cheia.
/// 80%: um mês um pouco abaixo da média não é falta de consistência, é a vida.
const CONSISTENCY_TARGET: f64 = 0.8;

/// Tudo vem de query; nada é estimado.
#[derive(Debug, Clone, Default)]
pub struct FinancialInputs {
    /// Meses distintos com ao menos um aporte, nos últimos 12.
    pub months_with_contribution_12m: u32,
    /// Total investido por classe, em centavos. Só o líquido POSITIVO conta para
    /// a alocação: uma classe zerada por resgate não é diversificação.
    pub class_cents: Vec<(AssetClass, i64)>,
    /// Média dos objetivos financeiros ativos (0..=1). `None` = não há nenhum —
    /// o caso do M3.5, e a parcela se redistribui.
    pub active_goal_progress: Option<f64>,
    /// Aporte do mês corrente, em centavos.
    pub this_month_cents: i64,
    /// Média mensal de aporte nos últimos 6 meses, em centavos.
    pub avg_6m_cents: f64,
}

/// Uma parcela da nota, com a conta que a produziu.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub label: String,
    /// Peso EFETIVO, já redistribuído.
    pub weight: f64,
    /// 0.0..=1.0
    pub ratio: f64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinancialHealth {
    /// 0..=100, ou `None` quando não há aporte nenhum — não zero. Zero diria
    /// "sua carteira está mal"; a verdade é que ainda não há carteira.
    pub value: Option<u8>,
    pub components: Vec<Component>,
    pub formula: String,
}

/// O índice de Herfindahl das classes: a soma dos quadrados das participações.
///
/// 1 (tudo numa classe) → 1/n (dividido igualmente). `1 − H` é a
/// diversificação: 0 quando concentrado, próximo de 1 quando espalhado.
///
/// Só as classes com saldo POSITIVO entram: uma zerada por resgate não é uma
/// aposta, e contá-la inflaria a diversificação com um zero.
fn one_minus_herfindahl(class_cents: &[(AssetClass, i64)]) -> Option<f64> {
    let total: i64 = class_cents.iter().map(|(_, c)| *c).filter(|c| *c > 0).sum();
    if total <= 0 {
        return None;
    }
    let h: f64 = class_cents
        .iter()
        .filter(|(_, c)| *c > 0)
        .map(|(_, c)| {
            let share = *c as f64 / total as f64;
            share * share
        })
        .sum();
    Some(1.0 - h)
}

/// Calcula a Saúde Financeira.
pub fn compute(input: &FinancialInputs) -> FinancialHealth {
    let mut components: Vec<Component> = Vec::new();

    // Regularidade — sempre se aplica quando há qualquer aporte no ano.
    if input.months_with_contribution_12m > 0 {
        let m = input.months_with_contribution_12m.min(12);
        components.push(Component {
            label: "Regularidade".into(),
            weight: W_REGULARITY,
            ratio: f64::from(m) / 12.0,
            detail: format!("{m} de 12 meses com aporte"),
        });
    }

    // Diversificação — só quando há patrimônio investido.
    if let Some(div) = one_minus_herfindahl(&input.class_cents) {
        let classes = input.class_cents.iter().filter(|(_, c)| *c > 0).count();
        components.push(Component {
            label: "Diversificação".into(),
            weight: W_DIVERSIFICATION,
            ratio: div.clamp(0.0, 1.0),
            detail: format!(
                "{classes} {} na carteira",
                if classes == 1 { "classe" } else { "classes" }
            ),
        });
    }

    // Progresso dos objetivos — M4. Ausente hoje, e por isso redistribuído.
    if let Some(p) = input.active_goal_progress {
        components.push(Component {
            label: "Objetivos".into(),
            weight: W_GOALS,
            ratio: p.clamp(0.0, 1.0),
            detail: format!("{}% dos objetivos ativos", (p * 100.0).round() as i64),
        });
    }

    // Consistência — só com 6 meses de história para comparar.
    if input.avg_6m_cents > 0.0 {
        let target = CONSISTENCY_TARGET * input.avg_6m_cents;
        let ratio = (input.this_month_cents as f64 / target).clamp(0.0, 1.0);
        components.push(Component {
            label: "Consistência".into(),
            weight: W_CONSISTENCY,
            ratio,
            detail: format!(
                "aporte do mês vs {}% da média de 6m",
                (CONSISTENCY_TARGET * 100.0) as i64
            ),
        });
    }

    if components.is_empty() {
        return FinancialHealth {
            value: None,
            components,
            formula: "Ainda sem aportes — não há carteira para avaliar.".into(),
        };
    }

    let total_weight: f64 = components.iter().map(|c| c.weight).sum();
    let earned: f64 = components.iter().map(|c| c.weight * c.ratio).sum();
    let value = (100.0 * earned / total_weight).round() as u8;

    let parts: Vec<String> = components
        .iter()
        .map(|c| {
            format!(
                "{} {:.0}%×{:.0}",
                c.label,
                c.ratio * 100.0,
                c.weight / total_weight * 100.0
            )
        })
        .collect();
    let formula = format!(
        "Saúde Financeira = {value} · pesos redistribuídos entre o que se aplica: {}.",
        parts.join(" + ")
    );

    FinancialHealth {
        value: Some(value),
        components,
        formula,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inputs() -> FinancialInputs {
        FinancialInputs::default()
    }

    #[test]
    fn no_contributions_is_none_not_zero() {
        // "Sua carteira está péssima" é diferente de "você ainda não tem
        // carteira". Zero afirmaria o primeiro; a verdade é o segundo.
        let h = compute(&inputs());
        assert_eq!(h.value, None);
    }

    #[test]
    fn a_single_class_scores_zero_on_diversification_but_still_appears() {
        // Tudo em renda fixa: Herfindahl = 1, diversificação = 0. A parcela
        // existe (para o usuário ver que dá para melhorar), mas vale 0.
        let mut i = inputs();
        i.months_with_contribution_12m = 12;
        i.class_cents = vec![(AssetClass::RendaFixa, 100_000)];
        let h = compute(&i);

        let div = h
            .components
            .iter()
            .find(|c| c.label == "Diversificação")
            .expect("a parcela aparece mesmo valendo zero");
        assert_eq!(div.ratio, 0.0);
    }

    #[test]
    fn an_even_split_diversifies_well() {
        // Quatro classes iguais: H = 4×(1/4)² = 0,25; 1−H = 0,75.
        let mut i = inputs();
        i.class_cents = vec![
            (AssetClass::RendaFixa, 100),
            (AssetClass::Acoes, 100),
            (AssetClass::Fiis, 100),
            (AssetClass::Cripto, 100),
        ];
        let div = one_minus_herfindahl(&i.class_cents).unwrap();
        assert!(
            (div - 0.75).abs() < 1e-9,
            "1 − H de 4 iguais é 0,75, veio {div}"
        );
    }

    #[test]
    fn a_resgate_does_not_inflate_diversification() {
        // Uma classe zerada por resgate (saldo <= 0) não é diversificação: ela
        // não entra na conta. Sem o filtro, um zero contaria como "mais uma
        // classe" e a diversificação subiria de mentira.
        let cents = vec![
            (AssetClass::RendaFixa, 100),
            (AssetClass::Acoes, 0),
            (AssetClass::Fiis, -50),
        ];
        // Só a renda fixa é positiva: uma classe só, H = 1, 1−H = 0.
        assert_eq!(one_minus_herfindahl(&cents), Some(0.0));
    }

    #[test]
    fn the_goals_weight_redistributes_when_there_are_none() {
        // O caso do M3.5: sem objetivos financeiros, os 25 pontos deles não
        // zeram a nota — eles se diluem. Uma carteira regular e diversificada,
        // sem objetivos, ainda tira nota alta.
        let mut i = inputs();
        i.months_with_contribution_12m = 12; // regularidade cheia
        i.class_cents = vec![(AssetClass::RendaFixa, 100), (AssetClass::Acoes, 100)]; // 1−H = 0,5
        i.this_month_cents = 100_000;
        i.avg_6m_cents = 100_000.0; // consistência cheia

        let h = compute(&i);
        assert!(
            !h.components.iter().any(|c| c.label == "Objetivos"),
            "a parcela dos objetivos não aparece quando não há nenhum"
        );
        // regularidade 1,0 + diversificação 0,5 + consistência 1,0, pesos
        // 30/25/20 = 75. earned = 30 + 12,5 + 20 = 62,5. 100×62,5/75 = 83.
        assert_eq!(h.value, Some(83));
    }

    #[test]
    fn goals_enter_the_average_when_they_exist() {
        // O M4: com objetivos, a parcela entra e o peso volta a ser 100.
        let mut i = inputs();
        i.months_with_contribution_12m = 12;
        i.class_cents = vec![(AssetClass::RendaFixa, 100), (AssetClass::Acoes, 100)];
        i.this_month_cents = 100_000;
        i.avg_6m_cents = 100_000.0;
        i.active_goal_progress = Some(0.6);

        let h = compute(&i);
        // 30×1 + 25×0,5 + 25×0,6 + 20×1 = 30 + 12,5 + 15 + 20 = 77,5 → 78.
        assert_eq!(h.value, Some(78));
        assert!(h.components.iter().any(|c| c.label == "Objetivos"));
    }

    #[test]
    fn consistency_needs_six_months_of_history() {
        // Sem média de 6m (avg = 0), não há com o que comparar: a parcela não
        // se aplica, em vez de acusar inconsistência de quem acabou de começar.
        let mut i = inputs();
        i.months_with_contribution_12m = 2;
        i.this_month_cents = 50_000;
        i.avg_6m_cents = 0.0;

        let h = compute(&i);
        assert!(!h.components.iter().any(|c| c.label == "Consistência"));
    }

    #[test]
    fn the_formula_is_always_shown() {
        // Constituição §2: todo insight se explica. Um número sem a conta é uma
        // caixa-preta, e o NEXUS não tem caixa-preta.
        let mut i = inputs();
        i.months_with_contribution_12m = 6;
        i.class_cents = vec![(AssetClass::RendaFixa, 100)];
        let h = compute(&i);
        assert!(h.formula.contains("Saúde Financeira ="));
        assert!(h.formula.contains("Regularidade"));
    }
}
