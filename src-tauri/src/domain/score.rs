//! Nexus Score — o número que resume o dia.
//!
//! Determinístico e explicável: a UI mostra "ⓘ como calculamos" e a resposta é
//! esta função. Zero IA, zero caixa-preta.
//!
//! Pesos (§5.3 do prompt mestre):
//!
//!   40% hábitos agendados cumpridos
//!   30% tarefas planejadas concluídas
//!   20% rotina matinal completa
//!   10% inbox zerada

use serde::Serialize;

const W_HABITS: f64 = 40.0;
const W_TASKS: f64 = 30.0;
const W_ROUTINE: f64 = 20.0;
const W_INBOX: f64 = 10.0;

/// Contagens do dia. Tudo vem de query; nada é estimado.
#[derive(Debug, Clone, Copy, Default)]
pub struct ScoreInputs {
    pub habits_scheduled: u32,
    pub habits_done: u32,
    pub tasks_planned: u32,
    pub tasks_done: u32,
    /// Hábitos da rotina matinal. 0 = o usuário não tem rotina matinal.
    pub routine_total: u32,
    pub routine_done: u32,
    pub inbox_open: u32,
}

/// Uma parcela do score, com o que a produziu.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub label: String,
    /// Peso EFETIVO, já redistribuído (ver `compute`).
    pub weight: f64,
    /// 0.0..=1.0
    pub ratio: f64,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    /// 0..=100, ou `None` quando não havia nada a fazer.
    pub value: Option<u8>,
    pub components: Vec<Component>,
    pub formula: String,
}

/// Calcula o score do dia.
///
/// **Pesos são redistribuídos entre o que se aplica.** Quem não tem rotina
/// matinal não perde 20 pontos por isso, nem ganha 20 de graça: os 20% se
/// diluem nas demais parcelas. Um score que castiga por não usar uma feature
/// mede a feature, não o dia; um que presenteia vira enfeite.
///
/// Quando **nada** se aplica (sem hábitos agendados, sem tarefas planejadas,
/// sem rotina), o valor é `None` — não zero. Zero diria "você falhou" num dia em
/// que não havia o que fazer.
pub fn compute(input: ScoreInputs) -> Score {
    let mut components: Vec<Component> = Vec::new();

    if input.habits_scheduled > 0 {
        components.push(Component {
            label: "Hábitos".into(),
            weight: W_HABITS,
            ratio: ratio(input.habits_done, input.habits_scheduled),
            detail: format!(
                "{} de {} hábitos agendados",
                input.habits_done.min(input.habits_scheduled),
                input.habits_scheduled
            ),
        });
    }

    if input.tasks_planned > 0 {
        components.push(Component {
            label: "Tarefas".into(),
            weight: W_TASKS,
            ratio: ratio(input.tasks_done, input.tasks_planned),
            detail: format!(
                "{} de {} tarefas planejadas",
                input.tasks_done.min(input.tasks_planned),
                input.tasks_planned
            ),
        });
    }

    if input.routine_total > 0 {
        components.push(Component {
            label: "Rotina matinal".into(),
            weight: W_ROUTINE,
            ratio: ratio(input.routine_done, input.routine_total),
            detail: format!(
                "{} de {} passos",
                input.routine_done.min(input.routine_total),
                input.routine_total
            ),
        });
    }

    // O Inbox sempre se aplica: todo mundo tem um, e "zerada" é binário — é o
    // que a palavra quer dizer. Mas só entra na conta se houver alguma outra
    // parcela; sozinho, ele não é o seu dia.
    let has_other = !components.is_empty();
    if has_other {
        let zeroed = input.inbox_open == 0;
        components.push(Component {
            label: "Inbox".into(),
            weight: W_INBOX,
            ratio: if zeroed { 1.0 } else { 0.0 },
            detail: if zeroed {
                "zerada".into()
            } else {
                format!(
                    "{} {} aguardando triagem",
                    input.inbox_open,
                    plural(input.inbox_open)
                )
            },
        });
    }

    if components.is_empty() {
        return Score {
            value: None,
            components,
            formula: "Sem hábitos agendados, tarefas planejadas ou rotina hoje — \
                      não há score a calcular."
                .into(),
        };
    }

    // Redistribuição: normaliza pelos pesos presentes.
    let total_weight: f64 = components.iter().map(|c| c.weight).sum();
    let earned: f64 = components.iter().map(|c| c.weight * c.ratio).sum();
    let value = (earned / total_weight * 100.0).round().clamp(0.0, 100.0) as u8;

    // Reescreve os pesos como efetivos, para a UI mostrar a conta que de fato
    // foi feita — e não a tabela teórica.
    for c in components.iter_mut() {
        c.weight = (c.weight / total_weight * 100.0 * 10.0).round() / 10.0;
    }

    let parts: Vec<String> = components
        .iter()
        .map(|c| format!("{}% × {} ({})", c.weight, pct(c.ratio), c.detail))
        .collect();

    Score {
        value: Some(value),
        formula: format!("{} = {}", parts.join("  +  "), value),
        components,
    }
}

fn ratio(done: u32, total: u32) -> f64 {
    if total == 0 {
        return 0.0;
    }
    // min: marcar mais do que o agendado (rotina em cascata, import) não pode
    // gerar ratio > 1 e empurrar o score acima de 100.
    (f64::from(done.min(total))) / f64::from(total)
}

