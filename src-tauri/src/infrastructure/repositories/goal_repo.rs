//! Metas e sub-desafios em SQLite.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{
    Checkpoint, Goal, GoalRepository, Milestone, NewCheckpoint, NewGoalDetails, NewMilestone,
    NewNode,
};
use crate::domain::entities::{Direction, MilestoneKind, ProgressSource};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;
use crate::infrastructure::repositories::node_repo::insert_in_tx;

pub struct SqliteGoalRepository {
    db: Arc<Db>,
}

impl SqliteGoalRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT_GOAL: &str = "
    SELECT n.id, n.title, n.area_id, n.status,
           g.metric_name, g.start_value, g.target_value, g.unit, g.direction,
           g.deadline, g.progress_source
      FROM nodes n
      JOIN goal_details g ON g.node_id = n.id";

/// O contador se preenche AQUI, na mesma query que lê o sub-desafio.
///
/// A subquery conta os ticks 'done' do hábito ligado. É o que torna literal a
/// regra do §4 da 0007: um 'counter' nunca é um número que o usuário digitou —
/// os ticks que ele já dá todo dia é que o alimentam. Num 'simple' o `habit_id`
/// é NULL e a subquery devolve NULL, não zero: "não conta nada" e "conta zero"
/// são coisas diferentes na barra da meta.
const SELECT_MILESTONE: &str = "
    SELECT n.id, n.parent_id, n.title, n.status,
           m.kind, m.habit_id, m.target_count, m.weight, m.sort_order,
           CASE WHEN m.habit_id IS NULL THEN NULL ELSE (
               SELECT COUNT(*) FROM habit_ticks t
                WHERE t.habit_id = m.habit_id AND t.status = 'done'
           ) END
      FROM nodes n
      JOIN milestone_details m ON m.node_id = n.id";

fn to_sql_err(e: NexusError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
}

fn map_goal(row: &Row) -> rusqlite::Result<Goal> {
    let direction: String = row.get(8)?;
    let source: String = row.get(10)?;
    Ok(Goal {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        metric_name: row.get(4)?,
        start_value: row.get(5)?,
        target_value: row.get(6)?,
        unit: row.get(7)?,
        direction: Direction::parse(&direction).map_err(to_sql_err)?,
        deadline: row.get(9)?,
        progress_source: ProgressSource::parse(&source).map_err(to_sql_err)?,
    })
}

fn map_milestone(row: &Row) -> rusqlite::Result<Milestone> {
    let kind: String = row.get(4)?;
    Ok(Milestone {
        id: row.get(0)?,
        goal_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        title: row.get(2)?,
        status: row.get(3)?,
        kind: MilestoneKind::parse(&kind).map_err(to_sql_err)?,
        habit_id: row.get(5)?,
        target_count: row.get(6)?,
        weight: row.get(7)?,
        sort_order: row.get(8)?,
        current_count: row.get(9)?,
    })
}

fn map_checkpoint(row: &Row) -> rusqlite::Result<Checkpoint> {
    Ok(Checkpoint {
        id: row.get(0)?,
        goal_id: row.get(1)?,
        value: row.get(2)?,
        noted_at: row.get(3)?,
        note: row.get(4)?,
    })
}

