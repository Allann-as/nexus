//! O lado de leitura do `bi_engine`, em SQLite.
//!
//! Tudo aqui bebe do pool `query_only` (`with_read`) — o motor de BI nunca
//! escreve estado do usuário; ele só lê e preenche o `insight_cache`. A única
//! escrita é o próprio cache (`cache_put`), que vai pela conexão de escrita.

use std::sync::Arc;

use rusqlite::params;

use crate::application::ports::{CachedInsight, HabitSeries, InsightRepository};
use crate::domain::errors::Result;
use crate::domain::schedule::Schedule;
use crate::infrastructure::db::Db;

pub struct SqliteInsightRepository {
    db: Arc<Db>,
}

impl SqliteInsightRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

impl InsightRepository for SqliteInsightRepository {
    fn active_habit_series(&self) -> Result<Vec<HabitSeries>> {
        self.db.with_read(|c| {
            // Os hábitos ativos e sua agenda.
            let mut stmt = c.prepare_cached(
                "SELECT n.id, n.title, n.area_id, h.schedule_json
                   FROM nodes n
                   JOIN habit_details h ON h.node_id = n.id
                  WHERE n.kind = 'habit' AND n.status = 'active'
                  ORDER BY n.id",
            )?;
            let mut series: Vec<HabitSeries> = stmt
                .query_map([], |row| {
                    let schedule_json: String = row.get(3)?;
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        schedule_json,
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .into_iter()
                .filter_map(|(id, title, area_id, sched)| {
                    // Uma agenda ilegível não derruba a análise inteira — o hábito
                    // some da lista e os outros seguem.
                    Schedule::parse_json(&sched)
                        .ok()
                        .map(|schedule| HabitSeries {
                            id,
                            title,
                            area_id,
                            schedule,
                            done_days: Vec::new(),
                        })
                })
                .collect();

            // Todos os dias 'done' dos hábitos ativos, numa varredura só —
            // agrupados em Rust para não fazer N+1.
            let mut ticks = c.prepare_cached(
                "SELECT t.habit_id, t.day
                   FROM habit_ticks t
                   JOIN nodes n ON n.id = t.habit_id
                  WHERE n.kind = 'habit' AND n.status = 'active' AND t.status = 'done'
                  ORDER BY t.habit_id",
            )?;
            let rows = ticks
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;

            use std::collections::HashMap;
            let mut by_habit: HashMap<String, Vec<String>> = HashMap::new();
            for (habit_id, day) in rows {
                by_habit.entry(habit_id).or_default().push(day);
            }
            for s in series.iter_mut() {
                if let Some(days) = by_habit.remove(&s.id) {
                    s.done_days = days;
                }
            }
            Ok(series)
        })
    }

    fn done_ticks_by_day(&self, from_day: &str, to_day: &str) -> Result<Vec<(String, i64)>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT day, COUNT(*)
                   FROM habit_ticks
                  WHERE status = 'done' AND day BETWEEN ?1 AND ?2
                  GROUP BY day",
            )?;
            let rows = stmt.query_map(params![from_day, to_day], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn event_count_by_day(&self, from_day: &str, to_day: &str) -> Result<Vec<(String, i64)>> {
        self.db.with_read(|c| {
            // `day` é local e indexado (0007) — uma cancelada não conta como carga.
            let mut stmt = c.prepare_cached(
                "SELECT day, COUNT(*)
                   FROM event_occurrences
                  WHERE status != 'cancelled' AND day BETWEEN ?1 AND ?2
                  GROUP BY day",
            )?;
            let rows = stmt.query_map(params![from_day, to_day], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn cache_get(&self, key: &str) -> Result<Option<CachedInsight>> {
        self.db.with_read(|c| {
            let row = c
                .query_row(
                    "SELECT payload_json, input_hash, computed_at
                       FROM insight_cache WHERE insight_key = ?1",
                    params![key],
                    |r| {
                        Ok(CachedInsight {
                            payload_json: r.get(0)?,
                            input_hash: r.get(1)?,
                            computed_at: r.get(2)?,
                        })
                    },
                )
                .ok();
            Ok(row)
        })
    }

    fn cache_put(&self, key: &str, payload_json: &str, input_hash: &str, now: i64) -> Result<()> {
        self.db.with_write(|c| {
            c.execute(
                "INSERT OR REPLACE INTO insight_cache
                     (insight_key, payload_json, input_hash, computed_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![key, payload_json, input_hash, now],
            )?;
            Ok(())
        })
    }

    fn input_signature(&self) -> Result<String> {
        self.db.with_read(|c| {
            // Contadores e marcas d'água das tabelas que alimentam os insights.
            // Se nenhum mudou, o resultado é idêntico e recomputar é desperdício.
            let sig: String = c.query_row(
                "SELECT
                    (SELECT COUNT(*) FROM habit_ticks) || ':' ||
                    (SELECT COALESCE(MAX(ts),0) FROM habit_ticks) || '|' ||
                    (SELECT COUNT(*) FROM event_occurrences) || '|' ||
                    (SELECT COUNT(*) FROM nodes) || '|' ||
                    (SELECT COALESCE(MAX(seq),0) FROM ledger) || '|' ||
                    (SELECT COUNT(*) FROM goal_checkpoints)",
                [],
                |r| r.get(0),
            )?;
            Ok(sig)
        })
    }
}
