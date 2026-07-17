//! As leituras em lote do Hub, em SQLite.
//!
//! Duas queries — não duas por Esfera, não duas por hábito. O Hub é a primeira
//! tela que o usuário vê a cada abertura do app; o orçamento dela é o cold
//! start inteiro.

use std::sync::Arc;

use rusqlite::params;

use crate::application::ports::{SphereRepository, Tick};
use crate::domain::entities::Kind;
use crate::domain::errors::Result;
use crate::domain::streak::TickStatus;
use crate::infrastructure::db::Db;

pub struct SqliteSphereRepository {
    db: Arc<Db>,
}

impl SqliteSphereRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

impl SphereRepository for SqliteSphereRepository {
    fn ticks_since(&self, from_day: &str) -> Result<Vec<(String, String, Tick)>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT habit_id, day, status, value
                   FROM habit_ticks
                  WHERE day >= ?1
                  ORDER BY habit_id, day",
            )?;

            let rows = stmt.query_map(params![from_day], |r| {
                let status: String = r.get(2)?;
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    status,
                    r.get::<_, Option<f64>>(3)?,
                ))
            })?;

            let mut out = Vec::new();
            for row in rows {
                let (habit_id, day, status, value) = row?;
                // Um status fora do vocabulário só existiria por escrita manual
                // no arquivo. Ignorar a linha degrada um sparkline; um unwrap
                // derrubaria o Hub inteiro.
                let Some(status) = TickStatus::parse(&status) else {
                    tracing::warn!(
                        habit_id,
                        day,
                        status,
                        "tick com status desconhecido, ignorado"
                    );
                    continue;
                };
                out.push((habit_id, day, Tick { status, value }));
            }
            Ok(out)
        })
    }

    fn active_node_counts_by_area(&self) -> Result<Vec<(Option<String>, Kind, i64)>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT area_id, kind, COUNT(*)
                   FROM nodes
                  WHERE status = 'active' AND archived_at IS NULL
                  GROUP BY area_id, kind",
            )?;

            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?;

            let mut out = Vec::new();
            for row in rows {
                let (area_id, kind, count) = row?;
                // Idem: o CHECK de `nodes.kind` já garante o vocabulário. Se
                // algo escapou, é um contador a menos, não uma tela a menos.
                let Ok(kind) = Kind::parse(&kind) else {
                    tracing::warn!(kind, "node com kind desconhecido, ignorado na contagem");
                    continue;
                };
                out.push((area_id, kind, count));
            }
            Ok(out)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::application::ports::{HabitRepository, NewHabitDetails, NewNode, NodeRepository};
    use crate::domain::ledger::{EventType, NewLedgerEvent};
    use crate::domain::schedule::Schedule;
    use crate::infrastructure::paths::Paths;
    use crate::infrastructure::repositories::{
        habit_repo::SqliteHabitRepository, node_repo::SqliteNodeRepository,
    };

    fn event(id: &str, kind: Kind) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 0,
            day: "2026-07-17".into(),
            entity_id: id.into(),
            entity_kind: kind.into(),
            event_type: EventType::Created,
            payload: serde_json::json!({}),
            title_snapshot: "t".into(),
        }
    }

    /// Monta um banco com uma Esfera, um hábito nela e ticks em dias distintos.
    ///
    /// Arquivo temporário e não `open_in_memory`: este repositório só faz
    /// leitura, e no modo in-memory o pool de leitura aponta para uma segunda
    /// conexão `:memory:` VAZIA — todo teste aqui veria zero linhas e passaria
    /// por engano. O `TempDir` volta junto porque apagar o diretório ao sair de
    /// `fixture` levaria o banco embora no meio do teste.
    fn fixture() -> (tempfile::TempDir, Arc<Db>, SqliteSphereRepository) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        let nodes = SqliteNodeRepository::new(db.clone());
        let habits = SqliteHabitRepository::new(db.clone());

        db.with_write(|c| {
            c.execute(
                "INSERT INTO areas (id, name, template) VALUES ('a1', 'Saúde', 'health')",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        nodes
            .create_with_event(
                "h1",
                &NewNode {
                    kind: Kind::Habit,
                    title: "Treino".into(),
                    area_id: Some("a1".into()),
                    parent_id: None,
                },
                &event("h1", Kind::Habit),
            )
            .unwrap();

        habits
            .create_details(
                "h1",
                &NewHabitDetails {
                    schedule: Schedule::Daily,
                    target_value: None,
                    unit: None,
                    routine_id: None,
                    reminder_time: None,
                },
            )
            .unwrap();

        for (day, status) in [
            ("2026-07-14", TickStatus::Done),
            ("2026-07-15", TickStatus::Skipped),
            ("2026-07-16", TickStatus::Done),
        ] {
            habits
                .tick_with_event(
                    "h1",
                    day,
                    Tick {
                        status,
                        value: None,
                    },
                    0,
                    &event("h1", Kind::Habit),
                )
                .unwrap();
        }

        let repo = SqliteSphereRepository::new(db.clone());
        (dir, db, repo)
    }

    #[test]
    fn ticks_since_returns_every_status_not_just_done() {
        // O streak precisa distinguir 'skipped' (neutro) de uma falta. Um
        // filtro por 'done' aqui faria toda folga assumida virar quebra.
        let (_dir, _db, repo) = fixture();
        let ticks = repo.ticks_since("2026-07-01").unwrap();

        assert_eq!(ticks.len(), 3);
        assert!(ticks
            .iter()
            .any(|(_, d, t)| d == "2026-07-15" && t.status == TickStatus::Skipped));
    }

    #[test]
    fn ticks_since_respects_the_window() {
        let (_dir, _db, repo) = fixture();
        let ticks = repo.ticks_since("2026-07-16").unwrap();

        assert_eq!(ticks.len(), 1, "só o tick de 16/07 entra na janela");
        assert_eq!(ticks[0].1, "2026-07-16");
    }

    #[test]
    fn active_counts_group_by_area_and_kind() {
        let (_dir, _db, repo) = fixture();
        let counts = repo.active_node_counts_by_area().unwrap();

        let habits = counts
            .iter()
            .find(|(area, kind, _)| area.as_deref() == Some("a1") && *kind == Kind::Habit);
        assert_eq!(habits.map(|(_, _, n)| *n), Some(1));
    }

    #[test]
    fn orphan_nodes_count_under_a_null_area() {
        // O Inbox não tem Esfera — é exatamente por isso que ele existe.
        let (_dir, db, repo) = fixture();
        let nodes = SqliteNodeRepository::new(db.clone());
        nodes
            .create_with_event(
                "i1",
                &NewNode {
                    kind: Kind::InboxItem,
                    title: "pensamento solto".into(),
                    area_id: None,
                    parent_id: None,
                },
                &event("i1", Kind::InboxItem),
            )
            .unwrap();

        let counts = repo.active_node_counts_by_area().unwrap();
        let orphans = counts
            .iter()
            .find(|(area, kind, _)| area.is_none() && *kind == Kind::InboxItem);
        assert_eq!(orphans.map(|(_, _, n)| *n), Some(1));
    }
}
