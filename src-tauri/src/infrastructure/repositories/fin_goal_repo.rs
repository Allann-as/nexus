//! Objetivos Financeiros (as "caixinhas") em SQLite.
//!
//! Uma caixinha é um node 'fin_goal' com o satélite `fin_goal_details`; o total
//! guardado é a soma de `fin_goal_deposits`, nunca um número à mão — o mesmo
//! princípio do contador de sub-desafio.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{
    FinGoal, FinGoalDeposit, FinGoalRepository, NewFinGoal, NewFinGoalDeposit, NewNode,
};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;
use crate::infrastructure::repositories::node_repo::insert_in_tx;

pub struct SqliteFinGoalRepository {
    db: Arc<Db>,
}

impl SqliteFinGoalRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

/// O SELECT de uma caixinha, com `saved_cents` já somado e o nome do banco.
/// `?1` é o dia-piso da janela de projeção; a coluna extra é o total desde ele.
const SELECT_GOAL: &str = "
    SELECT n.id, n.title, n.area_id, n.status,
           g.target_cents, g.account_id, a.name, g.deadline, g.emoji,
           COALESCE((SELECT SUM(d.amount_cents) FROM fin_goal_deposits d
                      WHERE d.goal_id = n.id), 0) AS saved_cents,
           n.created_at,
           COALESCE((SELECT SUM(d.amount_cents) FROM fin_goal_deposits d
                      WHERE d.goal_id = n.id AND d.happened_on >= ?1), 0) AS recent_cents
      FROM fin_goal_details g
      JOIN nodes n     ON n.id = g.node_id
      LEFT JOIN accounts a ON a.id = g.account_id";

fn map_goal(row: &Row) -> rusqlite::Result<(FinGoal, i64)> {
    let goal = FinGoal {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        target_cents: row.get(4)?,
        account_id: row.get(5)?,
        account_name: row.get(6)?,
        deadline: row.get(7)?,
        emoji: row.get(8)?,
        saved_cents: row.get(9)?,
        created_at: row.get(10)?,
    };
    let recent: i64 = row.get(11)?;
    Ok((goal, recent))
}

fn map_deposit(row: &Row) -> rusqlite::Result<FinGoalDeposit> {
    Ok(FinGoalDeposit {
        id: row.get(0)?,
        goal_id: row.get(1)?,
        amount_cents: row.get(2)?,
        happened_on: row.get(3)?,
        note: row.get(4)?,
        created_at: row.get(5)?,
    })
}

