//! Migration runner.
//!
//! Each migration is plain SQL, numbered, embedded with `include_str!`, and
//! immutable once committed — an engineer in 2056 can read the whole schema
//! history without running this program. Changing an applied migration is a
//! bug: write the next one instead.

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

use crate::domain::errors::{NexusError, Result};

fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../../../migrations/0001_core_schema.sql")),
        M::up(include_str!("../../../migrations/0002_fts.sql")),
        M::up(include_str!("../../../migrations/0003_ledger.sql")),
        M::up(include_str!("../../../migrations/0004_task_order.sql")),
        M::up(include_str!("../../../migrations/0005_spheres.sql")),
        M::up(include_str!("../../../migrations/0006_career_magenta.sql")),
        M::up(include_str!("../../../migrations/0007_time.sql")),
    ])
}

/// Brings the schema to the latest version. Each migration runs in its own
/// transaction, so a failure leaves the database at the last good version
/// rather than half-migrated.
///
/// # Por que as FKs ficam desligadas aqui
///
/// O SQLite não sabe alterar um `CHECK`. Trocar o vocabulário de `nodes.kind` —
/// que a §2 do DATA_MODEL promete ser rotina ("1 valor no CHECK + 1 satélite +
/// 1 migration") — exige o *12-step procedure* oficial: criar a tabela nova,
/// copiar, **dropar a antiga**, renomear.
///
/// Com as FKs ligadas, esse `DROP TABLE nodes` executa um `DELETE FROM`
/// implícito, e os `ON DELETE CASCADE` dos oito satélites **apagariam os dados
/// do usuário**. Por isso o procedimento oficial começa com `foreign_keys=OFF`.
///
/// E ele **tem** que ser desligado aqui, e não dentro do arquivo .sql: o pragma
/// é um no-op dentro de uma transação, e é dentro de uma transação que cada
/// migration roda.
///
/// Desligar não é afrouxar: `foreign_key_check` abaixo verifica o banco INTEIRO
/// depois, e uma violação aborta a abertura. A checagem é mais forte que a
/// incremental — ela olha todas as linhas, não só as que foram tocadas.
pub fn run(conn: &mut Connection) -> Result<()> {
    let from = user_version(conn)?;

    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    let migrated = migrations().to_latest(conn);
    // Religa antes de tratar o erro: um `?` acima sairia com o banco de FK
    // desligada, e a conexão é a mesma que o app vai usar o resto da vida.
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrated?;

    foreign_key_check(conn)?;

    let to = user_version(conn)?;
    if from != to {
        tracing::info!(from, to, "schema migrated");
    }
    Ok(())
}

