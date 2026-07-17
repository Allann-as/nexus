//! A Máquina do Tempo — leituras da Timeline e o congelamento mensal.
//!
//! O ledger é a fonte. A visão MÊS o lê paginado por `day` (idx_ledger_day); a
//! visão ANO lê `timeline_rollups`, meses pré-agregados que o job de fechamento
//! congela na primeira abertura do mês seguinte (§2.6). É o que faz um ano de 5
//! anos atrás abrir em < 100 ms sem varrer milhões de linhas.

use std::sync::Arc;

use rusqlite::{params, Row};

use crate::domain::errors::Result;
use crate::domain::ledger::LedgerEntry;
use crate::infrastructure::db::Db;

pub struct SqliteTimelineRepository {
    db: Arc<Db>,
}

impl SqliteTimelineRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

/// Um mês congelado — as contagens que a visão ANO desenha.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthRollup {
    /// 'YYYY-MM'.
    pub month: String,
    /// Total de eventos do mês.
    pub events: i64,
    /// Conquistas (event_type = 'completed').
    pub completed: i64,
    /// Marcações de hábito ('checked').
    pub checked: i64,
}

fn map_entry(row: &Row) -> rusqlite::Result<LedgerEntry> {
    Ok(LedgerEntry {
        seq: row.get(0)?,
        ts: row.get(1)?,
        day: row.get(2)?,
        entity_id: row.get(3)?,
        entity_kind: row.get(4)?,
        event_type: row.get(5)?,
        payload: row.get(6)?,
        title_snapshot: row.get(7)?,
    })
}

const SELECT: &str =
    "SELECT seq, ts, day, entity_id, entity_kind, event_type, payload, title_snapshot FROM ledger";