impl FinGoalRepository for SqliteFinGoalRepository {
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewFinGoal,
        event: &NewLedgerEvent,
    ) -> Result<FinGoal> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            insert_in_tx(&tx, id, node, event.ts)?;
            tx.execute(
                "INSERT INTO fin_goal_details
                   (node_id, target_cents, account_id, deadline, emoji)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    id,
                    new.target_cents,
                    new.account_id,
                    new.deadline,
                    new.emoji
                ],
            )?;
            append_in_tx(&tx, event)?;

            let (created, _) = tx.query_row(
                &format!("{SELECT_GOAL} WHERE n.id = ?2"),
                // ?1 (rate_since) é irrelevante na criação: uma caixinha nova não
                // tem depósito. Um dia impossível de bater garante recent = 0.
                params!["9999-99-99", id],
                map_goal,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn get(&self, id: &str) -> Result<FinGoal> {
        self.db.with_read(|c| {
            c.query_row(
                &format!("{SELECT_GOAL} WHERE n.id = ?2"),
                params!["9999-99-99", id],
                map_goal,
            )
            .optional()?
            .map(|(g, _)| g)
            .ok_or_else(|| NexusError::NotFound(format!("objetivo financeiro {id}")))
        })
    }

    fn list(&self, area_id: Option<&str>, rate_since: &str) -> Result<Vec<(FinGoal, i64)>> {
        self.db.with_read(|c| {
            // Arquivadas somem; a ordem é a de criação, como as metas.
            let (where_area, sql);
            match area_id {
                Some(_) => {
                    where_area = " AND n.area_id = ?2";
                    sql = format!(
                        "{SELECT_GOAL} WHERE n.status <> 'archived'{where_area} \
                         ORDER BY n.created_at DESC, n.id DESC"
                    );
                    let mut stmt = c.prepare_cached(&sql)?;
                    let rows = stmt.query_map(params![rate_since, area_id], map_goal)?;
                    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
                }
                None => {
                    sql = format!(
                        "{SELECT_GOAL} WHERE n.status <> 'archived' \
                         ORDER BY n.created_at DESC, n.id DESC"
                    );
                    let mut stmt = c.prepare_cached(&sql)?;
                    let rows = stmt.query_map(params![rate_since], map_goal)?;
                    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
                }
            }
        })
    }

    fn deposit_with_event(
        &self,
        id: &str,
        deposit: &NewFinGoalDeposit,
        created_at: i64,
        deposit_event: &NewLedgerEvent,
        completion: Option<&NewLedgerEvent>,
    ) -> Result<FinGoalDeposit> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            tx.execute(
                "INSERT INTO fin_goal_deposits
                   (id, goal_id, amount_cents, happened_on, note, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    deposit.goal_id,
                    deposit.amount_cents,
                    deposit.happened_on,
                    deposit.note,
                    created_at,
                ],
            )?;
            append_in_tx(&tx, deposit_event)?;

            // A conquista (§2.1): quando o depósito fecha a caixinha, o node vira
            // 'done' e o 🏆 entra no ledger — na mesma transação que o depósito.
            // Sem a atomicidade, uma falha entre os dois deixaria a caixinha
            // cheia sem conquista, ou a conquista sem o dinheiro.
            if let Some(done) = completion {
                tx.execute(
                    "UPDATE nodes SET status = 'done', updated_at = ?2
                      WHERE id = ?1 AND status <> 'done'",
                    params![deposit.goal_id, created_at],
                )?;
                append_in_tx(&tx, done)?;
            }

            let created = tx.query_row(
                "SELECT id, goal_id, amount_cents, happened_on, note, created_at
                   FROM fin_goal_deposits WHERE id = ?1",
                params![id],
                map_deposit,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn deposits(&self, goal_id: &str) -> Result<Vec<FinGoalDeposit>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT id, goal_id, amount_cents, happened_on, note, created_at
                   FROM fin_goal_deposits
                  WHERE goal_id = ?1
                  ORDER BY happened_on DESC, created_at DESC",
            )?;
            let rows = stmt.query_map(params![goal_id], map_deposit)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn active_progress(&self) -> Result<Option<f64>> {
        self.db.with_read(|c| {
            // Uma linha por caixinha ativa, com o total guardado. A média do
            // progresso (clamp 0..1) é feita em Rust: manter a fórmula no domínio
            // deixa o SQL só coletando.
            let mut stmt = c.prepare_cached(
                "SELECT g.target_cents,
                        COALESCE(SUM(d.amount_cents), 0) AS saved
                   FROM fin_goal_details g
                   JOIN nodes n ON n.id = g.node_id
                   LEFT JOIN fin_goal_deposits d ON d.goal_id = g.node_id
                  WHERE n.status = 'active'
                  GROUP BY g.node_id",
            )?;
            let rows = stmt.query_map([], |r| {
                let target: i64 = r.get(0)?;
                let saved: i64 = r.get(1)?;
                Ok((target, saved))
            })?;

            let mut sum = 0.0f64;
            let mut count = 0u32;
            for row in rows {
                let (target, saved) = row?;
                if target > 0 {
                    sum += (saved as f64 / target as f64).clamp(0.0, 1.0);
                    count += 1;
                }
            }
            Ok(if count == 0 {
                None
            } else {
                Some(sum / f64::from(count))
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::entities::Kind;
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteFinGoalRepository) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (dir, SqliteFinGoalRepository::new(db))
    }

    fn created_event(id: &str) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1_000,
            day: "2026-07-17".into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::Node(Kind::FinGoal),
            event_type: EventType::Created,
            payload: serde_json::json!({}),
            title_snapshot: "PS5".into(),
        }
    }

    fn deposit_event(id: &str) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 2_000,
            day: "2026-07-17".into(),
            entity_id: "g1".into(),
            entity_kind: LedgerEntityKind::Node(Kind::FinGoal),
            event_type: EventType::ValueRecorded,
            payload: serde_json::json!({ "depositId": id }),
            title_snapshot: "PS5".into(),
        }
    }

    fn make_goal(repo: &SqliteFinGoalRepository, id: &str, target: i64) {
        repo.create_with_event(
            id,
            &NewNode {
                kind: Kind::FinGoal,
                title: "PS5".into(),
                area_id: Some("sphere-fin-goals".into()),
                parent_id: None,
            },
            &NewFinGoal {
                title: "PS5".into(),
                area_id: Some("sphere-fin-goals".into()),
                target_cents: target,
                account_id: Some("acct-btg-invest".into()),
                deadline: None,
                emoji: "🎮".into(),
            },
            &created_event(id),
        )
        .unwrap();
    }

    #[test]
    fn a_new_box_starts_empty_and_carries_the_bank_name() {
        let (_d, repo) = fixture();
        make_goal(&repo, "g1", 250_000);
        let g = repo.get("g1").unwrap();
        assert_eq!(g.saved_cents, 0);
        assert_eq!(g.account_name.as_deref(), Some("BTG Investimentos"));
        assert_eq!(g.emoji, "🎮");
    }

    #[test]
    fn deposits_sum_into_saved_cents() {
        let (_d, repo) = fixture();
        make_goal(&repo, "g1", 250_000);

        repo.deposit_with_event(
            "d1",
            &NewFinGoalDeposit {
                goal_id: "g1".into(),
                amount_cents: 50_000,
                happened_on: "2026-07-01".into(),
                note: None,
            },
            0,
            &deposit_event("d1"),
            None,
        )
        .unwrap();
        repo.deposit_with_event(
            "d2",
            &NewFinGoalDeposit {
                goal_id: "g1".into(),
                amount_cents: 30_000,
                happened_on: "2026-07-10".into(),
                note: None,
            },
            0,
            &deposit_event("d2"),
            None,
        )
        .unwrap();

        assert_eq!(repo.get("g1").unwrap().saved_cents, 80_000);
        assert_eq!(repo.deposits("g1").unwrap().len(), 2);
    }

    #[test]
    fn a_completing_deposit_marks_the_node_done_and_logs_the_trophy() {
        let (_d, repo) = fixture();
        make_goal(&repo, "g1", 100_000);

        let mut trophy = deposit_event("dX");
        trophy.event_type = EventType::Completed;

        repo.deposit_with_event(
            "d1",
            &NewFinGoalDeposit {
                goal_id: "g1".into(),
                amount_cents: 100_000,
                happened_on: "2026-07-01".into(),
                note: None,
            },
            5_000,
            &deposit_event("d1"),
            Some(&trophy),
        )
        .unwrap();

        assert_eq!(repo.get("g1").unwrap().status, "done");
        let completions: i64 = repo
            .db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger
                      WHERE entity_id = 'g1' AND event_type = 'completed'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(completions, 1, "a conquista foi para o ledger");
    }

    #[test]
    fn the_recent_window_only_counts_deposits_since_the_floor() {
        let (_d, repo) = fixture();
        make_goal(&repo, "g1", 500_000);
        for (id, day, cents) in [
            ("d1", "2026-01-10", 40_000), // fora da janela
            ("d2", "2026-06-10", 30_000),
            ("d3", "2026-07-10", 30_000),
        ] {
            repo.deposit_with_event(
                id,
                &NewFinGoalDeposit {
                    goal_id: "g1".into(),
                    amount_cents: cents,
                    happened_on: day.into(),
                    note: None,
                },
                0,
                &deposit_event(id),
                None,
            )
            .unwrap();
        }

        let list = repo.list(Some("sphere-fin-goals"), "2026-05-01").unwrap();
        assert_eq!(list.len(), 1);
        let (goal, recent) = &list[0];
        assert_eq!(goal.saved_cents, 100_000, "o total é de sempre");
        assert_eq!(
            *recent, 60_000,
            "só junho e julho entram na janela de ritmo"
        );
    }

    #[test]
    fn active_progress_averages_the_boxes_and_is_none_when_there_are_none() {
        let (_d, repo) = fixture();
        assert_eq!(repo.active_progress().unwrap(), None);

        make_goal(&repo, "g1", 100_000);
        make_goal(&repo, "g2", 100_000);
        repo.deposit_with_event(
            "d1",
            &NewFinGoalDeposit {
                goal_id: "g1".into(),
                amount_cents: 100_000, // g1 a 100%
                happened_on: "2026-07-01".into(),
                note: None,
            },
            0,
            &deposit_event("d1"),
            None,
        )
        .unwrap();

        // g1 = 1.0, g2 = 0.0 → média 0.5.
        let p = repo.active_progress().unwrap().unwrap();
        assert!((p - 0.5).abs() < 1e-9, "média veio {p}");
    }

    #[test]
    fn over_funding_clamps_progress_at_one() {
        let (_d, repo) = fixture();
        make_goal(&repo, "g1", 100_000);
        repo.deposit_with_event(
            "d1",
            &NewFinGoalDeposit {
                goal_id: "g1".into(),
                amount_cents: 300_000, // 300% do alvo
                happened_on: "2026-07-01".into(),
                note: None,
            },
            0,
            &deposit_event("d1"),
            None,
        )
        .unwrap();
        // clamp em 1.0: uma caixinha estourada não infla a média além de 100%.
        assert_eq!(repo.active_progress().unwrap(), Some(1.0));
    }

    #[test]
    fn deleting_the_goal_takes_the_deposits() {
        let (_d, repo) = fixture();
        make_goal(&repo, "g1", 100_000);
        repo.deposit_with_event(
            "d1",
            &NewFinGoalDeposit {
                goal_id: "g1".into(),
                amount_cents: 10_000,
                happened_on: "2026-07-01".into(),
                note: None,
            },
            0,
            &deposit_event("d1"),
            None,
        )
        .unwrap();

        repo.db
            .with_write(|c| {
                c.execute("DELETE FROM nodes WHERE id = 'g1'", [])?;
                Ok(())
            })
            .unwrap();

        let orphans: i64 = repo
            .db
            .with_read(|c| {
                Ok(c.query_row("SELECT COUNT(*) FROM fin_goal_deposits", [], |r| r.get(0))?)
            })
            .unwrap();
        assert_eq!(orphans, 0, "os depósitos somem com a caixinha (CASCADE)");
    }
}
