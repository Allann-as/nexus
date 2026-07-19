//! Agregados de período em SQLite (ARSENAL) — as somas do comparativo.
//!
//! Uma query, quatro subselects, todos por intervalo de `day`/`happened_on`
//! (colunas indexadas): estudo, foco, aportes e tarefas concluídas. O comparativo
//! só cruza DOIS períodos adjacentes, então o custo é limitado ao que se pergunta
//! — não paga rollup por isso (ADR-0062). O score médio, que precisa parsear o
//! payload do ledger, é somado no serviço (o padrão do resto do código).

use std::sync::Arc;

use rusqlite::params;

use crate::application::ports::{PeriodStatsRepository, RawPeriodStats};
use crate::domain::errors::Result;
use crate::infrastructure::db::Db;

pub struct SqlitePeriodStatsRepository {
    db: Arc<Db>,
}

impl SqlitePeriodStatsRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

impl PeriodStatsRepository for SqlitePeriodStatsRepository {
    fn range_stats(&self, from_day: &str, to_day: &str) -> Result<RawPeriodStats> {
        self.db.with_read(|c| {
            let row = c.query_row(
                "SELECT
                   (SELECT COALESCE(SUM(minutes), 0) FROM study_sessions
                     WHERE day BETWEEN ?1 AND ?2),
                   (SELECT COALESCE(SUM(minutes), 0) FROM focus_sessions
                     WHERE day BETWEEN ?1 AND ?2),
                   (SELECT COALESCE(SUM(amount_cents), 0) FROM contributions
                     WHERE happened_on BETWEEN ?1 AND ?2),
                   (SELECT COUNT(*) FROM ledger
                     WHERE event_type = 'completed' AND entity_kind = 'task'
                       AND day BETWEEN ?1 AND ?2)",
                params![from_day, to_day],
                |r| {
                    Ok(RawPeriodStats {
                        study_minutes: r.get(0)?,
                        focus_minutes: r.get(1)?,
                        contribution_cents: r.get(2)?,
                        tasks_completed: r.get(3)?,
                    })
                },
            )?;
            Ok(row)
        })
    }
}
