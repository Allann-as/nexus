//! Eventos em SQLite.
//!
//! O calendário lê `event_occurrences` e mais nada: as ocorrências já estão
//! materializadas, inclusive a única do evento avulso. Ver a §3 da 0007.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension, Row};

use crate::application::ports::{
    Event, EventPatch, EventRepository, NewEventDetails, NewNode, NewOccurrence, Occurrence,
    OccurrenceMove,
};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::NewLedgerEvent;
use crate::domain::recurrence::Recurrence;
use crate::infrastructure::db::Db;
use crate::infrastructure::repositories::ledger_repo::append_in_tx;
use crate::infrastructure::repositories::node_repo::insert_in_tx;

pub struct SqliteEventRepository {
    db: Arc<Db>,
}

impl SqliteEventRepository {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

const SELECT_EVENT: &str = "
    SELECT n.id, n.title, n.area_id, n.status,
           e.starts_at, e.ends_at, e.all_day, e.rrule, e.recurrence_end,
           e.location, e.category
      FROM nodes n
      JOIN event_details e ON e.node_id = n.id";

/// A ocorrência já traz o que herda do node e do satélite: o calendário desenha
/// sem uma segunda ida ao banco por item.
const SELECT_OCCURRENCE: &str = "
    SELECT o.event_id, n.title, n.area_id, o.starts_at, o.ends_at, o.day, o.status,
           e.all_day, e.location, e.category, e.rrule IS NOT NULL
      FROM event_occurrences o
      JOIN event_details e ON e.node_id = o.event_id
      JOIN nodes n         ON n.id      = o.event_id";

fn map_event(row: &Row) -> rusqlite::Result<Event> {
    let rrule: Option<String> = row.get(7)?;
    // Uma rrule ilegível só existiria por edição manual do arquivo. Falhar alto
    // aqui é melhor que devolver um evento que a UI acha que não se repete e
    // cujas ocorrências existem mesmo assim.
    let rrule = rrule
        .map(|s| Recurrence::parse_json(&s))
        .transpose()
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(e))
        })?;

    Ok(Event {
        id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        status: row.get(3)?,
        starts_at: row.get(4)?,
        ends_at: row.get(5)?,
        all_day: row.get::<_, i64>(6)? != 0,
        rrule,
        recurrence_end: row.get(8)?,
        location: row.get(9)?,
        category: row.get(10)?,
    })
}

fn map_occurrence(row: &Row) -> rusqlite::Result<Occurrence> {
    Ok(Occurrence {
        event_id: row.get(0)?,
        title: row.get(1)?,
        area_id: row.get(2)?,
        starts_at: row.get(3)?,
        ends_at: row.get(4)?,
        day: row.get(5)?,
        status: row.get(6)?,
        all_day: row.get::<_, i64>(7)? != 0,
        location: row.get(8)?,
        category: row.get(9)?,
        is_recurring: row.get::<_, i64>(10)? != 0,
    })
}

fn insert_details(
    conn: &rusqlite::Connection,
    node_id: &str,
    d: &NewEventDetails,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO event_details
           (node_id, starts_at, ends_at, all_day, rrule, recurrence_end, location, category)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            node_id,
            d.starts_at,
            d.ends_at,
            i64::from(d.all_day),
            d.rrule.as_ref().map(|r| r.to_json()),
            d.recurrence_end,
            d.location,
            d.category,
        ],
    )?;
    Ok(())
}

