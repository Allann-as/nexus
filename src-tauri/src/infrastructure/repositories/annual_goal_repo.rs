//! Metas Anuais em SQLite.
//!
//! Uma meta anual é um node 'annual_goal' com o satélite `annual_goal_details`.
//! Reusa o PADRÃO de goal (métrica/alvo/progresso), não a tabela `goal_details`
//! (ADR-0036): os checkpoints de uma quantitativa vivem no LEDGER, não numa
//! tabela de medições diárias. O status é o `nodes.status`.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{AnnualGoal, AnnualGoalRepository, NewAnnualGoal, NewNode};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;
use crate::infrastructure::repositories::node_repo::insert_in_tx;

pub struct SqliteAnnualGoalRepository {
    db: Arc<Db>,
}

impl SqliteAnnualGoalRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

// As duas últimas colunas são DERIVADAS na leitura (ARSENAL, ADR-0058), no molde
// do contador de sub-desafio (§5.6): quando um hábito é ligado à meta por
// `contributes_to`, o progresso vem dos ticks, não da coluna `current_value`.
//   - `is_tracked` (0/1): existe algum hábito ligado a esta meta?
//   - `tracked_days`: COUNT(DISTINCT dia) dos ticks `done` dos hábitos ligados,
//     na janela do ANO da meta. É range scan na PK clusterizada de `habit_ticks`.
const SELECT: &str = "
    SELECT n.id, n.title, n.area_id, n.status,
           a.year, a.goal_kind, a.metric_name, a.target_value, a.current_value, a.unit,
           n.created_at,
           EXISTS(
             SELECT 1 FROM links l JOIN nodes hn ON hn.id = l.source_id
              WHERE l.target_id = n.id AND l.link_type = 'contributes_to'
                AND hn.kind = 'habit'
           ) AS is_tracked,
           (
             SELECT COUNT(DISTINCT t.day)
               FROM habit_ticks t
               JOIN links l ON l.source_id = t.habit_id
               JOIN nodes hn ON hn.id = l.source_id
              WHERE l.target_id = n.id AND l.link_type = 'contributes_to'
                AND hn.kind = 'habit' AND t.status = 'done'
                AND t.day BETWEEN printf('%04d-01-01', a.year)
                              AND printf('%04d-12-31', a.year)
           ) AS tracked_days
      FROM annual_goal_details a
      JOIN nodes n ON n.id = a.node_id";

fn map_goal(row: &Row) -> rusqlite::Result<AnnualGoal> {
    let is_tracked: bool = row.get(11)?;
    let tracked_days: i64 = row.get(12)?;
    Ok(AnnualGoal {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        year: row.get(4)?,
        goal_kind: row.get(5)?,
        metric_name: row.get(6)?,
        target_value: row.get(7)?,
        current_value: row.get(8)?,
        unit: row.get(9)?,
        created_at: row.get(10)?,
        tracked_count: is_tracked.then_some(tracked_days as f64),
    })
}

