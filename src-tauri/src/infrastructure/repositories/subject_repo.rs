//! Matérias dos Estudos em SQLite (M4.6, item 7).
//!
//! Uma matéria é um node 'subject' com o satélite `subject_details`. O progresso
//! NÃO mora aqui — ele é somado das sessões (`study_session_repo`). O satélite
//! guarda só identidade e a meta opcional de minutos. Criar uma matéria é um fato
//! (`created` no ledger); mexer na meta é configuração e não grava (ADR-0023).

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{NewNode, NewSubject, Subject, SubjectRepository};
use crate::domain::entities::{CourseStage, SubjectTrack};
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
           s.category, s.target_minutes, n.created_at,
           s.track, s.course_stage, s.expected_end, s.level_goal_id
      FROM subject_details s
      JOIN nodes n ON n.id = s.node_id";

fn map_subject(row: &Row) -> rusqlite::Result<Subject> {
    // `track` e `course_stage` são fechados no CHECK da 0016; se ainda assim uma
    // linha trouxer lixo, cai no default em vez de derrubar a listagem inteira —
    // uma matéria com trilha estranha aparece em "Matérias", não some do app.
    let track: String = row.get(7)?;
    let stage: Option<String> = row.get(8)?;
    Ok(Subject {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        category: row.get(4)?,
        target_minutes: row.get(5)?,
        created_at: row.get(6)?,
        track: SubjectTrack::parse(&track).unwrap_or_default(),
        course_stage: stage.as_deref().and_then(|s| CourseStage::parse(s).ok()),
        expected_end: row.get(9)?,
        level_goal_id: row.get(10)?,
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
                "INSERT INTO subject_details
                     (node_id, category, target_minutes, track, course_stage, expected_end)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    id,
                    new.category,
                    new.target_minutes,
                    new.track.as_str(),
                    new.course_stage.map(|s| s.as_str()),
                    new.expected_end,
                ],
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

    fn list(&self, area_id: Option<&str>, track: Option<SubjectTrack>) -> Result<Vec<Subject>> {
        self.db.with_read(|c| {
            // Arquivadas somem; por categoria e depois título.
            let order = " AND n.status <> 'archived' \
                         ORDER BY s.category IS NULL, s.category, n.title";
            // Os dois filtros são independentes: ambos entram como `?N IS NULL OR
            // coluna = ?N`, então uma única query cobre as quatro combinações sem
            // montar SQL na mão. O `idx_subject_track` atende ao segundo.
            let sql = format!(
                "{SELECT} WHERE (?1 IS NULL OR n.area_id = ?1) \
                             AND (?2 IS NULL OR s.track = ?2){order}"
            );
            let mut stmt = c.prepare_cached(&sql)?;
            let rows = stmt.query_map(params![area_id, track.map(|t| t.as_str())], map_subject)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
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

    fn set_course_stage(
        &self,
        id: &str,
        stage: Option<CourseStage>,
        updated_at: i64,
    ) -> Result<Subject> {
        self.update_column(
            id,
            "course_stage",
            &stage.map(|s| s.as_str().to_string()),
            updated_at,
        )
    }

    fn set_expected_end(&self, id: &str, day: Option<&str>, updated_at: i64) -> Result<Subject> {
        self.update_column(id, "expected_end", &day.map(|d| d.to_string()), updated_at)
    }

    fn set_level_goal(&self, id: &str, goal_id: Option<&str>, updated_at: i64) -> Result<Subject> {
        self.update_column(
            id,
            "level_goal_id",
            &goal_id.map(|g| g.to_string()),
            updated_at,
        )
    }
}

impl SqliteSubjectRepository {
    /// Grava UMA coluna do satélite e devolve a matéria já relida.
    ///
    /// `column` NUNCA vem de fora — os três chamadores passam literais deste
    /// arquivo. É o único jeito de não repetir três vezes o mesmo UPDATE + o
    /// mesmo `updated_at` + o mesmo NotFound.
    fn update_column(
        &self,
        id: &str,
        column: &'static str,
        value: &Option<String>,
        updated_at: i64,
    ) -> Result<Subject> {
        self.db.with_write(|conn| {
            let changed = conn.execute(
                &format!("UPDATE subject_details SET {column} = ?2 WHERE node_id = ?1"),
                params![id, value],
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
        make_on(repo, id, "Cálculo", SubjectTrack::Livre, target)
    }

    fn make_on(
        repo: &SqliteSubjectRepository,
        id: &str,
        title: &str,
        track: SubjectTrack,
        target: Option<i64>,
    ) -> Subject {
        repo.create_with_event(
            id,
            &NewNode {
                kind: Kind::Subject,
                title: title.into(),
                area_id: None,
                parent_id: None,
            },
            &NewSubject {
                title: title.into(),
                area_id: None,
                category: Some("Faculdade".into()),
                target_minutes: target,
                track,
                course_stage: None,
                expected_end: None,
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
        let live = repo.list(None, None).unwrap();
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
    fn a_new_subject_defaults_to_the_free_track() {
        // O default do schema, visto de fora: quem não escolhe seção cai em
        // "Matérias", e nada de curso vem junto.
        let (_d, repo, _db) = fixture();
        let s = make(&repo, "su1", None);
        assert_eq!(s.track, SubjectTrack::Livre);
        assert_eq!(s.course_stage, None);
        assert_eq!(s.expected_end, None);
        assert_eq!(s.level_goal_id, None);
    }

    #[test]
    fn the_track_filter_isolates_the_sections_from_each_other() {
        // O BUG da fase D, no nível do repositório: o Inglês criado em Idiomas
        // NÃO pode aparecer em Faculdade nem em Cursos.
        let (_d, repo, _db) = fixture();
        make_on(&repo, "s_idi", "Inglês", SubjectTrack::Idioma, None);
        make_on(&repo, "s_fac", "Cálculo II", SubjectTrack::Faculdade, None);
        make_on(&repo, "s_cur", "Rust Avançado", SubjectTrack::Curso, None);
        make_on(&repo, "s_liv", "Xadrez", SubjectTrack::Livre, None);

        for (track, expected) in [
            (SubjectTrack::Idioma, "s_idi"),
            (SubjectTrack::Faculdade, "s_fac"),
            (SubjectTrack::Curso, "s_cur"),
            (SubjectTrack::Livre, "s_liv"),
        ] {
            let found = repo.list(None, Some(track)).unwrap();
            assert_eq!(found.len(), 1, "{track:?} devia trazer exatamente uma");
            assert_eq!(found[0].id, expected);
            assert_eq!(found[0].track, track);
        }

        // E `None` continua trazendo TUDO — é disso que a aba "Matérias" vive.
        assert_eq!(repo.list(None, None).unwrap().len(), 4);
    }

    #[test]
    fn the_track_filter_combines_with_the_area_filter() {
        let (_d, repo, db) = fixture();
        db.with_write(|c| {
            c.execute("INSERT INTO areas (id, name) VALUES ('a1', 'Estudos')", [])?;
            Ok(())
        })
        .unwrap();
        // Dois idiomas, um em a1 e um sem esfera.
        repo.create_with_event(
            "s1",
            &NewNode {
                kind: Kind::Subject,
                title: "Inglês".into(),
                area_id: Some("a1".into()),
                parent_id: None,
            },
            &NewSubject {
                title: String::new(),
                area_id: None,
                category: None,
                target_minutes: None,
                track: SubjectTrack::Idioma,
                course_stage: None,
                expected_end: None,
            },
            &created("s1"),
        )
        .unwrap();
        make_on(&repo, "s2", "Alemão", SubjectTrack::Idioma, None);

        let in_area = repo.list(Some("a1"), Some(SubjectTrack::Idioma)).unwrap();
        assert_eq!(in_area.len(), 1);
        assert_eq!(in_area[0].id, "s1");
        // Sem trilha, mas com esfera: só a de a1 também.
        assert_eq!(repo.list(Some("a1"), None).unwrap().len(), 1);
        // Sem esfera, com trilha: os dois idiomas.
        assert_eq!(
            repo.list(None, Some(SubjectTrack::Idioma)).unwrap().len(),
            2
        );
    }

    #[test]
    fn the_course_fields_are_written_and_cleared() {
        let (_d, repo, _db) = fixture();
        make_on(&repo, "c1", "Rust", SubjectTrack::Curso, None);

        let s = repo
            .set_course_stage("c1", Some(CourseStage::Fazendo), 2_000)
            .unwrap();
        assert_eq!(s.course_stage, Some(CourseStage::Fazendo));

        let s = repo
            .set_expected_end("c1", Some("2026-12-31"), 3_000)
            .unwrap();
        assert_eq!(s.expected_end.as_deref(), Some("2026-12-31"));
        // O estágio não foi atropelado pela outra escrita.
        assert_eq!(s.course_stage, Some(CourseStage::Fazendo));

        // E os dois voltam a None.
        assert_eq!(
            repo.set_course_stage("c1", None, 4_000)
                .unwrap()
                .course_stage,
            None
        );
        assert_eq!(
            repo.set_expected_end("c1", None, 5_000)
                .unwrap()
                .expected_end,
            None
        );
    }

    #[test]
    fn the_level_goal_link_is_written_and_cleared() {
        let (_d, repo, db) = fixture();
        make_on(&repo, "i1", "Inglês", SubjectTrack::Idioma, None);
        db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, status, created_at, updated_at)
                 VALUES ('g1', 'goal', 'Inglês: Básico -> Fluente', 'active', 0, 0)",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        let s = repo.set_level_goal("i1", Some("g1"), 2_000).unwrap();
        assert_eq!(s.level_goal_id.as_deref(), Some("g1"));
        assert_eq!(
            repo.set_level_goal("i1", None, 3_000)
                .unwrap()
                .level_goal_id,
            None
        );
    }

    #[test]
    fn the_new_setters_refuse_a_missing_subject() {
        let (_d, repo, _db) = fixture();
        assert!(repo
            .set_course_stage("ghost", Some(CourseStage::Fazendo), 1)
            .is_err());
        assert!(repo
            .set_expected_end("ghost", Some("2026-01-01"), 1)
            .is_err());
        assert!(repo.set_level_goal("ghost", Some("g1"), 1).is_err());
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
