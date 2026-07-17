//! Tarefas em SQLite.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{NewTaskDetails, Progress, Task, TaskPatch, TaskRepository};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;

pub struct SqliteTaskRepository {
    db: Arc<Db>,
}

impl SqliteTaskRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT: &str = "
    SELECT n.id, n.title, n.area_id, n.parent_id, n.status,
           t.due_at, t.scheduled_at, t.duration_min, t.priority, t.energy,
           t.completed_at, t.sort_order
      FROM nodes n
      JOIN task_details t ON t.node_id = n.id";

fn map_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        parent_id: row.get(3)?,
        status: row.get(4)?,
        due_at: row.get(5)?,
        scheduled_at: row.get(6)?,
        duration_min: row.get(7)?,
        priority: row.get(8)?,
        energy: row.get(9)?,
        completed_at: row.get(10)?,
        sort_order: row.get(11)?,
    })
}

impl TaskRepository for SqliteTaskRepository {
    fn create_details(&self, node_id: &str, d: &NewTaskDetails) -> Result<()> {
        self.db.with_write(|c| {
            // Nova tarefa vai para o fim da lista do projeto dela.
            let next: f64 = c.query_row(
                "SELECT COALESCE(MAX(t.sort_order), -1) + 1
                   FROM task_details t
                   JOIN nodes n ON n.id = t.node_id
                  WHERE n.parent_id IS (SELECT parent_id FROM nodes WHERE id = ?1)",
                params![node_id],
                |r| r.get(0),
            )?;

            c.execute(
                "INSERT INTO task_details
                   (node_id, due_at, scheduled_at, duration_min, priority, energy, sort_order)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    node_id,
                    d.due_at,
                    d.scheduled_at,
                    d.duration_min,
                    d.priority,
                    d.energy,
                    next
                ],
            )?;
            Ok(())
        })
    }

    fn get(&self, id: &str) -> Result<Task> {
        self.db.with_read(|c| {
            c.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_task)
                .optional()?
                .ok_or_else(|| NexusError::NotFound(format!("tarefa {id}")))
        })
    }

    fn list_for_project(&self, project_id: &str, include_done: bool) -> Result<Vec<Task>> {
        self.db.with_read(|c| {
            let mut sql = format!("{SELECT} WHERE n.parent_id = ?1");
            if !include_done {
                sql.push_str(" AND t.completed_at IS NULL");
            }
            // A ordem do usuário manda; o id desempata para a paginação não
            // embaralhar tarefas com o mesmo sort_order.
            sql.push_str(" ORDER BY t.sort_order, n.id");

            let mut stmt = c.prepare_cached(&sql)?;
            let rows = stmt.query_map(params![project_id], map_task)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn scheduled_between(&self, from_ms: i64, to_ms: i64) -> Result<Vec<Task>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT} WHERE t.scheduled_at >= ?1 AND t.scheduled_at < ?2
                   AND t.completed_at IS NULL
                 ORDER BY t.scheduled_at, t.priority"
            ))?;
            let rows = stmt.query_map(params![from_ms, to_ms], map_task)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn update(&self, id: &str, patch: &TaskPatch) -> Result<Task> {
        self.db.with_write(|c| {
            // Os campos anuláveis usam o par flag+valor (não COALESCE): "não
            // mexer" e "limpar para NULL" precisam ser distinguíveis.
            let changed = c.execute(
                "UPDATE task_details SET
                    due_at       = CASE WHEN ?2 THEN ?3 ELSE due_at END,
                    scheduled_at = CASE WHEN ?4 THEN ?5 ELSE scheduled_at END,
                    duration_min = CASE WHEN ?6 THEN ?7 ELSE duration_min END,
                    energy       = CASE WHEN ?8 THEN ?9 ELSE energy END,
                    priority     = COALESCE(?10, priority)
                 WHERE node_id = ?1",
                params![
                    id,
                    patch.due_at.is_some(),
                    patch.due_at.flatten(),
                    patch.scheduled_at.is_some(),
                    patch.scheduled_at.flatten(),
                    patch.duration_min.is_some(),
                    patch.duration_min.flatten(),
                    patch.energy.is_some(),
                    patch.energy.clone().flatten(),
                    patch.priority,
                ],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("tarefa {id}")));
            }
            c.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_task)
                .map_err(Into::into)
        })
    }

    fn set_completed_with_event(
        &self,
        id: &str,
        completed_at: Option<i64>,
        event: &NewLedgerEvent,
    ) -> Result<Task> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // `task_details.completed_at` e `nodes.status` são duas
            // representações do MESMO fato. Escrevê-las em transações
            // separadas deixaria uma janela em que a lista diz "aberta" e o BI
            // diz "concluída" — e um crash no meio tornaria a divergência
            // permanente. Ou as duas, ou nenhuma.
            let changed = tx.execute(
                "UPDATE task_details SET completed_at = ?2 WHERE node_id = ?1",
                params![id, completed_at],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("tarefa {id}")));
            }

            tx.execute(
                "UPDATE nodes SET status = ?2, updated_at = ?3 WHERE id = ?1",
                params![
                    id,
                    if completed_at.is_some() {
                        "done"
                    } else {
                        "active"
                    },
                    event.ts
                ],
            )?;

            append_in_tx(&tx, event)?;

            // Lido DEPOIS dos dois updates: devolver a linha antes deles
            // entregaria à UI um status que já não é verdade.
            let task = tx.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_task)?;
            tx.commit()?;
            Ok(task)
        })
    }

    fn reorder(&self, id: &str, new_order: f64) -> Result<()> {
        self.db.with_write(|c| {
            let changed = c.execute(
                "UPDATE task_details SET sort_order = ?2 WHERE node_id = ?1",
                params![id, new_order],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("tarefa {id}")));
            }
            Ok(())
        })
    }

    fn neighbours(&self, project_id: &str, index: usize) -> Result<(Option<f64>, Option<f64>)> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT t.sort_order
                   FROM task_details t
                   JOIN nodes n ON n.id = t.node_id
                  WHERE n.parent_id = ?1 AND t.completed_at IS NULL
                  ORDER BY t.sort_order, n.id",
            )?;
            let orders: Vec<f64> = stmt
                .query_map(params![project_id], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;

            // `index` é a posição de DESTINO na lista visível. O item antes dela
            // e o item nela viram os vizinhos entre os quais a média cai.
            let before = if index == 0 {
                None
            } else {
                orders.get(index - 1).copied()
            };
            let after = orders.get(index).copied();
            Ok((before, after))
        })
    }

    fn renumber_project_tasks(&self, project_id: &str) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            let ids: Vec<String> = {
                let mut stmt = tx.prepare(
                    "SELECT t.node_id
                       FROM task_details t
                       JOIN nodes n ON n.id = t.node_id
                      WHERE n.parent_id = ?1
                      ORDER BY t.sort_order, n.id",
                )?;
                // Coletado numa variável ligada, e não como expressão final: o
                // iterador empresta `stmt`, que morre no fim deste bloco.
                let rows: Vec<String> = stmt
                    .query_map(params![project_id], |r| r.get(0))?
                    .collect::<rusqlite::Result<_>>()?;
                rows
            };

            // Reespaça em inteiros, devolvendo folga máxima para as próximas
            // médias. É O(n), mas só roda quando o double satura — na prática,
            // quase nunca.
            for (i, id) in ids.iter().enumerate() {
                tx.execute(
                    "UPDATE task_details SET sort_order = ?2 WHERE node_id = ?1",
                    params![id, i as f64],
                )?;
            }

            tx.commit()?;
            Ok(())
        })
    }

    fn progress(&self, project_id: &str) -> Result<Progress> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL),
                        COUNT(*)
                   FROM task_details t
                   JOIN nodes n ON n.id = t.node_id
                  WHERE n.parent_id = ?1",
                params![project_id],
                |r| {
                    Ok(Progress {
                        done: r.get(0)?,
                        total: r.get(1)?,
                    })
                },
            )?)
        })
    }

    fn day_counts(&self, from_ms: i64, to_ms: i64) -> Result<(u32, u32)> {
        self.db.with_read(|c| {
            // "Planejadas" = agendadas para o dia, concluídas ou não. Contar só
            // as abertas faria o score subir ao concluir E ao adiar — os dois
            // tirariam a tarefa da conta.
            let (planned, done): (i64, i64) = c.query_row(
                "SELECT COUNT(*),
                        COUNT(*) FILTER (WHERE completed_at IS NOT NULL)
                   FROM task_details
                  WHERE scheduled_at >= ?1 AND scheduled_at < ?2",
                params![from_ms, to_ms],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
            Ok((planned.max(0) as u32, done.max(0) as u32))
        })
    }
}
