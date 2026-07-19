//! A retrospectiva anual em SQLite (ARSENAL) — os fatos do ano, do ledger.
//!
//! Contagens por `event_type`/`entity_kind` no intervalo do ano, e os destaques
//! (conquistas + recordes) com o título da época. Tudo por `day` (indexado por
//! `idx_ledger_day`). Ver ADR-0064.

use std::sync::Arc;

use rusqlite::params;

use crate::application::ports::{Highlight, RetrospectiveRepository, YearCounts};
use crate::domain::errors::Result;
use crate::infrastructure::db::Db;

pub struct SqliteRetrospectiveRepository {
    db: Arc<Db>,
}

impl SqliteRetrospectiveRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

impl RetrospectiveRepository for SqliteRetrospectiveRepository {
    fn year_counts(&self, from_day: &str, to_day: &str) -> Result<YearCounts> {
        self.db.with_read(|c| {
            let counts = c.query_row(
                "SELECT
                   (SELECT COUNT(*) FROM ledger
                     WHERE event_type = 'achievement_unlocked' AND day BETWEEN ?1 AND ?2),
                   (SELECT COUNT(*) FROM ledger
                     WHERE event_type = 'record_broken' AND day BETWEEN ?1 AND ?2),
                   (SELECT COUNT(*) FROM ledger
                     WHERE event_type = 'completed' AND entity_kind = 'book'
                       AND day BETWEEN ?1 AND ?2),
                   (SELECT COUNT(*) FROM ledger
                     WHERE event_type = 'challenge_completed' AND day BETWEEN ?1 AND ?2),
                   (SELECT COUNT(*) FROM ledger
                     WHERE event_type = 'completed' AND entity_kind = 'annual_goal'
                       AND day BETWEEN ?1 AND ?2)",
                params![from_day, to_day],
                |r| {
                    Ok(YearCounts {
                        achievements: r.get(0)?,
                        records: r.get(1)?,
                        books_finished: r.get(2)?,
                        challenges_won: r.get(3)?,
                        annual_goals_done: r.get(4)?,
                    })
                },
            )?;
            Ok(counts)
        })
    }

    fn year_highlights(&self, from_day: &str, to_day: &str, limit: i64) -> Result<Vec<Highlight>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT event_type, title_snapshot, day
                   FROM ledger
                  WHERE day BETWEEN ?1 AND ?2
                    AND event_type IN ('achievement_unlocked', 'record_broken')
                  ORDER BY day ASC, seq ASC
                  LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![from_day, to_day, limit], |r| {
                let et: String = r.get(0)?;
                Ok(Highlight {
                    kind: if et == "achievement_unlocked" {
                        "achievement".into()
                    } else {
                        "record".into()
                    },
                    title: r.get(1)?,
                    day: r.get(2)?,
                })
            })?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }
}
