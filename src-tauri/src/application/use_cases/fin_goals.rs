//! Casos de uso dos Objetivos Financeiros — as "caixinhas".

use std::sync::Arc;

use chrono::{Datelike, Months, NaiveDate};
use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    AreaRepository, Clock, FinGoal, FinGoalDeposit, FinGoalRepository, IdGen, NewFinGoal,
    NewFinGoalDeposit, NewNode, NodeRepository,
};
use crate::domain::entities::{validate_title, Kind};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::savings::{self, SavingsProjection, RATE_MONTHS};
use crate::domain::schedule::{format_day, parse_day};

/// Uma caixinha com a projeção já calculada — o que o card mostra.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinGoalCard {
    #[serde(flatten)]
    pub goal: FinGoal,
    pub projection: SavingsProjection,
}

/// O resultado de um depósito: o depósito e se ele FECHOU a caixinha.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositOutcome {
    pub deposit: FinGoalDeposit,
    /// `true` quando este depósito cruzou o alvo — a UI dispara a celebração.
    pub completed: bool,
}

pub struct FinGoalService {
    pub fin_goals: Arc<dyn FinGoalRepository>,
    /// Para EXCLUIR: uma caixinha é um node, e apagar um node é a mesma
    /// operação para todos eles (ADR-0056). Ver `FinGoalService::delete`.
    pub nodes: Arc<dyn NodeRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl FinGoalService {
    pub fn create(
        &self,
        title: &str,
        area_id: Option<String>,
        target_cents: i64,
        account_id: Option<String>,
        deadline: Option<String>,
        emoji: Option<String>,
    ) -> Result<FinGoal> {
        let title = validate_title(title)?;
        if target_cents <= 0 {
            return Err(NexusError::Validation(
                "o alvo de uma caixinha precisa ser positivo".into(),
            ));
        }
        if let Some(ref a) = area_id {
            if !self.areas.exists(a)? {
                return Err(NexusError::NotFound(format!("esfera {a} não existe")));
            }
        }
        // O prazo é validado e normalizado: um 'deadline' torto viraria um dado
        // que a projeção e a UI não sabem ler.
        let deadline = deadline
            .map(|d| parse_day(&d).map(format_day))
            .transpose()?;
        // 'target' é o ícone Lucide padrão (M4.6: ícone, não emoji — ADR-0042).
        // A coluna se chama `emoji` por legado; hoje guarda um NOME de ícone.
        let emoji = emoji
            .map(|e| e.trim().to_string())
            .filter(|e| !e.is_empty())
            .unwrap_or_else(|| "target".into());

        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::FinGoal),
            event_type: EventType::Created,
            payload: json!({ "targetCents": target_cents }),
            title_snapshot: title.clone(),
        };

