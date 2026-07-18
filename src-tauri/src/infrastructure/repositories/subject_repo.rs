//! Matérias dos Estudos em SQLite (M4.6, item 7).
//!
//! Uma matéria é um node 'subject' com o satélite `subject_details`. O progresso
//! NÃO mora aqui — ele é somado das sessões (`study_session_repo`). O satélite
//! guarda só identidade e a meta opcional de minutos. Criar uma matéria é um fato
//! (`created` no ledger); mexer na meta é configuração e não grava (ADR-0023).

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{NewNode, NewSubject, Subject, SubjectRepository};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;
use crate::infrastructure::repositories::node_repo::insert_in_tx;

pub struct SqliteSubjectRepository {
    db: Arc<Db>,
}

impl SqliteSubjectRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT: &str = "
    SELECT n.id, n.title, n.area_id, n.status,
           s.category, s.target_minutes, n.created_at
      FROM subject_details s
      JOIN nodes n ON n.id = s.node_id";

fn map_subject(row: &Row) -> rusqlite::Result<Subject> {
    Ok(Subject {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        category: row.get(4)?,
        target_minutes: row.get(5)?,
        created_at: row.get(6)?,
    })
}

impl SubjectRepository for SqliteSubjectRepository {
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewSubject,
        event: &NewLedgerEvent,
    ) -> Result<Subject> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            insert_in_tx(&tx, id, node, event.ts)?;
            tx.execute(
                "INSERT INTO subject_details (node_id, category, target_minutes)
                 VALUES (?1, ?2, ?3)",
                params![id, new.category, new.target_minutes],
            )?;
            append_in_tx(&tx, event)?;
            let created = tx.query_row(
                &format!("{SELECT} WHERE n.id = ?1"),
                params![id],
                map_subject,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn get(&self, id: &str) -> Result<Subject> {
        self.db.with_read(|c| {
            c.query_row(
                &format!("{SELECT} WHERE n.id = ?1"),
                params![id],
                map_subject,
            )
            .optional()?
            .ok_or_else(|| NexusError::NotFound(format!("matéria {id}")))
        })
    }

    fn list(&self, area_id: Option<&str>) -> Result<Vec<Subject>> {
        self.db.with_read(|c| {
            // Arquivadas somem; por categoria e depois título (a trilha da matéria).
            let order = " AND n.status <> 'archived' \
                         ORDER BY s.category IS NULL, s.category, n.title";
            match area_id {
                Some(a) => {
                    let mut stmt =
                        c.prepare_cached(&format!("{SELECT} WHERE n.area_id = ?1{order}"))?;
                    let rows = stmt.query_map(params![a], map_subject)?;
                    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
                }
                None => {
                    let mut stmt = c.prepare_cached(&format!("{SELECT} WHERE 1 = 1{order}"))?;
                    let rows = stmt.query_map([], map_subject)?;
                    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
                }
            }
        })
    }

    fn set_target(
        &self,
        id: &str,
        target_minutes: Option<i64>,
        updated_at: i64,
    ) -> Result<Subject> {
        self.db.with_write(|conn| {
            let changed = conn.execute(
                "UPDATE subject_details SET target_minutes = ?2 WHERE node_id = ?1",
                params![id, target_minutes],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("matéria {id}")));
            }
            conn.execute(
                "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
                params![id, updated_at],
            )?;
            conn.query_row(
                &format!("{SELECT} WHERE n.id = ?1"),
                params![id],
                map_subject,
            )
            .map_err(Into::into)
        })
    }

    fn archive(&self, id: &str, updated_at: i64) -> Result<()> {
        self.db.with_write(|conn| {
            let changed = conn.execute(
                "UPDATE nodes SET status = 'archived', archived_at = ?2, updated_at = ?2
                  WHERE id = ?1 AND kind = 'subject'",
                params![id, updated_at],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("matéria {id}")));
            }
            Ok(())
        })
    }

    fn linked_count(&self, id: &str) -> Result<i64> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT COUNT(*) FROM links WHERE target_id = ?1",
                params![id],
                |r| r.get(0),
            )?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::entities::Kind;
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteSubjectRepository, Arc<Db>) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (dir, SqliteSubjectRepository::new(db.clone()), db)
    }

    fn created(id: &str) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1_000,
            day: "2026-07-18".into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::Node(Kind::Subject),
            event_type: EventType::Created,
            payload: serde_json::json!({}),
            title_snapshot: "Cálculo".into(),
        }
    }

    fn make(repo: &SqliteSubjectRepository, id: &str, target: Option<i64>) -> Subject {
        repo.create_with_event(
            id,
            &NewNode {
                kind: Kind::Subject,
                title: "Cálculo".into(),
                area_id: None,
                parent_id: None,
            },
            &NewSubject {
                title: "Cálculo".into(),
                area_id: None,
                category: Some("Faculdade".into()),
                target_minutes: target,
            },
            &created(id),
        )
        .unwrap()
    }

    #[test]
    fn a_new_subject_carries_its_target_and_category() {
        let (_d, repo, _db) = fixture();
        let s = make(&repo, "su1", Some(6000));
        assert_eq!(s.status, "active");
        assert_eq!(s.category.as_deref(), Some("Faculdade"));
        assert_eq!(s.target_minutes, Some(6000));
        // O `created` foi ao ledger.
        assert_eq!(repo.get("su1").unwrap().id, "su1");
    }

    #[test]
    fn setting_the_target_does_not_touch_the_ledger() {
        // Mexer na meta é configuração (ADR-0023): muda o satélite, não a história.
        let (_d, repo, db) = fixture();
        make(&repo, "su1", None);
        let before: i64 = db
            .with_read(|c| Ok(c.query_row("SELECT COUNT(*) FROM ledger", [], |r| r.get(0))?))
            .unwrap();
        let s = repo.set_target("su1", Some(1200), 2_000).unwrap();
        assert_eq!(s.target_minutes, Some(1200));
        let after: i64 = db
            .with_read(|c| Ok(c.query_row("SELECT COUNT(*) FROM ledger", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(before, after, "trocar a meta não é um fato do ledger");
        // Removê-la volta a None.
        assert_eq!(
            repo.set_target("su1", None, 3_000).unwrap().target_minutes,
            None
        );
    }

    #[test]
    fn archiving_hides_it_from_the_list() {
        let (_d, repo, _db) = fixture();
        make(&repo, "su1", None);
        make(&repo, "su2", None);
        repo.archive("su1", 5_000).unwrap();
        let live = repo.list(None).unwrap();
        assert_eq!(live.len(), 1);
        assert_eq!(live[0].id, "su2");
        // Mas o node segue existindo (a hora estudada nas sessões sobrevive).
        assert_eq!(repo.get("su1").unwrap().status, "archived");
    }

    #[test]
    fn a_missing_subject_is_not_found() {
        let (_d, repo, _db) = fixture();
        assert!(repo.get("ghost").is_err());
        assert!(repo.set_target("ghost", Some(1), 1).is_err());
        assert!(repo.archive("ghost", 1).is_err());
    }

    #[test]
    fn linked_count_reads_the_links_table() {
        let (_d, repo, db) = fixture();
        make(&repo, "su1", None);
        assert_eq!(repo.linked_count("su1").unwrap(), 0);
        // Um link apontando para a matéria (ex.: uma meta de carreira que "conta para").
        db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, status, created_at, updated_at)
                 VALUES ('g1', 'annual_goal', 'Passar', 'active', 0, 0)",
                [],
            )?;
            c.execute(
                "INSERT INTO links (source_id, target_id, link_type, created_at)
                 VALUES ('g1', 'su1', 'contributes_to', 0)",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        assert_eq!(repo.linked_count("su1").unwrap(), 1);
    }
}
