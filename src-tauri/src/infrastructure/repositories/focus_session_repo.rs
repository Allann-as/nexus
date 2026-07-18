//! Blocos de foco em SQLite (Modo Foco, M5).
//!
//! Um bloco de foco é um LOG de alta frequência (`focus_sessions`), não um node —
//! como a sessão de estudo (ADR-0027/0047). Registrar um bloco grava estado E o
//! evento `focus_session_logged` na MESMA transação. A ligação com a tarefa é
//! `ON DELETE SET NULL`: os minutos focados sobrevivem ao apagamento do vínculo.
//!
//! Só um bloco CONCLUÍDO chega aqui (o timer do frontend só loga ao zerar). Os
//! agregados alimentam as estatísticas de foco (minutos/semana, constância,
//! melhores horas). A hora do dia sai do `ts` convertido para o fuso LOCAL — o
//! bloco só guarda o `day` local, então `ts` é a única fonte da hora.

use std::sync::Arc;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Row};

use crate::application::ports::{FocusSession, FocusSessionRepository, NewFocusSession};
use crate::domain::errors::Result;
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;

pub struct SqliteFocusSessionRepository {
    db: Arc<Db>,
}

impl SqliteFocusSessionRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

/// As colunas de um bloco + o título da tarefa (para a lista não fazer N JOINs).
const SELECT_COLS: &str =
    "SELECT fs.id, fs.task_id, tk.title, fs.label, fs.minutes, fs.day, fs.ts \
     FROM focus_sessions fs";

/// O JOIN da tarefa — serve tanto ao título quanto ao filtro de Esfera.
const TASK_JOIN: &str = " LEFT JOIN nodes tk ON tk.id = fs.task_id";

/// O predicado de pertencimento a uma Esfera: a Esfera da tarefa focada.
const AREA_MATCH: &str = "tk.area_id";

fn map_session(row: &Row) -> rusqlite::Result<FocusSession> {
    Ok(FocusSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        task_title: row.get(2)?,
        label: row.get(3)?,
        minutes: row.get(4)?,
        day: row.get(5)?,
        ts: row.get(6)?,
    })
}

