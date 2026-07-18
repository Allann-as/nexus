//! Aportes e patrimônio em SQLite.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{
    Account, Bucket, Contribution, ContributionRepository, MonthTotal, NewContribution,
};
use crate::domain::entities::AssetClass;
use crate::domain::errors::Result;
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;

pub struct SqliteContributionRepository {
    db: Arc<Db>,
}

impl SqliteContributionRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

/// O rótulo humano de uma classe — o que a legenda do donut mostra. Fica no
/// backend e não na UI porque o mesmo texto serve o gráfico e um dia servirá um
/// export CSV (M5); dois lugares divergiriam.
fn class_label(class: &str) -> &'static str {
    match AssetClass::parse(class) {
        Ok(AssetClass::RendaFixa) => "Renda fixa",
        Ok(AssetClass::Acoes) => "Ações",
        Ok(AssetClass::Fiis) => "FIIs",
        Ok(AssetClass::EtfExterior) => "ETF exterior",
        Ok(AssetClass::Cripto) => "Cripto",
        Ok(AssetClass::Reserva) => "Reserva",
        Ok(AssetClass::Outros) | Err(_) => "Outros",
    }
}

fn map_contribution(row: &Row) -> rusqlite::Result<Contribution> {
    Ok(Contribution {
        id: row.get(0)?,
        account_id: row.get(1)?,
        asset_class: row.get(2)?,
        amount_cents: row.get(3)?,
        happened_on: row.get(4)?,
        note: row.get(5)?,
        created_at: row.get(6)?,
    })
}

