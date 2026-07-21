//! Metas e sub-desafios em SQLite.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{
    Checkpoint, Goal, GoalRepository, Milestone, NewCheckpoint, NewGoalDetails, NewMilestone,
    NewNode,
};
use crate::domain::entities::{Direction, GoalKind, MilestoneKind, ProgressSource};
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
    SELECT n.id, n.title, n.area_id, n.status, g.goal_kind,
           g.metric_name, g.start_value, g.target_value, g.unit, g.direction,
           g.deadline, g.progress_source, g.habit_id, g.daily_target
      FROM nodes n
      JOIN goal_details g ON g.node_id = n.id";

/// O contador se preenche AQUI, na mesma query que lê o sub-desafio.
///
/// A subquery conta os ticks 'done' do hábito ligado. É o que torna literal a
/// regra do §4 da 0007: um 'counter' nunca é um número que o usuário digitou —
/// os ticks que ele já dá todo dia é que o alimentam. Num 'simple' o `habit_id`
/// é NULL e a subquery devolve NULL, não zero: "não conta nada" e "conta zero"
/// são coisas diferentes na barra da meta.
///
/// E ele conta a partir de `counts_from` (0009). Sem esse piso, um "30 dias de
/// academia" criado hoje sobre um hábito com 120 dias de histórico nasce
/// marcado, exibindo **51/30** — foi o que a tela mostrou quando o M3 foi
/// dirigido de verdade. `counts_from` NULL = desde sempre, que é o que dizem as
/// linhas anteriores à 0009. A comparação de texto 'YYYY-MM-DD' é exata e usa
/// índice; nenhum `date(..., 'localtime')` aqui — ver a §3 da 0007.
const SELECT_MILESTONE: &str = "
    SELECT n.id, n.parent_id, n.title, n.status,
           m.kind, m.habit_id, m.target_count, m.weight, m.sort_order, m.counts_from,
           CASE WHEN m.habit_id IS NULL THEN NULL ELSE (
               SELECT COUNT(*) FROM habit_ticks t
                WHERE t.habit_id = m.habit_id AND t.status = 'done'
                  AND (m.counts_from IS NULL OR t.day >= m.counts_from)
           ) END
      FROM nodes n
      JOIN milestone_details m ON m.node_id = n.id";

fn to_sql_err(e: NexusError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
}