impl EventRepository for SqliteEventRepository {
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        details: &NewEventDetails,
        occurrences: &[NewOccurrence],
        event: &NewLedgerEvent,
    ) -> Result<Event> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            insert_in_tx(&tx, id, node, event.ts)?;
            insert_details(&tx, id, details)?;

            // As ocorrências entram na MESMA transação que a regra que as
            // gerou. Um evento com node e sem ocorrência é um compromisso
            // invisível: o usuário só descobre no dia em que ele não toca.
            {
                let mut stmt = tx.prepare(
                    "INSERT INTO event_occurrences (event_id, starts_at, ends_at, day)
                     VALUES (?1, ?2, ?3, ?4)",
                )?;
                for o in occurrences {
                    stmt.execute(params![id, o.starts_at, o.ends_at, o.day])?;
                }
            }

            append_in_tx(&tx, event)?;

            let created = tx.query_row(
                &format!("{SELECT_EVENT} WHERE n.id = ?1"),
                params![id],
                map_event,
            )?;
            tx.commit()?;
            Ok(created)
        })
    }

    fn get(&self, id: &str) -> Result<Event> {
        self.db.with_read(|c| {
            c.query_row(
                &format!("{SELECT_EVENT} WHERE n.id = ?1"),
                params![id],
                map_event,
            )
            .optional()?
            .ok_or_else(|| NexusError::NotFound(format!("evento {id}")))
        })
    }

    fn range(&self, from_day: &str, to_day: &str) -> Result<Vec<Occurrence>> {
        self.db.with_read(|c| {
            // Uma cancelada é justamente a que o usuário disse que NÃO acontece;
            // desenhá-la seria devolver o compromisso que ele tirou da agenda.
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT_OCCURRENCE}
                  WHERE o.day BETWEEN ?1 AND ?2
                    AND o.status <> 'cancelled'
                  ORDER BY o.starts_at, o.event_id"
            ))?;
            let rows = stmt.query_map(params![from_day, to_day], map_occurrence)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn overlapping_window(&self, from_ms: i64, to_ms: i64) -> Result<Vec<Occurrence>> {
        self.db.with_read(|c| {
            // Meio-aberto, igual a `domain::recurrence::overlaps`: quem termina
            // exatamente em `from_ms` não toca a janela. As duas regras têm que
            // concordar, senão o SQL entrega um par que o domínio recusa.
            let mut stmt = c.prepare_cached(&format!(
                "{SELECT_OCCURRENCE}
                  WHERE o.starts_at < ?2 AND o.ends_at > ?1
                    AND o.status <> 'cancelled'
                  ORDER BY o.starts_at, o.event_id"
            ))?;
            let rows = stmt.query_map(params![from_ms, to_ms], map_occurrence)?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }

    fn update(&self, id: &str, patch: &EventPatch, updated_at: i64) -> Result<Event> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // Flag+valor e não COALESCE: "não mexer" e "limpar o local" chegam
            // os dois como NULL e são pedidos diferentes.
            let changed = tx.execute(
                "UPDATE event_details SET
                    location = CASE WHEN ?2 THEN ?3 ELSE location END,
                    category = CASE WHEN ?4 THEN ?5 ELSE category END
                 WHERE node_id = ?1",
                params![
                    id,
                    patch.location.is_some(),
                    patch.location.clone().flatten(),
                    patch.category.is_some(),
                    patch.category.clone().flatten(),
                ],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!("evento {id}")));
            }
            tx.execute(
                "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
                params![id, updated_at],
            )?;

            let updated = tx.query_row(
                &format!("{SELECT_EVENT} WHERE n.id = ?1"),
                params![id],
                map_event,
            )?;
            tx.commit()?;
            Ok(updated)
        })
    }

    fn move_occurrence_with_event(
        &self,
        m: &OccurrenceMove<'_>,
        event: &NewLedgerEvent,
    ) -> Result<Occurrence> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            // O destino já ocupado pela mesma série violaria a PK
            // (event_id, starts_at). Detectado aqui, vira uma frase; deixado
            // para o SQLite, viraria "UNIQUE constraint failed" na cara do
            // usuário.
            if m.to_start != m.from_start {
                let taken: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM event_occurrences
                      WHERE event_id = ?1 AND starts_at = ?2",
                    params![m.event_id, m.to_start],
                    |r| r.get(0),
                )?;
                if taken > 0 {
                    return Err(NexusError::Validation(
                        "já existe uma ocorrência deste evento no horário de destino".into(),
                    ));
                }
            }

            let changed = tx.execute(
                "UPDATE event_occurrences
                    SET starts_at = ?3, ends_at = ?4, day = ?5,
                        status = CASE WHEN ?6 THEN 'moved' ELSE status END
                  WHERE event_id = ?1 AND starts_at = ?2",
                params![
                    m.event_id,
                    m.from_start,
                    m.to_start,
                    m.to_end,
                    m.to_day,
                    m.detach,
                ],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!(
                    "ocorrência de {} em {}",
                    m.event_id, m.from_start
                )));
            }

            // Um evento avulso não tem série de que se soltar: a ocorrência e a
            // regra são o MESMO fato, e deixar `event_details` para trás faria a
            // tela de detalhe contradizer o calendário para sempre.
            if !m.detach {
                tx.execute(
                    "UPDATE event_details SET starts_at = ?2, ends_at = ?3 WHERE node_id = ?1",
                    params![m.event_id, m.to_start, m.to_end],
                )?;
                tx.execute(
                    "UPDATE nodes SET updated_at = ?2 WHERE id = ?1",
                    params![m.event_id, event.ts],
                )?;
            }

            append_in_tx(&tx, event)?;

            let moved = tx.query_row(
                &format!("{SELECT_OCCURRENCE} WHERE o.event_id = ?1 AND o.starts_at = ?2"),
                params![m.event_id, m.to_start],
                map_occurrence,
            )?;
            tx.commit()?;
            Ok(moved)
        })
    }

    fn cancel_occurrence_with_event(
        &self,
        event_id: &str,
        starts_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<()> {
        self.db.with_write(|conn| {
            let tx = conn.transaction()?;

            let changed = tx.execute(
                "UPDATE event_occurrences SET status = 'cancelled'
                  WHERE event_id = ?1 AND starts_at = ?2",
                params![event_id, starts_at],
            )?;
            if changed == 0 {
                return Err(NexusError::NotFound(format!(
                    "ocorrência de {event_id} em {starts_at}"
                )));
            }

            append_in_tx(&tx, event)?;
            tx.commit()?;
            Ok(())
        })
    }
}

