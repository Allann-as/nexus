//! Hábitos em SQLite.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{Habit, HabitRepository, NewHabitDetails, Tick};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::domain::schedule::Schedule;
use crate::domain::streak::TickStatus;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;

pub struct SqliteHabitRepository {
    db: Arc<Db>,
}

impl SqliteHabitRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT: &str = "
    SELECT n.id, n.title, n.area_id, n.status,
           h.schedule_json, h.target_value, h.unit,
           h.routine_id, h.routine_order, h.reminder_time
      FROM nodes n
      JOIN habit_details h ON h.node_id = n.id";

fn map_habit(row: &Row) -> rusqlite::Result<Habit> {
    let schedule_json: String = row.get(4)?;
    let schedule = Schedule::parse_json(&schedule_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
    })?;

    Ok(Habit {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        schedule,
        target_value: row.get(5)?,
        unit: row.get(6)?,
        routine_id: row.get(7)?,
        routine_order: row.get(8)?,
        reminder_time: row.get(9)?,
    })
}

fn map_tick(row: &Row) -> rusqlite::Result<(String, Tick)> {
    let key: String = row.get(0)?;
    let status: String = row.get(1)?;
    let status = TickStatus::parse(&status).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            Box::new(NexusError::Validation(format!(
                "status de tick desconhecido: {status}"
            ))),
        )
    })?;
    Ok((
        key,
        Tick {
            status,
            value: row.get(2)?,
        },
    ))
}

