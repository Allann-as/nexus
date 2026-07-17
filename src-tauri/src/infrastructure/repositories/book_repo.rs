//! A Biblioteca — livros em SQLite.
//!
//! Um livro é um node 'book' com o satélite `book_details`. Terminar um livro é
//! um FATO (grava no ledger + conquista); mudar de página ou de prateleira é
//! estado de leitura (não grava). A resenha vira uma nota linkada — o primeiro
//! consumidor real da tabela `links` (0001).

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{Book, BookPatch, BookRepository, NewBook, NewNode, ReviewNote};
use crate::domain::entities::BookStatus;
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;
use crate::infrastructure::repositories::node_repo::insert_in_tx;

pub struct SqliteBookRepository {
    db: Arc<Db>,
}

impl SqliteBookRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT_BOOK: &str = "
    SELECT n.id, n.title, n.area_id,
           b.author, b.total_pages, b.current_page, b.status, b.rating, b.shelf,
           b.started_on, b.finished_on, n.created_at
      FROM book_details b
      JOIN nodes n ON n.id = b.node_id";

fn map_book(row: &Row) -> rusqlite::Result<Book> {
    let status: String = row.get(6)?;
    Ok(Book {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        author: row.get(3)?,
        total_pages: row.get(4)?,
        current_page: row.get(5)?,
        status: BookStatus::parse(&status).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e))
        })?,
        rating: row.get(7)?,
        shelf: row.get(8)?,
        started_on: row.get(9)?,
        finished_on: row.get(10)?,
        created_at: row.get(11)?,
    })
}