impl GoalRepository for SqliteGoalRepository {
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        d: &NewGoalDetails,
        event: &NewLedgerEvent,
    ) -> Result<Goal> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            insert_in_tx(&tx, id, node, event.ts)?;
            tx.execute(
                "INSERT INTO goal_details
                   (node_id, metric_name, start_value, target_value, unit, direction,
                    deadline, progress_source)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    d.metric_name,
                    d.start_value,
                    d.target_value,
                    d.unit,
                    d.direction.as_str(),
                    d.deadline,
                    d.progress_source.as_str(),
                ],
            )?;
            append_in_tx(&tx, event)?;

            let created = tx.query_row(
                &format!("{SELECT_GOAL} WHERE n.id = ?1"),
                params![id],
                map_goal,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn get(&self, id: &str) -> Result<Goal> {
        self.db.with_read(|c| {
            c.query_row(
                &format!("{SELECT_GOAL} WHERE n.id = ?1"),
                params![id],
                map_goal,
            )
            .optional()?
            .ok_or_else(|| NexusError::NotFound(format!("meta {id}")))
        })
    }

    fn list(&self, area_id: Option<&str>) -> Result<Vec<Goal>> {
        self.db.with_read(|c| {
            let mut sql = format!("{SELECT_GOAL} WHERE n.status <> 'archived'");
            if area_id.is_some() {
                sql.push_str(" AND n.area_id = ?1");
            }
            sql.push_str(" ORDER BY n.created_at DESC, n.id DESC");

            let mut stmt = c.prepare_cached(&sql)?;
            let rows = match area_id {
                Some(a) => stmt.query_map(params![a], map_goal)?,
                None => stmt.query_map([], map_goal)?,
            };
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn add_checkpoint_with_event(
        &self,
        id: &str,
        cp: &NewCheckpoint,
        event: &NewLedgerEvent,
    ) -> Result<Checkpoint> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // A medição e o evento juntos: um checkpoint sem história seria um
            // ponto na projeção que a timeline nunca explica.
            tx.execute(
                "INSERT INTO goal_checkpoints (id, goal_id, value, noted_at, note)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, cp.goal_id, cp.value, cp.noted_at, cp.note],
            )?;
            append_in_tx(&tx, event)?;

            let created = tx.query_row(
                "SELECT id, goal_id, value, noted_at, note FROM goal_checkpoints WHERE id = ?1",
                params![id],
                map_checkpoint,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn checkpoints(&self, goal_id: &str) -> Result<Vec<Checkpoint>> {
        self.db.with_read(|c| {
            // `idx_checkpoints` é (goal_id, noted_at): a série já sai ordenada.
            // `id` desempata para duas medições no mesmo ms não trocarem de
            // lugar entre chamadas — a projeção tem que ser determinística.
            let mut stmt = c.prepare_cached(
                "SELECT id, goal_id, value, noted_at, note
                   FROM goal_checkpoints
                  WHERE goal_id = ?1
                  ORDER BY noted_at, id",
            )?;
            let rows = stmt.query_map(params![goal_id], map_checkpoint)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn add_milestone_with_event(
        &self,
        id: &str,
        node: &NewNode,
        m: &NewMilestone,
        event: &NewLedgerEvent,
    ) -> Result<Milestone> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            insert_in_tx(&tx, id, node, event.ts)?;

            // Novo sub-desafio vai para o fim da lista da meta.
            let next: f64 = tx.query_row(
                "SELECT COALESCE(MAX(m.sort_order), -1) + 1
                   FROM milestone_details m
                   JOIN nodes n ON n.id = m.node_id
                  WHERE n.parent_id = ?1",
                params![m.goal_id],
                |r| r.get(0),
            )?;

            tx.execute(
                "INSERT INTO milestone_details
                   (node_id, kind, habit_id, target_count, weight, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    m.kind.as_str(),
                    m.habit_id,
                    m.target_count,
                    m.weight,
                    next
                ],
            )?;
            append_in_tx(&tx, event)?;

            let created = tx.query_row(
                &format!("{SELECT_MILESTONE} WHERE n.id = ?1"),
                params![id],
                map_milestone,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn list_milestones(&self, goal_id: &str) -> Result<Vec<Milestone>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT_MILESTONE} WHERE n.parent_id = ?1 ORDER BY m.sort_order, n.id"
            ))?;
            let rows = stmt.query_map(params![goal_id], map_milestone)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn get_milestone(&self, id: &str) -> Result<Milestone> {
        self.db.with_read(|c| {
            c.query_row(
                &format!("{SELECT_MILESTONE} WHERE n.id = ?1"),
                params![id],
                map_milestone,
            )
            .optional()?
            .ok_or_else(|| NexusError::NotFound(format!("sub-desafio {id}")))
        })
    }

    fn set_milestone_done_with_event(
        &self,
        id: &str,
        done: bool,
        event: &NewLedgerEvent,
    ) -> Result<Milestone> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // `nodes.status` É o checkbox (§4 da 0007) — não há coluna
            // `completed` no satélite para divergir dele.
            let changed = tx.execute(
                "UPDATE nodes SET status = ?2, updated_at = ?3
                  WHERE id = ?1 AND kind = 'milestone'",
                params![id, if done { "done" } else { "active" }, event.ts],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("sub-desafio {id}")));
            }

            append_in_tx(&tx, event)?;

            let updated = tx.query_row(
                &format!("{SELECT_MILESTONE} WHERE n.id = ?1"),
                params![id],
                map_milestone,
            )?;
            tx.commit()?;
            Ok(updated)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ports::{HabitRepository, NewHabitDetails, Tick};
    use crate::domain::entities::Kind;
    use crate::domain::ledger::{EventType, NewLedgerEvent};
    use crate::domain::schedule::Schedule;
    use crate::domain::streak::TickStatus;
    use crate::infrastructure::paths::Paths;
    use crate::infrastructure::repositories::habit_repo::SqliteHabitRepository;

    /// Arquivo temporário: `open_in_memory` daria ao pool de leitura um banco
    /// VAZIO, e todo teste que lê pelo `list_milestones` passaria por engano.
    fn fixture() -> (tempfile::TempDir, Arc<Db>, SqliteGoalRepository) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        let repo = SqliteGoalRepository::new(db.clone());
        (dir, db, repo)
    }

    fn ledger_event(id: &str, kind: Kind) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1_000,
            day: "2026-07-17".into(),
            entity_id: id.into(),
            entity_kind: kind,
            event_type: EventType::Created,
            payload: serde_json::json!({}),
            title_snapshot: "t".into(),
        }
    }

    fn goal(repo: &SqliteGoalRepository) -> Goal {
        repo.create_with_event(
            "g1",
            &NewNode {
                kind: Kind::Goal,
                title: "Perder 10 kg".into(),
                area_id: None,
                parent_id: None,
            },
            &NewGoalDetails {
                metric_name: "Peso".into(),
                start_value: 90.0,
                target_value: 80.0,
                unit: "kg".into(),
                direction: Direction::Decrease,
                deadline: None,
                progress_source: ProgressSource::Metric,
            },
            &ledger_event("g1", Kind::Goal),
        )
        .unwrap()
    }

    fn milestone(repo: &SqliteGoalRepository, id: &str, m: NewMilestone) -> Milestone {
        repo.add_milestone_with_event(
            id,
            &NewNode {
                kind: Kind::Milestone,
                title: m.title.clone(),
                area_id: None,
                parent_id: Some(m.goal_id.clone()),
            },
            &m,
            &ledger_event(id, Kind::Milestone),
        )
        .unwrap()
    }

    fn simple(goal_id: &str, title: &str, weight: f64) -> NewMilestone {
        NewMilestone {
            title: title.into(),
            goal_id: goal_id.into(),
            kind: MilestoneKind::Simple,
            habit_id: None,
            target_count: None,
            weight,
        }
    }

    #[test]
    fn a_goal_is_born_with_its_details_and_its_history() {
        let (_dir, db, repo) = fixture();
        let g = goal(&repo);
        assert_eq!(g.progress_source, ProgressSource::Metric);
        assert_eq!(g.direction, Direction::Decrease);

        let logged: i64 = db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger WHERE entity_id = 'g1'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(logged, 1);
    }

    #[test]
    fn the_progress_source_default_comes_from_the_migration() {
        // A 0007 adicionou a coluna com DEFAULT 'metric'. Uma meta antiga, de
        // antes da coluna existir, tem que continuar legível — e é justamente
        // ela que o `parse` explodiria se o default não tivesse pegado.
        let (_dir, db, _repo) = fixture();
        db.with_write(|c| {
            c.execute_batch(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('g0', 'goal', 'Meta antiga', 0, 0);
                 INSERT INTO goal_details
                        (node_id, metric_name, start_value, target_value, unit, direction)
                      VALUES ('g0', 'Peso', 90, 80, 'kg', 'decrease');",
            )?;
            Ok(())
        })
        .unwrap();

        let repo = SqliteGoalRepository::new(db);
        assert_eq!(
            repo.get("g0").unwrap().progress_source,
            ProgressSource::Metric
        );
    }

    #[test]
    fn a_counter_fills_itself_from_the_habits_ticks() {
        // A regra do §4 da 0007: o número não é digitado, ele é contado. Se esta
        // subquery sumisse, o sub-desafio viraria mais um campo para o usuário
        // manter à mão — exatamente o trabalho que os ticks já fazem.
        let (_dir, db, repo) = fixture();
        goal(&repo);

        let habits = SqliteHabitRepository::new(db.clone());
        db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('h1', 'habit', 'Sem açúcar', 0, 0)",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        habits
            .create_details(
                "h1",
                &NewHabitDetails {
                    schedule: Schedule::Daily,
                    target_value: None,
                    unit: None,
                    routine_id: None,
                    reminder_time: None,
                },
            )
            .unwrap();

        for (day, status) in [
            ("2026-07-14", TickStatus::Done),
            ("2026-07-15", TickStatus::Done),
            // 'skipped' não conta: a meta é "30 dias SEM açúcar", e um dia
            // pulado não é um dia sem açúcar.
            ("2026-07-16", TickStatus::Skipped),
            ("2026-07-17", TickStatus::Failed),
        ] {
            habits
                .tick_with_event(
                    "h1",
                    day,
                    Tick {
                        status,
                        value: None,
                    },
                    0,
                    &ledger_event("h1", Kind::Habit),
                )
                .unwrap();
        }

        milestone(
            &repo,
            "m1",
            NewMilestone {
                title: "30 dias sem açúcar".into(),
                goal_id: "g1".into(),
                kind: MilestoneKind::Counter,
                habit_id: Some("h1".into()),
                target_count: Some(30),
                weight: 1.0,
            },
        );

        let found = repo.get_milestone("m1").unwrap();
        assert_eq!(found.current_count, Some(2), "só os 'done' contam");
        assert_eq!(found.target_count, Some(30));
    }

    #[test]
    fn a_simple_milestone_counts_nothing_which_is_not_counting_zero() {
        // NULL e 0 dizem coisas diferentes: "não tem contador" e "contador em
        // zero". Colapsar os dois faria a UI desenhar uma barra 0/0 num
        // checkbox.
        let (_dir, _db, repo) = fixture();
        goal(&repo);
        let m = milestone(&repo, "m1", simple("g1", "Comprar tênis", 1.0));
        assert_eq!(m.current_count, None);
        assert_eq!(m.kind, MilestoneKind::Simple);
    }

    #[test]
    fn the_status_of_the_node_is_the_checkbox() {
        let (_dir, _db, repo) = fixture();
        goal(&repo);
        milestone(&repo, "m1", simple("g1", "Comprar tênis", 1.0));

        let done = repo
            .set_milestone_done_with_event("m1", true, &ledger_event("m1", Kind::Milestone))
            .unwrap();
        assert_eq!(done.status, "done");

        let undone = repo
            .set_milestone_done_with_event("m1", false, &ledger_event("m1", Kind::Milestone))
            .unwrap();
        assert_eq!(undone.status, "active", "desmarcar é um clique legítimo");
    }

    #[test]
    fn ticking_a_milestone_that_is_not_one_is_refused() {
        // O UPDATE filtra por kind: sem isso, um id de tarefa passado por engano
        // marcaria a TAREFA como concluída e gravaria um evento de sub-desafio
        // sobre ela.
        let (_dir, db, repo) = fixture();
        db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('t1', 'task', 'Uma tarefa', 0, 0)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        let err = repo
            .set_milestone_done_with_event("t1", true, &ledger_event("t1", Kind::Milestone))
            .unwrap_err();
        assert!(matches!(err, NexusError::NotFound(_)), "{err:?}");

        let status: String = db
            .with_read(|c| {
                Ok(c.query_row("SELECT status FROM nodes WHERE id = 't1'", [], |r| r.get(0))?)
            })
            .unwrap();
        assert_eq!(status, "active", "a tarefa não pode ter sido tocada");
    }

    #[test]
    fn the_checkpoint_series_comes_out_in_time_order_whatever_the_insert_order() {
        // A projeção é uma reta sobre esta série. Uma ordem instável faria o
        // mesmo banco devolver duas datas diferentes para a mesma meta.
        let (_dir, _db, repo) = fixture();
        goal(&repo);

        for (id, value, ts) in [
            ("c3", 88.0, 3_000),
            ("c1", 90.0, 1_000),
            ("c2", 89.0, 2_000),
        ] {
            repo.add_checkpoint_with_event(
                id,
                &NewCheckpoint {
                    goal_id: "g1".into(),
                    value,
                    noted_at: ts,
                    note: None,
                },
                &ledger_event("g1", Kind::Goal),
            )
            .unwrap();
        }

        let series = repo.checkpoints("g1").unwrap();
        let values: Vec<f64> = series.iter().map(|c| c.value).collect();
        assert_eq!(values, vec![90.0, 89.0, 88.0]);
    }

    #[test]
    fn deleting_the_goal_takes_the_checkpoints_and_the_milestones() {
        let (_dir, db, repo) = fixture();
        goal(&repo);
        milestone(&repo, "m1", simple("g1", "Comprar tênis", 1.0));
        repo.add_checkpoint_with_event(
            "c1",
            &NewCheckpoint {
                goal_id: "g1".into(),
                value: 89.0,
                noted_at: 1_000,
                note: None,
            },
            &ledger_event("g1", Kind::Goal),
        )
        .unwrap();

        db.with_write(|c| {
            // O sub-desafio é filho por `parent_id`, que NÃO tem CASCADE — o
            // serviço é quem apaga os filhos. O checkpoint pende de
            // `goal_details` e cai com ele.
            c.execute("DELETE FROM nodes WHERE id = 'm1'", [])?;
            c.execute("DELETE FROM nodes WHERE id = 'g1'", [])?;
            Ok(())
        })
        .unwrap();

        assert!(repo.checkpoints("g1").unwrap().is_empty());
        assert!(repo.list_milestones("g1").unwrap().is_empty());
    }

    #[test]
    fn milestones_keep_the_order_they_were_added_in() {
        let (_dir, _db, repo) = fixture();
        goal(&repo);
        for (i, title) in ["Primeiro", "Segundo", "Terceiro"].iter().enumerate() {
            milestone(&repo, &format!("m{i}"), simple("g1", title, 1.0));
        }
        let titles: Vec<String> = repo
            .list_milestones("g1")
            .unwrap()
            .into_iter()
            .map(|m| m.title)
            .collect();
        assert_eq!(titles, vec!["Primeiro", "Segundo", "Terceiro"]);
    }

    #[test]
    fn a_weight_of_zero_is_refused_by_the_schema() {
        // O CHECK (weight > 0) da 0007. Peso zero faria o sub-desafio sumir da
        // média sem sumir da tela — e uma meta inteira de pesos zero dividiria
        // por zero.
        let (_dir, _db, repo) = fixture();
        goal(&repo);
        let boom = repo.add_milestone_with_event(
            "m1",
            &NewNode {
                kind: Kind::Milestone,
                title: "Peso zero".into(),
                area_id: None,
                parent_id: Some("g1".into()),
            },
            &simple("g1", "Peso zero", 0.0),
            &ledger_event("m1", Kind::Milestone),
        );
        assert!(boom.is_err());
        assert!(
            repo.list_milestones("g1").unwrap().is_empty(),
            "o node não pode ter sobrado sem o satélite"
        );
    }
}