impl HabitRepository for SqliteHabitRepository {
    fn create_details(&self, node_id: &str, d: &NewHabitDetails) -> Result<()> {
        self.db.with_write(|c| {
            // A ordem dentro da rotina vai para o fim da rotina.
            let next_order: Option<i64> = match &d.routine_id {
                None => None,
                Some(rid) => Some(c.query_row(
                    "SELECT COALESCE(MAX(routine_order), -1) + 1
                       FROM habit_details WHERE routine_id = ?1",
                    params![rid],
                    |r| r.get(0),
                )?),
            };

            c.execute(
                "INSERT INTO habit_details
                   (node_id, schedule_json, target_value, unit, routine_id, routine_order, reminder_time)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    node_id,
                    d.schedule.to_json(),
                    d.target_value,
                    d.unit,
                    d.routine_id,
                    next_order,
                    d.reminder_time,
                ],
            )?;
            Ok(())
        })
    }

    fn get(&self, id: &str) -> Result<Habit> {
        self.db.with_read(|c| {
            c.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_habit)
                .optional()?
                .ok_or_else(|| NexusError::NotFound(format!("hábito {id}")))
        })
    }

    fn list(&self, area_id: Option<&str>, include_archived: bool) -> Result<Vec<Habit>> {
        self.db.with_read(|c| {
            let mut sql = format!("{SELECT} WHERE 1=1");
            if !include_archived {
                sql.push_str(" AND n.status = 'active'");
            }
            if area_id.is_some() {
                sql.push_str(" AND n.area_id = ?1");
            }
            // Rotina primeiro (na ordem dela), depois os avulsos por título.
            sql.push_str(
                " ORDER BY h.routine_id IS NULL, h.routine_id, h.routine_order, n.title COLLATE NOCASE",
            );

            let mut stmt = c.prepare_cached(&sql)?;
            let rows = match area_id {
                Some(a) => stmt.query_map(params![a], map_habit)?,
                None => stmt.query_map([], map_habit)?,
            };
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn list_in_routine(&self, routine_id: &str) -> Result<Vec<Habit>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT} WHERE h.routine_id = ?1 AND n.status = 'active'
                 ORDER BY h.routine_order"
            ))?;
            let rows = stmt.query_map(params![routine_id], map_habit)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn update_schedule(&self, id: &str, schedule: &Schedule) -> Result<()> {
        self.db.with_write(|c| {
            let changed = c.execute(
                "UPDATE habit_details SET schedule_json = ?2 WHERE node_id = ?1",
                params![id, schedule.to_json()],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("hábito {id}")));
            }
            Ok(())
        })
    }

    fn tick_with_event(
        &self,
        habit_id: &str,
        day: &str,
        tick: Tick,
        ts: i64,
        event: &NewLedgerEvent,
    ) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // ON CONFLICT: remarcar o mesmo dia sobrescreve o estado atual em
            // vez de duplicar (a PK é (habit_id, day)). O ledger, esse, guarda
            // TODAS as marcações — estado atual é o último, história é tudo.
            tx.execute(
                "INSERT INTO habit_ticks (habit_id, day, status, value, ts)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(habit_id, day) DO UPDATE SET
                   status = excluded.status,
                   value  = excluded.value,
                   ts     = excluded.ts",
                params![habit_id, day, tick.status.as_str(), tick.value, ts],
            )?;

            append_in_tx(&tx, event)?;
            tx.commit()?;
            Ok(())
        })
    }

    fn untick_with_event(&self, habit_id: &str, day: &str, event: &NewLedgerEvent) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            let changed = tx.execute(
                "DELETE FROM habit_ticks WHERE habit_id = ?1 AND day = ?2",
                params![habit_id, day],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!(
                    "não havia marcação em {day} para desfazer"
                )));
            }
            append_in_tx(&tx, event)?;
            tx.commit()?;
            Ok(())
        })
    }

    fn ticks_in_range(&self, habit_id: &str, from: &str, to: &str) -> Result<Vec<(String, Tick)>> {
        self.db.with_read(|c| {
            // habit_ticks é WITHOUT ROWID, clusterizada por (habit_id, day):
            // isto é um range scan SEQUENCIAL, não 365 buscas aleatórias.
            let mut stmt = c.prepare_cached(
                "SELECT day, status, value FROM habit_ticks
                  WHERE habit_id = ?1 AND day BETWEEN ?2 AND ?3
                  ORDER BY day",
            )?;
            let rows = stmt.query_map(params![habit_id, from, to], map_tick)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn ticks_on_day(&self, day: &str) -> Result<Vec<(String, Tick)>> {
        self.db.with_read(|c| {
            // Uma query para o dia inteiro. A alternativa (uma por hábito) faria
            // o Dashboard — a tela mais aberta do app — pagar N idas ao banco.
            let mut stmt =
                c.prepare_cached("SELECT habit_id, status, value FROM habit_ticks WHERE day = ?1")?;
            let rows = stmt.query_map(params![day], map_tick)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn complete_routine(
        &self,
        _routine_id: &str,
        day: &str,
        ts: i64,
        events: &[(String, NewLedgerEvent)],
    ) -> Result<u32> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            let mut n = 0;

            for (habit_id, event) in events {
                tx.execute(
                    "INSERT INTO habit_ticks (habit_id, day, status, value, ts)
                     VALUES (?1, ?2, 'done', NULL, ?3)
                     ON CONFLICT(habit_id, day) DO UPDATE SET
                       status = 'done', ts = excluded.ts",
                    params![habit_id, day, ts],
                )?;
                append_in_tx(&tx, event)?;
                n += 1;
            }

            // Uma transação para os N ticks + N eventos. Meia rotina marcada
            // seria pior que nenhuma: o usuário confiaria num número errado.
            tx.commit()?;
            Ok(n)
        })
    }

    fn failure_rate_by_weekday(&self, habit_id: &str, since: &str) -> Result<Vec<(u8, u32, u32)>> {
        self.db.with_read(|c| {
            // strftime('%w') devolve 0=domingo..6=sábado — a mesma base do
            // `weekday_index` do domínio. Os dois combinam de propósito.
            let mut stmt = c.prepare_cached(
                "SELECT CAST(strftime('%w', day) AS INTEGER) AS wd,
                        SUM(status = 'done'),
                        COUNT(*)
                   FROM habit_ticks
                  WHERE habit_id = ?1 AND day >= ?2
                  GROUP BY wd
                  ORDER BY wd",
            )?;
            let rows = stmt.query_map(params![habit_id, since], |r| {
                Ok((
                    r.get::<_, i64>(0)? as u8,
                    r.get::<_, i64>(1)? as u32,
                    r.get::<_, i64>(2)? as u32,
                ))
            })?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }
}
