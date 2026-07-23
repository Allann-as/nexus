//! Migration runner.
//!
//! Each migration is plain SQL, numbered, embedded with `include_str!`, and
//! immutable once committed — an engineer in 2056 can read the whole schema
//! history without running this program. Changing an applied migration is a
//! bug: write the next one instead.

use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

use crate::domain::errors::{NexusError, Result};

fn migration_set() -> Vec<M<'static>> {
    vec![
        M::up(include_str!("../../../migrations/0001_core_schema.sql")),
        M::up(include_str!("../../../migrations/0002_fts.sql")),
        M::up(include_str!("../../../migrations/0003_ledger.sql")),
        M::up(include_str!("../../../migrations/0004_task_order.sql")),
        M::up(include_str!("../../../migrations/0005_spheres.sql")),
        M::up(include_str!("../../../migrations/0006_career_magenta.sql")),
        M::up(include_str!("../../../migrations/0007_time.sql")),
        M::up(include_str!(
            "../../../migrations/0008_occurrence_rule_start.sql"
        )),
        M::up(include_str!(
            "../../../migrations/0009_milestone_counts_from.sql"
        )),
        M::up(include_str!("../../../migrations/0010_finances.sql")),
        M::up(include_str!(
            "../../../migrations/0011_studies_fin_goals.sql"
        )),
        M::up(include_str!("../../../migrations/0012_life.sql")),
        M::up(include_str!("../../../migrations/0013_career_studies.sql")),
        M::up(include_str!(
            "../../../migrations/0014_contributes_to_link.sql"
        )),
        M::up(include_str!("../../../migrations/0015_focus_sessions.sql")),
        M::up(include_str!("../../../migrations/0016_compass.sql")),
        M::up(include_str!("../../../migrations/0017_goal_engine.sql")),
        M::up(include_str!("../../../migrations/0018_habit_unlinks.sql")),
        M::up(include_str!(
            "../../../migrations/0019_delete_is_a_right.sql"
        )),
        M::up(include_str!("../../../migrations/0020_subject_items.sql")),
        M::up(include_str!(
            "../../../migrations/0021_finance_cyan_studies_blue.sql"
        )),
    ]
}

fn migrations() -> Migrations<'static> {
    Migrations::new(migration_set())
}

/// O `user_version` que um banco em dia carrega — o `rusqlite_migration` grava
/// nele a quantidade de migrations aplicadas.
fn latest_version() -> i64 {
    migration_set().len() as i64
}