impl AnnualGoalRepository for SqliteAnnualGoalRepository {
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewAnnualGoal,
        event: &NewLedgerEvent,
    ) -> Result<AnnualGoal> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            insert_in_tx(&tx, id, node, event.ts)?;
            tx.execute(
                "INSERT INTO annual_goal_details
                   (node_id, year, goal_kind, metric_name, target_value, current_value, unit)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
                params![
                    id,
                    new.year,
                    new.goal_kind.as_str(),
                    new.metric_name,
                    new.target_value,
                    new.unit,
                ],
            )?;
            append_in_tx(&tx, event)?;
            let created =
                tx.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_goal)?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn get(&self, id: &str) -> Result<AnnualGoal> {
        self.db.with_read(|c| {
            c.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_goal)
                .optional()?
                .ok_or_else(|| NexusError::NotFound(format!("meta anual {id}")))
        })
    }

    fn list_by_year(&self, year: i64) -> Result<Vec<AnnualGoal>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT} WHERE a.year = ?1 AND n.status <> 'archived' \
                 ORDER BY n.created_at ASC, n.id ASC"
            ))?;
            let rows = stmt.query_map(params![year], map_goal)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn years(&self) -> Result<Vec<i64>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT DISTINCT a.year
                   FROM annual_goal_details a JOIN nodes n ON n.id = a.node_id
                  WHERE n.status <> 'archived'
                  ORDER BY a.year DESC",
            )?;
            let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn set_progress(
        &self,
        id: &str,
        current_value: f64,
        updated_at: i64,
        checkpoint: &NewLedgerEvent,
        completion: Option<&NewLedgerEvent>,
    ) -> Result<AnnualGoal> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            let changed = tx.execute(
                "UPDATE annual_goal_details SET current_value = ?2
                  WHERE node_id = ?1 AND goal_kind = 'quantitative'",
                params![id, current_value],
            )?;
            if changed == 0 {
                return Err(NexusError::Validation(
                    "só uma meta anual quantitativa tem progresso a atualizar".into(),
                ));
            }
            tx.execute(
                "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
                params![id, updated_at],
            )?;
            append_in_tx(&tx, checkpoint)?;

            // Cruzou o alvo: fecha e grava a conclusão, na mesma transação.
            if let Some(done) = completion {
                tx.execute(
                    "UPDATE nodes SET status = 'done', updated_at = ?2
                      WHERE id = ?1 AND status = 'active'",
                    params![id, updated_at],
                )?;
                append_in_tx(&tx, done)?;
            }

            let updated =
                tx.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_goal)?;
            tx.commit()?;
            Ok(updated)
        })
    }

    fn set_status(
        &self,
        id: &str,
        status: &str,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<AnnualGoal> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE nodes SET status = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, status, updated_at],
            )?;
            append_in_tx(&tx, event)?;
            let updated =
                tx.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_goal)?;
            tx.commit()?;
            Ok(updated)
        })
    }

    fn delete_with_event(&self, id: &str, event: &NewLedgerEvent) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            // O evento primeiro (o ledger sobrevive ao delete — sem FK); depois o
            // node, cujo CASCADE leva o satélite.
            append_in_tx(&tx, event)?;
            tx.execute("DELETE FROM nodes WHERE id = ?1", params![id])?;
            tx.commit()?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::entities::{AnnualGoalKind, Kind};
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteAnnualGoalRepository) {
        let (dir, _db, repo) = fixture_with_db();
        (dir, repo)
    }

    fn fixture_with_db() -> (tempfile::TempDir, Arc<Db>, SqliteAnnualGoalRepository) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        let repo = SqliteAnnualGoalRepository::new(Arc::clone(&db));
        (dir, db, repo)
    }

    fn ev(id: &str, et: EventType) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1_000,
            day: "2026-07-17".into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::Node(Kind::AnnualGoal),
            event_type: et,
            payload: serde_json::json!({}),
            title_snapshot: "Ler 12 livros".into(),
        }
    }

    fn make(
        repo: &SqliteAnnualGoalRepository,
        id: &str,
        year: i64,
        kind: AnnualGoalKind,
        target: Option<f64>,
    ) -> AnnualGoal {
        repo.create_with_event(
            id,
            &NewNode {
                kind: Kind::AnnualGoal,
                title: "Ler 12 livros".into(),
                area_id: None,
                parent_id: None,
            },
            &NewAnnualGoal {
                title: "Ler 12 livros".into(),
                area_id: None,
                year,
                goal_kind: kind,
                metric_name: target.map(|_| "livros".into()),
                target_value: target,
                unit: target.map(|_| "livros".into()),
            },
            &ev(id, EventType::Created),
        )
        .unwrap()
    }

    #[test]
    fn a_quantitative_goal_tracks_current_value() {
        let (_d, repo) = fixture();
        make(&repo, "g1", 2026, AnnualGoalKind::Quantitative, Some(12.0));

        let updated = repo
            .set_progress("g1", 5.0, 2_000, &ev("g1", EventType::GoalCheckpoint), None)
            .unwrap();
        assert_eq!(updated.current_value, 5.0);
        assert_eq!(updated.status, "active");
    }

    #[test]
    fn crossing_the_target_marks_it_done() {
        let (_d, repo) = fixture();
        make(&repo, "g1", 2026, AnnualGoalKind::Quantitative, Some(12.0));
        let done = ev("g1", EventType::Completed);
        let updated = repo
            .set_progress(
                "g1",
                12.0,
                2_000,
                &ev("g1", EventType::GoalCheckpoint),
                Some(&done),
            )
            .unwrap();
        assert_eq!(updated.status, "done");
    }

    #[test]
    fn a_binary_goal_has_no_progress_to_set() {
        let (_d, repo) = fixture();
        make(&repo, "g1", 2026, AnnualGoalKind::Binary, None);
        let r = repo.set_progress("g1", 1.0, 2_000, &ev("g1", EventType::GoalCheckpoint), None);
        assert!(r.is_err(), "binária não tem current_value a mexer");
    }

    #[test]
    fn years_and_list_respect_the_year_and_hide_archived() {
        let (_d, repo) = fixture();
        make(&repo, "g1", 2026, AnnualGoalKind::Binary, None);
        make(&repo, "g2", 2027, AnnualGoalKind::Binary, None);
        make(&repo, "g3", 2027, AnnualGoalKind::Binary, None);

        assert_eq!(repo.years().unwrap(), vec![2027, 2026]);
        assert_eq!(repo.list_by_year(2027).unwrap().len(), 2);

        repo.set_status("g3", "archived", 3_000, &ev("g3", EventType::Archived))
            .unwrap();
        assert_eq!(repo.list_by_year(2027).unwrap().len(), 1, "arquivada some");
    }

    /// ADR-0058: um hábito ligado por `contributes_to` faz a contagem vir dos
    /// ticks (DERIVADA), não da coluna `current_value`. `DISTINCT dia` e a janela
    /// do ano são o contrato.
    #[test]
    fn a_linked_habit_makes_the_count_come_from_the_ticks() {
        let (_d, db, repo) = fixture_with_db();
        make(&repo, "g1", 2026, AnnualGoalKind::Quantitative, Some(100.0));

        // Sem hábito ligado: não é rastreada; o número é o da coluna (0 aqui).
        assert_eq!(repo.get("g1").unwrap().tracked_count, None);

        // Cria o hábito, liga-o à meta e semeia ticks — dois `done` em 2026, um
        // fora do ano, um `failed` (que não conta) e um dia repetido (DISTINCT).
        db.with_write(|conn| {
            conn.execute(
                "INSERT INTO nodes (id, kind, title, status, created_at, updated_at)
                 VALUES ('h1', 'habit', 'Correr', 'active', 1, 1)",
                [],
            )?;
            conn.execute(
                "INSERT INTO links (source_id, target_id, link_type, created_at)
                 VALUES ('h1', 'g1', 'contributes_to', 1)",
                [],
            )?;
            for (day, status) in [
                ("2026-03-01", "done"),
                ("2026-03-02", "done"),
                ("2026-03-02", "done"), // PK (h1, dia) — mesmo dia, não duplica
                ("2026-04-10", "failed"), // falhou: não conta
                ("2025-12-31", "done"), // fora do ano da meta
            ] {
                conn.execute(
                    "INSERT OR REPLACE INTO habit_ticks (habit_id, day, status, ts)
                     VALUES ('h1', ?1, ?2, 1)",
                    params![day, status],
                )?;
            }
            Ok(())
        })
        .unwrap();

        // Agora é rastreada: dois dias distintos `done` dentro de 2026.
        assert_eq!(repo.get("g1").unwrap().tracked_count, Some(2.0));
    }

    #[test]
    fn deleting_takes_the_satellite() {
        let (_d, repo) = fixture();
        make(&repo, "g1", 2026, AnnualGoalKind::Binary, None);
        repo.delete_with_event("g1", &ev("g1", EventType::Deleted))
            .unwrap();
        assert!(repo.get("g1").is_err(), "a meta some");
    }
}
