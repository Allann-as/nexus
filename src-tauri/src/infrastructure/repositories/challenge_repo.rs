//! Temporadas / Desafios em SQLite.
//!
//! Uma temporada é um node 'challenge' com o satélite `challenge_details`. O
//! placar é COMPUTADO na leitura — para `habit_days`, os ticks 'done' do hábito
//! ligado dentro da janela (reusa `habit_ticks`); para `manual`, o contador. O
//! estado "vencida" é derivado na camada de cima (ADR-0036), não gravado.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{Challenge, ChallengeRepository, NewChallenge, NewNode};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;
use crate::infrastructure::repositories::node_repo::insert_in_tx;

pub struct SqliteChallengeRepository {
    db: Arc<Db>,
}

impl SqliteChallengeRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

/// O SELECT de uma temporada, com o placar (`progress_count`) já resolvido: o
/// contador manual, ou a contagem de ticks 'done' na janela.
const SELECT: &str = "
    SELECT n.id, n.title, n.area_id, n.status,
           c.starts_on, c.ends_on, c.metric, c.habit_id, h.title,
           c.target_count, c.manual_count,
           CASE c.metric
             WHEN 'manual' THEN c.manual_count
             ELSE (SELECT COUNT(*) FROM habit_ticks t
                    WHERE t.habit_id = c.habit_id AND t.status = 'done'
                      AND t.day BETWEEN c.starts_on AND c.ends_on)
           END AS progress_count,
           n.created_at
      FROM challenge_details c
      JOIN nodes n ON n.id = c.node_id
      LEFT JOIN nodes h ON h.id = c.habit_id";

fn map_challenge(row: &Row) -> rusqlite::Result<Challenge> {
    Ok(Challenge {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        starts_on: row.get(4)?,
        ends_on: row.get(5)?,
        metric: row.get(6)?,
        habit_id: row.get(7)?,
        habit_title: row.get(8)?,
        target_count: row.get(9)?,
        manual_count: row.get(10)?,
        progress_count: row.get(11)?,
        created_at: row.get(12)?,
    })
}