        self.fin_goals.create_with_event(
            &id,
            &NewNode {
                kind: Kind::FinGoal,
                title: title.clone(),
                area_id: area_id.clone(),
                parent_id: None,
            },
            &NewFinGoal {
                title,
                area_id,
                target_cents,
                account_id,
                deadline,
                emoji,
            },
            &event,
        )
    }

    /// As caixinhas de uma Esfera (ou todas), cada uma com a projeção pronta.
    pub fn list(&self, area_id: Option<&str>) -> Result<Vec<FinGoalCard>> {
        let today = parse_day(&self.clock.today_local())?;
        let rate_since = rate_window_start(today);

        let rows = self.fin_goals.list(area_id, &rate_since)?;
        Ok(rows
            .into_iter()
            .map(|(goal, recent)| {
                let projection =
                    savings::project(goal.saved_cents, goal.target_cents, recent, today);
                FinGoalCard { goal, projection }
            })
            .collect())
    }

    /// Deposita (ou saca, com valor negativo) numa caixinha.
    ///
    /// Um depósito É um fato da vida do usuário (ADR-0023) — grava no ledger. Se
    /// ele fechar a caixinha, a conquista entra junto, na mesma transação.
    pub fn deposit(
        &self,
        goal_id: &str,
        amount_cents: i64,
        happened_on: Option<String>,
        note: Option<String>,
    ) -> Result<DepositOutcome> {
        if amount_cents == 0 {
            return Err(NexusError::Validation(
                "um depósito de zero não é um depósito".into(),
            ));
        }
        let goal = self.fin_goals.get(goal_id)?;
        let day = match happened_on {
            Some(d) => format_day(parse_day(&d)?),
            None => self.clock.today_local(),
        };
        let now = self.clock.now_ms();
        let id = self.ids.new_id();

        let saved_after = goal.saved_cents + amount_cents;
        // O cruzamento do alvo: só um depósito POSITIVO que leva de abaixo para
        // igual-ou-acima do alvo é uma conquista. Um saque nunca fecha; um
        // depósito numa caixinha já fechada não reconquista.
        let just_completed = amount_cents > 0
            && goal.saved_cents < goal.target_cents
            && saved_after >= goal.target_cents;

        let verb = if amount_cents >= 0 {
            "Depósito"
        } else {
            "Saque"
        };
        let reais = amount_cents.abs() as f64 / 100.0;
        let deposit_event = NewLedgerEvent {
            ts: now,
            day: day.clone(),
            entity_id: goal_id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::FinGoal),
            event_type: EventType::ValueRecorded,
            payload: json!({
                "depositId": id,
                "amountCents": amount_cents,
                "savedCents": saved_after,
                "targetCents": goal.target_cents,
            }),
            title_snapshot: format!("{verb} de R$ {reais:.2} · {}", goal.title),
        };

        let completion = just_completed.then(|| NewLedgerEvent {
            ts: now,
            day: day.clone(),
            entity_id: goal_id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::FinGoal),
            event_type: EventType::Completed,
            payload: json!({
                "achievement": "fin_goal_complete",
                "targetCents": goal.target_cents,
            }),
            title_snapshot: format!("Objetivo alcançado — {}", goal.title),
        });

        let deposit = self.fin_goals.deposit_with_event(
            &id,
            &NewFinGoalDeposit {
                goal_id: goal_id.to_string(),
                amount_cents,
                happened_on: day,
                note,
            },
            now,
            &deposit_event,
            completion.as_ref(),
        )?;

        Ok(DepositOutcome {
            deposit,
            completed: just_completed,
        })
    }

    pub fn deposits(&self, goal_id: &str) -> Result<Vec<FinGoalDeposit>> {
        self.fin_goals.deposits(goal_id)
    }

    /// Apaga um depósito lançado por engano (v1.3, fase 3c).
    ///
    /// O aporte já podia ser excluído desde o ADR-0056; o depósito de caixinha,
    /// não — e é o mesmo dinheiro, digitado com o mesmo teclado. Um R$ 5.000
    /// onde eram R$ 500 ficava lá, inflando o guardado e a projeção de quando a
    /// caixinha fecha.
    ///
    /// `saved_cents` não é atualizado porque não existe como coluna: é a SOMA dos
    /// depósitos, feita na leitura (0011). Tirar a linha já corrige o saldo, a
    /// barra e a projeção.
    ///
    /// **O que NÃO é desfeito, de propósito:** se aquele depósito fechou a
    /// caixinha, o `Completed` continua no ledger e a conquista continua contada.
    /// O ledger é append-only (ADR-0056) — a conquista ACONTECEU no instante em
    /// que o número cruzou o alvo. O `nodes.status` também não volta a 'active'
    /// sozinho: reabrir uma caixinha é uma decisão do usuário, não um efeito
    /// colateral de apagar uma linha.
    pub fn delete_deposit(&self, id: &str) -> Result<()> {
        let deposit = self.fin_goals.get_deposit(id)?;
        let goal = self.fin_goals.get(&deposit.goal_id)?;

        let reais = deposit.amount_cents.abs() as f64 / 100.0;
        let verb = if deposit.amount_cents >= 0 {
            "Depósito"
        } else {
            "Saque"
        };

        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: deposit.goal_id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::FinGoal),
            event_type: EventType::Deleted,
            payload: json!({
                "depositId": id,
                "amountCents": deposit.amount_cents,
                "happenedOn": deposit.happened_on,
            }),
            title_snapshot: format!("{verb} de R$ {reais:.2} removido — {}", goal.title),
        };

        self.fin_goals.delete_deposit_with_event(id, &event)
    }

    /// Exclui uma caixinha (BÚSSOLA, fase B).
    ///
    /// O que o usuário criou, ele tem que poder desfazer. A regra é a mesma do
    /// ADR-0056: apaga o ESTADO, e o ledger fica. O evento `Deleted` entra na
    /// MESMA transação do DELETE (`delete_with_event`), então ou a história e o
    /// estado andam juntos ou nenhum dos dois anda.
    ///
    /// Os DEPÓSITOS saem junto pelo CASCADE encadeado do schema:
    /// `nodes` -> `fin_goal_details(node_id)` -> `fin_goal_deposits(goal_id)`,
    /// os dois `ON DELETE CASCADE` da 0011, com `PRAGMA foreign_keys = ON`
    /// aplicado em toda conexão. Nada a apagar à mão aqui — e o teste
    /// `deleting_a_caixinha_takes_its_deposits_with_it` é quem garante isso.
    pub fn delete(&self, id: &str) -> Result<()> {
        // Lê pelo repositório da caixinha, não pelo de nodes: assim um id de
        // tarefa ou de hábito não é apagado por um command chamado
        // `delete_fin_goal`. O `NotFound` vem daqui.
        let goal = self.fin_goals.get(id)?;
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::FinGoal),
            event_type: EventType::Deleted,
            payload: json!({
                "targetCents": goal.target_cents,
                "savedCents": goal.saved_cents,
            }),
            title_snapshot: goal.title.clone(),
        };
        self.nodes.delete_with_event(id, &event)
    }
}

/// O primeiro dia da janela de ritmo: o dia 1 do mês [`RATE_MONTHS`] meses atrás
/// (inclusive o corrente). Para julho e 3 meses → 1º de maio.
fn rate_window_start(today: NaiveDate) -> String {
    let first_of_month = today.with_day(1).unwrap_or(today);
    let start = first_of_month
        .checked_sub_months(Months::new(RATE_MONTHS - 1))
        .unwrap_or(first_of_month);
    format!(
        "{:04}-{:02}-{:02}",
        start.year(),
        start.month(),
        start.day()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rate_window_starts_three_months_back_at_the_first() {
        let today = NaiveDate::from_ymd_opt(2026, 7, 15).unwrap();
        assert_eq!(rate_window_start(today), "2026-05-01");
    }

    #[test]
    fn the_rate_window_crosses_the_year_boundary() {
        let today = NaiveDate::from_ymd_opt(2026, 1, 20).unwrap();
        assert_eq!(rate_window_start(today), "2025-11-01");
    }
}