impl ContributionRepository for SqliteContributionRepository {
    fn accounts(&self) -> Result<Vec<Account>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT id, name, kind, color, sort_order
                   FROM accounts WHERE archived_at IS NULL
                  ORDER BY sort_order, name",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(Account {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    color: r.get(3)?,
                    sort_order: r.get(4)?,
                })
            })?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn create_with_event(
        &self,
        id: &str,
        c: &NewContribution,
        created_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Contribution> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            tx.execute(
                "INSERT INTO contributions
                   (id, account_id, asset_class, amount_cents, happened_on, note, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    id,
                    c.account_id,
                    c.asset_class.as_str(),
                    c.amount_cents,
                    c.happened_on,
                    c.note,
                    created_at,
                ],
            )?;
            append_in_tx(&tx, event)?;

            let created = tx.query_row(
                "SELECT id, account_id, asset_class, amount_cents, happened_on, note, created_at
                   FROM contributions WHERE id = ?1",
                params![id],
                map_contribution,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn recent(&self, limit: i64) -> Result<Vec<Contribution>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT id, account_id, asset_class, amount_cents, happened_on, note, created_at
                   FROM contributions
                  ORDER BY happened_on DESC, created_at DESC
                  LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], map_contribution)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn find(&self, id: &str) -> Result<Contribution> {
        self.db.with_read(|c| {
            c.query_row(
                "SELECT id, account_id, asset_class, amount_cents, happened_on, note, created_at
                   FROM contributions WHERE id = ?1",
                params![id],
                map_contribution,
            )
            .map_err(|_| crate::domain::errors::NexusError::NotFound(format!("aporte {id}")))
        })
    }

    fn delete_with_event(&self, id: &str, event: &NewLedgerEvent) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            // Só a linha de estado sai; a história fica e ganha o evento de correção.
            let changed = tx.execute("DELETE FROM contributions WHERE id = ?1", params![id])?;
            if changed == 0 {
                return Err(crate::domain::errors::NexusError::NotFound(format!(
                    "aporte {id}"
                )));
            }
            append_in_tx(&tx, event)?;
            tx.commit()?;
            Ok(())
        })
    }

    fn totals_by_class(&self) -> Result<Vec<Bucket>> {
        self.db.with_read(|c| {
            // `HAVING SUM > 0`: uma classe zerada por resgate não é uma fatia. O
            // donut some com ela em vez de desenhar uma fatia de largura zero.
            let mut stmt = c.prepare_cached(
                "SELECT asset_class, SUM(amount_cents) AS total
                   FROM contributions
                  GROUP BY asset_class
                 HAVING total > 0
                  ORDER BY total DESC",
            )?;
            let rows = stmt.query_map([], |r| {
                let key: String = r.get(0)?;
                Ok(Bucket {
                    label: class_label(&key).to_string(),
                    key,
                    cents: r.get(1)?,
                })
            })?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn totals_by_account(&self) -> Result<Vec<Bucket>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT a.id, a.name, SUM(c.amount_cents) AS total
                   FROM contributions c
                   JOIN accounts a ON a.id = c.account_id
                  GROUP BY a.id
                 HAVING total > 0
                  ORDER BY total DESC",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(Bucket {
                    key: r.get(0)?,
                    label: r.get(1)?,
                    cents: r.get(2)?,
                })
            })?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn monthly_totals(&self, months: i64) -> Result<Vec<MonthTotal>> {
        self.db.with_read(|c| {
            // `substr(happened_on, 1, 7)` é 'YYYY-MM': o mês local, sem
            // `strftime(..., 'localtime')`. `happened_on` já é dia local
            // (0010), então recortar os 7 primeiros caracteres é exato e usa o
            // índice por prefixo.
            let mut stmt = c.prepare_cached(
                "SELECT substr(happened_on, 1, 7) AS month, SUM(amount_cents) AS total
                   FROM contributions
                  GROUP BY month
                  ORDER BY month DESC
                  LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![months], |r| {
                Ok(MonthTotal {
                    month: r.get(0)?,
                    cents: r.get(1)?,
                })
            })?;
            // A query vem do mais recente (para o LIMIT pegar os últimos N); a
            // área acumulada desenha do mais antigo para o mais novo.
            let mut out = rows.collect::<rusqlite::Result<Vec<_>>>()?;
            out.reverse();
            Ok(out)
        })
    }

    fn latest_snapshot_cents(&self) -> Result<Option<i64>> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT total_cents FROM portfolio_snapshots ORDER BY month DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()?)
        })
    }

    fn set_snapshot(&self, month: &str, total_cents: i64, noted_at: i64) -> Result<()> {
        self.db.with_write(|c| {
            // INSERT OR REPLACE: informar de novo o mesmo mês corrige o total,
            // em vez de empilhar dois retratos que o gráfico não desempata.
            c.execute(
                "INSERT OR REPLACE INTO portfolio_snapshots (month, total_cents, noted_at)
                 VALUES (?1, ?2, ?3)",
                params![month, total_cents, noted_at],
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteContributionRepository) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (dir, SqliteContributionRepository::new(db))
    }

    fn ledger_event(id: &str) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1_000,
            day: "2026-07-17".into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::Contribution,
            event_type: EventType::Created,
            payload: serde_json::json!({}),
            title_snapshot: "Aporte".into(),
        }
    }

    fn contribute(
        repo: &SqliteContributionRepository,
        id: &str,
        account: &str,
        class: AssetClass,
        cents: i64,
        day: &str,
    ) {
        repo.create_with_event(
            id,
            &NewContribution {
                account_id: account.into(),
                asset_class: class,
                amount_cents: cents,
                happened_on: day.into(),
                note: None,
            },
            0,
            &ledger_event(id),
        )
        .unwrap();
    }

    #[test]
    fn the_six_system_accounts_are_there_from_the_start() {
        // Semeados pela 0005: a Esfera Finanças lista bancos desde o primeiro
        // boot, sem o usuário cadastrar nada.
        let (_d, repo) = fixture();
        let accounts = repo.accounts().unwrap();
        assert_eq!(accounts.len(), 6);
        assert!(accounts.iter().any(|a| a.id == "acct-btg-invest"));
    }

    #[test]
    fn a_contribution_writes_itself_and_a_ledger_event_together() {
        let (_d, repo) = fixture();
        contribute(
            &repo,
            "c1",
            "acct-btg-invest",
            AssetClass::RendaFixa,
            50_000,
            "2026-07-10",
        );

        assert_eq!(repo.recent(10).unwrap().len(), 1);
        let logged: i64 = repo
            .db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger WHERE entity_id = 'c1'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(logged, 1, "um aporte é um fato: ele existe na história");
    }

    #[test]
    fn deleting_an_aporte_removes_state_but_keeps_and_appends_to_the_ledger() {
        let (_d, repo) = fixture();
        contribute(
            &repo,
            "c1",
            "acct-btg-invest",
            AssetClass::RendaFixa,
            50_000,
            "2026-07-10",
        );

        let correction = NewLedgerEvent {
            event_type: EventType::Deleted,
            title_snapshot: "Aporte de R$ 500.00 removido".into(),
            ..ledger_event("c1")
        };
        repo.delete_with_event("c1", &correction).unwrap();

        // O estado sumiu: saldos e médias recalculam a partir daqui.
        assert_eq!(repo.recent(10).unwrap().len(), 0);
        assert!(repo.find("c1").is_err());

        // A história ficou E ganhou o evento de correção: o original não foi
        // reescrito (append-only), então há DOIS eventos para 'c1'.
        let logged: i64 = repo
            .db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger WHERE entity_id = 'c1'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(logged, 2, "o created original fica; o deleted é apendado");
    }

    #[test]
    fn deleting_a_missing_aporte_is_not_found() {
        let (_d, repo) = fixture();
        let ev = NewLedgerEvent {
            event_type: EventType::Deleted,
            ..ledger_event("nope")
        };
        assert!(repo.delete_with_event("nope", &ev).is_err());
    }

    #[test]
    fn a_resgate_is_a_negative_contribution_that_nets_out() {
        // "Botei 500, tirei 200" = 300 líquido, sem tabela de resgate.
        let (_d, repo) = fixture();
        contribute(
            &repo,
            "c1",
            "acct-btg-invest",
            AssetClass::Acoes,
            50_000,
            "2026-07-01",
        );
        contribute(
            &repo,
            "c2",
            "acct-btg-invest",
            AssetClass::Acoes,
            -20_000,
            "2026-07-15",
        );

        let classes = repo.totals_by_class().unwrap();
        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].cents, 30_000);
    }

    #[test]
    fn a_class_zeroed_by_a_resgate_disappears_from_the_donut() {
        // Uma fatia de largura zero não é uma fatia. O HAVING > 0 a esconde.
        let (_d, repo) = fixture();
        contribute(
            &repo,
            "c1",
            "acct-btg-invest",
            AssetClass::Cripto,
            10_000,
            "2026-07-01",
        );
        contribute(
            &repo,
            "c2",
            "acct-btg-invest",
            AssetClass::Cripto,
            -10_000,
            "2026-07-20",
        );

        assert!(repo.totals_by_class().unwrap().is_empty());
    }

    #[test]
    fn monthly_totals_come_out_oldest_first_for_the_area_chart() {
        let (_d, repo) = fixture();
        contribute(
            &repo,
            "c1",
            "acct-btg-invest",
            AssetClass::RendaFixa,
            10_000,
            "2026-05-10",
        );
        contribute(
            &repo,
            "c2",
            "acct-btg-invest",
            AssetClass::RendaFixa,
            20_000,
            "2026-06-10",
        );
        contribute(
            &repo,
            "c3",
            "acct-btg-invest",
            AssetClass::RendaFixa,
            30_000,
            "2026-07-10",
        );

        let months = repo.monthly_totals(12).unwrap();
        let seq: Vec<(&str, i64)> = months.iter().map(|m| (m.month.as_str(), m.cents)).collect();
        assert_eq!(
            seq,
            vec![
                ("2026-05", 10_000),
                ("2026-06", 20_000),
                ("2026-07", 30_000)
            ],
            "a área acumulada desenha do mais antigo ao mais novo"
        );
    }

    #[test]
    fn a_snapshot_for_the_same_month_corrects_instead_of_stacking() {
        let (_d, repo) = fixture();
        repo.set_snapshot("2026-07", 1_000_000, 0).unwrap();
        repo.set_snapshot("2026-07", 1_200_000, 1).unwrap();
        assert_eq!(repo.latest_snapshot_cents().unwrap(), Some(1_200_000));
    }
}