impl ChallengeRepository for SqliteChallengeRepository {
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewChallenge,
        event: &NewLedgerEvent,
    ) -> Result<Challenge> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            insert_in_tx(&tx, id, node, event.ts)?;
            tx.execute(
                "INSERT INTO challenge_details
                   (node_id, starts_on, ends_on, metric, habit_id, target_count, manual_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
                params![
                    id,
                    new.starts_on,
                    new.ends_on,
                    new.metric.as_str(),
                    new.habit_id,
                    new.target_count,
                ],
            )?;
            append_in_tx(&tx, event)?;
            let created = tx.query_row(
                &format!("{SELECT} WHERE n.id = ?1"),
                params![id],
                map_challenge,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn get(&self, id: &str) -> Result<Challenge> {
        self.db.with_read(|c| {
            c.query_row(
                &format!("{SELECT} WHERE n.id = ?1"),
                params![id],
                map_challenge,
            )
            .optional()?
            .ok_or_else(|| NexusError::NotFound(format!("temporada {id}")))
        })
    }

    fn list(&self, area_id: Option<&str>) -> Result<Vec<Challenge>> {
        self.db.with_read(|c| {
            // Arquivadas somem; ativas primeiro, depois por criação recente.
            let order = " AND n.status <> 'archived' \
                         ORDER BY CASE n.status WHEN 'active' THEN 0 ELSE 1 END, \
                                  n.created_at DESC, n.id DESC";
            match area_id {
                Some(a) => {
                    let mut stmt =
                        c.prepare_cached(&format!("{SELECT} WHERE n.area_id = ?1{order}"))?;
                    let rows = stmt.query_map(params![a], map_challenge)?;
                    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
                }
                None => {
                    let mut stmt = c.prepare_cached(&format!("{SELECT} WHERE 1 = 1{order}"))?;
                    let rows = stmt.query_map([], map_challenge)?;
                    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
                }
            }
        })
    }

    fn bump_manual(
        &self,
        id: &str,
        delta: i64,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Challenge> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            // MAX(0, ...): o contador nunca fica negativo, mesmo com um decremento
            // no zero. Só toca temporadas 'manual' — habit_days ignora o contador.
            let changed = tx.execute(
                "UPDATE challenge_details
                    SET manual_count = MAX(0, manual_count + ?2)
                  WHERE node_id = ?1 AND metric = 'manual'",
                params![id, delta],
            )?;
            if changed == 0 {
                return Err(NexusError::Validation(
                    "só uma temporada de contador manual pode ser incrementada".into(),
                ));
            }
            tx.execute(
                "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
                params![id, updated_at],
            )?;
            append_in_tx(&tx, event)?;
            let updated = tx.query_row(
                &format!("{SELECT} WHERE n.id = ?1"),
                params![id],
                map_challenge,
            )?;
            tx.commit()?;
            Ok(updated)
        })
    }

    fn complete(&self, id: &str, updated_at: i64, event: &NewLedgerEvent) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            // Idempotente: só fecha o que ainda está 'active'. Se já fechou, o
            // UPDATE não pega linha e o evento não é gravado.
            let changed = tx.execute(
                "UPDATE nodes SET status = 'done', updated_at = ?2
                  WHERE id = ?1 AND status = 'active'",
                params![id, updated_at],
            )?;
            if changed > 0 {
                append_in_tx(&tx, event)?;
            }
            tx.commit()?;
            Ok(())
        })
    }

    fn set_status(
        &self,
        id: &str,
        status: &str,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Challenge> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE nodes SET status = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, status, updated_at],
            )?;
            append_in_tx(&tx, event)?;
            let updated = tx.query_row(
                &format!("{SELECT} WHERE n.id = ?1"),
                params![id],
                map_challenge,
            )?;
            tx.commit()?;
            Ok(updated)
        })
    }

    fn active_reached(&self) -> Result<Vec<Challenge>> {
        self.db.with_read(|c| {
            // As ativas cujo placar >= alvo. O placar é a mesma expressão do
            // SELECT, então filtramos por ela num HAVING-like via subquery externa.
            let mut stmt = c.prepare(&format!(
                "SELECT * FROM ({SELECT} WHERE n.status = 'active') \
                  WHERE progress_count >= target_count"
            ))?;
            let rows = stmt.query_map([], map_challenge)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::entities::ChallengeMetric;
    use crate::domain::entities::Kind;
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteChallengeRepository, Arc<Db>) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (dir, SqliteChallengeRepository::new(db.clone()), db)
    }

    fn started(id: &str) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1_000,
            day: "2026-07-17".into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::Node(Kind::Challenge),
            event_type: EventType::ChallengeStarted,
            payload: serde_json::json!({}),
            title_snapshot: "90 dias".into(),
        }
    }

    fn make_manual(repo: &SqliteChallengeRepository, id: &str, target: i64) -> Challenge {
        repo.create_with_event(
            id,
            &NewNode {
                kind: Kind::Challenge,
                title: "90 dias".into(),
                area_id: None,
                parent_id: None,
            },
            &NewChallenge {
                title: "90 dias".into(),
                area_id: None,
                starts_on: "2026-01-01".into(),
                ends_on: "2026-03-31".into(),
                metric: ChallengeMetric::Manual,
                habit_id: None,
                target_count: target,
            },
            &started(id),
        )
        .unwrap()
    }

    #[test]
    fn a_manual_challenge_starts_at_zero() {
        let (_d, repo, _db) = fixture();
        let c = make_manual(&repo, "c1", 90);
        assert_eq!(c.progress_count, 0);
        assert_eq!(c.status, "active");
        assert_eq!(c.metric, "manual");
    }

    #[test]
    fn bumping_the_manual_counter_moves_the_scoreboard() {
        let (_d, repo, _db) = fixture();
        make_manual(&repo, "c1", 90);
        let bump = |n| {
            repo.bump_manual(
                "c1",
                n,
                2_000,
                &NewLedgerEvent {
                    event_type: EventType::Checked,
                    ..started("c1")
                },
            )
            .unwrap()
        };
        assert_eq!(bump(1).progress_count, 1);
        assert_eq!(bump(1).progress_count, 2);
        // Nunca abaixo de zero.
        assert_eq!(bump(-5).progress_count, 0);
    }

    #[test]
    fn a_habit_challenge_counts_done_ticks_in_the_window() {
        let (_d, repo, db) = fixture();
        // Um hábito e três ticks: dois dentro da janela, um fora.
        db.with_write(|c| {
            c.execute_batch(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('h1', 'habit', 'Treino', 0, 0);
                 INSERT INTO habit_details (node_id, schedule_json)
                      VALUES ('h1', '{\"type\":\"daily\"}');
                 INSERT INTO habit_ticks (habit_id, day, status, ts)
                      VALUES ('h1','2026-01-05','done',1),
                             ('h1','2026-02-10','done',1),
                             ('h1','2025-12-30','done',1);",
            )?;
            Ok(())
        })
        .unwrap();

        repo.create_with_event(
            "c1",
            &NewNode {
                kind: Kind::Challenge,
                title: "Treino".into(),
                area_id: None,
                parent_id: None,
            },
            &NewChallenge {
                title: "Treino".into(),
                area_id: None,
                starts_on: "2026-01-01".into(),
                ends_on: "2026-03-31".into(),
                metric: ChallengeMetric::HabitDays,
                habit_id: Some("h1".into()),
                target_count: 30,
            },
            &started("c1"),
        )
        .unwrap();

        // Só os dois ticks dentro da janela contam; o de dezembro fica de fora.
        assert_eq!(repo.get("c1").unwrap().progress_count, 2);
        assert_eq!(
            repo.get("c1").unwrap().habit_title.as_deref(),
            Some("Treino")
        );
    }

    #[test]
    fn active_reached_finds_the_ones_that_hit_the_target() {
        let (_d, repo, _db) = fixture();
        make_manual(&repo, "c1", 3);
        make_manual(&repo, "c2", 3);
        for _ in 0..3 {
            repo.bump_manual(
                "c1",
                1,
                2_000,
                &NewLedgerEvent {
                    event_type: EventType::Checked,
                    ..started("c1")
                },
            )
            .unwrap();
        }
        let reached = repo.active_reached().unwrap();
        assert_eq!(reached.len(), 1);
        assert_eq!(reached[0].id, "c1");
    }

    #[test]
    fn completing_is_idempotent() {
        let (_d, repo, db) = fixture();
        make_manual(&repo, "c1", 1);
        let done = NewLedgerEvent {
            event_type: EventType::ChallengeCompleted,
            ..started("c1")
        };
        repo.complete("c1", 3_000, &done).unwrap();
        repo.complete("c1", 3_000, &done).unwrap(); // segunda vez: no-op

        assert_eq!(repo.get("c1").unwrap().status, "done");
        let completions: i64 = db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger WHERE event_type = 'challenge_completed'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(completions, 1, "fechar duas vezes grava um evento só");
    }
}