impl SqliteTimelineRepository {
    /// Os meses ('YYYY-MM') com evento no ledger que são ANTERIORES a
    /// `current_month` — os candidatos a congelar. O mês corrente nunca entra:
    /// ele ainda está em curso.
    pub fn ledger_months_before(&self, current_month: &str) -> Result<Vec<String>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT DISTINCT substr(day, 1, 7) AS m FROM ledger
                  WHERE substr(day, 1, 7) < ?1
                  ORDER BY m",
            )?;
            let rows = stmt.query_map(params![current_month], |r| r.get::<_, String>(0))?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    /// Os meses que já têm rollup congelado.
    pub fn rolled_up_months(&self) -> Result<Vec<String>> {
        self.db.with_read(|c| {
            let mut stmt =
                c.prepare_cached("SELECT DISTINCT month FROM timeline_rollups ORDER BY month")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    /// Congela um mês: grava as contagens agregadas em `timeline_rollups`, numa
    /// transação. `INSERT OR REPLACE` torna o congelamento idempotente.
    pub fn freeze_month(&self, month: &str, now: i64) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            let day_from = format!("{month}-01");
            let day_to = format!("{month}-31");

            // Uma varredura do mês, três contagens.
            let (events, completed, checked): (i64, i64, i64) = tx.query_row(
                "SELECT
                    COUNT(*),
                    SUM(CASE WHEN event_type = 'completed' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN event_type = 'checked'   THEN 1 ELSE 0 END)
                   FROM ledger WHERE day BETWEEN ?1 AND ?2",
                params![day_from, day_to],
                |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0), r.get::<_, Option<i64>>(2)?.unwrap_or(0))),
            )?;

            for (metric, value) in [("events", events), ("completed", completed), ("checked", checked)] {
                tx.execute(
                    "INSERT OR REPLACE INTO timeline_rollups (month, metric, value, computed_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![month, metric, value as f64, now],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
    }

    /// Os rollups de um ano ('YYYY'), como `MonthRollup` por mês.
    ///
    /// Meses completos vêm de `timeline_rollups` (congelados). O mês corrente,
    /// que ainda não foi congelado, é computado AO VIVO do ledger e mesclado — a
    /// visão ANO nunca mostra o mês em curso vazio.
    pub fn year(&self, year: &str, current_month: &str) -> Result<Vec<MonthRollup>> {
        self.db.with_read(|c| {
            // Os congelados do ano.
            let mut stmt = c.prepare_cached(
                "SELECT month, metric, value FROM timeline_rollups
                  WHERE substr(month, 1, 4) = ?1",
            )?;
            let mut months: std::collections::BTreeMap<String, MonthRollup> = Default::default();
            let rows = stmt.query_map(params![year], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?))
            })?;
            for row in rows {
                let (month, metric, value) = row?;
                let entry = months.entry(month.clone()).or_insert_with(|| MonthRollup {
                    month,
                    events: 0,
                    completed: 0,
                    checked: 0,
                });
                match metric.as_str() {
                    "events" => entry.events = value as i64,
                    "completed" => entry.completed = value as i64,
                    "checked" => entry.checked = value as i64,
                    _ => {}
                }
            }

            // O mês corrente, ao vivo — se ele pertence ao ano pedido.
            if current_month.starts_with(year) && !months.contains_key(current_month) {
                let (events, completed, checked): (i64, i64, i64) = c.query_row(
                    "SELECT
                        COUNT(*),
                        SUM(CASE WHEN event_type = 'completed' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN event_type = 'checked'   THEN 1 ELSE 0 END)
                       FROM ledger WHERE day BETWEEN ?1 AND ?2",
                    params![format!("{current_month}-01"), format!("{current_month}-31")],
                    |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0), r.get::<_, Option<i64>>(2)?.unwrap_or(0))),
                )?;
                months.insert(
                    current_month.to_string(),
                    MonthRollup {
                        month: current_month.to_string(),
                        events,
                        completed,
                        checked,
                    },
                );
            }

            Ok(months.into_values().collect())
        })
    }

    /// "Neste dia": eventos do mesmo dia-do-mês ('MM-DD') de anos anteriores.
    ///
    /// `today` é 'YYYY-MM-DD'; a busca casa o sufixo 'MM-DD' e exclui o próprio
    /// hoje (só o passado — "há 1/2/5 anos").
    pub fn on_this_day(&self, today: &str) -> Result<Vec<LedgerEntry>> {
        self.db.with_read(|c| {
            let mmdd = &today[5..]; // 'MM-DD'
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT} WHERE substr(day, 6, 5) = ?1 AND day < ?2 ORDER BY day DESC, seq DESC LIMIT 40"
            ))?;
            let rows = stmt.query_map(params![mmdd, today], map_entry)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::domain::entities::Kind;
    use crate::infrastructure::paths::Paths;
    use crate::infrastructure::repositories::ledger_repo::SqliteLedgerRepository;
    use crate::application::ports::LedgerRepository;

    fn fixture() -> (tempfile::TempDir, SqliteTimelineRepository, SqliteLedgerRepository) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (
            dir,
            SqliteTimelineRepository::new(db.clone()),
            SqliteLedgerRepository::new(db),
        )
    }

    fn log(ledger: &SqliteLedgerRepository, day: &str, ty: EventType) {
        ledger
            .append(&NewLedgerEvent {
                ts: 0,
                day: day.into(),
                entity_id: "x".into(),
                entity_kind: LedgerEntityKind::Node(Kind::Task),
                event_type: ty,
                payload: serde_json::json!({}),
                title_snapshot: "algo".into(),
            })
            .unwrap();
    }

    #[test]
    fn freezing_a_month_counts_events_and_is_idempotent() {
        let (_d, tl, ledger) = fixture();
        log(&ledger, "2026-03-05", EventType::Created);
        log(&ledger, "2026-03-10", EventType::Completed);
        log(&ledger, "2026-03-11", EventType::Checked);
        log(&ledger, "2026-03-12", EventType::Checked);

        tl.freeze_month("2026-03", 0).unwrap();
        tl.freeze_month("2026-03", 1).unwrap(); // de novo: OR REPLACE, sem empilhar

        let year = tl.year("2026", "2026-07").unwrap();
        let march = year.iter().find(|m| m.month == "2026-03").unwrap();
        assert_eq!(march.events, 4);
        assert_eq!(march.completed, 1);
        assert_eq!(march.checked, 2);
    }

    #[test]
    fn only_months_before_the_current_are_candidates() {
        let (_d, tl, ledger) = fixture();
        log(&ledger, "2026-05-01", EventType::Created);
        log(&ledger, "2026-07-01", EventType::Created); // mês corrente

        let candidates = tl.ledger_months_before("2026-07").unwrap();
        assert_eq!(candidates, vec!["2026-05"], "julho está em curso, não congela");
    }

    #[test]
    fn the_year_view_computes_the_current_month_live() {
        let (_d, tl, ledger) = fixture();
        // Nada congelado; o mês corrente ainda aparece, computado ao vivo.
        log(&ledger, "2026-07-03", EventType::Completed);
        let year = tl.year("2026", "2026-07").unwrap();
        let july = year.iter().find(|m| m.month == "2026-07").unwrap();
        assert_eq!(july.completed, 1);
    }

    #[test]
    fn on_this_day_finds_past_years_and_excludes_today() {
        let (_d, tl, ledger) = fixture();
        log(&ledger, "2024-07-17", EventType::Created);
        log(&ledger, "2025-07-17", EventType::Completed);
        log(&ledger, "2026-07-17", EventType::Checked); // hoje
        log(&ledger, "2025-07-18", EventType::Created); // outro dia

        let hits = tl.on_this_day("2026-07-17").unwrap();
        assert_eq!(hits.len(), 2, "há 1 e 2 anos, sem o de hoje");
        assert_eq!(hits[0].day, "2025-07-17", "o mais recente primeiro");
    }
}
