//! Notas em SQLite — corpo, wiki-links (o segundo consumidor de `links`) e anexos.

use std::sync::Arc;

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::application::ports::{
    Attachment, NewAttachment, NewNode, NoteFull, NoteLink, NoteRepository, NoteSummary,
};
use crate::domain::entities::Kind;
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;
use crate::infrastructure::repositories::node_repo::insert_in_tx;

pub struct SqliteNoteRepository {
    db: Arc<Db>,
}

impl SqliteNoteRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

fn kind_of(s: &str) -> rusqlite::Result<Kind> {
    Kind::parse(s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}

fn map_link(row: &Row) -> rusqlite::Result<NoteLink> {
    let kind: String = row.get(1)?;
    Ok(NoteLink {
        node_id: row.get(0)?,
        kind: kind_of(&kind)?,
        title: row.get(2)?,
        link_type: row.get(3)?,
    })
}

/// Lê os elos de saída (menos anexos), backlinks e anexos de uma nota — cada um
/// em UMA query, usando o mesmo `conn` para servir tanto leitura quanto tx.
fn read_relations(
    conn: &Connection,
    id: &str,
) -> rusqlite::Result<(Vec<NoteLink>, Vec<NoteLink>, Vec<Attachment>)> {
    let mut out_stmt = conn.prepare(
        "SELECT n.id, n.kind, n.title, l.link_type
           FROM links l JOIN nodes n ON n.id = l.target_id
          WHERE l.source_id = ?1 AND l.link_type <> 'attached_to'
          ORDER BY n.title",
    )?;
    let outgoing = out_stmt
        .query_map(params![id], map_link)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut back_stmt = conn.prepare(
        "SELECT n.id, n.kind, n.title, l.link_type
           FROM links l JOIN nodes n ON n.id = l.source_id
          WHERE l.target_id = ?1
          ORDER BY n.updated_at DESC",
    )?;
    let backlinks = back_stmt
        .query_map(params![id], map_link)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut att_stmt = conn.prepare(
        "SELECT n.id, n.title, f.relative_path, f.mime, f.size_bytes, f.sha256
           FROM links l
           JOIN nodes n        ON n.id = l.target_id
           JOIN file_details f ON f.node_id = n.id
          WHERE l.source_id = ?1 AND l.link_type = 'attached_to'
          ORDER BY n.created_at DESC",
    )?;
    let attachments = att_stmt
        .query_map(params![id], |r| {
            Ok(Attachment {
                node_id: r.get(0)?,
                title: r.get(1)?,
                relative_path: r.get(2)?,
                mime: r.get(3)?,
                size_bytes: r.get(4)?,
                sha256: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok((outgoing, backlinks, attachments))
}

fn read_note(conn: &Connection, id: &str) -> Result<NoteFull> {
    let base = conn
        .query_row(
            "SELECT n.id, n.title, n.area_id, n.updated_at,
                    COALESCE(d.body_md, ''), COALESCE(d.is_pinned, 0)
               FROM nodes n
               LEFT JOIN note_details d ON d.node_id = n.id
              WHERE n.id = ?1 AND n.kind = 'note'",
            params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| NexusError::NotFound(format!("nota {id}")))?;

    let (outgoing, backlinks, attachments) = read_relations(conn, id)?;
    Ok(NoteFull {
        id: base.0,
        title: base.1,
        area_id: base.2,
        updated_at: base.3,
        body_md: base.4,
        is_pinned: base.5 != 0,
        outgoing,
        backlinks,
        attachments,
    })
}

impl NoteRepository for SqliteNoteRepository {
    fn list(&self, area_id: Option<&str>) -> Result<Vec<NoteSummary>> {
        self.db.with_read(|c| {
            let sql = "SELECT n.id, n.title, n.area_id, COALESCE(d.is_pinned, 0), n.updated_at
                         FROM nodes n
                         LEFT JOIN note_details d ON d.node_id = n.id
                        WHERE n.kind = 'note' AND n.status <> 'archived'";
            let map = |r: &Row| {
                Ok(NoteSummary {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    area_id: r.get(2)?,
                    is_pinned: r.get::<_, i64>(3)? != 0,
                    updated_at: r.get(4)?,
                })
            };
            // Fixadas primeiro, depois as mais recentes.
            let order = " ORDER BY COALESCE(d.is_pinned,0) DESC, n.updated_at DESC";
            match area_id {
                Some(a) => {
                    let mut stmt = c.prepare_cached(&format!("{sql} AND n.area_id = ?1{order}"))?;
                    let rows = stmt
                        .query_map(params![a], map)?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    Ok(rows)
                }
                None => {
                    let mut stmt = c.prepare_cached(&format!("{sql}{order}"))?;
                    let rows = stmt
                        .query_map([], map)?
                        .collect::<rusqlite::Result<Vec<_>>>()?;
                    Ok(rows)
                }
            }
        })
    }

    fn get_full(&self, id: &str) -> Result<NoteFull> {
        self.db.with_read(|c| read_note(c, id))
    }

    fn save_body_with_event(
        &self,
        id: &str,
        body_md: &str,
        resolved: &[String],
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<NoteFull> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // O node precisa existir e ser uma nota.
            let exists: Option<String> = tx
                .query_row(
                    "SELECT id FROM nodes WHERE id = ?1 AND kind = 'note'",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?;
            if exists.is_none() {
                return Err(NexusError::NotFound(format!("nota {id}")));
            }

            // Upsert do corpo. O gatilho de FTS (note_fts_ai/au) reindexará.
            tx.execute(
                "INSERT INTO note_details (node_id, body_md) VALUES (?1, ?2)
                 ON CONFLICT(node_id) DO UPDATE SET body_md = excluded.body_md",
                params![id, body_md],
            )?;
            tx.execute(
                "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
                params![id, updated_at],
            )?;

            // Resincroniza os wiki-links: apaga os 'references' que ESTA nota
            // emitia e regrava os resolvidos. Os 'attached_to' (anexos) não vêm
            // do texto e ficam intactos.
            tx.execute(
                "DELETE FROM links WHERE source_id = ?1 AND link_type = 'references'",
                params![id],
            )?;
            {
                let mut ins = tx.prepare(
                    "INSERT OR IGNORE INTO links (source_id, target_id, link_type, created_at)
                     VALUES (?1, ?2, 'references', ?3)",
                )?;
                for target in resolved {
                    // Um elo para si mesma não é backlink de nada.
                    if target != id {
                        ins.execute(params![id, target, updated_at])?;
                    }
                }
            }

            append_in_tx(&tx, event)?;
            let note = read_note(&tx, id)?;
            tx.commit()?;
            Ok(note)
        })
    }

    fn set_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        self.db.with_write(|c| {
            // Upsert: uma nota sem corpo ainda pode ser fixada.
            c.execute(
                "INSERT INTO note_details (node_id, is_pinned) VALUES (?1, ?2)
                 ON CONFLICT(node_id) DO UPDATE SET is_pinned = excluded.is_pinned",
                params![id, i64::from(pinned)],
            )?;
            Ok(())
        })
    }

    fn find_by_title(&self, title: &str, exclude_id: &str) -> Result<Option<String>> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT id FROM nodes
                  WHERE title = ?1 COLLATE NOCASE AND id <> ?2 AND status <> 'archived'
                  ORDER BY updated_at DESC LIMIT 1",
                params![title, exclude_id],
                |r| r.get(0),
            )
            .optional()?)
        })
    }

    fn path_for_sha(&self, sha256: &str) -> Result<Option<String>> {
        self.db.with_read(|c| {
            Ok(c.query_row(
                "SELECT relative_path FROM file_details WHERE sha256 = ?1 LIMIT 1",
                params![sha256],
                |r| r.get(0),
            )
            .optional()?)
        })
    }

    fn attach_with_event(
        &self,
        file_id: &str,
        note_id: &str,
        att: &NewAttachment,
        now: i64,
        event: &NewLedgerEvent,
    ) -> Result<Attachment> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            insert_in_tx(
                &tx,
                file_id,
                &NewNode {
                    kind: Kind::File,
                    title: att.title.clone(),
                    area_id: att.area_id.clone(),
                    parent_id: None,
                },
                now,
            )?;
            tx.execute(
                "INSERT INTO file_details (node_id, relative_path, mime, size_bytes, sha256)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    file_id,
                    att.relative_path,
                    att.mime,
                    att.size_bytes,
                    att.sha256
                ],
            )?;
            tx.execute(
                "INSERT INTO links (source_id, target_id, link_type, created_at)
                 VALUES (?1, ?2, 'attached_to', ?3)",
                params![note_id, file_id, now],
            )?;
            append_in_tx(&tx, event)?;
            tx.commit()?;

            Ok(Attachment {
                node_id: file_id.to_string(),
                title: att.title.clone(),
                relative_path: att.relative_path.clone(),
                mime: att.mime.clone(),
                size_bytes: att.size_bytes,
                sha256: att.sha256.clone(),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ports::NodeRepository;
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;
    use crate::infrastructure::repositories::node_repo::SqliteNodeRepository;

    fn fixture() -> (
        tempfile::TempDir,
        SqliteNoteRepository,
        SqliteNodeRepository,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (
            dir,
            SqliteNoteRepository::new(db.clone()),
            SqliteNodeRepository::new(db),
        )
    }

    fn ev(id: &str, ty: EventType) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1,
            day: "2026-07-17".into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::Node(Kind::Note),
            event_type: ty,
            payload: serde_json::json!({}),
            title_snapshot: "Nota".into(),
        }
    }

    fn note(nodes: &SqliteNodeRepository, id: &str, title: &str) {
        nodes
            .create_with_event(
                id,
                &NewNode {
                    kind: Kind::Note,
                    title: title.into(),
                    area_id: None,
                    parent_id: None,
                },
                &ev(id, EventType::Created),
            )
            .unwrap();
    }

    #[test]
    fn saving_a_body_makes_it_searchable_and_readable_back() {
        let (_d, notes, nodes) = fixture();
        note(&nodes, "n1", "Sono");
        notes
            .save_body_with_event(
                "n1",
                "Dormir 7h30 por noite.",
                &[],
                10,
                &ev("n1", EventType::NoteEdited),
            )
            .unwrap();

        let full = notes.get_full("n1").unwrap();
        assert_eq!(full.body_md, "Dormir 7h30 por noite.");
        assert_eq!(full.updated_at, 10);
    }

    #[test]
    fn wiki_links_become_links_and_backlinks() {
        let (_d, notes, nodes) = fixture();
        note(&nodes, "n1", "Diário");
        note(&nodes, "n2", "Academia");

        notes
            .save_body_with_event(
                "n1",
                "Fui à [[Academia]] hoje.",
                &["n2".into()],
                10,
                &ev("n1", EventType::NoteEdited),
            )
            .unwrap();

        let from = notes.get_full("n1").unwrap();
        assert_eq!(from.outgoing.len(), 1);
        assert_eq!(from.outgoing[0].node_id, "n2");

        let to = notes.get_full("n2").unwrap();
        assert_eq!(to.backlinks.len(), 1, "Academia sabe que o Diário a cita");
        assert_eq!(to.backlinks[0].node_id, "n1");
    }

    #[test]
    fn re_saving_resyncs_the_wiki_links() {
        // Tirar um [[elo]] do texto tem que apagar o link; o backlink some junto.
        let (_d, notes, nodes) = fixture();
        note(&nodes, "n1", "Diário");
        note(&nodes, "n2", "Academia");

        notes
            .save_body_with_event(
                "n1",
                "[[Academia]]",
                &["n2".into()],
                10,
                &ev("n1", EventType::NoteEdited),
            )
            .unwrap();
        notes
            .save_body_with_event(
                "n1",
                "sem elos agora",
                &[],
                11,
                &ev("n1", EventType::NoteEdited),
            )
            .unwrap();

        assert!(notes.get_full("n1").unwrap().outgoing.is_empty());
        assert!(
            notes.get_full("n2").unwrap().backlinks.is_empty(),
            "o backlink some"
        );
    }

    #[test]
    fn find_by_title_is_case_insensitive_and_skips_self() {
        let (_d, notes, nodes) = fixture();
        note(&nodes, "n1", "Protocolo de Sono");
        note(&nodes, "n2", "Protocolo de Sono");
        assert_eq!(
            notes.find_by_title("protocolo de sono", "n1").unwrap(),
            Some("n2".into())
        );
        assert_eq!(notes.find_by_title("Inexistente", "n1").unwrap(), None);
    }

    #[test]
    fn an_attachment_creates_a_file_node_and_an_attached_link() {
        let (_d, notes, nodes) = fixture();
        note(&nodes, "n1", "Nota com foto");

        notes
            .attach_with_event(
                "f1",
                "n1",
                &NewAttachment {
                    title: "print.png".into(),
                    relative_path: "media/2026/07/abc.png".into(),
                    mime: "image/png".into(),
                    size_bytes: 1234,
                    sha256: "abc".into(),
                    area_id: None,
                },
                5,
                &ev("f1", EventType::Created),
            )
            .unwrap();

        let full = notes.get_full("n1").unwrap();
        assert_eq!(full.attachments.len(), 1);
        assert_eq!(full.attachments[0].relative_path, "media/2026/07/abc.png");
        // O anexo NÃO polui os wiki-links de saída.
        assert!(full.outgoing.is_empty());
        assert_eq!(
            notes.path_for_sha("abc").unwrap().as_deref(),
            Some("media/2026/07/abc.png")
        );
    }

    #[test]
    fn re_saving_the_body_keeps_the_attachment() {
        let (_d, notes, nodes) = fixture();
        note(&nodes, "n1", "Nota");
        notes
            .attach_with_event(
                "f1",
                "n1",
                &NewAttachment {
                    title: "x.png".into(),
                    relative_path: "media/x.png".into(),
                    mime: "image/png".into(),
                    size_bytes: 1,
                    sha256: "s".into(),
                    area_id: None,
                },
                5,
                &ev("f1", EventType::Created),
            )
            .unwrap();
        notes
            .save_body_with_event(
                "n1",
                "texto novo",
                &[],
                10,
                &ev("n1", EventType::NoteEdited),
            )
            .unwrap();

        assert_eq!(
            notes.get_full("n1").unwrap().attachments.len(),
            1,
            "o anexo sobrevive ao save"
        );
    }
}