impl BookRepository for SqliteBookRepository {
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewBook,
        event: &NewLedgerEvent,
    ) -> Result<Book> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            insert_in_tx(&tx, id, node, event.ts)?;
            tx.execute(
                "INSERT INTO book_details (node_id, author, total_pages, shelf)
                 VALUES (?1, ?2, ?3, ?4)",
                params![id, new.author, new.total_pages, new.shelf],
            )?;
            append_in_tx(&tx, event)?;

            let created =
                tx.query_row(&format!("{SELECT_BOOK} WHERE n.id = ?1"), params![id], map_book)?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn get(&self, id: &str) -> Result<Book> {
        self.db.with_read(|c| {
            c.query_row(&format!("{SELECT_BOOK} WHERE n.id = ?1"), params![id], map_book)
                .optional()?
                .ok_or_else(|| NexusError::NotFound(format!("livro {id}")))
        })
    }

    fn list(&self, area_id: Option<&str>) -> Result<Vec<Book>> {
        self.db.with_read(|c| match area_id {
            Some(a) => {
                let mut stmt = c.prepare_cached(&format!(
                    "{SELECT_BOOK} WHERE n.status <> 'archived' AND n.area_id = ?1 \
                     ORDER BY n.created_at DESC"
                ))?;
                let rows = stmt.query_map(params![a], map_book)?;
                Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
            }
            None => {
                let mut stmt = c.prepare_cached(&format!(
                    "{SELECT_BOOK} WHERE n.status <> 'archived' ORDER BY n.created_at DESC"
                ))?;
                let rows = stmt.query_map([], map_book)?;
                Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
            }
        })
    }

    fn update(&self, id: &str, patch: &BookPatch) -> Result<Book> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // Flag+valor para os anuláveis (rating, shelf, datas): "limpar" e
            // "não mexer" chegam os dois como NULL e são pedidos diferentes.
            let changed = tx.execute(
                "UPDATE book_details SET
                    current_page = COALESCE(?2, current_page),
                    status       = COALESCE(?3, status),
                    rating       = CASE WHEN ?4 THEN ?5  ELSE rating      END,
                    shelf        = CASE WHEN ?6 THEN ?7  ELSE shelf       END,
                    started_on   = CASE WHEN ?8 THEN ?9  ELSE started_on  END,
                    finished_on  = CASE WHEN ?10 THEN ?11 ELSE finished_on END
                 WHERE node_id = ?1",
                params![
                    id,
                    patch.current_page,
                    patch.status.map(|s| s.as_str()),
                    patch.rating.is_some(),
                    patch.rating.flatten(),
                    patch.shelf.is_some(),
                    patch.shelf.clone().flatten(),
                    patch.started_on.is_some(),
                    patch.started_on.clone().flatten(),
                    patch.finished_on.is_some(),
                    patch.finished_on.clone().flatten(),
                ],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("livro {id}")));
            }

            if let Some(node_status) = patch.node_status {
                tx.execute(
                    "UPDATE nodes SET status = ?2 WHERE id = ?1",
                    params![id, node_status.as_str()],
                )?;
            }

            let updated =
                tx.query_row(&format!("{SELECT_BOOK} WHERE n.id = ?1"), params![id], map_book)?;
            tx.commit()?;
            Ok(updated)
        })
    }

    fn finish_with_event(
        &self,
        id: &str,
        rating: Option<i64>,
        finished_on: &str,
        now: i64,
        completion: &NewLedgerEvent,
        review: Option<&ReviewNote>,
    ) -> Result<Book> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // Terminar: status 'lido', nota, data, e a página no total (se
            // conhecido). O node vira 'done' — terminar um livro é uma conquista,
            // e o node concluído aparece na timeline como tal.
            let changed = tx.execute(
                "UPDATE book_details SET
                    status = 'lido',
                    rating = ?2,
                    finished_on = ?3,
                    current_page = COALESCE(total_pages, current_page),
                    started_on = COALESCE(started_on, ?3)
                 WHERE node_id = ?1",
                params![id, rating, finished_on],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("livro {id}")));
            }
            tx.execute(
                "UPDATE nodes SET status = 'done', updated_at = ?2 WHERE id = ?1",
                params![id, now],
            )?;
            append_in_tx(&tx, completion)?;

            // A resenha vira uma nota, linkada ao livro (§2.2). Tudo na mesma
            // transação: uma nota órfã ou um livro concluído sem a resenha que o
            // usuário escreveu seriam meio-fatos.
            if let Some(r) = review {
                insert_in_tx(
                    &tx,
                    &r.note_id,
                    &NewNode {
                        kind: crate::domain::entities::Kind::Note,
                        title: r.title.clone(),
                        // A nota herda a Esfera do livro.
                        area_id: tx
                            .query_row(
                                "SELECT area_id FROM nodes WHERE id = ?1",
                                params![id],
                                |row| row.get::<_, Option<String>>(0),
                            )
                            .optional()?
                            .flatten(),
                        parent_id: None,
                    },
                    now,
                )?;
                tx.execute(
                    "INSERT INTO note_details (node_id, body_md) VALUES (?1, ?2)",
                    params![r.note_id, r.body_md],
                )?;
                // O link livro → nota. 'references': a nota fala do livro.
                tx.execute(
                    "INSERT INTO links (source_id, target_id, link_type, created_at)
                     VALUES (?1, ?2, 'references', ?3)",
                    params![id, r.note_id, now],
                )?;
                append_in_tx(&tx, &r.event)?;
            }

            let updated =
                tx.query_row(&format!("{SELECT_BOOK} WHERE n.id = ?1"), params![id], map_book)?;
            tx.commit()?;
            Ok(updated)
        })
    }

    fn finished_in_year(&self, year: &str) -> Result<i64> {
        self.db.with_read(|c| {
            // 'lido' com `finished_on` no ano. substr(...,1,4) é o ano local,
            // como `happened_on` nas Finanças — comparação de texto exata.
            Ok(c.query_row(
                "SELECT COUNT(*) FROM book_details
                  WHERE status = 'lido' AND substr(finished_on, 1, 4) = ?1",
                params![year],
                |r| r.get(0),
            )?)
        })
    }

    fn reading_goal(&self, year: &str) -> Result<Option<i64>> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT target FROM reading_goals WHERE year = ?1",
                params![year],
                |r| r.get(0),
            )
            .optional()?)
        })
    }

    fn set_reading_goal(&self, year: &str, target: i64, noted_at: i64) -> Result<()> {
        self.db.with_write(|c| {
            c.execute(
                "INSERT OR REPLACE INTO reading_goals (year, target, noted_at)
                 VALUES (?1, ?2, ?3)",
                params![year, target, noted_at],
            )?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::entities::Kind;
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteBookRepository) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (dir, SqliteBookRepository::new(db))
    }

    fn ev(id: &str, ty: EventType) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1_000,
            day: "2026-07-17".into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::Node(Kind::Book),
            event_type: ty,
            payload: serde_json::json!({}),
            title_snapshot: "O Nome do Vento".into(),
        }
    }

    fn make_book(repo: &SqliteBookRepository, id: &str, pages: Option<i64>) {
        repo.create_with_event(
            id,
            &NewNode {
                kind: Kind::Book,
                title: "O Nome do Vento".into(),
                area_id: Some("sphere-studies".into()),
                parent_id: None,
            },
            &NewBook {
                title: "O Nome do Vento".into(),
                area_id: Some("sphere-studies".into()),
                author: Some("Patrick Rothfuss".into()),
                total_pages: pages,
                shelf: Some("ficcao".into()),
            },
            &ev(id, EventType::Created),
        )
        .unwrap();
    }

    #[test]
    fn a_new_book_starts_in_the_queue() {
        let (_d, repo) = fixture();
        make_book(&repo, "b1", Some(600));
        let b = repo.get("b1").unwrap();
        assert_eq!(b.status, BookStatus::Fila);
        assert_eq!(b.current_page, 0);
        assert_eq!(b.author.as_deref(), Some("Patrick Rothfuss"));
    }

    #[test]
    fn updating_progress_does_not_touch_the_ledger() {
        let (_d, repo) = fixture();
        make_book(&repo, "b1", Some(600));
        repo.update(
            "b1",
            &BookPatch {
                current_page: Some(120),
                status: Some(BookStatus::Lendo),
                started_on: Some(Some("2026-07-01".into())),
                ..Default::default()
            },
        )
        .unwrap();

        let b = repo.get("b1").unwrap();
        assert_eq!(b.current_page, 120);
        assert_eq!(b.status, BookStatus::Lendo);

        let events: i64 = repo
            .db
            .with_read(|c| Ok(c.query_row("SELECT COUNT(*) FROM ledger WHERE entity_id='b1'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(events, 1, "só o Created; mudar de página não é um fato");
    }

    #[test]
    fn finishing_marks_lido_sets_the_node_done_and_logs_it() {
        let (_d, repo) = fixture();
        make_book(&repo, "b1", Some(600));
        repo.finish_with_event("b1", Some(5), "2026-07-15", 9_000, &ev("b1", EventType::Completed), None)
            .unwrap();

        let b = repo.get("b1").unwrap();
        assert_eq!(b.status, BookStatus::Lido);
        assert_eq!(b.rating, Some(5));
        assert_eq!(b.current_page, 600, "terminar leva a página ao total");
        assert_eq!(b.finished_on.as_deref(), Some("2026-07-15"));

        let node_status: String = repo
            .db
            .with_read(|c| Ok(c.query_row("SELECT status FROM nodes WHERE id='b1'", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(node_status, "done");
    }

    #[test]
    fn a_review_becomes_a_linked_note() {
        let (_d, repo) = fixture();
        make_book(&repo, "b1", Some(600));

        let review = ReviewNote {
            note_id: "note1".into(),
            title: "Resenha: O Nome do Vento".into(),
            body_md: "Prosa linda, ritmo lento no meio.".into(),
            event: NewLedgerEvent {
                ts: 9_000,
                day: "2026-07-15".into(),
                entity_id: "note1".into(),
                entity_kind: LedgerEntityKind::Node(Kind::Note),
                event_type: EventType::Created,
                payload: serde_json::json!({}),
                title_snapshot: "Resenha: O Nome do Vento".into(),
            },
        };
        repo.finish_with_event("b1", Some(4), "2026-07-15", 9_000, &ev("b1", EventType::Completed), Some(&review))
            .unwrap();

        // A nota existe, herdou a Esfera e está linkada ao livro.
        let (note_area, linked): (Option<String>, i64) = repo
            .db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT (SELECT area_id FROM nodes WHERE id='note1'),
                            (SELECT COUNT(*) FROM links WHERE source_id='b1' AND target_id='note1')",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?)
            })
            .unwrap();
        assert_eq!(note_area.as_deref(), Some("sphere-studies"), "a nota herda a Esfera do livro");
        assert_eq!(linked, 1, "o link livro → nota existe");
    }

    #[test]
    fn the_annual_count_only_sees_books_finished_that_year() {
        let (_d, repo) = fixture();
        make_book(&repo, "b1", Some(100));
        make_book(&repo, "b2", Some(100));
        repo.finish_with_event("b1", Some(5), "2026-03-01", 0, &ev("b1", EventType::Completed), None)
            .unwrap();
        repo.finish_with_event("b2", Some(4), "2025-12-30", 0, &ev("b2", EventType::Completed), None)
            .unwrap();

        assert_eq!(repo.finished_in_year("2026").unwrap(), 1);
        assert_eq!(repo.finished_in_year("2025").unwrap(), 1);
    }

    #[test]
    fn the_reading_goal_round_trips_and_corrects_on_reset() {
        let (_d, repo) = fixture();
        assert_eq!(repo.reading_goal("2026").unwrap(), None);
        repo.set_reading_goal("2026", 12, 0).unwrap();
        repo.set_reading_goal("2026", 20, 1).unwrap();
        assert_eq!(repo.reading_goal("2026").unwrap(), Some(20));
    }

    #[test]
    fn deleting_the_book_takes_the_details() {
        let (_d, repo) = fixture();
        make_book(&repo, "b1", Some(100));
        repo.db
            .with_write(|c| {
                c.execute("DELETE FROM nodes WHERE id='b1'", [])?;
                Ok(())
            })
            .unwrap();
        let n: i64 = repo
            .db
            .with_read(|c| Ok(c.query_row("SELECT COUNT(*) FROM book_details", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(n, 0);
    }
}