/// Uma migration deixou FK órfã? Fala agora.
///
/// Silêncio aqui é o pior resultado possível: um banco que abre com referência
/// quebrada só conta a verdade meses depois, num JOIN que devolve nada.
fn foreign_key_check(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA foreign_key_check")?;
    let mut rows = stmt.query([])?;

    if let Some(row) = rows.next()? {
        let table: String = row.get(0)?;
        let parent: String = row.get(2)?;
        return Err(NexusError::Integrity(format!(
            "migration deixou uma referência órfã: {table} -> {parent}"
        )));
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

    /// A recriação de `nodes` (0007) é a operação mais perigosa deste schema:
    /// ela DROPA a tabela mais referenciada do banco, com o dado do usuário
    /// dentro. Cada teste aqui corresponde a uma das armadilhas documentadas no
    /// 0007 — e todas as três falham em SILÊNCIO se der errado, que é
    /// exatamente por que elas precisam de teste e não de revisão.
    mod recreating_nodes {
        use super::*;

        /// Um banco no estado do 0006, com dado nos satélites que o CASCADE
        /// apagaria se a FK estivesse ligada durante o DROP.
        fn seeded_at_v6() -> Connection {
            let mut conn = Connection::open_in_memory().unwrap();
            conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
            migrations().to_version(&mut conn, 6).unwrap();

            conn.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Saude');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('n1', 'note', 'Ideia sobre arquitetura', 'a1', 100, 100);
                 INSERT INTO note_details (node_id, body_md)
                      VALUES ('n1', 'o corpo da nota');
                 INSERT INTO tags (id, name) VALUES ('t1', 'importante');
                 INSERT INTO node_tags (node_id, tag_id) VALUES ('n1', 't1');
                 INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('n2', 'task', 'Uma tarefa', 100, 100);
                 INSERT INTO task_details (node_id, priority) VALUES ('n2', 1);",
            )
            .unwrap();
            conn
        }

        #[test]
        fn the_cascade_does_not_eat_the_satellites() {
            // Armadilha (a): `DROP TABLE nodes` com FK ligada roda um DELETE
            // implícito, e os ON DELETE CASCADE levariam anos de notas junto.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            let (nodes, notes, tasks, tags): (i64, i64, i64, i64) = conn
                .query_row(
                    "SELECT (SELECT COUNT(*) FROM nodes),
                            (SELECT COUNT(*) FROM note_details),
                            (SELECT COUNT(*) FROM task_details),
                            (SELECT COUNT(*) FROM node_tags)",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap();

            assert_eq!(nodes, 2, "os nodes sobrevivem a recriacao");
            assert_eq!(notes, 1, "note_details sobrevive ao DROP de nodes");
            assert_eq!(tasks, 1, "task_details sobrevive");
            assert_eq!(tags, 1, "node_tags sobrevive");
        }

        #[test]
        fn the_rowid_survives_so_search_still_points_at_the_right_row() {
            // Armadilha (b): `search_index` é FTS5 contentless e se liga ao
            // conteúdo SÓ pelo rowid (ver 0002). Uma cópia sem rowid explícito
            // renumeraria tudo e a busca passaria a devolver a linha errada —
            // sem erro, sem exceção, sem nada.
            let mut conn = seeded_at_v6();

            let before: i64 = conn
                .query_row("SELECT rowid FROM nodes WHERE id = 'n1'", [], |r| r.get(0))
                .unwrap();

            migrations().to_latest(&mut conn).unwrap();

            let after: i64 = conn
                .query_row("SELECT rowid FROM nodes WHERE id = 'n1'", [], |r| r.get(0))
                .unwrap();
            assert_eq!(before, after, "o rowid é o vínculo com a busca");

            // A prova que importa: a busca ainda acha, e acha a linha CERTA.
            let hit: String = conn
                .query_row(
                    "SELECT n.id
                       FROM search_index s
                       JOIN nodes n ON n.rowid = s.rowid
                      WHERE search_index MATCH 'arquitetura'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(hit, "n1");
        }

        #[test]
        fn the_fts_triggers_come_back() {
            // O DROP leva junto os gatilhos que MORAM em nodes. Esquecer de
            // recriá-los faria a busca parar de indexar tudo que nascesse
            // depois da migration — e nada acusaria.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('n3', 'note', 'peixe voador', 200, 200)",
                [],
            )
            .unwrap();
            let inserted: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM search_index WHERE search_index MATCH 'voador'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(inserted, 1, "o gatilho de INSERT voltou");

            conn.execute(
                "UPDATE nodes SET title = 'peixe nadador' WHERE id = 'n3'",
                [],
            )
            .unwrap();
            let renamed: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM search_index WHERE search_index MATCH 'nadador'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(renamed, 1, "o gatilho de UPDATE voltou");

            conn.execute("DELETE FROM nodes WHERE id = 'n3'", [])
                .unwrap();
            let deleted: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM search_index WHERE search_index MATCH 'nadador'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(deleted, 0, "o gatilho de DELETE voltou");
        }

        #[test]
        fn foreign_keys_still_bite_after_the_recreation() {
            // A tabela nova tem que trazer as FKs junto. Uma recriação que
            // esquece um REFERENCES deixa o banco aceitando órfão para sempre.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

            let orphan = conn.execute(
                "INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('x', 'note', 'orfa', 'nao-existe', 0, 0)",
                [],
            );
            assert!(orphan.is_err(), "area_id pendurada tem que ser recusada");
        }

        #[test]
        fn milestone_joins_the_vocabulary_and_the_check_still_rejects_junk() {
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('m1', 'milestone', '30 dias sem acucar', 0, 0)",
                [],
            )
            .expect("'milestone' entrou no vocabulário");

            let junk = conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('m2', 'pizza', 'nao', 0, 0)",
                [],
            );
            assert!(junk.is_err(), "o CHECK não pode ter sumido na recriação");
        }

        #[test]
        fn the_indexes_come_back() {
            // O DROP leva os índices junto. Sem eles o banco continua CORRETO e
            // fica lento — a pior categoria de regressão, porque passa em todo
            // teste de comportamento.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            let n: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                      WHERE type = 'index'
                        AND name IN ('idx_nodes_kind_status','idx_nodes_area','idx_nodes_parent')",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 3, "os três índices de nodes voltaram");
        }
    }
}
