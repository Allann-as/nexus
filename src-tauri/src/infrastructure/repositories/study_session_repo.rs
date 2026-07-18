//! Sessões de estudo em SQLite (M4.6, item 7).
//!
//! Uma sessão é um LOG de alta frequência (`study_sessions`), não um node — como
//! o aporte (ADR-0027/0045). Registrar uma sessão grava estado E o evento
//! `study_session_logged` na MESMA transação. As três ligações (matéria, livro,
//! competência) são independentes e `ON DELETE SET NULL`: a hora estudada
//! sobrevive ao apagamento do vínculo.
//!
//! Os agregados daqui alimentam o progresso da matéria e as estatísticas de
//! estudo (horas/semana, constância, melhores horários). A hora do dia sai do
//! `ts` convertido para o fuso LOCAL — a sessão só guarda o `day` local, não o
//! turno, então `ts` é a única fonte da hora.

use std::sync::Arc;

use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Row};

use crate::application::ports::{
    NewStudySession, SessionSummary, StudySession, StudySessionRepository,
};
use crate::domain::errors::Result;
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;

pub struct SqliteStudySessionRepository {
    db: Arc<Db>,
}

impl SqliteStudySessionRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

/// As colunas de uma sessão + o título da matéria (para a lista não fazer N JOINs).
const SELECT_COLS: &str = "SELECT ss.id, ss.subject_id, subj.title, ss.book_id, ss.skill_id, \
     ss.topic, ss.minutes, ss.day, ss.ts FROM study_sessions ss";

/// Só o JOIN da matéria — o suficiente para o título.
const SUBJ_JOIN: &str = " LEFT JOIN nodes subj ON subj.id = ss.subject_id";

/// Os três JOINs — para o filtro de Esfera por `COALESCE` (a mesma regra do XP).
const AREA_JOINS: &str = " LEFT JOIN nodes subj ON subj.id = ss.subject_id \
     LEFT JOIN nodes bk ON bk.id = ss.book_id \
     LEFT JOIN nodes sk ON sk.id = ss.skill_id";

/// O predicado de pertencimento a uma Esfera: a matéria, ou o livro/competência.
const AREA_MATCH: &str = "COALESCE(subj.area_id, bk.area_id, sk.area_id)";

fn map_session(row: &Row) -> rusqlite::Result<StudySession> {
    Ok(StudySession {
        id: row.get(0)?,
        subject_id: row.get(1)?,
        subject_title: row.get(2)?,
        book_id: row.get(3)?,
        skill_id: row.get(4)?,
        topic: row.get(5)?,
        minutes: row.get(6)?,
        day: row.get(7)?,
        ts: row.get(8)?,
    })
}

