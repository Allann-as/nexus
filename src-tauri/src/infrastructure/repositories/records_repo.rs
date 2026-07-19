//! Recordes pessoais em SQLite (ARSENAL) — os máximos históricos por período.
//!
//! Tudo leitura pura do estado (`query_only`): a melhor semana de estudo, o melhor
//! mês de aportes, o melhor mês de foco. Cada consulta devolve o valor recordista
//! e um dia do período que o alcançou — o serviço formata o rótulo e decide se
//! virou fato no ledger. O recorde de streak e o de score vivem no serviço (um no
//! domínio `streak`, o outro no ledger dos scores). Ver ADR-0060.

use std::sync::Arc;

use rusqlite::{OptionalExtension, Row};

use crate::application::ports::{BestHit, RecordsRepository};
use crate::domain::errors::Result;
use crate::infrastructure::db::Db;

pub struct SqliteRecordsRepository {
    db: Arc<Db>,
}

impl SqliteRecordsRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

fn map_hit(row: &Row) -> rusqlite::Result<BestHit> {
    Ok(BestHit {
        value: row.get::<_, f64>(0)?,
        sample_day: row.get(1)?,
    })
}

impl RecordsRepository for SqliteRecordsRepository {
    fn best_study_week_minutes(&self) -> Result<Option<BestHit>> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT CAST(SUM(minutes) AS REAL) AS total, MIN(day) AS sample
                   FROM study_sessions
                  GROUP BY strftime('%Y-%W', day)
                  ORDER BY total DESC LIMIT 1",
                [],
                map_hit,
            )
            .optional()?)
        })
    }

    fn best_contribution_month_cents(&self) -> Result<Option<BestHit>> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT CAST(SUM(amount_cents) AS REAL) AS total, MIN(happened_on) AS sample
                   FROM contributions
                  GROUP BY substr(happened_on, 1, 7)
                 HAVING total > 0
                  ORDER BY total DESC LIMIT 1",
                [],
                map_hit,
            )
            .optional()?)
        })
    }

    fn best_focus_days_month(&self) -> Result<Option<BestHit>> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT CAST(COUNT(DISTINCT day) AS REAL) AS days, MIN(day) AS sample
                   FROM focus_sessions
                  GROUP BY substr(day, 1, 7)
                  ORDER BY days DESC LIMIT 1",
                [],
                map_hit,
            )
            .optional()?)
        })
    }
}