/// Só para os testes lerem o que a materialização gravou, incluindo as
/// canceladas — que `range` esconde de propósito.
#[cfg(test)]
impl SqliteEventRepository {
    fn all_occurrences(&self, event_id: &str) -> Result<Vec<(i64, String, String)>> {
        self.db.with_read(|c| {
            let mut stmt = c.prepare(
                "SELECT starts_at, day, status FROM event_occurrences
                  WHERE event_id = ?1 ORDER BY starts_at",
            )?;
            let rows =
                stmt.query_map(params![event_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::entities::Kind;
    use crate::domain::ledger::{EventType, NewLedgerEvent};
    use crate::infrastructure::paths::Paths;

    /// Arquivo temporário e não `open_in_memory`: neste modo o pool de leitura
    /// aponta para uma segunda conexão `:memory:` VAZIA, e todo teste que lê
    /// pelo `range` veria zero linhas e passaria por engano.
    fn fixture() -> (tempfile::TempDir, SqliteEventRepository) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Arc::new(Db::open(&paths).unwrap());
        let repo = SqliteEventRepository::new(db);
        (dir, repo)
    }

    fn ledger_event(id: &str) -> NewLedgerEvent {
        NewLedgerEvent {
            ts: 1_000,
            day: "2026-07-17".into(),
            entity_id: id.into(),
            entity_kind: Kind::Event,
            event_type: EventType::Created,
            payload: serde_json::json!({}),
            title_snapshot: "Reunião".into(),
        }
    }

    fn node(title: &str) -> NewNode {
        NewNode {
            kind: Kind::Event,
            title: title.into(),
            area_id: None,
            parent_id: None,
        }
    }

    fn details(starts_at: i64, ends_at: i64, rrule: Option<Recurrence>) -> NewEventDetails {
        NewEventDetails {
            starts_at,
            ends_at,
            all_day: false,
            rrule,
            recurrence_end: None,
            location: None,
            category: None,
        }
    }

    fn occ(starts_at: i64, ends_at: i64, day: &str) -> NewOccurrence {
        NewOccurrence {
            starts_at,
            ends_at,
            day: day.into(),
        }
    }

    #[test]
    fn a_failed_occurrence_insert_takes_the_whole_event_with_it() {
        // A regra de ouro da 0007: ou o evento inteiro existe, ou nada existe.
        // Duas ocorrências no mesmo instante violam a PK — e a transação tem que
        // levar node, satélite e ledger junto, em vez de deixar um evento
        // pela metade que o calendário desenharia errado para sempre.
        let (_dir, repo) = fixture();
        let boom = repo.create_with_event(
            "e1",
            &node("Reunião"),
            &details(1_000, 2_000, None),
            &[
                occ(1_000, 2_000, "2026-07-17"),
                occ(1_000, 2_000, "2026-07-17"),
            ],
            &ledger_event("e1"),
        );
        assert!(boom.is_err(), "a PK (event_id, starts_at) tem que morder");

        assert!(repo.get("e1").is_err(), "o node não pode ter sobrado");
        assert!(
            repo.range("2000-01-01", "2100-01-01").unwrap().is_empty(),
            "nem a ocorrência que chegou a entrar"
        );
    }

    #[test]
    fn a_single_event_still_gets_exactly_one_occurrence() {
        // O ponto inteiro da materialização: o calendário lê UMA tabela, nunca
        // uma união de "avulsos" com "séries".
        let (_dir, repo) = fixture();
        repo.create_with_event(
            "e1",
            &node("Dentista"),
            &details(1_000, 2_000, None),
            &[occ(1_000, 2_000, "2026-07-17")],
            &ledger_event("e1"),
        )
        .unwrap();

        let found = repo.range("2026-07-17", "2026-07-17").unwrap();
        assert_eq!(found.len(), 1);
        assert!(!found[0].is_recurring, "avulso não é série");
    }

    #[test]
    fn a_cancelled_occurrence_disappears_from_the_calendar_but_not_from_the_table() {
        // "Toda terça, MENOS a de 25/11": a linha fica (senão a próxima
        // materialização a traria de volta), mas o calendário não a desenha.
        let (_dir, repo) = fixture();
        repo.create_with_event(
            "e1",
            &node("Terapia"),
            &details(1_000, 2_000, Some(Recurrence::Daily { interval: 1 })),
            &[
                occ(1_000, 2_000, "2026-07-17"),
                occ(90_000_000, 91_000_000, "2026-07-18"),
            ],
            &ledger_event("e1"),
        )
        .unwrap();

        repo.cancel_occurrence_with_event("e1", 1_000, &ledger_event("e1"))
            .unwrap();

        let drawn = repo.range("2026-07-01", "2026-07-31").unwrap();
        assert_eq!(drawn.len(), 1, "a cancelada sai do calendário");
        assert_eq!(drawn[0].day, "2026-07-18");

        let stored = repo.all_occurrences("e1").unwrap();
        assert_eq!(stored.len(), 2, "a linha continua lá");
        assert_eq!(stored[0].2, "cancelled");
    }

    #[test]
    fn moving_one_occurrence_of_a_series_does_not_rewrite_the_series() {
        let (_dir, repo) = fixture();
        repo.create_with_event(
            "e1",
            &node("Treino"),
            &details(1_000, 2_000, Some(Recurrence::Daily { interval: 1 })),
            &[
                occ(1_000, 2_000, "2026-07-17"),
                occ(90_000_000, 91_000_000, "2026-07-18"),
            ],
            &ledger_event("e1"),
        )
        .unwrap();

        let moved = repo
            .move_occurrence_with_event(
                &OccurrenceMove {
                    event_id: "e1",
                    from_start: 1_000,
                    to_start: 5_000,
                    to_end: 6_000,
                    to_day: "2026-07-19",
                    detach: true,
                },
                &ledger_event("e1"),
            )
            .unwrap();

        assert_eq!(moved.status, "moved", "a ocorrência se soltou da regra");

        let event = repo.get("e1").unwrap();
        assert_eq!(event.starts_at, 1_000, "a REGRA não se mexeu");

        let stored = repo.all_occurrences("e1").unwrap();
        assert_eq!(stored.len(), 2, "arrastar uma não pode criar nem sumir");
        assert_eq!(stored[1].0, 90_000_000, "a irmã ficou onde estava");
    }

    #[test]
    fn moving_a_single_event_moves_the_rule_too() {
        // Um avulso não tem série de que se soltar: a ocorrência e a regra são o
        // mesmo fato. Deixar `event_details` para trás faria a tela de detalhe
        // contradizer o calendário.
        let (_dir, repo) = fixture();
        repo.create_with_event(
            "e1",
            &node("Almoço"),
            &details(1_000, 2_000, None),
            &[occ(1_000, 2_000, "2026-07-17")],
            &ledger_event("e1"),
        )
        .unwrap();

        let moved = repo
            .move_occurrence_with_event(
                &OccurrenceMove {
                    event_id: "e1",
                    from_start: 1_000,
                    to_start: 5_000,
                    to_end: 6_000,
                    to_day: "2026-07-18",
                    detach: false,
                },
                &ledger_event("e1"),
            )
            .unwrap();

        assert_eq!(moved.status, "scheduled", "não há série de que se soltar");

        let event = repo.get("e1").unwrap();
        assert_eq!((event.starts_at, event.ends_at), (5_000, 6_000));
    }

    #[test]
    fn moving_onto_a_sibling_is_refused_with_a_sentence() {
        // Sem esta checagem o usuário levaria um "UNIQUE constraint failed" na
        // cara ao arrastar uma terça para cima de outra.
        let (_dir, repo) = fixture();
        repo.create_with_event(
            "e1",
            &node("Treino"),
            &details(1_000, 2_000, Some(Recurrence::Daily { interval: 1 })),
            &[
                occ(1_000, 2_000, "2026-07-17"),
                occ(5_000, 6_000, "2026-07-18"),
            ],
            &ledger_event("e1"),
        )
        .unwrap();

        let err = repo
            .move_occurrence_with_event(
                &OccurrenceMove {
                    event_id: "e1",
                    from_start: 1_000,
                    to_start: 5_000,
                    to_end: 6_000,
                    to_day: "2026-07-18",
                    detach: true,
                },
                &ledger_event("e1"),
            )
            .unwrap_err();
        assert!(matches!(err, NexusError::Validation(_)), "{err:?}");
    }

    #[test]
    fn the_overlap_window_is_half_open_like_the_domain_says() {
        // `domain::recurrence::overlaps` diz que quem acaba às 10h e quem começa
        // às 10h não conflitam. Se o SQL discordasse, ele entregaria pares que o
        // domínio recusa — e a lista de conflitos ficaria dependendo de qual das
        // duas regras rodou primeiro.
        let (_dir, repo) = fixture();
        repo.create_with_event(
            "e1",
            &node("Antes"),
            &details(1_000, 2_000, None),
            &[occ(1_000, 2_000, "2026-07-17")],
            &ledger_event("e1"),
        )
        .unwrap();

        assert!(
            repo.overlapping_window(2_000, 3_000).unwrap().is_empty(),
            "encostado não é sobreposto"
        );
        assert_eq!(
            repo.overlapping_window(1_999, 3_000).unwrap().len(),
            1,
            "um milissegundo de sobreposição é sobreposição"
        );
    }

    #[test]
    fn deleting_the_node_takes_the_occurrences_with_it() {
        // O CASCADE encadeado: nodes -> event_details -> event_occurrences. É
        // por isso que `event_occurrences` não tem FK para `nodes`.
        let (_dir, repo) = fixture();
        repo.create_with_event(
            "e1",
            &node("Some"),
            &details(1_000, 2_000, None),
            &[occ(1_000, 2_000, "2026-07-17")],
            &ledger_event("e1"),
        )
        .unwrap();

        repo.db
            .with_write(|c| {
                c.execute("DELETE FROM nodes WHERE id = 'e1'", [])?;
                Ok(())
            })
            .unwrap();

        assert!(repo.all_occurrences("e1").unwrap().is_empty());
    }

    #[test]
    fn the_range_is_inclusive_on_both_days() {
        // Um mês vai do dia 1 ao dia 31; um BETWEEN exclusivo comeria o último
        // dia de todo mês do calendário, e ninguém repararia até virar o mês.
        let (_dir, repo) = fixture();
        for (i, day) in ["2026-07-01", "2026-07-15", "2026-07-31"]
            .iter()
            .enumerate()
        {
            let t = 1_000 + i as i64 * 1_000;
            repo.create_with_event(
                &format!("e{i}"),
                &node("X"),
                &details(t, t + 500, None),
                &[occ(t, t + 500, day)],
                &ledger_event(&format!("e{i}")),
            )
            .unwrap();
        }
        assert_eq!(repo.range("2026-07-01", "2026-07-31").unwrap().len(), 3);
        assert_eq!(repo.range("2026-07-02", "2026-07-30").unwrap().len(), 1);
    }

    #[test]
    fn the_ledger_and_the_occurrences_land_in_the_same_transaction() {
        let (_dir, repo) = fixture();
        repo.create_with_event(
            "e1",
            &node("Reunião"),
            &details(1_000, 2_000, None),
            &[occ(1_000, 2_000, "2026-07-17")],
            &ledger_event("e1"),
        )
        .unwrap();

        let logged: i64 = repo
            .db
            .with_read(|c| {
                Ok(c.query_row(
                    "SELECT COUNT(*) FROM ledger WHERE entity_id = 'e1'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(
            logged, 1,
            "criar um evento é UM acontecimento, e ele existe"
        );
    }
}
