//! Casos de uso das Finanças: aportes, agregados e a Saúde Financeira.

use std::sync::Arc;

use chrono::{Datelike, Months, NaiveDate};
use serde::Serialize;
use serde_json::json;

use crate::application::ports::{
    Account, Bucket, Clock, Contribution, ContributionRepository, FinGoalRepository, IdGen,
    MonthTotal, NewContribution,
};
use crate::domain::entities::AssetClass;
use crate::domain::errors::{NexusError, Result};
use crate::domain::financial_health::{self, FinancialHealth, FinancialInputs};
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::schedule::{format_day, parse_day};

/// Tudo que o dashboard das Finanças precisa, numa chamada.
///
/// Uma tela, uma ida ao backend: o painel abre com sete perguntas (total,
/// alocação, bancos, série, médias, saúde), e sete round-trips fariam o cold
/// start da Esfera piscar seção por seção.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceOverview {
    /// Soma de todos os aportes (líquido de resgates), em centavos.
    pub total_contributed_cents: i64,
    /// O patrimônio informado à mão, se houver. `None` = nunca informado, e a UI
    /// mostra o total aportado no lugar.
    pub portfolio_cents: Option<i64>,
    pub by_class: Vec<Bucket>,
    pub by_account: Vec<Bucket>,
    /// Aporte por mês, do mais antigo ao mais novo — a área acumulada.
    pub monthly: Vec<MonthTotal>,
    pub this_month_cents: i64,
    /// Média mensal dos últimos 6 meses, em centavos.
    pub avg_6m_cents: i64,
    /// Meses seguidos, terminando no atual, com ao menos um aporte.
    pub streak_months: u32,
    pub health: FinancialHealth,
}