fn pct(ratio: f64) -> String {
    format!("{}%", (ratio * 100.0).round() as i64)
}

fn plural(n: u32) -> &'static str {
    if n == 1 {
        "item"
    } else {
        "itens"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_perfect_day_is_100() {
        let s = compute(ScoreInputs {
            habits_scheduled: 4,
            habits_done: 4,
            tasks_planned: 3,
            tasks_done: 3,
            routine_total: 5,
            routine_done: 5,
            inbox_open: 0,
        });
        assert_eq!(s.value, Some(100));
    }

    #[test]
    fn a_wasted_day_is_zero_not_none() {
        // Havia o que fazer e nada foi feito: zero é a resposta honesta.
        let s = compute(ScoreInputs {
            habits_scheduled: 4,
            habits_done: 0,
            tasks_planned: 3,
            tasks_done: 0,
            routine_total: 5,
            routine_done: 0,
            inbox_open: 9,
        });
        assert_eq!(s.value, Some(0));
    }

    #[test]
    fn a_day_with_nothing_scheduled_has_no_score() {
        // Zero diria "você falhou"; não havia o que fazer.
        let s = compute(ScoreInputs {
            inbox_open: 3,
            ..Default::default()
        });
        assert_eq!(s.value, None);
        assert!(s.components.is_empty());
        assert!(s.formula.contains("não há score"));
    }

    #[test]
    fn weights_redistribute_when_there_is_no_morning_routine() {
        // Sem rotina: hábitos/tarefas/inbox = 40/30/10 -> normalizado sobre 80.
        // Tudo cumprido tem que dar 100, não 80.
        let s = compute(ScoreInputs {
            habits_scheduled: 2,
            habits_done: 2,
            tasks_planned: 2,
            tasks_done: 2,
            routine_total: 0,
            routine_done: 0,
            inbox_open: 0,
        });
        assert_eq!(s.value, Some(100), "não ter rotina não pode custar pontos");

        let labels: Vec<&str> = s.components.iter().map(|c| c.label.as_str()).collect();
        assert!(!labels.contains(&"Rotina matinal"));

        // Os pesos efetivos exibidos precisam somar ~100.
        let total: f64 = s.components.iter().map(|c| c.weight).sum();
        assert!((total - 100.0).abs() < 0.5, "pesos efetivos somam {total}");
    }

    #[test]
    fn missing_only_the_inbox_costs_only_the_inbox_weight() {
        // Tudo feito, inbox com 1 item. Perde exatamente os 10%.
        let s = compute(ScoreInputs {
            habits_scheduled: 2,
            habits_done: 2,
            tasks_planned: 2,
            tasks_done: 2,
            routine_total: 2,
            routine_done: 2,
            inbox_open: 1,
        });
        assert_eq!(s.value, Some(90));
    }

    #[test]
    fn inbox_is_binary_not_graded() {
        // "Zerada" é uma palavra binária. 1 item ou 20 custam o mesmo.
        let mk = |open| {
            compute(ScoreInputs {
                habits_scheduled: 1,
                habits_done: 1,
                tasks_planned: 1,
                tasks_done: 1,
                routine_total: 1,
                routine_done: 1,
                inbox_open: open,
            })
        };
        assert_eq!(mk(1).value, mk(20).value);
        assert_eq!(mk(0).value, Some(100));
    }

    #[test]
    fn half_the_habits_gives_half_that_weight() {
        // Só hábitos: 2 de 4 -> 50% de um peso que virou 100% (redistribuído).
        let s = compute(ScoreInputs {
            habits_scheduled: 4,
            habits_done: 2,
            ..Default::default()
        });
        // Hábitos (40) + Inbox (10) presentes; inbox zerada = 1.0.
        // (40*0.5 + 10*1.0) / 50 = 60
        assert_eq!(s.value, Some(60));
    }

    #[test]
    fn overshooting_cannot_push_the_score_past_100() {
        // Concluir a rotina em cascata pode marcar mais hábitos que o agendado.
        let s = compute(ScoreInputs {
            habits_scheduled: 2,
            habits_done: 5,
            tasks_planned: 1,
            tasks_done: 4,
            routine_total: 1,
            routine_done: 3,
            inbox_open: 0,
        });
        assert_eq!(s.value, Some(100), "nunca acima de 100");
    }

    #[test]
    fn every_component_explains_itself() {
        // Regra da constituição: todo insight responde "como você calculou?".
        let s = compute(ScoreInputs {
            habits_scheduled: 4,
            habits_done: 3,
            tasks_planned: 2,
            tasks_done: 1,
            routine_total: 0,
            routine_done: 0,
            inbox_open: 2,
        });
        assert!(s.value.is_some());
        assert!(!s.formula.is_empty());
        for c in &s.components {
            assert!(!c.detail.is_empty(), "'{}' precisa se explicar", c.label);
            assert!((0.0..=1.0).contains(&c.ratio));
        }
        assert!(s.formula.contains("3 de 4 hábitos agendados"));
        assert!(s.formula.contains("2 itens aguardando triagem"));
    }

    #[test]
    fn inbox_alone_does_not_make_a_day() {
        // Só a inbox zerada não pode render 100: o dia não foi "perfeito",
        // simplesmente não havia nada agendado.
        let s = compute(ScoreInputs {
            inbox_open: 0,
            ..Default::default()
        });
        assert_eq!(s.value, None);
    }
}
