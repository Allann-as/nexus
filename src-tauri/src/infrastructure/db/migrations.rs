//! Migration runner.
//!
//! Each migration is plain SQL, numbered, embedded with `include_str!`, and
//! immutable once committed — an engineer in 2056 can read the whole schema
//! history without running this program. Changing an applied migration is a
//! bug: write the next one instead.

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

use crate::domain::errors::Result;

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../../migrations/0001_core_schema.sql")),
        M::up(include_str!("../../../migrations/0002_fts.sql")),
        M::up(include_str!("../../../migrations/0003_ledger.sql")),
        M::up(include_str!("../../../migrations/0004_task_order.sql")),
        M::up(include_str!("../../../migrations/0005_spheres.sql")),
        M::up(include_str!("../../../migrations/0006_career_magenta.sql")),
    ])
}

/// Brings the schema to the latest version. Each migration runs in its own
/// transaction, so a failure leaves the database at the last good version
/// rather than half-migrated.
pub fn run(conn: &mut Connection) -> Result<()> {
    let from = user_version(conn)?;
    migrations().to_latest(conn)?;
    let to = user_version(conn)?;

    if from != to {
        tracing::info!(from, to, "schema migrated");
    }
    Ok(())
}

fn user_version(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_valid() {
        // Catches malformed SQL and out-of-order definitions at test time
        // rather than on a user's machine at startup.
        migrations().validate().unwrap();
    }

    #[test]
    fn applies_from_empty_to_latest() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();
        assert!(user_version(&conn).unwrap() > 0);

        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name IN ('nodes','areas','links','tags')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 4, "core tables must exist after migrating");
    }

    #[test]
    fn the_five_system_spheres_are_seeded() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();

        let spheres: i64 = conn
            .query_row("SELECT COUNT(*) FROM areas WHERE is_system = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(spheres, 5, "as 5 Esferas padrão nascem com o schema");

        // O template é o que a UI lê para decidir a tela; um seed com template
        // errado daria uma Esfera Saúde mostrando a tela de agenda simples.
        let health: String = conn
            .query_row(
                "SELECT template FROM areas WHERE id = 'sphere-health'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(health, "health");
    }

    #[test]
    fn the_template_check_constraint_is_live() {
        // O CHECK veio por ALTER TABLE ADD COLUMN. Este teste prova que ele
        // realmente pegou — se o SQLite o tivesse ignorado, o INSERT passaria.
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();

        let bad = conn.execute(
            "INSERT INTO areas (id, name, template) VALUES ('x', 'Bad', 'nao_existe')",
            [],
        );
        assert!(
            bad.is_err(),
            "um template fora do vocabulário deve ser recusado"
        );
    }

    #[test]
    fn career_is_magenta_not_violet() {
        // O violeta da 0005 ficava a ΔE 2,5 do azul das Finanças sob
        // protanopia. Ver ADR-0019.
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();

        let color: String = conn
            .query_row(
                "SELECT color FROM areas WHERE id = 'sphere-career'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(color, "#EC4899");
    }

    #[test]
    fn the_recolour_does_not_stomp_a_users_own_choice() {
        // A 0006 só troca a linha que ainda está exatamente como a 0005 a
        // deixou. Um usuário que já escolheu a cor da própria Esfera Carreira
        // não pode vê-la mudar sozinha durante uma migration.
        //
        // O teste simula a ordem real: 0005 aplicada, usuário escolhe, 0006
        // chega depois. É por isso que ele migra em dois passos em vez de rodar
        // `to_latest` de uma vez.
        let mut conn = Connection::open_in_memory().unwrap();
        migrations().to_version(&mut conn, 5).unwrap();

        conn.execute(
            "UPDATE areas SET color = '#123456' WHERE id = 'sphere-career'",
            [],
        )
        .unwrap();

        migrations().to_latest(&mut conn).unwrap();

        let color: String = conn
            .query_row(
                "SELECT color FROM areas WHERE id = 'sphere-career'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            color, "#123456",
            "a escolha do usuário sobrevive à migration"
        );
    }

    #[test]
    fn the_users_banks_are_seeded() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();

        let (banking, investment): (i64, i64) = conn
            .query_row(
                "SELECT
                    (SELECT COUNT(*) FROM accounts WHERE kind = 'banking'),
                    (SELECT COUNT(*) FROM accounts WHERE kind = 'investment')",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(banking, 5, "Santander, Bradesco, Nubank, Itaú, BTG Banking");
        assert_eq!(investment, 1, "BTG Investimentos");
    }

    #[test]
    fn running_twice_is_a_no_op() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();
        let first = user_version(&conn).unwrap();
        run(&mut conn).unwrap();
        assert_eq!(first, user_version(&conn).unwrap());
    }
}
