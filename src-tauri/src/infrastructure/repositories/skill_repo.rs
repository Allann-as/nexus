//! Competências da Carreira em SQLite (M4.6).
//!
//! Uma competência é um node 'skill' com o satélite `skill_details`. O `level` é o
//! estado ATUAL; subir de nível é um FATO do usuário no ledger ('skill_level_up'),
//! gravado na MESMA transação que incrementa `level` (ADR-0037/0045). A trilha de
//! evolução é a série desses eventos — o nível é a posição na ordem, então nada é
//! guardado no payload.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{NewNode, NewSkill, Skill, SkillRepository};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;
use crate::infrastructure::repositories::node_repo::insert_in_tx;

pub struct SqliteSkillRepository {
    db: Arc<Db>,
}

impl SqliteSkillRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT: &str = "
    SELECT n.id, n.title, n.area_id, n.status,
           s.level, s.category, s.max_level, n.created_at
      FROM skill_details s
      JOIN nodes n ON n.id = s.node_id";

fn map_skill(row: &Row) -> rusqlite::Result<Skill> {
    Ok(Skill {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        level: row.get(4)?,
        category: row.get(5)?,
        max_level: row.get(6)?,
        created_at: row.get(7)?,
    })
}

impl SkillRepository for SqliteSkillRepository {
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewSkill,
        event: &NewLedgerEvent,
    ) -> Result<Skill> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            insert_in_tx(&tx, id, node, event.ts)?;
            tx.execute(
                "INSERT INTO skill_details (node_id, level, category, max_level)
                 VALUES (?1, 1, ?2, ?3)",
                params![id, new.category, new.max_level],
            )?;
            append_in_tx(&tx, event)?;
            let created =
                tx.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_skill)?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn get(&self, id: &str) -> Result<Skill> {
        self.db.with_read(|c| {
            c.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_skill)
                .optional()?
                .ok_or_else(|| NexusError::NotFound(format!("competência {id}")))
        })
    }

    fn list(&self, area_id: Option<&str>) -> Result<Vec<Skill>> {
        self.db.with_read(|c| {
            // Arquivadas somem; maior nível primeiro, depois por categoria e título.
            let order = " AND n.status <> 'archived' \
                         ORDER BY s.level DESC, s.category IS NULL, s.category, n.title";
            match area_id {
                Some(a) => {
                    let mut stmt =
                        c.prepare_cached(&format!("{SELECT} WHERE n.area_id = ?1{order}"))?;
                    let rows = stmt.query_map(params![a], map_skill)?;
                    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
                }
                None => {
                    let mut stmt = c.prepare_cached(&format!("{SELECT} WHERE 1 = 1{order}"))?;
                    let rows = stmt.query_map([], map_skill)?;
                    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
                }
            }
        })
    }

    fn level_up_with_event(
        &self,
        id: &str,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Skill> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            // Incremento atômico, guardado pelo teto: só sobe se não há teto ou se
            // ainda está abaixo dele. O CHECK do banco (`max_level >= level`) é a
            // segunda linha de defesa. `changed == 0` = já no máximo (ou não existe).
            let changed = tx.execute(
                "UPDATE skill_details
                    SET level = level + 1
                  WHERE node_id = ?1 AND (max_level IS NULL OR level < max_level)",
                params![id],
            )?;
            if changed == 0 {
                // Distingue "não existe" de "já no teto" para uma mensagem honesta.
                let exists: bool = tx
                    .query_row(
                        "SELECT 1 FROM skill_details WHERE node_id = ?1",
                        params![id],
                        |_| Ok(true),
                    )
                    .optional()?
                    .unwrap_or(false);
                return Err(if exists {
                    NexusError::Validation("a competência já está no nível máximo".into())
                } else {
                    NexusError::NotFound(format!("competência {id}"))
                });
            }
            tx.execute(
                "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
                params![id, updated_at],
            )?;
            append_in_tx(&tx, event)?;
            let updated =
                tx.query_row(&format!("{SELECT} WHERE n.id = ?1"), params![id], map_skill)?;
            tx.commit()?;
            Ok(updated)
        })
    }

    fn level_history(&self, id: &str) -> Result<Vec<(String, i64)>> {
        self.db.with_read(|c| {
            // O 'created' é o nível 1; cada 'skill_level_up' é +1. Ordenado por ts,
            // o nível é a posição na sequência — nada precisa vir do payload.
            let mut stmt = c.prepare(
                "SELECT day FROM ledger
                  WHERE entity_id = ?1 AND event_type IN ('created','skill_level_up')
                  ORDER BY ts, seq",
            )?;
            let days = stmt
                .query_map(params![id], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(days
                .into_iter()
                .enumerate()
                .map(|(i, day)| (day, (i as i64) + 1))
                .collect())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::entities::Kind;
    use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteSkillRepository) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        (dir, SqliteSkillRepository::new(db))
    }

    fn created(id: &str) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1_000,
            day: "2026-07-18".into(),
            entity_id: id.into(),
            entity_kind: LedgerEntityKind::Node(Kind::Skill),
            event_type: EventType::Created,
            payload: serde_json::json!({}),
            title_snapshot: "System Design".into(),
        }
    }

    fn make(repo: &SqliteSkillRepository, id: &str, max_level: Option<i64>) -> Skill {
        repo.create_with_event(
            id,
            &NewNode {
                kind: Kind::Skill,
                title: "System Design".into(),
                area_id: None,
                parent_id: None,
            },
            &NewSkill {
                title: "System Design".into(),
                area_id: None,
                category: Some("Backend".into()),
                max_level,
            },
            &created(id),
        )
        .unwrap()
    }

    fn level_up(repo: &SqliteSkillRepository, id: &str, ts: i64, day: &str) -> Result<Skill> {
        repo.level_up_with_event(
            id,
            ts,
            &NewLedgerEvent {
                ts,
                day: day.into(),
                event_type: EventType::SkillLevelUp,
                ..created(id)
            },
        )
    }

    #[test]
    fn a_new_skill_starts_at_level_one() {
        let (_d, repo) = fixture();
        let s = make(&repo, "sk1", None);
        assert_eq!(s.level, 1);
        assert_eq!(s.status, "active");
        assert_eq!(s.category.as_deref(), Some("Backend"));
    }

    #[test]
    fn leveling_up_climbs_and_logs_one_event_each() {
        let (_d, repo) = fixture();
        make(&repo, "sk1", None);
        assert_eq!(
            level_up(&repo, "sk1", 2_000, "2026-07-19").unwrap().level,
            2
        );
        assert_eq!(
            level_up(&repo, "sk1", 3_000, "2026-07-20").unwrap().level,
            3
        );

        // A trilha: created (1) + dois level-ups (2, 3) = três pontos.
        let hist = repo.level_history("sk1").unwrap();
        assert_eq!(hist.len(), 3);
        assert_eq!(hist[0].1, 1);
        assert_eq!(hist[2].1, 3);
    }

    #[test]
    fn a_brand_new_skill_has_a_single_history_point() {
        // A UI omite o sparkline quando há um ponto só — aqui está a fonte disso.
        let (_d, repo) = fixture();
        make(&repo, "sk1", None);
        assert_eq!(repo.level_history("sk1").unwrap().len(), 1);
    }

    #[test]
    fn the_cap_refuses_leveling_past_the_max() {
        let (_d, repo) = fixture();
        make(&repo, "sk1", Some(2));
        assert_eq!(
            level_up(&repo, "sk1", 2_000, "2026-07-19").unwrap().level,
            2
        );
        // No teto: recusa, e não grava um segundo level-up.
        assert!(level_up(&repo, "sk1", 3_000, "2026-07-20").is_err());
        assert_eq!(repo.get("sk1").unwrap().level, 2);
        assert_eq!(repo.level_history("sk1").unwrap().len(), 2);
    }

    #[test]
    fn leveling_a_missing_skill_is_not_found() {
        let (_d, repo) = fixture();
        assert!(level_up(&repo, "ghost", 1, "2026-07-19").is_err());
    }
}