impl StudySessionRepository for SqliteStudySessionRepository {
    fn log_with_event(
        &self,
        id: &str,
        new: &NewStudySession,
        ts: i64,
        event: &NewLedgerEvent,
    ) -> Result<StudySession> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO study_sessions
                   (id, subject_id, book_id, skill_id, topic, minutes, day, ts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    id,
                    new.subject_id,
                    new.book_id,
                    new.skill_id,
                    new.topic,
                    new.minutes,
                    new.day,
                    ts,
                ],
            )?;
            append_in_tx(&tx, event)?;
            let created = tx.query_row(
                &format!("{SELECT_COLS}{SUBJ_JOIN} WHERE ss.id = ?1"),
                params![id],
                map_session,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn recent(&self, area_id: Option<&str>, limit: i64) -> Result<Vec<StudySession>> {
        self.db.with_read(|c| {
            let mut sql = format!("{SELECT_COLS}{AREA_JOINS}");
            let mut vals: Vec<Value> = Vec::new();
            if let Some(a) = area_id {
                sql.push_str(&format!(" WHERE {AREA_MATCH} = ?"));
                vals.push(Value::Text(a.into()));
            }
            sql.push_str(" ORDER BY ss.day DESC, ss.ts DESC LIMIT ?");
            vals.push(Value::Integer(limit));
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(params_from_iter(vals.iter()), map_session)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn recent_for_subject(&self, subject_id: &str, limit: i64) -> Result<Vec<StudySession>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT_COLS}{SUBJ_JOIN} WHERE ss.subject_id = ?1 \
                 ORDER BY ss.day DESC, ss.ts DESC LIMIT ?2"
            ))?;
            let rows = stmt.query_map(params![subject_id, limit], map_session)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn subject_summary(&self, subject_id: &str) -> Result<SessionSummary> {
        self.db.with_read(|c| {
            // Uma varredura das sessões da matéria (índice parcial por subject_id):
            // minutos, contagem, último dia e livros distintos tocados. `COUNT(DISTINCT
            // book_id)` ignora NULL — sessões sem livro não inflam o número.
            let s = c.query_row(
                "SELECT COALESCE(SUM(minutes), 0), COUNT(*), MAX(day), COUNT(DISTINCT book_id)
                   FROM study_sessions WHERE subject_id = ?1",
                params![subject_id],
                |r| {
                    Ok(SessionSummary {
                        total_minutes: r.get(0)?,
                        session_count: r.get(1)?,
                        last_day: r.get(2)?,
                        books_touched: r.get(3)?,
                    })
                },
            )?;
            Ok(s)
        })
    }

    fn minutes_between(&self, area_id: Option<&str>, from: &str, to: &str) -> Result<i64> {
        self.db.with_read(|c| {
            let mut sql = format!(
                "SELECT COALESCE(SUM(ss.minutes), 0) FROM study_sessions ss{AREA_JOINS} \
                 WHERE ss.day BETWEEN ? AND ?"
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
                "SELECT COUNT(DISTINCT ss.day) FROM study_sessions ss{AREA_JOINS} \
                 WHERE ss.day >= ?"
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
            // A hora LOCAL de `ts` (epoch ms): ss.ts/1000 é segundos; 'localtime'
            // converte para o fuso da máquina do usuário — o "às 21h" que ele viveu.
            let mut sql = format!(
                "SELECT CAST(strftime('%H', ss.ts / 1000, 'unixepoch', 'localtime') AS INTEGER) \
                        AS hour, SUM(ss.minutes) \
                   FROM study_sessions ss{AREA_JOINS}"
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
                "SELECT COALESCE(SUM(ss.minutes), 0), COUNT(*) \
                   FROM study_sessions ss{AREA_JOINS}"
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
            let changed = c.execute("DELETE FROM study_sessions WHERE id = ?1", params![id])?;
            if changed == 0 {
                return Err(crate::domain::errors::NexusError::NotFound(format!(
                    "sessão {id}"
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

    fn fixture() -> (tempfile::TempDir, SqliteStudySessionRepository, Arc<Db>) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (dir, SqliteStudySessionRepository::new(db.clone()), db)
    }

    fn event(id: &str, day: &str, ts: i64) -> NewLedgerEvent {
        NewLedgerEvent {
            ts,
            day: day.into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::StudySession,
            event_type: EventType::StudySessionLogged,
            payload: serde_json::json!({}),
            title_snapshot: "Sessão de estudo".into(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn log(
        repo: &SqliteStudySessionRepository,
        id: &str,
        subject: Option<&str>,
        book: Option<&str>,
        minutes: i64,
        day: &str,
        ts: i64,
    ) -> StudySession {
        repo.log_with_event(
            id,
            &NewStudySession {
                subject_id: subject.map(Into::into),
                book_id: book.map(Into::into),
                skill_id: None,
                topic: Some("integrais".into()),
                minutes,
                day: day.into(),
            },
            ts,
            &event(id, day, ts),
        )
        .unwrap()
    }

    /// Uma matéria de verdade (node 'subject'), para os testes que ligam sessões.
    fn seed_subject(db: &Arc<Db>, id: &str, area: Option<&str>) {
        db.with_write(|c| {
            if let Some(a) = area {
                c.execute(
                    "INSERT OR IGNORE INTO areas (id, name) VALUES (?1, 'Estudos')",
                    params![a],
                )?;
            }
            c.execute(
                "INSERT INTO nodes (id, kind, title, area_id, status, created_at, updated_at)
                 VALUES (?1, 'subject', 'Cálculo', ?2, 'active', 0, 0)",
                params![id, area],
            )?;
            c.execute(
                "INSERT INTO subject_details (node_id, category, target_minutes)
                 VALUES (?1, NULL, NULL)",
                params![id],
            )?;
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn logging_a_session_writes_state_and_a_ledger_event_together() {
        let (_d, repo, db) = fixture();
        seed_subject(&db, "su1", None);
        let s = log(&repo, "ss1", Some("su1"), None, 40, "2026-07-18", 1_000);
        assert_eq!(s.minutes, 40);
        assert_eq!(s.subject_title.as_deref(), Some("Cálculo"));
        let logged: i64 = db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger WHERE entity_id = 'ss1' \
                       AND event_type = 'study_session_logged'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(logged, 1, "uma sessão é um fato: existe na história");
    }

    #[test]
    fn the_subject_summary_aggregates_minutes_sessions_and_books() {
        let (_d, repo, db) = fixture();
        seed_subject(&db, "su1", None);
        // O livro precisa existir: `study_sessions.book_id` tem FK para `nodes`.
        db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, status, created_at, updated_at)
                 VALUES ('bk1', 'book', 'SICP', 'active', 0, 0)",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        log(
            &repo,
            "ss1",
            Some("su1"),
            Some("bk1"),
            30,
            "2026-07-16",
            1_000,
        );
        log(
            &repo,
            "ss2",
            Some("su1"),
            Some("bk1"),
            45,
            "2026-07-18",
            2_000,
        );
        log(&repo, "ss3", Some("su1"), None, 15, "2026-07-17", 3_000);

        let sum = repo.subject_summary("su1").unwrap();
        assert_eq!(sum.total_minutes, 90);
        assert_eq!(sum.session_count, 3);
        assert_eq!(sum.last_day.as_deref(), Some("2026-07-18"));
        assert_eq!(sum.books_touched, 1, "um livro distinto, ignorando o NULL");
    }

    #[test]
    fn an_empty_subject_summary_is_zeroes_not_a_crash() {
        let (_d, repo, db) = fixture();
        seed_subject(&db, "su1", None);
        let sum = repo.subject_summary("su1").unwrap();
        assert_eq!(sum.total_minutes, 0);
        assert_eq!(sum.session_count, 0);
        assert_eq!(sum.last_day, None);
    }

    #[test]
    fn minutes_between_bounds_are_inclusive_and_area_filters() {
        let (_d, repo, db) = fixture();
        seed_subject(&db, "su1", Some("area-estudos"));
        seed_subject(&db, "su2", Some("area-outra"));
        log(&repo, "ss1", Some("su1"), None, 30, "2026-07-13", 1_000); // dentro
        log(&repo, "ss2", Some("su1"), None, 20, "2026-07-19", 2_000); // borda inclusiva
        log(&repo, "ss3", Some("su1"), None, 99, "2026-07-20", 3_000); // fora
        log(&repo, "ss4", Some("su2"), None, 50, "2026-07-15", 4_000); // outra Esfera

        // Sem filtro: as três dentro da janela (30+20+50).
        assert_eq!(
            repo.minutes_between(None, "2026-07-13", "2026-07-19")
                .unwrap(),
            100
        );
        // Filtrado à Esfera de Estudos: só su1 (30+20).
        assert_eq!(
            repo.minutes_between(Some("area-estudos"), "2026-07-13", "2026-07-19")
                .unwrap(),
            50
        );
    }

    #[test]
    fn active_days_counts_distinct_days() {
        let (_d, repo, db) = fixture();
        seed_subject(&db, "su1", None);
        log(&repo, "ss1", Some("su1"), None, 30, "2026-07-18", 1_000);
        log(&repo, "ss2", Some("su1"), None, 20, "2026-07-18", 2_000); // mesmo dia
        log(&repo, "ss3", Some("su1"), None, 10, "2026-07-19", 3_000);
        assert_eq!(repo.active_days_since(None, "2026-07-01").unwrap(), 2);
        // O corte é inclusivo e recorta o passado.
        assert_eq!(repo.active_days_since(None, "2026-07-19").unwrap(), 1);
    }

    #[test]
    fn deleting_a_session_removes_state_but_keeps_the_ledger() {
        // Corrigir um erro: a linha some do estado, o evento fica na história.
        let (_d, repo, db) = fixture();
        seed_subject(&db, "su1", None);
        log(&repo, "ss1", Some("su1"), None, 45, "2026-07-18", 1_000);

        repo.delete("ss1").unwrap();
        assert_eq!(repo.subject_summary("su1").unwrap().total_minutes, 0);
        assert_eq!(repo.totals(None).unwrap(), (0, 0));

        // O evento do ledger sobrevive — a história é imutável (append-only).
        let events: i64 = db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger WHERE entity_id = 'ss1' \
                       AND event_type = 'study_session_logged'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(events, 1, "o fato de que a sessão foi lançada permanece");

        // Apagar de novo é um erro honesto (não silencioso).
        assert!(repo.delete("ss1").is_err());
    }

    #[test]
    fn totals_and_recent_come_back_newest_first() {
        let (_d, repo, db) = fixture();
        seed_subject(&db, "su1", None);
        log(&repo, "ss1", Some("su1"), None, 30, "2026-07-16", 1_000);
        log(&repo, "ss2", Some("su1"), None, 20, "2026-07-18", 2_000);

        assert_eq!(repo.totals(None).unwrap(), (50, 2));
        let recent = repo.recent(None, 10).unwrap();
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, "ss2", "o mais recente primeiro");
    }
}