impl FocusSessionRepository for SqliteFocusSessionRepository {
    fn log_with_event(
        &self,
        id: &str,
        new: &NewFocusSession,
        ts: i64,
        event: &NewLedgerEvent,
    ) -> Result<FocusSession> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO focus_sessions (id, task_id, label, minutes, day, ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, new.task_id, new.label, new.minutes, new.day, ts],
            )?;
            append_in_tx(&tx, event)?;
            let created = tx.query_row(
                &format!("{SELECT_COLS}{TASK_JOIN} WHERE fs.id = ?1"),
                params![id],
                map_session,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn recent(&self, area_id: Option<&str>, limit: i64) -> Result<Vec<FocusSession>> {
        self.db.with_read(|c| {
            let mut sql = format!("{SELECT_COLS}{TASK_JOIN}");
            let mut vals: Vec<Value> = Vec::new();
            if let Some(a) = area_id {
                sql.push_str(&format!(" WHERE {AREA_MATCH} = ?"));
                vals.push(Value::Text(a.into()));
            }
            sql.push_str(" ORDER BY fs.day DESC, fs.ts DESC LIMIT ?");
            vals.push(Value::Integer(limit));
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(params_from_iter(vals.iter()), map_session)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn minutes_between(&self, area_id: Option<&str>, from: &str, to: &str) -> Result<i64> {
        self.db.with_read(|c| {
            let mut sql = format!(
                "SELECT COALESCE(SUM(fs.minutes), 0) FROM focus_sessions fs{TASK_JOIN} \
                 WHERE fs.day BETWEEN ? AND ?"
            );
            let mut vals: Vec<Value> = vec![Value::Text(from.into()), Value::Text(to.into())];
            if let Some(a) = area_id {
                sql.push_str(&format!(" AND {AREA_MATCH} = ?"));
                vals.push(Value::Text(a.into()));
            }
            Ok(c.query_row(&sql, params_from_iter(vals.iter()), |r| r.get(0))?)
        })
    }

    fn active_days_since(&self, area_id: Option<&str>, from: &str) -> Result<i64> {
        self.db.with_read(|c| {
            let mut sql = format!(
                "SELECT COUNT(DISTINCT fs.day) FROM focus_sessions fs{TASK_JOIN} \
                 WHERE fs.day >= ?"
            );
            let mut vals: Vec<Value> = vec![Value::Text(from.into())];
            if let Some(a) = area_id {
                sql.push_str(&format!(" AND {AREA_MATCH} = ?"));
                vals.push(Value::Text(a.into()));
            }
            Ok(c.query_row(&sql, params_from_iter(vals.iter()), |r| r.get(0))?)
        })
    }

    fn minutes_by_hour(&self, area_id: Option<&str>) -> Result<Vec<(i64, i64)>> {
        self.db.with_read(|c| {
            // A hora LOCAL de `ts` (epoch ms): fs.ts/1000 é segundos; 'localtime'
            // converte para o fuso da máquina — o "às 21h" que o usuário viveu.
            let mut sql = format!(
                "SELECT CAST(strftime('%H', fs.ts / 1000, 'unixepoch', 'localtime') AS INTEGER) \
                        AS hour, SUM(fs.minutes) \
                   FROM focus_sessions fs{TASK_JOIN}"
            );
            let mut vals: Vec<Value> = Vec::new();
            if let Some(a) = area_id {
                sql.push_str(&format!(" WHERE {AREA_MATCH} = ?"));
                vals.push(Value::Text(a.into()));
            }
            sql.push_str(" GROUP BY hour ORDER BY hour");
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(params_from_iter(vals.iter()), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            })?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn totals(&self, area_id: Option<&str>) -> Result<(i64, i64)> {
        self.db.with_read(|c| {
            let mut sql = format!(
                "SELECT COALESCE(SUM(fs.minutes), 0), COUNT(*) \
                   FROM focus_sessions fs{TASK_JOIN}"
            );
            let mut vals: Vec<Value> = Vec::new();
            if let Some(a) = area_id {
                sql.push_str(&format!(" WHERE {AREA_MATCH} = ?"));
                vals.push(Value::Text(a.into()));
            }
            Ok(c.query_row(&sql, params_from_iter(vals.iter()), |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?)
        })
    }

    fn delete(&self, id: &str) -> Result<()> {
        self.db.with_write(|c| {
            // Só a linha de estado — o ledger não é tocado (a história fica).
            let changed = c.execute("DELETE FROM focus_sessions WHERE id = ?1", params![id])?;
            if changed == 0 {
                return Err(crate::domain::errors::NexusError::NotFound(format!(
                    "bloco de foco {id}"
                )));
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteFocusSessionRepository, Arc<Db>) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (dir, SqliteFocusSessionRepository::new(db.clone()), db)
    }

    fn event(id: &str, day: &str, ts: i64) -> NewLedgerEvent {
        NewLedgerEvent {
            ts,
            day: day.into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::FocusSession,
            event_type: EventType::FocusSessionLogged,
            payload: serde_json::json!({}),
            title_snapshot: "Bloco de foco".into(),
        }
    }

    fn log(
        repo: &SqliteFocusSessionRepository,
        id: &str,
        task: Option<&str>,
        minutes: i64,
        day: &str,
        ts: i64,
    ) -> FocusSession {
        repo.log_with_event(
            id,
            &NewFocusSession {
                task_id: task.map(Into::into),
                label: Some("Escrever".into()),
                minutes,
                day: day.into(),
            },
            ts,
            &event(id, day, ts),
        )
        .unwrap()
    }

    /// Uma tarefa de verdade (node 'task'), para os testes que ligam blocos.
    fn seed_task(db: &Arc<Db>, id: &str, area: Option<&str>) {
        db.with_write(|c| {
            if let Some(a) = area {
                c.execute(
                    "INSERT OR IGNORE INTO areas (id, name) VALUES (?1, 'Carreira')",
                    params![a],
                )?;
            }
            c.execute(
                "INSERT INTO nodes (id, kind, title, area_id, status, created_at, updated_at)
                 VALUES (?1, 'task', 'Relatório', ?2, 'active', 0, 0)",
                params![id, area],
            )?;
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn logging_a_block_writes_state_and_a_ledger_event_together() {
        let (_d, repo, db) = fixture();
        seed_task(&db, "t1", None);
        let s = log(&repo, "fs1", Some("t1"), 25, "2026-07-18", 1_000);
        assert_eq!(s.minutes, 25);
        assert_eq!(s.task_title.as_deref(), Some("Relatório"));
        let logged: i64 = db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger WHERE entity_id = 'fs1' \
                       AND event_type = 'focus_session_logged'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(
            logged, 1,
            "um bloco concluído é um fato: existe na história"
        );
    }

    #[test]
    fn minutes_between_bounds_are_inclusive_and_area_filters() {
        let (_d, repo, db) = fixture();
        seed_task(&db, "t1", Some("area-carreira"));
        seed_task(&db, "t2", Some("area-outra"));
        log(&repo, "fs1", Some("t1"), 25, "2026-07-13", 1_000); // dentro
        log(&repo, "fs2", Some("t1"), 25, "2026-07-19", 2_000); // borda inclusiva
        log(&repo, "fs3", Some("t1"), 99, "2026-07-20", 3_000); // fora
        log(&repo, "fs4", Some("t2"), 50, "2026-07-15", 4_000); // outra Esfera

        assert_eq!(
            repo.minutes_between(None, "2026-07-13", "2026-07-19")
                .unwrap(),
            100
        );
        assert_eq!(
            repo.minutes_between(Some("area-carreira"), "2026-07-13", "2026-07-19")
                .unwrap(),
            50
        );
    }

    #[test]
    fn active_days_counts_distinct_days() {
        let (_d, repo, db) = fixture();
        seed_task(&db, "t1", None);
        log(&repo, "fs1", Some("t1"), 25, "2026-07-18", 1_000);
        log(&repo, "fs2", Some("t1"), 25, "2026-07-18", 2_000); // mesmo dia
        log(&repo, "fs3", Some("t1"), 25, "2026-07-19", 3_000);
        assert_eq!(repo.active_days_since(None, "2026-07-01").unwrap(), 2);
        assert_eq!(repo.active_days_since(None, "2026-07-19").unwrap(), 1);
    }

    #[test]
    fn a_free_focus_block_without_task_counts_in_general() {
        // Sem tarefa: area_id NULL, mas o bloco existe e soma nos totais globais.
        let (_d, repo, _db) = fixture();
        log(&repo, "fs1", None, 25, "2026-07-18", 1_000);
        assert_eq!(repo.totals(None).unwrap(), (25, 1));
        // Filtrar por uma Esfera não pega o foco livre (a tarefa é a fonte da Esfera).
        assert_eq!(repo.totals(Some("area-carreira")).unwrap(), (0, 0));
    }

    #[test]
    fn deleting_a_block_removes_state_but_keeps_the_ledger() {
        let (_d, repo, db) = fixture();
        seed_task(&db, "t1", None);
        log(&repo, "fs1", Some("t1"), 25, "2026-07-18", 1_000);

        repo.delete("fs1").unwrap();
        assert_eq!(repo.totals(None).unwrap(), (0, 0));

        let events: i64 = db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger WHERE entity_id = 'fs1' \
                       AND event_type = 'focus_session_logged'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(events, 1, "o fato de que o bloco foi focado permanece");

        assert!(repo.delete("fs1").is_err());
    }

    #[test]
    fn totals_and_recent_come_back_newest_first() {
        let (_d, repo, db) = fixture();
        seed_task(&db, "t1", None);
        log(&repo, "fs1", Some("t1"), 25, "2026-07-16", 1_000);
        log(&repo, "fs2", Some("t1"), 50, "2026-07-18", 2_000);

        assert_eq!(repo.totals(None).unwrap(), (75, 2));
        let recent = repo.recent(None, 10).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, "fs2", "o mais recente primeiro");
    }
}