pub struct FinanceService {
    pub contributions: Arc<dyn ContributionRepository>,
    /// Os objetivos financeiros alimentam a parcela "Objetivos" da Saúde
    /// Financeira (ADR-0028). No M3.5 ela se redistribuía por não haver dado; o
    /// M4 trouxe as caixinhas, e a parcela ganhou fonte.
    pub fin_goals: Arc<dyn FinGoalRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl FinanceService {
    pub fn accounts(&self) -> Result<Vec<Account>> {
        self.contributions.accounts()
    }

    pub fn recent(&self, limit: i64) -> Result<Vec<Contribution>> {
        self.contributions.recent(limit)
    }

    /// Registra um aporte (ou resgate, com valor negativo).
    ///
    /// Um aporte É um fato da vida do usuário (ADR-0023) — ele grava no ledger,
    /// como uma pesagem grava. `entity_kind = Contribution`: o primeiro fato do
    /// ledger que não é um node (ADR-0027).
    pub fn contribute(&self, new: &NewContribution) -> Result<Contribution> {
        if new.amount_cents == 0 {
            return Err(NexusError::Validation(
                "um aporte de zero não é um aporte".into(),
            ));
        }
        // O dia é validado e normalizado: um 'happened_on' torto viraria um mês
        // fantasma na área acumulada.
        let day = format_day(parse_day(&new.happened_on)?);
        if !self.account_exists(&new.account_id)? {
            return Err(NexusError::NotFound(format!(
                "conta {} não existe",
                new.account_id
            )));
        }

        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let reais = new.amount_cents as f64 / 100.0;
        let verb = if new.amount_cents >= 0 {
            "Aporte"
        } else {
            "Resgate"
        };

        let event = NewLedgerEvent {
            ts: now,
            day: day.clone(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Contribution,
            // Um aporte é um valor registrado — o vocabulário do ledger já tem o
            // termo, e a Timeline (M4) desenha a série sem inventar um novo.
            event_type: EventType::ValueRecorded,
            payload: json!({
                "accountId": new.account_id,
                "assetClass": new.asset_class.as_str(),
                "amountCents": new.amount_cents,
            }),
            title_snapshot: format!("{verb} de R$ {reais:.2}"),
        };

        self.contributions.create_with_event(
            &id,
            &NewContribution {
                happened_on: day,
                ..new.clone()
            },
            now,
            &event,
        )
    }

    /// Exclui um aporte lançado por engano (REFINO R6). Dado financeiro errado
    /// tem que poder sair: apaga o ESTADO, e saldos/médias/meses recalculam
    /// sozinhos porque são derivados dos aportes. O evento original PERMANECE no
    /// ledger (append-only) e um evento de correção é apendado — a história diz
    /// que o aporte foi removido, sem jamais reescrever o passado (ADR-0056).
    pub fn delete_contribution(&self, id: &str) -> Result<()> {
        let existing = self.contributions.find(id)?;
        let now = self.clock.now_ms();
        let reais = existing.amount_cents.abs() as f64 / 100.0;
        let verb = if existing.amount_cents >= 0 {
            "Aporte"
        } else {
            "Resgate"
        };

        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Contribution,
            event_type: EventType::Deleted,
            payload: json!({
                "accountId": existing.account_id,
                "assetClass": existing.asset_class.as_str(),
                "amountCents": existing.amount_cents,
                "happenedOn": existing.happened_on,
            }),
            title_snapshot: format!("{verb} de R$ {reais:.2} removido"),
        };

        self.contributions.delete_with_event(id, &event)
    }

    pub fn set_snapshot(&self, month: &str, total_cents: i64) -> Result<()> {
        validate_month(month)?;
        if total_cents < 0 {
            return Err(NexusError::Validation(
                "o patrimônio não pode ser negativo".into(),
            ));
        }
        self.contributions
            .set_snapshot(month, total_cents, self.clock.now_ms())
    }

    /// O dashboard inteiro das Finanças.
    pub fn overview(&self) -> Result<FinanceOverview> {
        let today = parse_day(&self.clock.today_local())?;
        let this_month = month_str(today);

        let by_class = self.contributions.totals_by_class()?;
        let by_account = self.contributions.totals_by_account()?;
        // 24 meses cobrem a regularidade de 12m e a série de 12m com folga.
        let monthly = self.contributions.monthly_totals(24)?;

        let total_contributed_cents = self.total_contributed(&monthly);
        let this_month_cents = month_cents(&monthly, &this_month);
        let avg_6m_cents = average_last_6m(&monthly, today);
        let streak_months = streak_of_months(&monthly, today);
        let months_with_contribution_12m = months_active_within(&monthly, today, 12);

        let class_cents: Vec<(AssetClass, i64)> = by_class
            .iter()
            .filter_map(|b| AssetClass::parse(&b.key).ok().map(|c| (c, b.cents)))
            .collect();

        let health = financial_health::compute(&FinancialInputs {
            months_with_contribution_12m,
            class_cents,
            // A parcela dos objetivos (ADR-0028): a média de progresso das
            // caixinhas ativas. `None` (nenhuma caixinha) ainda redistribui,
            // como antes — a nota não pune quem não usa a feature.
            active_goal_progress: self.fin_goals.active_progress()?,
            this_month_cents,
            avg_6m_cents: avg_6m_cents as f64,
        });

        // A área acumulada quer os últimos 12 meses, do mais antigo ao mais novo.
        let monthly_12: Vec<MonthTotal> = monthly
            .iter()
            .filter(|m| within_months(&m.month, today, 12))
            .cloned()
            .collect();

        Ok(FinanceOverview {
            total_contributed_cents,
            portfolio_cents: self.contributions.latest_snapshot_cents()?,
            by_class,
            by_account,
            monthly: monthly_12,
            this_month_cents,
            avg_6m_cents,
            streak_months,
            health,
        })
    }

    fn account_exists(&self, id: &str) -> Result<bool> {
        Ok(self.contributions.accounts()?.iter().any(|a| a.id == id))
    }

    fn total_contributed(&self, monthly: &[MonthTotal]) -> i64 {
        monthly.iter().map(|m| m.cents).sum()
    }
}

/// 'YYYY-MM' de uma data.
fn month_str(d: NaiveDate) -> String {
    format!("{:04}-{:02}", d.year(), d.month())
}

/// O aporte líquido de um mês específico na série, ou 0.
fn month_cents(monthly: &[MonthTotal], month: &str) -> i64 {
    monthly
        .iter()
        .find(|m| m.month == month)
        .map(|m| m.cents)
        .unwrap_or(0)
}

/// Um mês 'YYYY-MM' está dentro dos últimos `n` meses (inclusive o atual)?
fn within_months(month: &str, today: NaiveDate, n: u32) -> bool {
    let Some(cutoff) = today.checked_sub_months(Months::new(n - 1)) else {
        return false;
    };
    month >= month_str(cutoff).as_str()
}

/// Quantos dos últimos `n` meses tiveram aporte.
fn months_active_within(monthly: &[MonthTotal], today: NaiveDate, n: u32) -> u32 {
    monthly
        .iter()
        .filter(|m| m.cents != 0 && within_months(&m.month, today, n))
        .count() as u32
}

/// A média mensal dos últimos 6 meses — soma / 6, não / meses ativos.
///
/// Dividir pelos meses ATIVOS mediria "quanto aporto quando aporto"; dividir por
/// 6 mede "quanto aporto por mês", que é a pergunta da consistência: um mês
/// pulado tem que puxar a média para baixo.
fn average_last_6m(monthly: &[MonthTotal], today: NaiveDate) -> i64 {
    let sum: i64 = monthly
        .iter()
        .filter(|m| within_months(&m.month, today, 6))
        .map(|m| m.cents)
        .sum();
    sum / 6
}

/// Meses seguidos, terminando no mês atual, com ao menos um aporte.
///
/// Um buraco quebra a sequência. O mês atual sem aporte ainda conta como vivo se
/// o anterior teve — não: a sequência que interessa termina no último mês
/// COMPLETO com aporte, então um mês atual vazio não zera o que já foi
/// construído; ele só não estende. Começamos do mês atual e andamos para trás
/// enquanto houver aporte.
fn streak_of_months(monthly: &[MonthTotal], today: NaiveDate) -> u32 {
    let active: std::collections::HashSet<&str> = monthly
        .iter()
        .filter(|m| m.cents != 0)
        .map(|m| m.month.as_str())
        .collect();

    let mut streak = 0;
    let mut cursor = today;
    // Se o mês atual ainda não teve aporte, a sequência é medida a partir do mês
    // anterior — o mês corrente está em curso e ainda pode ganhar um aporte.
    if !active.contains(month_str(cursor).as_str()) {
        let Some(prev) = cursor.checked_sub_months(Months::new(1)) else {
            return 0;
        };
        cursor = prev;
    }
    while active.contains(month_str(cursor).as_str()) {
        streak += 1;
        match cursor.checked_sub_months(Months::new(1)) {
            Some(p) => cursor = p,
            None => break,
        }
    }
    streak
}

fn validate_month(month: &str) -> Result<()> {
    let bad = || NexusError::Validation(format!("mês inválido: {month} (esperado 'AAAA-MM')"));
    let (y, m) = month.split_once('-').ok_or_else(bad)?;
    let year: i32 = y.parse().map_err(|_| bad())?;
    let mon: u32 = m.parse().map_err(|_| bad())?;
    NaiveDate::from_ymd_opt(year, mon, 1).ok_or_else(bad)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(month: &str, cents: i64) -> MonthTotal {
        MonthTotal {
            month: month.into(),
            cents,
        }
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 15).unwrap()
    }