fn map_goal(row: &Row) -> rusqlite::Result<Goal> {
    let kind: String = row.get(4)?;
    // NULL numa meta 'binary'/'staged' — o `transpose` mantém "sem direção" e
    // "direção ilegível" como coisas diferentes (0016).
    let direction: Option<String> = row.get(9)?;
    let source: String = row.get(11)?;
    Ok(Goal {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        goal_kind: GoalKind::parse(&kind).map_err(to_sql_err)?,
        metric_name: row.get(5)?,
        start_value: row.get(6)?,
        target_value: row.get(7)?,
        unit: row.get(8)?,
        direction: direction
            .as_deref()
            .map(Direction::parse)
            .transpose()
            .map_err(to_sql_err)?,
        deadline: row.get(10)?,
        progress_source: ProgressSource::parse(&source).map_err(to_sql_err)?,
        // Os dois campos da constância (0017). NULL em todo outro tipo, por
        // CHECK — não por convenção.
        habit_id: row.get(12)?,
        daily_target: row.get(13)?,
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
        counts_from: row.get(9)?,
        current_count: row.get(10)?,
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
                   (node_id, goal_kind, metric_name, start_value, target_value, unit,
                    direction, deadline, progress_source, habit_id, daily_target)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    id,
                    d.goal_kind.as_str(),
                    d.metric_name,
                    d.start_value,
                    d.target_value,
                    d.unit,
                    d.direction.map(Direction::as_str),
                    d.deadline,
                    d.progress_source.as_str(),
                    d.habit_id,
                    d.daily_target,
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

    fn get_checkpoint(&self, id: &str) -> Result<Checkpoint> {
        self.db.with_read(|c| {
            c.query_row(
                "SELECT id, goal_id, value, noted_at, note FROM goal_checkpoints WHERE id = ?1",
                params![id],
                map_checkpoint,
            )
            .optional()?
            .ok_or_else(|| NexusError::NotFound(format!("medição {id}")))
        })
    }

    fn delete_checkpoint_with_event(&self, id: &str, event: &NewLedgerEvent) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // A correção é apendada ANTES do DELETE, como em todo delete do app:
            // depois a linha não existe mais para ser lida, e `ledger.entity_id`
            // não tem FK justamente para o evento sobreviver a ela.
            append_in_tx(&tx, event)?;

            let changed = tx.execute("DELETE FROM goal_checkpoints WHERE id = ?1", params![id])?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("medição {id}")));
            }

            tx.commit()?;
            Ok(())
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
                   (node_id, kind, habit_id, target_count, weight, sort_order, counts_from)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    id,
                    m.kind.as_str(),
                    m.habit_id,
                    m.target_count,
                    m.weight,
                    next,
                    m.counts_from,
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

    fn set_progress_source(&self, goal_id: &str, source: ProgressSource) -> Result<Goal> {
        self.db.with_write(|c| {
            let changed = c.execute(
                "UPDATE goal_details SET progress_source = ?2 WHERE node_id = ?1",
                params![goal_id, source.as_str()],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("meta {goal_id}")));
            }
            Ok(c.query_row(
                &format!("{SELECT_GOAL} WHERE n.id = ?1"),
                params![goal_id],
                map_goal,
            )?)
        })
    }

    fn set_habit(&self, goal_id: &str, habit_id: Option<&str>) -> Result<Goal> {
        self.db.with_write(|c| {
            let changed = c.execute(
                "UPDATE goal_details SET habit_id = ?2 WHERE node_id = ?1",
                params![goal_id, habit_id],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("meta {goal_id}")));
            }
            Ok(c.query_row(
                &format!("{SELECT_GOAL} WHERE n.id = ?1"),
                params![goal_id],
                map_goal,
            )?)
        })
    }

    fn milestone_neighbours(
        &self,
        goal_id: &str,
        index: usize,
    ) -> Result<(Option<f64>, Option<f64>)> {
        self.db.with_read(|c| {
            // O mesmo `ORDER BY` do `list_milestones`, e isso não é coincidência:
            // `index` é a posição na lista que o usuário VÊ. Uma ordem diferente
            // aqui faria o item cair entre os vizinhos de outra lista.
            let mut stmt = c.prepare_cached(
                "SELECT m.sort_order
                   FROM milestone_details m
                   JOIN nodes n ON n.id = m.node_id
                  WHERE n.parent_id = ?1
                  ORDER BY m.sort_order, n.id",
            )?;
            let orders: Vec<f64> = stmt
                .query_map(params![goal_id], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;

            let before = if index == 0 {
                None
            } else {
                orders.get(index - 1).copied()
            };
            Ok((before, orders.get(index).copied()))
        })
    }

    fn reorder_milestone(&self, id: &str, new_order: f64) -> Result<()> {
        self.db.with_write(|c| {
            let changed = c.execute(
                "UPDATE milestone_details SET sort_order = ?2 WHERE node_id = ?1",
                params![id, new_order],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("sub-desafio {id}")));
            }
            Ok(())
        })
    }

    fn renumber_milestones(&self, goal_id: &str) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            let ids: Vec<String> = {
                let mut stmt = tx.prepare(
                    "SELECT m.node_id
                       FROM milestone_details m
                       JOIN nodes n ON n.id = m.node_id
                      WHERE n.parent_id = ?1
                      ORDER BY m.sort_order, n.id",
                )?;
                // Coletado numa variável ligada: o iterador empresta `stmt`, que
                // morre no fim deste bloco.
                let rows: Vec<String> = stmt
                    .query_map(params![goal_id], |r| r.get(0))?
                    .collect::<rusqlite::Result<_>>()?;
                rows
            };

            // Reespaça em inteiros, devolvendo folga máxima para as próximas
            // médias. O(n), mas só roda quando o double satura — na prática,
            // quase nunca.
            for (i, id) in ids.iter().enumerate() {
                tx.execute(
                    "UPDATE milestone_details SET sort_order = ?2 WHERE node_id = ?1",
                    params![id, i as f64],
                )?;
            }

            tx.commit()?;
            Ok(())
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
            entity_kind: kind.into(),
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
                goal_kind: GoalKind::Quantitative,
                metric_name: Some("Peso".into()),
                start_value: Some(90.0),
                target_value: Some(80.0),
                unit: Some("kg".into()),
                direction: Some(Direction::Decrease),
                deadline: None,
                progress_source: ProgressSource::Metric,
                habit_id: None,
                daily_target: None,
            },
            &ledger_event("g1", Kind::Goal),
        )
        .unwrap()
    }

    /// Uma meta SEM métrica (0016): os cinco campos em NULL e a fonte nos
    /// degraus — é o que o CHECK de tabela exige de uma 'binary'/'staged'.
    fn metricless_goal(repo: &SqliteGoalRepository, id: &str, kind: GoalKind) -> Goal {
        repo.create_with_event(
            id,
            &NewNode {
                kind: Kind::Goal,
                title: "Conseguir um emprego".into(),
                area_id: None,
                parent_id: None,
            },
            &NewGoalDetails {
                goal_kind: kind,
                metric_name: None,
                start_value: None,
                target_value: None,
                unit: None,
                direction: None,
                deadline: None,
                progress_source: ProgressSource::Milestones,
                habit_id: None,
                daily_target: None,
            },
            &ledger_event(id, Kind::Goal),
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
            counts_from: None,
        }
    }

    #[test]
    fn a_goal_is_born_with_its_details_and_its_history() {
        let (_dir, db, repo) = fixture();
        let g = goal(&repo);
        assert_eq!(g.progress_source, ProgressSource::Metric);
        assert_eq!(g.goal_kind, GoalKind::Quantitative);
        assert_eq!(g.direction, Some(Direction::Decrease));

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
    fn a_goal_without_a_metric_round_trips_as_nulls() {
        // A 0016 tornou os cinco campos NULLABLE. O repositório tem que gravar e
        // reler o NULL como `None` — se ele mandasse string vazia ou zero, o
        // CHECK de tabela recusaria a linha, e a barra teria um alvo falso.
        let (_dir, _db, repo) = fixture();
        for (id, kind) in [("gb", GoalKind::Binary), ("gs", GoalKind::Staged)] {
            let g = metricless_goal(&repo, id, kind);
            assert_eq!(g.goal_kind, kind);
            for field in [g.metric_name.is_none(), g.unit.is_none()] {
                assert!(field, "{id}: um campo de métrica veio preenchido");
            }
            assert!(g.start_value.is_none());
            assert!(g.target_value.is_none());
            assert!(g.direction.is_none());
            assert_eq!(g.progress_source, ProgressSource::Milestones);

            // E relendo do banco, não só do INSERT que acabou de rodar.
            assert_eq!(repo.get(id).unwrap().goal_kind, kind);
        }
    }

    #[test]
    fn the_goal_kind_default_comes_from_the_migration() {
        // A 0016 reconstruiu a tabela com DEFAULT 'quantitative' — é o que toda
        // linha anterior a ela é. Uma meta gravada sem a coluna tem que
        // continuar legível.
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
        assert_eq!(repo.get("g0").unwrap().goal_kind, GoalKind::Quantitative);
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
                // Sem piso: conta o histórico inteiro do hábito.
                counts_from: None,
            },
        );

        let found = repo.get_milestone("m1").unwrap();
        assert_eq!(found.current_count, Some(2), "só os 'done' contam");
        assert_eq!(found.target_count, Some(30));
    }

    #[test]
    fn a_counter_only_counts_from_the_day_it_started_counting() {
        // O bug que a TELA mostrou: "30 dias de academia", criado hoje sobre um
        // hábito com 120 dias de histórico, nasceu marcado exibindo 51/30. Um
        // contador que conta o passado não mede um desafio, mede o arquivo.
        //
        // Este teste fixa o piso da 0009: os ticks anteriores a `counts_from`
        // são do arquivo, não do desafio.
        let (_dir, db, repo) = fixture();
        goal(&repo);

        let habits = SqliteHabitRepository::new(db.clone());
        db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('h1', 'habit', 'Academia', 0, 0)",
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

        // Três dias de histórico ANTES do desafio, dois DEPOIS.
        for day in [
            "2026-07-10",
            "2026-07-11",
            "2026-07-12",
            "2026-07-15",
            "2026-07-16",
        ] {
            habits
                .tick_with_event(
                    "h1",
                    day,
                    Tick {
                        status: TickStatus::Done,
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
                title: "30 dias de academia".into(),
                goal_id: "g1".into(),
                kind: MilestoneKind::Counter,
                habit_id: Some("h1".into()),
                target_count: Some(30),
                weight: 1.0,
                counts_from: Some("2026-07-15".into()),
            },
        );

        let found = repo.get_milestone("m1").unwrap();
        assert_eq!(
            found.current_count,
            Some(2),
            "os três ticks anteriores ao desafio são do arquivo, não dele"
        );
        assert_eq!(found.counts_from.as_deref(), Some("2026-07-15"));
    }

    #[test]
    fn the_floor_includes_the_day_it_starts() {
        // `>=` e não `>`: quem cria o desafio hoje e treina hoje fez 1/30, não
        // 0/30. Um piso exclusivo comeria o primeiro dia — e o usuário veria o
        // contador ignorar o treino que ele acabou de marcar.
        let (_dir, db, repo) = fixture();
        goal(&repo);

        let habits = SqliteHabitRepository::new(db.clone());
        db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('h1', 'habit', 'Academia', 0, 0)",
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
        habits
            .tick_with_event(
                "h1",
                "2026-07-15",
                Tick {
                    status: TickStatus::Done,
                    value: None,
                },
                0,
                &ledger_event("h1", Kind::Habit),
            )
            .unwrap();

        milestone(
            &repo,
            "m1",
            NewMilestone {
                title: "30 dias de academia".into(),
                goal_id: "g1".into(),
                kind: MilestoneKind::Counter,
                habit_id: Some("h1".into()),
                target_count: Some(30),
                weight: 1.0,
                counts_from: Some("2026-07-15".into()),
            },
        );

        assert_eq!(repo.get_milestone("m1").unwrap().current_count, Some(1));
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
    fn the_progress_source_survives_the_round_trip() {
        let (_dir, _db, repo) = fixture();
        goal(&repo);

        let switched = repo
            .set_progress_source("g1", ProgressSource::Milestones)
            .unwrap();
        assert_eq!(switched.progress_source, ProgressSource::Milestones);
        assert_eq!(
            repo.get("g1").unwrap().progress_source,
            ProgressSource::Milestones,
            "e ficou gravado, não só no que voltou"
        );

        assert!(
            repo.set_progress_source("nao-existe", ProgressSource::Metric)
                .is_err(),
            "trocar a régua de uma meta que não existe é um erro, não um no-op"
        );
    }

    #[test]
    fn the_neighbours_of_a_position_come_from_the_list_the_user_sees() {
        // `index` é a posição na lista VISÍVEL. Se este ORDER BY divergisse do
        // `list_milestones`, o item cairia entre os vizinhos de outra lista — e
        // o arrasto pousaria no lugar errado.
        let (_dir, _db, repo) = fixture();
        goal(&repo);
        for (i, title) in ["Primeiro", "Segundo", "Terceiro"].iter().enumerate() {
            milestone(&repo, &format!("m{i}"), simple("g1", title, 1.0));
        }

        // add_milestone numera 0, 1, 2 (MAX + 1).
        assert_eq!(
            repo.milestone_neighbours("g1", 0).unwrap(),
            (None, Some(0.0)),
            "o topo não tem vizinho antes"
        );
        assert_eq!(
            repo.milestone_neighbours("g1", 1).unwrap(),
            (Some(0.0), Some(1.0))
        );
        assert_eq!(
            repo.milestone_neighbours("g1", 3).unwrap(),
            (Some(2.0), None),
            "o fim não tem vizinho depois"
        );
    }

    #[test]
    fn renumbering_respaces_the_tree_without_reordering_it() {
        // O reespaçamento é a válvula de escape da média: ele devolve folga e
        // NÃO pode mexer na ordem que o usuário vê — senão a lista embaralharia
        // sozinha justamente no arrasto que a saturou.
        let (_dir, _db, repo) = fixture();
        goal(&repo);
        for (i, title) in ["A", "B", "C"].iter().enumerate() {
            milestone(&repo, &format!("m{i}"), simple("g1", title, 1.0));
        }

        // Encosta os três num ponto só, como ~50 arrastos no mesmo lugar fariam.
        repo.reorder_milestone("m1", 1e-9).unwrap();
        repo.reorder_milestone("m2", 2e-9).unwrap();
        repo.reorder_milestone("m0", 0.0).unwrap();

        let before: Vec<String> = repo
            .list_milestones("g1")
            .unwrap()
            .into_iter()
            .map(|m| m.title)
            .collect();

        repo.renumber_milestones("g1").unwrap();

        let after = repo.list_milestones("g1").unwrap();
        assert_eq!(
            after.iter().map(|m| m.title.clone()).collect::<Vec<_>>(),
            before,
            "reespaçar não é reordenar"
        );
        assert_eq!(
            after.iter().map(|m| m.sort_order).collect::<Vec<_>>(),
            vec![0.0, 1.0, 2.0],
            "e a folga voltou a ser 1.0"
        );
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
