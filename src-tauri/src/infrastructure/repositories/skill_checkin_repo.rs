//! O check-in mensal de competência em SQLite (BÚSSOLA, fase E).
//!
//! Um check-in é um FATO de baixa frequência que NÃO é um node: ele vive em
//! `skill_checkins` (0016), com PK (skill_id, month) e `WITHOUT ROWID` — a mesma
//! decisão de `habit_ticks`. Ler "todos os check-ins da competência X em ordem",
//! que é exatamente o que a fórmula do nível faz, vira um range scan sequencial.
//!
//! **Reinformar o mês CORRIGE, não empilha** (`INSERT OR REPLACE`), como
//! `portfolio_snapshots` e `reading_goals`: um mês só tem um retrato. Mas a
//! HISTÓRIA de ter respondido vai para o ledger na MESMA transação, e o ledger é
//! append-only — corrigir o estado nunca reescreve o que aconteceu. Por isso um
//! mês corrigido tem UMA linha de estado e DUAS de história.

use std::sync::Arc;

use rusqlite::{params, Row};

use crate::application::ports::{NewSkillCheckin, SkillCheckin, SkillCheckinRepository};
use crate::domain::errors::Result;
use crate::domain::ledger::NewLedgerEvent;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;

pub struct SqliteSkillCheckinRepository {
    db: Arc<Db>,
}

impl SqliteSkillCheckinRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT: &str = "
    SELECT skill_id, month, studied, applied, stars, noted_at
      FROM skill_checkins";

fn map_checkin(row: &Row) -> rusqlite::Result<SkillCheckin> {
    Ok(SkillCheckin {
        skill_id: row.get(0)?,
        month: row.get(1)?,
        studied: row.get::<_, i64>(2)? != 0,
        applied: row.get(3)?,
        stars: row.get(4)?,
        noted_at: row.get(5)?,
    })
}