    #[test]
    fn within_months_bounds_to_the_calendar_window() {
        // 12 meses a partir de julho/2026 vão até agosto/2025 (inclusive).
        assert!(within_months("2025-08", today(), 12));
        assert!(
            !within_months("2025-07", today(), 12),
            "13 meses atrás está fora"
        );
        assert!(
            within_months("2026-07", today(), 12),
            "o mês atual está dentro"
        );
    }

    #[test]
    fn the_six_month_average_divides_by_six_not_by_active_months() {
        // Aportou em 2 dos últimos 6 meses, R$ 600 cada. Média = 1200/6 = 200,
        // não 600. Um mês pulado tem que puxar a média para baixo.
        let series = vec![m("2026-06", 60_000), m("2026-07", 60_000)];
        assert_eq!(average_last_6m(&series, today()), 20_000);
    }

    #[test]
    fn the_streak_counts_consecutive_months_back_from_now() {
        let series = vec![m("2026-05", 100), m("2026-06", 100), m("2026-07", 100)];
        assert_eq!(streak_of_months(&series, today()), 3);
    }

    #[test]
    fn a_gap_breaks_the_streak() {
        // Maio e julho, sem junho: a sequência que termina agora é só julho.
        let series = vec![m("2026-05", 100), m("2026-07", 100)];
        assert_eq!(streak_of_months(&series, today()), 1);
    }

    #[test]
    fn an_empty_current_month_does_not_zero_a_built_streak() {
        // Ainda não aportei em julho, mas maio e junho tiveram: a sequência é 2,
        // não 0 — julho está em curso e ainda pode ganhar um aporte.
        let series = vec![m("2026-05", 100), m("2026-06", 100)];
        assert_eq!(streak_of_months(&series, today()), 2);
    }

    #[test]
    fn months_active_within_ignores_old_activity() {
        // Doze meses ativos, mas todos há mais de um ano: a regularidade do ano
        // corrente é zero, não doze.
        let series = vec![m("2024-01", 100), m("2024-02", 100)];
        assert_eq!(months_active_within(&series, today(), 12), 0);
    }

    #[test]
    fn a_month_outside_the_vocabulary_is_refused() {
        for bad in ["2026", "2026-13", "julho", ""] {
            assert!(validate_month(bad).is_err(), "'{bad}' não é um mês");
        }
    }
}