/// Este banco vai ser ALTERADO por esta abertura?
///
/// `from > 0` é o filtro que importa: um banco novo em folha (versão 0) sobe do
/// zero e não tem nada a perder, então não vale um snapshot. Um banco com dados
/// do usuário que está atrás da versão corrente, sim — é exatamente o momento em
/// que anos de história passam por SQL destrutivo (o 12-step recria `nodes`).
pub fn is_upgrade_pending(conn: &Connection) -> Result<bool> {
    let from = user_version(conn)?;
    Ok(from > 0 && from < latest_version())
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

    #[test]
    fn contributes_to_joins_the_links_vocabulary_and_junk_is_rejected() {
        // A 0014 recria `links` para o 'contributes_to' (ADR-0046). O tipo novo
        // entra, e o CHECK continua recusando lixo.
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();
        conn.execute_batch(
            "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                  VALUES ('g1', 'goal', 'Meta de carreira', 0, 0),
                         ('ag1', 'annual_goal', 'Meta 2026', 0, 0);",
        )
        .unwrap();

        conn.execute(
            "INSERT INTO links (source_id, target_id, link_type, created_at)
                  VALUES ('g1', 'ag1', 'contributes_to', 0)",
            [],
        )
        .expect("'contributes_to' entrou no vocabulário de links");

        let junk = conn.execute(
            "INSERT INTO links (source_id, target_id, link_type, created_at)
                  VALUES ('g1', 'ag1', 'telepatia', 0)",
            [],
        );
        assert!(junk.is_err(), "um link_type fora do vocabulário é recusado");
    }

    #[test]
    fn the_old_links_survive_the_recreation() {
        // Um 'related' criado ANTES da 0014 tem que sobreviver à recriação da tabela.
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
        migrations().to_version(&mut conn, 13).unwrap();
        conn.execute_batch(
            "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                  VALUES ('n1', 'note', 'A', 0, 0), ('n2', 'note', 'B', 0, 0);
             INSERT INTO links (source_id, target_id, link_type, created_at)
                  VALUES ('n1', 'n2', 'related', 0);",
        )
        .unwrap();

        migrations().to_latest(&mut conn).unwrap();

        let survived: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM links WHERE source_id='n1' AND target_id='n2' AND link_type='related'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(survived, 1, "o link antigo sobrevive à recriação da tabela");
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
        fn fin_goal_and_book_join_the_vocabulary_in_one_recreation() {
            // O M4 recria `nodes` de novo (0011), agora para dois kinds de uma
            // vez. Ambos têm que entrar, e o CHECK tem que continuar recusando
            // lixo. Pagar a recriação uma vez para os dois é a decisão do
            // ADR-0029.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('g1', 'fin_goal', 'PS5', 0, 0)",
                [],
            )
            .expect("'fin_goal' entrou no vocabulário");
            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('b1', 'book', 'O Nome do Vento', 0, 0)",
                [],
            )
            .expect("'book' entrou no vocabulário");

            let junk = conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('z1', 'sanduiche', 'nao', 0, 0)",
                [],
            );
            assert!(junk.is_err(), "o CHECK não pode ter sumido na recriação");
        }

        #[test]
        fn the_new_satellites_cascade_from_their_node() {
            // fin_goal_details, fin_goal_deposits e book_details apagam junto com
            // o node dono — a mesma garantia dos satélites do 0001.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('g1', 'fin_goal', 'PS5', 0, 0);
                 INSERT INTO fin_goal_details (node_id, target_cents, account_id)
                      VALUES ('g1', 250000, 'acct-btg-invest');
                 INSERT INTO fin_goal_deposits (id, goal_id, amount_cents, happened_on, created_at)
                      VALUES ('d1', 'g1', 50000, '2026-07-01', 0);",
            )
            .unwrap();

            conn.execute("DELETE FROM nodes WHERE id = 'g1'", [])
                .unwrap();

            let (goals, deposits): (i64, i64) = conn
                .query_row(
                    "SELECT (SELECT COUNT(*) FROM fin_goal_details),
                            (SELECT COUNT(*) FROM fin_goal_deposits)",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(goals, 0, "o satélite da caixinha some com o node");
            assert_eq!(deposits, 0, "os depósitos somem com a caixinha (CASCADE)");
        }

        #[test]
        fn the_book_status_check_is_live() {
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('b1', 'book', 'Livro', 0, 0)",
                [],
            )
            .unwrap();
            let bad = conn.execute(
                "INSERT INTO book_details (node_id, status) VALUES ('b1', 'sumido')",
                [],
            );
            assert!(
                bad.is_err(),
                "um status fora do vocabulário deve ser recusado"
            );
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

        #[test]
        fn annual_goal_and_challenge_join_the_vocabulary_in_the_third_recreation() {
            // O M4.5 recria `nodes` PELA TERCEIRA VEZ (0012), agora para
            // 'annual_goal' e 'challenge' — a segunda recriação sobre dado já
            // existente. Ambos entram, e o CHECK continua recusando lixo. Ver
            // ADR-0036.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('ag1', 'annual_goal', 'Ler 12 livros em 2026', 0, 0)",
                [],
            )
            .expect("'annual_goal' entrou no vocabulário");
            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('ch1', 'challenge', '90 dias de treino', 0, 0)",
                [],
            )
            .expect("'challenge' entrou no vocabulário");

            let junk = conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('z2', 'lasanha', 'nao', 0, 0)",
                [],
            );
            assert!(junk.is_err(), "o CHECK não pode ter sumido na 3ª recriação");
        }

        #[test]
        fn the_life_satellites_cascade_from_their_node() {
            // annual_goal_details e challenge_details apagam junto com o node dono.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('ag1', 'annual_goal', 'Meta', 0, 0);
                 INSERT INTO annual_goal_details (node_id, year) VALUES ('ag1', 2026);
                 INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('ch1', 'challenge', 'Temporada', 0, 0);
                 INSERT INTO challenge_details
                        (node_id, starts_on, ends_on, metric, target_count)
                      VALUES ('ch1', '2026-01-01', '2026-03-31', 'manual', 90);",
            )
            .unwrap();

            conn.execute("DELETE FROM nodes WHERE id IN ('ag1','ch1')", [])
                .unwrap();

            let (ag, ch): (i64, i64) = conn
                .query_row(
                    "SELECT (SELECT COUNT(*) FROM annual_goal_details),
                            (SELECT COUNT(*) FROM challenge_details)",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(ag, 0, "o satélite da meta anual some com o node");
            assert_eq!(ch, 0, "o satélite da temporada some com o node");
        }

        #[test]
        fn skill_and_subject_join_the_vocabulary_in_the_fourth_recreation() {
            // O M4.6 recria `nodes` PELA QUARTA VEZ (0013), agora para 'skill'
            // (Carreira) e 'subject' (Estudos) — paga uma recriação para os dois
            // kinds, olhando o item 7 antes de escrever a migration do 6. Ambos
            // entram, e o CHECK continua recusando lixo. Ver ADR-0045.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('sk1', 'skill', 'System Design', 0, 0)",
                [],
            )
            .expect("'skill' entrou no vocabulário");
            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('su1', 'subject', 'Cálculo II', 0, 0)",
                [],
            )
            .expect("'subject' entrou no vocabulário");

            let junk = conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('z3', 'panqueca', 'nao', 0, 0)",
                [],
            );
            assert!(junk.is_err(), "o CHECK não pode ter sumido na 4ª recriação");
        }

        #[test]
        fn the_skill_level_floor_and_cap_are_live() {
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('sk1', 'skill', 'Inglês', 0, 0)",
                [],
            )
            .unwrap();

            // Nível abaixo de 1 é recusado.
            let below = conn.execute(
                "INSERT INTO skill_details (node_id, level) VALUES ('sk1', 0)",
                [],
            );
            assert!(below.is_err(), "nível < 1 é recusado pelo CHECK");

            // Nível acima do teto é recusado (a guarda coluna-a-coluna).
            let over = conn.execute(
                "INSERT INTO skill_details (node_id, level, max_level) VALUES ('sk1', 6, 5)",
                [],
            );
            assert!(over.is_err(), "level acima de max_level é recusado");

            conn.execute(
                "INSERT INTO skill_details (node_id, level, max_level) VALUES ('sk1', 2, 5)",
                [],
            )
            .expect("nível dentro do teto entra");
        }

        #[test]
        fn the_career_studies_satellites_cascade_and_sessions_survive_a_null() {
            // skill_details e subject_details apagam junto com o node dono; uma
            // sessão de estudo SOBREVIVE ao apagamento da matéria (ON DELETE SET
            // NULL) — a hora estudada aconteceu.
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('sk1', 'skill', 'Skill', 0, 0);
                 INSERT INTO skill_details (node_id, level) VALUES ('sk1', 3);
                 INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('su1', 'subject', 'Matéria', 0, 0);
                 INSERT INTO subject_details (node_id) VALUES ('su1');
                 INSERT INTO study_sessions (id, subject_id, minutes, day, ts)
                      VALUES ('ss1', 'su1', 40, '2026-07-01', 0);",
            )
            .unwrap();

            conn.execute("DELETE FROM nodes WHERE id = 'sk1'", [])
                .unwrap();
            conn.execute("DELETE FROM nodes WHERE id = 'su1'", [])
                .unwrap();

            let (sk, su, sess, orphan): (i64, i64, i64, i64) = conn
                .query_row(
                    "SELECT (SELECT COUNT(*) FROM skill_details),
                            (SELECT COUNT(*) FROM subject_details),
                            (SELECT COUNT(*) FROM study_sessions),
                            (SELECT COUNT(*) FROM study_sessions WHERE subject_id IS NULL)",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap();
            assert_eq!(sk, 0, "skill_details some com o node");
            assert_eq!(su, 0, "subject_details some com o node");
            assert_eq!(sess, 1, "a sessão de estudo sobrevive à matéria apagada");
            assert_eq!(
                orphan, 1,
                "o vínculo com a matéria virou NULL, não apagou a sessão"
            );
        }

        #[test]
        fn the_challenge_metric_check_is_live() {
            let mut conn = seeded_at_v6();
            migrations().to_latest(&mut conn).unwrap();

            conn.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('ch1', 'challenge', 'Temporada', 0, 0)",
                [],
            )
            .unwrap();
            let bad = conn.execute(
                "INSERT INTO challenge_details
                        (node_id, starts_on, ends_on, metric, target_count)
                      VALUES ('ch1', '2026-01-01', '2026-03-31', 'telepatia', 90)",
                [],
            );
            assert!(bad.is_err(), "uma métrica fora do vocabulário é recusada");
        }
    }

    /// A 0016 (BÚSSOLA) reconstrói `goal_details` para admitir metas SEM métrica.
    /// A reconstrução acontece sobre dados reais do usuário, então ela é provada
    /// como as recriações de `nodes`: os dados atravessam, as invariantes novas
    /// valem, e o que a referencia continua de pé.
    mod goal_kinds {
        use super::*;

        /// Um banco no estado da 0015, com uma meta quantitativa e o checkpoint
        /// dela — a linha que a FK de `goal_checkpoints` prende a `goal_details`.
        fn seeded_at_v15() -> Connection {
            let mut conn = Connection::open_in_memory().unwrap();
            conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
            migrations().to_version(&mut conn, 15).unwrap();

            conn.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Saude');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g1', 'goal', 'Perder 10 kg', 'a1', 100, 100);
                 INSERT INTO goal_details
                      (node_id, metric_name, start_value, target_value, unit, direction, deadline)
                      VALUES ('g1', 'Peso', 90.0, 80.0, 'kg', 'decrease', 999);
                 INSERT INTO goal_checkpoints (id, goal_id, value, noted_at)
                      VALUES ('c1', 'g1', 88.0, 200);",
            )
            .unwrap();
            conn
        }

        #[test]
        fn the_existing_goals_survive_and_are_quantitative() {
            let mut conn = seeded_at_v15();
            migrations().to_latest(&mut conn).unwrap();

            let (kind, metric, target, source): (String, String, f64, String) = conn
                .query_row(
                    "SELECT goal_kind, metric_name, target_value, progress_source
                       FROM goal_details WHERE node_id = 'g1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap();

            assert_eq!(kind, "quantitative", "toda meta anterior é quantitativa");
            assert_eq!(metric, "Peso", "a métrica atravessou a reconstrução");
            assert_eq!(target, 80.0);
            assert_eq!(source, "metric", "a fonte de progresso atravessou");
        }

        #[test]
        fn the_checkpoints_still_point_at_their_goal() {
            let mut conn = seeded_at_v15();
            migrations().to_latest(&mut conn).unwrap();

            // O dado continua lá...
            let value: f64 = conn
                .query_row(
                    "SELECT value FROM goal_checkpoints WHERE id = 'c1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(value, 88.0);

            // ...e a FK para a tabela RECONSTRUÍDA está íntegra. É o que o
            // `foreign_key_check` do runner cobraria no banco do usuário.
            let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
            let mut rows = stmt.query([]).unwrap();
            assert!(
                rows.next().unwrap().is_none(),
                "a reconstrução não deixou referência órfã"
            );
        }

        #[test]
        fn a_goal_without_a_metric_is_now_possible() {
            let mut conn = Connection::open_in_memory().unwrap();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Carreira');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g2', 'goal', 'Conseguir um emprego', 'a1', 100, 100);",
            )
            .unwrap();

            // A conquista binária: o que o formulário não conseguia criar antes.
            conn.execute(
                "INSERT INTO goal_details (node_id, goal_kind, progress_source)
                      VALUES ('g2', 'binary', 'milestones')",
                [],
            )
            .expect("uma conquista binária nasce sem métrica nenhuma");
        }

        #[test]
        fn a_quantitative_goal_still_needs_its_five_fields() {
            let mut conn = Connection::open_in_memory().unwrap();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Saude');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g3', 'goal', 'Meia meta', 'a1', 100, 100);",
            )
            .unwrap();

            // Nullable não virou opcional: o CHECK por tipo substitui o NOT NULL
            // que a coluna perdeu. Sem isso, a fase C teria afrouxado o banco.
            let bad = conn.execute(
                "INSERT INTO goal_details (node_id, goal_kind, metric_name)
                      VALUES ('g3', 'quantitative', 'Peso')",
                [],
            );
            assert!(bad.is_err(), "quantitativa sem alvo/unidade é recusada");
        }

        #[test]
        fn a_goal_without_a_metric_cannot_measure_by_metric() {
            let mut conn = Connection::open_in_memory().unwrap();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Estudos');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g4', 'goal', 'Ingles fluente', 'a1', 100, 100);",
            )
            .unwrap();

            let bad = conn.execute(
                "INSERT INTO goal_details (node_id, goal_kind, progress_source)
                      VALUES ('g4', 'staged', 'metric')",
                [],
            );
            assert!(
                bad.is_err(),
                "uma escada não mede por uma métrica que não tem"
            );
        }

        #[test]
        fn the_subject_track_and_the_skill_checkins_are_live() {
            let mut conn = Connection::open_in_memory().unwrap();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Estudos');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('s1', 'subject', 'Ingles', 'a1', 100, 100);
                 INSERT INTO subject_details (node_id, track) VALUES ('s1', 'idioma');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('k1', 'skill', 'Rust', 'a1', 100, 100);
                 INSERT INTO skill_details (node_id, level) VALUES ('k1', 1);",
            )
            .unwrap();

            // A trilha é fechada: a seção não pode receber um valor inventado.
            let bad = conn.execute(
                "UPDATE subject_details SET track = 'qualquer' WHERE node_id = 's1'",
                [],
            );
            assert!(bad.is_err(), "a trilha tem vocabulário fechado");

            // As matérias antigas (0013) nascem na trilha livre — nenhuma delas
            // aparece por engano numa das seções novas.
            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('s2', 'subject', 'Calculo', 'a1', 100, 100);
                 INSERT INTO subject_details (node_id) VALUES ('s2');",
            )
            .unwrap();
            let track: String = conn
                .query_row(
                    "SELECT track FROM subject_details WHERE node_id = 's2'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(track, "livre", "a matéria sem trilha fica fora das seções");

            // O check-in mensal: um retrato por mês, e reinformar CORRIGE.
            conn.execute_batch(
                "INSERT INTO skill_checkins (skill_id, month, studied, applied, stars, noted_at)
                      VALUES ('k1', '2026-07', 1, 3, 4, 500);
                 INSERT OR REPLACE INTO skill_checkins
                      (skill_id, month, studied, applied, stars, noted_at)
                      VALUES ('k1', '2026-07', 1, 9, 5, 600);",
            )
            .unwrap();
            let (n, applied): (i64, i64) = conn
                .query_row(
                    "SELECT COUNT(*), MAX(applied) FROM skill_checkins WHERE skill_id = 'k1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(n, 1, "o mês tem UM retrato, não uma pilha");
            assert_eq!(applied, 9, "reinformar corrigiu o retrato");

            // As estrelas são 1..5 — uma auto-avaliação fora da régua é recusada.
            let bad = conn.execute(
                "INSERT INTO skill_checkins (skill_id, month, studied, applied, stars, noted_at)
                      VALUES ('k1', '2026-08', 1, 0, 9, 700)",
                [],
            );
            assert!(bad.is_err(), "a auto-avaliação vive entre 1 e 5");
        }
    }

    /// A 0017 (COCKPIT) reconstrói `goal_details` pela SEGUNDA vez, para admitir
    /// o quarto tipo de meta — a CONSTÂNCIA. Como a 0016, a reconstrução
    /// acontece sobre dados reais do usuário, então é provada do mesmo jeito: os
    /// dados dos TRÊS tipos anteriores atravessam, as invariantes novas valem, e
    /// quem referencia a tabela continua de pé.
    ///
    /// O que esta suíte NÃO precisa provar, e o porquê: a 0017 não toca em
    /// `nodes` (o levantamento do ADR-0077 não achou `kind` novo), então CASCADE,
    /// rowid do FTS e rename de gatilho não se aplicam a nada aqui.
    mod goal_constancia {
        use super::*;

        /// Um banco no estado da 0016, com uma meta de CADA um dos três tipos que
        /// existiam, mais o checkpoint que a FK prende a `goal_details`.
        fn seeded_at_v16() -> Connection {
            let mut conn = Connection::open_in_memory().unwrap();
            conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
            migrations().to_version(&mut conn, 16).unwrap();

            conn.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Saude');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g1', 'goal', 'Perder 10 kg', 'a1', 100, 100);
                 INSERT INTO goal_details
                      (node_id, goal_kind, metric_name, start_value, target_value,
                       unit, direction, progress_source)
                      VALUES ('g1', 'quantitative', 'Peso', 90.0, 80.0, 'kg',
                              'decrease', 'metric');
                 INSERT INTO goal_checkpoints (id, goal_id, value, noted_at)
                      VALUES ('c1', 'g1', 88.0, 200);

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g2', 'goal', 'Ser promovido', 'a1', 100, 100);
                 INSERT INTO goal_details (node_id, goal_kind, progress_source)
                      VALUES ('g2', 'binary', 'milestones');

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g3', 'goal', 'Ingles fluente', 'a1', 100, 100);
                 INSERT INTO goal_details (node_id, goal_kind, progress_source)
                      VALUES ('g3', 'staged', 'milestones');",
            )
            .unwrap();
            conn
        }

        #[test]
        fn the_three_older_kinds_survive_the_second_rebuild() {
            let mut conn = seeded_at_v16();
            migrations().to_latest(&mut conn).unwrap();

            let mut stmt = conn
                .prepare("SELECT node_id, goal_kind FROM goal_details ORDER BY node_id")
                .unwrap();
            let rows: Vec<(String, String)> = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .map(|r| r.unwrap())
                .collect();

            assert_eq!(
                rows,
                vec![
                    ("g1".to_string(), "quantitative".to_string()),
                    ("g2".to_string(), "binary".to_string()),
                    ("g3".to_string(), "staged".to_string()),
                ],
                "os três tipos anteriores atravessaram a reconstrução intactos"
            );

            // A métrica da quantitativa não se perdeu no caminho.
            let (metric, target): (String, f64) = conn
                .query_row(
                    "SELECT metric_name, target_value FROM goal_details WHERE node_id = 'g1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(metric, "Peso");
            assert_eq!(target, 80.0);
        }

        #[test]
        fn the_checkpoints_still_point_at_their_goal_after_the_second_rebuild() {
            let mut conn = seeded_at_v16();
            migrations().to_latest(&mut conn).unwrap();

            let value: f64 = conn
                .query_row(
                    "SELECT value FROM goal_checkpoints WHERE id = 'c1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(value, 88.0);

            let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
            let mut rows = stmt.query([]).unwrap();
            assert!(
                rows.next().unwrap().is_none(),
                "a segunda reconstrução não deixou referência órfã"
            );
        }

        /// O banco de um usuário que já tinha metas: as colunas NOVAS chegam
        /// vazias, e é isso que a UI espera ler numa meta anterior à v1.3.
        fn latest_with_a_sphere_and_a_habit() -> Connection {
            let mut conn = Connection::open_in_memory().unwrap();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Financas');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('h1', 'habit', 'Guardar 10 reais', 'a1', 100, 100);
                 INSERT INTO habit_details (node_id, schedule_json)
                      VALUES ('h1', '{\"kind\":\"daily\"}');",
            )
            .unwrap();
            conn
        }

        #[test]
        fn a_constancia_goal_is_now_possible_and_carries_its_habit() {
            let conn = latest_with_a_sphere_and_a_habit();
            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g9', 'goal', 'Guardar R$ 10 por dia', 'a1', 100, 100);
                 INSERT INTO goal_details
                      (node_id, goal_kind, target_value, unit, direction,
                       progress_source, habit_id, daily_target)
                      VALUES ('g9', 'constancia', 3650.0, 'R$', 'increase',
                              'metric', 'h1', 10.0);",
            )
            .unwrap();

            let (habit, daily): (String, f64) = conn
                .query_row(
                    "SELECT habit_id, daily_target FROM goal_details WHERE node_id = 'g9'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(habit, "h1", "a constância sabe qual hábito a alimenta");
            assert_eq!(daily, 10.0, "o alvo POR DIA ficou guardado");
        }

        #[test]
        fn a_constancia_without_a_target_is_refused() {
            let conn = latest_with_a_sphere_and_a_habit();
            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g9', 'goal', 'Guardar sem alvo', 'a1', 100, 100);",
            )
            .unwrap();

            // Sem alvo/unidade/direção não há o que acumular NEM contra o que
            // projetar — seria uma barra que nunca chega a lugar nenhum.
            let bad = conn.execute(
                "INSERT INTO goal_details (node_id, goal_kind, progress_source)
                      VALUES ('g9', 'constancia', 'metric')",
                [],
            );
            assert!(bad.is_err(), "uma constância sem alvo não entra");
        }

        #[test]
        fn a_constancia_cannot_carry_a_metric_name_or_a_start_value() {
            let conn = latest_with_a_sphere_and_a_habit();
            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g9', 'goal', 'Constancia torta', 'a1', 100, 100);",
            )
            .unwrap();

            // Uma constância começa em ZERO por definição: ninguém já vinha
            // guardando R$ 10 por dia antes de criar a meta.
            let bad = conn.execute(
                "INSERT INTO goal_details
                      (node_id, goal_kind, start_value, target_value, unit,
                       direction, progress_source)
                      VALUES ('g9', 'constancia', 500.0, 3650.0, 'R$', 'increase', 'metric')",
                [],
            );
            assert!(bad.is_err(), "constância não tem valor inicial");
        }

        #[test]
        fn only_a_constancia_may_have_a_daily_target_or_a_habit() {
            let conn = latest_with_a_sphere_and_a_habit();
            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g9', 'goal', 'Conquista', 'a1', 100, 100);
                 INSERT INTO goal_details (node_id, goal_kind, progress_source)
                      VALUES ('g9', 'binary', 'milestones');",
            )
            .unwrap();

            // Um `daily_target` numa conquista é um número que nenhuma tela lê.
            let bad = conn.execute(
                "UPDATE goal_details SET daily_target = 10.0 WHERE node_id = 'g9'",
                [],
            );
            assert!(bad.is_err(), "só a constância tem alvo diário");

            let bad = conn.execute(
                "UPDATE goal_details SET habit_id = 'h1' WHERE node_id = 'g9'",
                [],
            );
            assert!(bad.is_err(), "só a constância liga um hábito");
        }

        #[test]
        fn a_daily_target_of_zero_is_refused() {
            let conn = latest_with_a_sphere_and_a_habit();
            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g9', 'goal', 'Guardar nada', 'a1', 100, 100);",
            )
            .unwrap();

            // Um alvo diário de zero é uma meta que nunca sai do lugar.
            let bad = conn.execute(
                "INSERT INTO goal_details
                      (node_id, goal_kind, target_value, unit, direction,
                       progress_source, daily_target)
                      VALUES ('g9', 'constancia', 3650.0, 'R$', 'increase', 'metric', 0)",
                [],
            );
            assert!(bad.is_err(), "o alvo diário é positivo ou não existe");
        }

        #[test]
        fn a_binary_goal_still_cannot_fake_a_metric() {
            let conn = latest_with_a_sphere_and_a_habit();
            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g9', 'goal', 'Conquista', 'a1', 100, 100);",
            )
            .unwrap();

            // A invariante da 0016 tem de sobreviver à reconstrução da 0017.
            let bad = conn.execute(
                "INSERT INTO goal_details
                      (node_id, goal_kind, target_value, progress_source)
                      VALUES ('g9', 'binary', 100.0, 'milestones')",
                [],
            );
            assert!(bad.is_err(), "conquista não finge ter número");
        }

        #[test]
        fn the_course_summary_and_the_delivery_notes_are_live() {
            let mut conn = Connection::open_in_memory().unwrap();
            migrations().to_latest(&mut conn).unwrap();
            conn.execute_batch(
                "INSERT INTO areas (id, name) VALUES ('a1', 'Estudos');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('s1', 'subject', 'Excel', 'a1', 100, 100);
                 INSERT INTO subject_details (node_id, track, course_stage, summary)
                      VALUES ('s1', 'curso', 'fazendo', 'Planilhas, formulas e tabela dinamica');

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('e1', 'event', 'Prova de Calculo', 'a1', 100, 100);
                 INSERT INTO event_details (node_id, starts_at, ends_at, category, notes)
                      VALUES ('e1', 1000, 2000, 'prova', 'Trazer calculadora');",
            )
            .unwrap();

            let summary: String = conn
                .query_row(
                    "SELECT summary FROM subject_details WHERE node_id = 's1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert!(summary.starts_with("Planilhas"), "o curso diz o que ensina");

            let notes: String = conn
                .query_row(
                    "SELECT notes FROM event_details WHERE node_id = 'e1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(notes, "Trazer calculadora");

            // A categoria do evento é TEXT LIVRE (o achado do ADR-0077): 'prova'
            // e 'entrega' entram sem migration. Se um dia virar CHECK, este teste
            // é o que avisa.
            conn.execute(
                "UPDATE event_details SET category = 'entrega' WHERE node_id = 'e1'",
                [],
            )
            .unwrap();
        }

        /// A migration é idempotente na prática: rodar de novo num banco já em dia
        /// não faz nada. É a garantia que o boot do app depende para não
        /// reconstruir `goal_details` a cada abertura.
        #[test]
        fn running_the_goal_engine_twice_is_a_no_op() {
            let mut conn = seeded_at_v16();
            migrations().to_latest(&mut conn).unwrap();
            migrations().to_latest(&mut conn).unwrap();

            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM goal_details", [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 3, "as metas não se multiplicaram nem sumiram");
        }
    }

    /// A 0018 conserta um defeito que existia desde a **0007**: um hábito ligado
    /// a um sub-desafio contado, a uma temporada ou a uma constância era
    /// **indelével** — o DELETE voltava `FOREIGN KEY constraint failed`, porque
    /// `REFERENCES nodes(id)` sem `ON DELETE` é NO ACTION, não "sem CASCADE".
    ///
    /// Cada teste daqui prova as DUAS metades: o pai SAI, e o filho FICA com o
    /// vínculo desfeito. Um teste que só apagasse o hábito passaria mesmo se a
    /// migration tivesse escrito CASCADE por engano — e CASCADE aqui apagaria a
    /// meta do usuário junto com o hábito.
    mod habit_unlinks {
        use super::*;

        /// Um banco no estado da 0017 — antes da correção — com um hábito
        /// segurado pelas TRÊS colunas ao mesmo tempo.
        ///
        /// Este seed liga as FKs (o teste `before_the_fix...` precisa delas para
        /// provar a recusa), e por isso os testes daqui sobem pelo `run()` e não
        /// pelo `migrations().to_latest()` cru — que é o que eles faziam até a
        /// 0019 os pegar. A diferença não é estilo: `run()` desliga as FKs
        /// durante a subida, e uma migration que dropa `nodes` com as FKs
        /// LIGADAS dispara os `ON DELETE CASCADE` dos oito satélites e apaga os
        /// dados do usuário (a razão de o pragma morar no runner, e não no .sql
        /// — ver o comentário de `run`). Enquanto nenhuma migration nova tocasse
        /// `nodes`, o atalho passava; a 0019 toca, e os três testes caíram com os
        /// satélites vazios. Um teste de migration que não passa pelo `run()` não
        /// está testando o upgrade que o usuário recebe.
        fn seeded_at_v17() -> Connection {
            let mut conn = Connection::open_in_memory().unwrap();
            migrations().to_version(&mut conn, 17).unwrap();
            conn.execute_batch(
                "PRAGMA foreign_keys = ON;
                 INSERT INTO areas (id, name) VALUES ('a1', 'Saude');

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('h1', 'habit', 'Academia', 'a1', 100, 100);
                 INSERT INTO habit_details (node_id, schedule_json)
                      VALUES ('h1', '{\"kind\":\"daily\"}');

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g1', 'goal', 'Perder 10 kg', 'a1', 100, 100);
                 INSERT INTO goal_details
                      (node_id, goal_kind, metric_name, start_value, target_value,
                       unit, direction, progress_source)
                      VALUES ('g1', 'quantitative', 'Peso', 90.0, 80.0, 'kg',
                              'decrease', 'metric');

                 INSERT INTO nodes (id, kind, title, area_id, parent_id, created_at, updated_at)
                      VALUES ('m1', 'milestone', '30 dias de academia', 'a1', 'g1', 100, 100);
                 INSERT INTO milestone_details
                      (node_id, kind, habit_id, target_count, counts_from)
                      VALUES ('m1', 'counter', 'h1', 30, '2026-07-01');

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('t1', 'challenge', 'Julho na academia', 'a1', 100, 100);
                 INSERT INTO challenge_details
                      (node_id, starts_on, ends_on, metric, habit_id, target_count)
                      VALUES ('t1', '2026-07-01', '2026-07-31', 'habit_days', 'h1', 20);

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g2', 'goal', '30 dias seguidos', 'a1', 100, 100);
                 INSERT INTO goal_details
                      (node_id, goal_kind, target_value, unit, direction,
                       progress_source, habit_id, daily_target)
                      VALUES ('g2', 'constancia', 30.0, 'dias', 'increase',
                              'metric', 'h1', NULL);",
            )
            .unwrap();
            conn
        }

        #[test]
        fn before_the_fix_the_habit_was_indelible() {
            // O defeito, provado em vez de descrito. Este teste é a razão de a
            // 0018 existir: sem ele, o próximo leitor teria que acreditar no
            // cabeçalho da migration.
            let conn = seeded_at_v17();
            let err = conn.execute("DELETE FROM nodes WHERE id = 'h1'", []);
            assert!(
                err.is_err(),
                "na 0017 o hábito era indelével — se isto passou, a 0018 perdeu o motivo"
            );
        }

        #[test]
        fn the_three_links_go_to_null_and_the_habit_finally_goes() {
            let mut conn = seeded_at_v17();
            run(&mut conn).unwrap();

            conn.execute("DELETE FROM nodes WHERE id = 'h1'", [])
                .unwrap();

            // Metade 1: o pai saiu.
            let habits: i64 = conn
                .query_row("SELECT COUNT(*) FROM nodes WHERE id = 'h1'", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert_eq!(habits, 0);

            // Metade 2: os três filhos FICARAM, sem o vínculo. Se a migration
            // tivesse escrito CASCADE, estas três contagens seriam zero — e o
            // usuário teria perdido uma meta, um sub-desafio e uma temporada por
            // ter apagado um hábito.
            for (table, id) in [
                ("milestone_details", "m1"),
                ("challenge_details", "t1"),
                ("goal_details", "g2"),
            ] {
                let habit: Option<String> = conn
                    .query_row(
                        &format!("SELECT habit_id FROM {table} WHERE node_id = ?1"),
                        [id],
                        |r| r.get(0),
                    )
                    .unwrap_or_else(|e| panic!("{table}/{id} sumiu junto com o hábito: {e}"));
                assert!(habit.is_none(), "{table}/{id} devia ter ido a NULL");
            }

            let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
            assert!(
                stmt.query([]).unwrap().next().unwrap().is_none(),
                "as três reconstruções não deixaram referência órfã"
            );
        }

        #[test]
        fn the_data_of_the_three_tables_survives_the_rebuild() {
            // Três tabelas recriadas de uma vez: o que elas guardavam tem que
            // atravessar inteiro, incluindo o `counts_from` que a 0009 acrescentou
            // e que um INSERT ... SELECT desatento deixaria para trás.
            let mut conn = seeded_at_v17();
            run(&mut conn).unwrap();

            let (kind, target, counts_from): (String, i64, String) = conn
                .query_row(
                    "SELECT kind, target_count, counts_from FROM milestone_details
                      WHERE node_id = 'm1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap();
            assert_eq!(
                (kind.as_str(), target, counts_from.as_str()),
                ("counter", 30, "2026-07-01")
            );

            let (metric, target): (String, i64) = conn
                .query_row(
                    "SELECT metric, target_count FROM challenge_details WHERE node_id = 't1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!((metric.as_str(), target), ("habit_days", 20));

            let (kind, unit): (String, String) = conn
                .query_row(
                    "SELECT goal_kind, unit FROM goal_details WHERE node_id = 'g2'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!((kind.as_str(), unit.as_str()), ("constancia", "dias"));
        }

        #[test]
        fn the_invariants_of_the_rebuilt_tables_are_still_live() {
            // A terceira reconstrução de `goal_details` reescreve os três CHECKs
            // à mão. Um deles esquecido passaria despercebido até o dia em que o
            // banco aceitasse uma meta incoerente.
            let mut conn = seeded_at_v17();
            run(&mut conn).unwrap();
            conn.execute_batch(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                      VALUES ('g9', 'goal', 'Incoerente', 0, 0);",
            )
            .unwrap();

            // Uma conquista não pode fingir métrica (o CHECK por tipo).
            assert!(conn
                .execute(
                    "INSERT INTO goal_details (node_id, goal_kind, target_value, progress_source)
                          VALUES ('g9', 'binary', 100.0, 'milestones')",
                    [],
                )
                .is_err());

            // Só a constância carrega hábito e alvo diário (o CHECK de exclusividade).
            assert!(conn
                .execute(
                    "INSERT INTO goal_details
                          (node_id, goal_kind, metric_name, start_value, target_value,
                           unit, direction, progress_source, daily_target)
                          VALUES ('g9', 'quantitative', 'Peso', 90.0, 80.0, 'kg',
                                  'decrease', 'metric', 10.0)",
                    [],
                )
                .is_err());

            // E o peso de um sub-desafio segue tendo que ser positivo (0007).
            assert!(conn
                .execute(
                    "INSERT INTO milestone_details (node_id, kind, weight)
                          VALUES ('g9', 'simple', 0)",
                    [],
                )
                .is_err());
        }

        #[test]
        fn running_the_unlink_twice_is_a_no_op() {
            let mut conn = seeded_at_v17();
            run(&mut conn).unwrap();
            run(&mut conn).unwrap();

            for (table, expected) in [
                ("milestone_details", 1i64),
                ("challenge_details", 1),
                ("goal_details", 2),
            ] {
                let n: i64 = conn
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                    .unwrap();
                assert_eq!(n, expected, "{table} se multiplicou ou sumiu");
            }
        }
    }

    /// A 0019 termina o serviço da 0018: ela não conserta mais três colunas, ela
    /// tira do schema a FORMA que produziu as três — `REFERENCES nodes(id)` sem
    /// cláusula `ON DELETE`, que o SQLite lê como "recuse apagar o pai".
    ///
    /// A varredura que achou as últimas três vive em `tests/deletion.rs`
    /// (`no_foreign_key_to_a_node_refuses_the_delete`), e é ela que impede a
    /// quarta de nascer. Aqui provamos a subida: o defeito antes, o conserto
    /// depois, e — porque `nodes` é recriada pela QUINTA vez — que nada se perde
    /// no caminho.
    mod delete_is_a_right {
        use super::*;

        /// Um banco no estado da 0018 com os três casos montados: um projeto com
        /// tarefa e sub-tarefa, uma rotina com hábito dentro, e um idioma cuja
        /// escada é uma meta.
        fn seeded_at_v18() -> Connection {
            let mut conn = Connection::open_in_memory().unwrap();
            migrations().to_version(&mut conn, 18).unwrap();
            conn.execute_batch(
                "PRAGMA foreign_keys = ON;
                 INSERT INTO areas (id, name) VALUES ('a1', 'Estudos');

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('p1', 'project', 'Reforma', 'a1', 100, 100);
                 INSERT INTO nodes (id, kind, title, area_id, parent_id, created_at, updated_at)
                      VALUES ('t1', 'task', 'Pintura', 'a1', 'p1', 100, 100);
                 INSERT INTO nodes (id, kind, title, area_id, parent_id, created_at, updated_at)
                      VALUES ('t2', 'task', 'Comprar tinta', 'a1', 't1', 100, 100);

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('r1', 'routine', 'Rotina da manha', 'a1', 100, 100);
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('h1', 'habit', 'Beber agua', 'a1', 100, 100);
                 INSERT INTO habit_details
                      (node_id, schedule_json, target_value, unit, routine_id,
                       routine_order, reminder_time)
                      VALUES ('h1', '{\"kind\":\"daily\"}', 2.0, 'L', 'r1', 3, '07:30');

                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('g1', 'goal', 'Ingles: Basico a Fluente', 'a1', 100, 100);
                 INSERT INTO goal_details (node_id, goal_kind, progress_source)
                      VALUES ('g1', 'staged', 'milestones');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('s1', 'subject', 'Ingles', 'a1', 100, 100);
                 INSERT INTO subject_details
                      (node_id, category, target_minutes, track, course_stage,
                       expected_end, level_goal_id, summary)
                      VALUES ('s1', 'Idiomas', 600, 'idioma', NULL,
                              '2026-12-31', 'g1', 'Conversacao e gramatica');",
            )
            .unwrap();
            conn
        }

        #[test]
        fn before_the_fix_the_three_parents_were_indelible() {
            // O defeito, provado em vez de descrito — e são TRÊS caminhos que o
            // usuário percorre com um clique de "excluir".
            let conn = seeded_at_v18();
            for (what, id) in [
                ("o projeto com tarefas", "p1"),
                ("a rotina com um habito", "r1"),
                ("a meta que e a escada de um idioma", "g1"),
            ] {
                assert!(
                    conn.execute("DELETE FROM nodes WHERE id = ?1", [id])
                        .is_err(),
                    "na 0018 {what} era indelevel — se isto passou, a 0019 perdeu o motivo"
                );
            }
        }

        #[test]
        fn after_the_fix_the_three_parents_go_and_the_children_stay() {
            let mut conn = seeded_at_v18();
            run(&mut conn).unwrap();

            for id in ["p1", "r1", "g1"] {
                conn.execute("DELETE FROM nodes WHERE id = ?1", [id])
                    .unwrap_or_else(|e| panic!("apagar {id} ainda falha: {e}"));
            }

            // As tarefas ficaram — soltas, porque quem as leva junto é o
            // `NodeService::delete` (que apenda um evento por filho), não a FK.
            // Ver o cabeçalho da 0019: das três formas de errar, SET NULL é a
            // única que o usuário enxerga e desfaz.
            let orphan: Option<String> = conn
                .query_row("SELECT parent_id FROM nodes WHERE id = 't1'", [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert!(orphan.is_none(), "o parent_id devia ter ido a NULL");

            let routine: Option<String> = conn
                .query_row(
                    "SELECT routine_id FROM habit_details WHERE node_id = 'h1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_else(|e| panic!("o habito foi junto com a rotina: {e}"));
            assert!(routine.is_none());

            let ladder: Option<String> = conn
                .query_row(
                    "SELECT level_goal_id FROM subject_details WHERE node_id = 's1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_else(|e| panic!("o idioma foi junto com a meta: {e}"));
            assert!(ladder.is_none());

            let mut stmt = conn.prepare("PRAGMA foreign_key_check").unwrap();
            assert!(
                stmt.query([]).unwrap().next().unwrap().is_none(),
                "as tres reconstrucoes nao deixaram referencia orfa"
            );
        }

        #[test]
        fn the_rebuilt_tables_keep_every_column() {
            // A armadilha que esta migration quase caiu: `subject_details` ganhou
            // quatro colunas por ALTER na 0016 e uma na 0017, e a primeira versão
            // da reconstrução esqueceu a `summary`. Um INSERT ... SELECT que
            // omite uma coluna não dá erro — ele só apaga o dado, e o repositório
            // (que faz SELECT por nome) só descobre no dia em que alguém lê o
            // campo. Comparar as duas listas é o único jeito de o esquecimento
            // fazer barulho na hora.
            let mut before = Connection::open_in_memory().unwrap();
            migrations().to_version(&mut before, 18).unwrap();
            let mut after = Connection::open_in_memory().unwrap();
            run(&mut after).unwrap();

            let columns = |conn: &Connection, table: &str| -> Vec<String> {
                let mut stmt = conn
                    .prepare(&format!(
                        "SELECT name, type FROM pragma_table_info('{table}')"
                    ))
                    .unwrap();
                stmt.query_map([], |r| {
                    Ok(format!(
                        "{} {}",
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?
                    ))
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
            };

            for table in ["nodes", "habit_details", "subject_details"] {
                assert_eq!(
                    columns(&before, table),
                    columns(&after, table),
                    "a reconstrucao de {table} mudou as colunas — so a clausula \
                     ON DELETE podia ter mudado"
                );
            }
        }

        #[test]
        fn the_data_of_the_three_tables_survives_the_rebuild() {
            let mut conn = seeded_at_v18();
            run(&mut conn).unwrap();

            let (title, parent): (String, String) = conn
                .query_row(
                    "SELECT title, parent_id FROM nodes WHERE id = 't2'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!((title.as_str(), parent.as_str()), ("Comprar tinta", "t1"));

            let (target, unit, order, reminder): (f64, String, i64, String) = conn
                .query_row(
                    "SELECT target_value, unit, routine_order, reminder_time
                       FROM habit_details WHERE node_id = 'h1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap();
            assert_eq!(
                (target, unit.as_str(), order, reminder.as_str()),
                (2.0, "L", 3, "07:30")
            );

            let (category, minutes, track, expected, summary): (
                String,
                i64,
                String,
                String,
                String,
            ) = conn
                .query_row(
                    "SELECT category, target_minutes, track, expected_end, summary
                       FROM subject_details WHERE node_id = 's1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .unwrap();
            assert_eq!(
                (
                    category.as_str(),
                    minutes,
                    track.as_str(),
                    expected.as_str(),
                    summary.as_str()
                ),
                (
                    "Idiomas",
                    600,
                    "idioma",
                    "2026-12-31",
                    "Conversacao e gramatica"
                )
            );
        }

        #[test]
        fn the_search_index_still_points_at_the_right_row() {
            // `nodes` recriada = `search_index` em risco. A busca é contentless e
            // se liga ao conteúdo SÓ pelo rowid (0002); uma cópia sem rowid
            // explícito renumeraria tudo e a busca passaria a devolver a linha
            // errada, sem erro nenhum. A quinta recriação corre o mesmo risco que
            // a primeira.
            let mut conn = seeded_at_v18();
            run(&mut conn).unwrap();

            let hit: String = conn
                .query_row(
                    "SELECT n.id FROM search_index s
                       JOIN nodes n ON n.rowid = s.rowid
                      WHERE search_index MATCH 'Reforma'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(hit, "p1");
        }

        #[test]
        fn running_it_twice_is_a_no_op() {
            let mut conn = seeded_at_v18();
            run(&mut conn).unwrap();
            run(&mut conn).unwrap();

            for (table, expected) in [
                ("nodes", 7i64),
                ("habit_details", 1),
                ("subject_details", 1),
            ] {
                let n: i64 = conn
                    .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                    .unwrap();
                assert_eq!(n, expected, "{table} se multiplicou ou sumiu");
            }
        }
    }

    /// A 0020 dá à matéria a lista que faltava: os TEMAS de dificuldade
    /// (Matemática -> Bháskara) e a checklist de conteúdos de um curso, que são a
    /// mesma forma e por isso a mesma tabela. Ver o cabeçalho da migration.
    ///
    /// `nodes` NÃO é tocada aqui — um item não é node —, então as três armadilhas
    /// do 12-step não se aplicam. O que precisa de prova é o CASCADE: os itens têm
    /// que ir junto quando a matéria vai.
    mod subject_items {
        use super::*;

        /// Um banco no estado da 0019 com uma matéria pronta para receber temas.
        fn seeded_at_v19() -> Connection {
            let mut conn = Connection::open_in_memory().unwrap();
            migrations().to_version(&mut conn, 19).unwrap();
            conn.execute_batch(
                "PRAGMA foreign_keys = ON;
                 INSERT INTO areas (id, name) VALUES ('a1', 'Estudos');
                 INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                      VALUES ('s1', 'subject', 'Matematica', 'a1', 100, 100);
                 INSERT INTO subject_details (node_id, track) VALUES ('s1', 'livre');",
            )
            .unwrap();
            conn
        }

        #[test]
        fn before_the_migration_a_subject_had_nowhere_to_put_a_theme() {
            // O motivo da migration, provado em vez de descrito.
            let conn = seeded_at_v19();
            assert!(
                conn.execute(
                    "INSERT INTO subject_items (id, subject_id, title, sort_order, created_at)
                     VALUES ('i1', 's1', 'Bhaskara', 0, 100)",
                    [],
                )
                .is_err(),
                "na 0019 a tabela nao existia — se isto passou, a 0020 perdeu o motivo"
            );
        }

        #[test]
        fn the_themes_of_a_subject_are_live_and_ordered() {
            let mut conn = seeded_at_v19();
            run(&mut conn).unwrap();
            conn.execute_batch(
                "INSERT INTO subject_items (id, subject_id, title, done, sort_order, created_at)
                      VALUES ('i2', 's1', 'Regra de 3', 0, 1, 100),
                             ('i1', 's1', 'Bhaskara',   1, 0, 100);",
            )
            .unwrap();

            let mut stmt = conn
                .prepare(
                    "SELECT title FROM subject_items WHERE subject_id = 's1' ORDER BY sort_order",
                )
                .unwrap();
            let titles: Vec<String> = stmt
                .query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            // A ordem é a do USUÁRIO (`sort_order`), não a alfabética nem a de
            // inserção: 'Bhaskara' foi inserido por último e vem primeiro.
            assert_eq!(titles, vec!["Bhaskara", "Regra de 3"]);
        }

        #[test]
        fn a_half_done_item_is_refused_by_the_check() {
            let mut conn = seeded_at_v19();
            run(&mut conn).unwrap();
            assert!(
                conn.execute(
                    "INSERT INTO subject_items (id, subject_id, title, done, sort_order, created_at)
                     VALUES ('i1', 's1', 'Bhaskara', 2, 0, 100)",
                    [],
                )
                .is_err(),
                "'done' e binario: um terceiro estado tornaria 'N de M' indefinido"
            );
        }

        #[test]
        fn deleting_the_subject_takes_its_items_with_it() {
            // O CASCADE do cabeçalho: um item não é node e nunca teve evento
            // próprio no ledger, então ele PODE ir junto (ao contrário do que o
            // ADR-0081 proíbe entre nodes).
            let mut conn = seeded_at_v19();
            run(&mut conn).unwrap();
            conn.execute_batch(
                "PRAGMA foreign_keys = ON;
                 INSERT INTO subject_items (id, subject_id, title, sort_order, created_at)
                      VALUES ('i1', 's1', 'Bhaskara', 0, 100);",
            )
            .unwrap();

            conn.execute("DELETE FROM nodes WHERE id = 's1'", [])
                .unwrap();

            let left: i64 = conn
                .query_row("SELECT COUNT(*) FROM subject_items", [], |r| r.get(0))
                .unwrap();
            assert_eq!(left, 0, "o tema sobreviveu a materia que o continha");
        }

        #[test]
        fn running_it_twice_is_a_no_op() {
            let mut conn = seeded_at_v19();
            run(&mut conn).unwrap();
            conn.execute(
                "INSERT INTO subject_items (id, subject_id, title, sort_order, created_at)
                 VALUES ('i1', 's1', 'Bhaskara', 0, 100)",
                [],
            )
            .unwrap();
            run(&mut conn).unwrap();

            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM subject_items", [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1, "o tema se multiplicou ou sumiu na segunda subida");
        }
    }
}