impl SkillCheckinRepository for SqliteSkillCheckinRepository {
    fn upsert_with_event(
        &self,
        new: &NewSkillCheckin,
        event: &NewLedgerEvent,
    ) -> Result<SkillCheckin> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT OR REPLACE INTO skill_checkins
                     (skill_id, month, studied, applied, stars, noted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    new.skill_id,
                    new.month,
                    i64::from(new.studied),
                    new.applied,
                    new.stars,
                    event.ts,
                ],
            )?;
            append_in_tx(&tx, event)?;
            let saved = tx.query_row(
                &format!("{SELECT} WHERE skill_id = ?1 AND month = ?2"),
                params![new.skill_id, new.month],
                map_checkin,
            )?;
            tx.commit()?;
            Ok(saved)
        })
    }

    fn list_for_skill(&self, skill_id: &str) -> Result<Vec<SkillCheckin>> {
        self.db.with_read(|c| {
            let mut stmt =
                c.prepare_cached(&format!("{SELECT} WHERE skill_id = ?1 ORDER BY month"))?;
            let rows = stmt.query_map(params![skill_id], map_checkin)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ledger::{EventType, LedgerEntityKind};
    use crate::infrastructure::paths::Paths;

    fn fixture() -> (tempfile::TempDir, SqliteSkillCheckinRepository, Arc<Db>) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        // A FK de `skill_checkins.skill_id` aponta para `nodes`.
        db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, status, created_at, updated_at)
                 VALUES ('sk1', 'skill', 'System Design', 'active', 0, 0)",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        (dir, SqliteSkillCheckinRepository::new(db.clone()), db)
    }

    fn event(month: &str, ts: i64) -> NewLedgerEvent {
        NewLedgerEvent {
            ts,
            day: "2026-07-18".into(),
            entity_id: "sk1".into(),
            entity_kind: LedgerEntityKind::SkillCheckin,
            event_type: EventType::SkillCheckin,
            payload: serde_json::json!({ "month": month }),
            title_snapshot: "System Design".into(),
        }
    }

    fn checkin(month: &str, studied: bool, applied: i64, stars: i64) -> NewSkillCheckin {
        NewSkillCheckin {
            skill_id: "sk1".into(),
            month: month.into(),
            studied,
            applied,
            stars,
        }
    }

    fn ledger_count(db: &Db) -> i64 {
        db.with_read(|c| Ok(c.query_row("SELECT COUNT(*) FROM ledger", [], |r| r.get(0))?))
            .unwrap()
    }

    #[test]
    fn a_checkin_is_saved_and_logged_in_the_same_transaction() {
        let (_d, repo, db) = fixture();
        let saved = repo
            .upsert_with_event(&checkin("2026-07", true, 3, 4), &event("2026-07", 1_000))
            .unwrap();
        assert_eq!(saved.month, "2026-07");
        assert!(saved.studied);
        assert_eq!(saved.applied, 3);
        assert_eq!(saved.stars, 4);
        assert_eq!(saved.noted_at, 1_000);
        assert_eq!(ledger_count(&db), 1, "o check-in é um fato do usuário");
    }

    #[test]
    fn re_informing_the_month_corrects_it_instead_of_stacking() {
        let (_d, repo, db) = fixture();
        repo.upsert_with_event(&checkin("2026-07", true, 3, 4), &event("2026-07", 1_000))
            .unwrap();
        // O usuário se corrige: na verdade não estudou e aplicou uma vez só.
        let fixed = repo
            .upsert_with_event(&checkin("2026-07", false, 1, 2), &event("2026-07", 2_000))
            .unwrap();

        let all = repo.list_for_skill("sk1").unwrap();
        assert_eq!(all.len(), 1, "um mês só tem um retrato");
        assert_eq!(all[0], fixed);
        assert!(!all[0].studied);
        assert_eq!(all[0].applied, 1);
        assert_eq!(all[0].stars, 2);
        assert_eq!(all[0].noted_at, 2_000);

        // O ESTADO foi corrigido; a HISTÓRIA das duas respostas ficou.
        assert_eq!(
            ledger_count(&db),
            2,
            "corrigir o estado nunca apaga o que aconteceu"
        );
    }

    #[test]
    fn checkins_come_back_in_month_order() {
        let (_d, repo, _db) = fixture();
        // Gravados fora de ordem de propósito: a fórmula lê em ordem de mês.
        for m in ["2026-03", "2025-12", "2026-01"] {
            repo.upsert_with_event(&checkin(m, true, 2, 3), &event(m, 1_000))
                .unwrap();
        }
        let months: Vec<_> = repo
            .list_for_skill("sk1")
            .unwrap()
            .into_iter()
            .map(|c| c.month)
            .collect();
        assert_eq!(months, vec!["2025-12", "2026-01", "2026-03"]);
    }

    #[test]
    fn a_skill_without_checkins_comes_back_empty() {
        // Vazio, e não um zero inventado — quem calcula o nível decide o que
        // fazer com a ausência de fato.
        let (_d, repo, _db) = fixture();
        assert!(repo.list_for_skill("sk1").unwrap().is_empty());
        assert!(repo.list_for_skill("fantasma").unwrap().is_empty());
    }

    #[test]
    fn checkins_of_other_skills_do_not_leak() {
        let (_d, repo, db) = fixture();
        db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, status, created_at, updated_at)
                 VALUES ('sk2', 'skill', 'Inglês', 'active', 0, 0)",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        repo.upsert_with_event(&checkin("2026-07", true, 2, 3), &event("2026-07", 1_000))
            .unwrap();
        repo.upsert_with_event(
            &NewSkillCheckin {
                skill_id: "sk2".into(),
                ..checkin("2026-07", true, 4, 5)
            },
            &NewLedgerEvent {
                entity_id: "sk2".into(),
                ..event("2026-07", 1_000)
            },
        )
        .unwrap();

        assert_eq!(repo.list_for_skill("sk1").unwrap().len(), 1);
        assert_eq!(repo.list_for_skill("sk2").unwrap()[0].stars, 5);
    }

    #[test]
    fn deleting_the_skill_takes_its_checkins_with_it() {
        // `ON DELETE CASCADE` na 0016: sem o node, o check-in não tem do que falar.
        let (_d, repo, db) = fixture();
        repo.upsert_with_event(&checkin("2026-07", true, 2, 3), &event("2026-07", 1_000))
            .unwrap();
        db.with_write(|c| {
            c.execute("DELETE FROM nodes WHERE id = 'sk1'", [])?;
            Ok(())
        })
        .unwrap();
        assert!(repo.list_for_skill("sk1").unwrap().is_empty());
        // Mas a história continua no ledger.
        assert_eq!(ledger_count(&db), 1);
    }
}
