//! Database bootstrap: PRAGMAs, connection topology, migrations, integrity.
//!
//! Concurrency model — one writer, many readers, which is precisely what WAL
//! exists to serve:
//!
//!   * `write` is a single `Connection` behind a `Mutex`. SQLite permits only
//!     one writer at a time regardless; making that explicit turns lock
//!     contention into a queue we control instead of `SQLITE_BUSY` surprises.
//!   * `read` is an r2d2 pool of `query_only` connections. Under WAL these read
//!     concurrently with an in-flight write, never blocking the UI. The BI
//!     engine draws from here.

pub mod migrations;

use std::sync::Mutex;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, OpenFlags};

use crate::domain::errors::{NexusError, Result};
use crate::infrastructure::paths::Paths;

pub type ReadPool = Pool<SqliteConnectionManager>;

/// Applied to every connection on open.
///
/// `journal_mode` persists in the database file itself; the rest are per
/// connection, so they must be re-applied each time the pool opens one.
const PRAGMAS: &str = "
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -64000;
    PRAGMA mmap_size = 268435456;
    PRAGMA temp_store = MEMORY;
";

/// The single point where PRAGMAs are applied. Nothing else in the codebase
/// opens a connection.
fn configure(conn: &Connection) -> Result<()> {
    // journal_mode returns a row, so it cannot go through execute_batch.
    let mode: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
    if !mode.eq_ignore_ascii_case("wal") {
        return Err(NexusError::Storage(format!(
            "could not enable WAL (engine reported journal_mode={mode})"
        )));
    }
    conn.execute_batch(PRAGMAS)?;
    Ok(())
}

/// A rede de segurança que faltava: um snapshot do banco ANTES de qualquer
/// migration tocá-lo.
///
/// A §6 do DATA_MODEL prometia "toda migration precedida de backup automático do
/// arquivo" desde o M5, mas a promessa nunca virou código — o `Db::open` ia do
/// `quick_check` direto para o `run`. Com dados reais no `%APPDATA%`, a diferença
/// entre um upgrade que dá errado e um upgrade que dá errado E leva anos de
/// história junto é exatamente este arquivo.
///
/// Decisões, e o porquê de cada uma:
///
/// * **`VACUUM INTO`, não uma cópia de arquivo.** Sob WAL, o `nexus.db` sozinho
///   não é o banco — as escritas mais recentes moram no `-wal`. Copiar o arquivo
///   é copiar um estado velho; o `VACUUM INTO` escreve um banco íntegro e
///   autocontido a partir de uma leitura consistente. É o mesmo motor do
///   `BackupEngine::create`, que aqui não dá para usar: ele precisa de um `Arc<Db>`
///   que ainda não existe neste ponto do boot.
///
/// * **`.db` cru, não `.zip`.** Este snapshot não é um backup do usuário: é uma
///   apólice para o desenvolvedor e para o suporte. Ficando fora do padrão de
///   nome `nexus-*.zip`, ele não aparece na lista da UI e — o que importa — a
///   **retenção nunca o poda**. Migrations são raras (15 na vida do projeto);
///   estes arquivos não se acumulam de forma relevante, e o preço de guardar um a
///   mais é irrisório perto do de não ter.
///
/// * **Falhar aqui não impede o boot.** Se a pasta estiver cheia ou somente
///   leitura, o app ainda tem de abrir. O aviso vai para o log; o que não pode
///   acontecer é o NEXUS se recusar a iniciar por causa da própria apólice.
fn snapshot_before_migrating(conn: &Connection, paths: &Paths) {
    match migrations::is_upgrade_pending(conn) {
        Ok(false) => return,
        Ok(true) => {}
        Err(e) => {
            tracing::warn!(error = %e, "não foi possível saber se há migration pendente; seguindo sem snapshot");
            return;
        }
    }

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = paths.backups.join(format!("pre-migration-{stamp}.db"));
    if let Err(e) = std::fs::create_dir_all(&paths.backups) {
        tracing::warn!(error = %e, "pasta de backups indisponível; migrando sem snapshot");
        return;
    }
    let _ = std::fs::remove_file(&dest);

    // Caminho app-controlado, mas a aspa simples é escapada por higiene: o
    // `VACUUM INTO` não aceita bind de parâmetro em toda versão do SQLite.
    let lit = dest.to_string_lossy().replace('\'', "''");
    match conn.execute_batch(&format!("VACUUM main INTO '{lit}'")) {
        Ok(()) => tracing::info!(path = %dest.display(), "snapshot pré-migration gravado"),
        Err(e) => tracing::warn!(error = %e, "snapshot pré-migration falhou; migrando assim mesmo"),
    }
}

pub struct Db {
    write: Mutex<Connection>,
    read: ReadPool,
}

impl Db {
    /// Opens the database, verifies integrity, and brings the schema up to date.
    ///
    /// Order matters: `quick_check` runs on a file that has not been migrated
    /// yet, so a corrupt database is caught before any write touches it.
    pub fn open(paths: &Paths) -> Result<Self> {
        let mut writer = Connection::open(&paths.db)?;
        configure(&writer)?;

        Self::quick_check(&writer)?;
        snapshot_before_migrating(&writer, paths);
        migrations::run(&mut writer)?;

        let manager = SqliteConnectionManager::file(&paths.db)
            .with_flags(OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
            .with_init(|c| {
                c.execute_batch(PRAGMAS)?;
                c.execute_batch("PRAGMA query_only = ON;")
            });

        let read = Pool::builder()
            .max_size(4)
            .build(manager)
            .map_err(|e| NexusError::Storage(format!("could not build read pool: {e}")))?;

        Ok(Self {
            write: Mutex::new(writer),
            read,
        })
    }

    /// Opens a throwaway in-memory database with the full schema applied.
    ///
    /// The read pool points at a separate empty `:memory:` connection, so this
    /// is only sound for tests that exercise the writer.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let mut writer = Connection::open_in_memory()?;
        writer.execute_batch(PRAGMAS)?;
        migrations::run(&mut writer)?;

        let read = Pool::builder()
            .max_size(1)
            .build(SqliteConnectionManager::memory())
            .map_err(|e| NexusError::Storage(format!("could not build read pool: {e}")))?;

        Ok(Self {
            write: Mutex::new(writer),
            read,
        })
    }

    fn quick_check(conn: &Connection) -> Result<()> {
        let verdict: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
        if verdict == "ok" {
            Ok(())
        } else {
            Err(NexusError::Integrity(verdict))
        }
    }

    /// Runs `f` against the writer, serialised behind the write mutex.
    pub fn with_write<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        let mut guard = self
            .write
            .lock()
            .map_err(|_| NexusError::Storage("write lock poisoned".into()))?;
        f(&mut guard)
    }

    /// Runs `f` against a pooled read-only connection.
    pub fn with_read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let conn = self.read.get()?;
        f(&conn)
    }

    /// Lets SQLite refresh its query-planner statistics. Called on shutdown,
    /// where the cost is invisible to the user.
    pub fn optimize(&self) -> Result<()> {
        self.with_write(|c| {
            c.execute_batch("PRAGMA optimize;")?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Quantos snapshots pré-migration existem na pasta de backups.
    fn snapshots(paths: &Paths) -> usize {
        std::fs::read_dir(&paths.backups)
            .map(|d| {
                d.flatten()
                    .filter(|e| {
                        e.file_name()
                            .to_string_lossy()
                            .starts_with("pre-migration-")
                    })
                    .count()
            })
            .unwrap_or(0)
    }

    #[test]
    fn a_brand_new_database_is_not_snapshotted() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();

        // Primeira abertura: 0 -> última versão. Não havia nada a perder.
        let db = Db::open(&paths).unwrap();
        assert_eq!(snapshots(&paths), 0, "banco novo não gera snapshot");

        // Reabrir um banco já em dia também não gera — nada vai ser alterado.
        drop(db);
        let _db = Db::open(&paths).unwrap();
        assert_eq!(snapshots(&paths), 0, "banco em dia não gera snapshot");
    }

    #[test]
    fn a_database_behind_the_schema_is_snapshotted_before_migrating() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();

        // Um banco com dado do usuário, fingindo estar atrás do schema corrente.
        let conn = Connection::open(&paths.db).unwrap();
        configure(&conn).unwrap();
        conn.execute_batch(
            "CREATE TABLE historia (id INTEGER PRIMARY KEY, o_que TEXT);
             INSERT INTO historia (o_que) VALUES ('cinco anos de vida');
             PRAGMA user_version = 1;",
        )
        .unwrap();

        snapshot_before_migrating(&conn, &paths);
        assert_eq!(snapshots(&paths), 1, "o snapshot foi gravado");

        // E o snapshot é um banco ÍNTEGRO com os dados dentro — não um arquivo
        // truncado que só parece um backup.
        let snap = std::fs::read_dir(&paths.backups)
            .unwrap()
            .flatten()
            .find(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("pre-migration-")
            })
            .unwrap()
            .path();
        let restored = Connection::open(&snap).unwrap();
        let verdict: String = restored
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(verdict, "ok", "o snapshot passa no quick_check");
        let saved: String = restored
            .query_row("SELECT o_que FROM historia", [], |r| r.get(0))
            .unwrap();
        assert_eq!(saved, "cinco anos de vida", "os dados estão no snapshot");
    }

    #[test]
    fn pragmas_are_applied_to_a_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Db::open(&paths).unwrap();

        db.with_write(|c| {
            let journal: String = c.query_row("PRAGMA journal_mode", [], |r| r.get(0))?;
            assert_eq!(journal.to_lowercase(), "wal");

            let fk: i64 = c.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
            assert_eq!(fk, 1, "foreign keys must be enforced");
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn read_pool_refuses_writes() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        let db = Db::open(&paths).unwrap();

        let result = db.with_read(|c| {
            c.execute("INSERT INTO areas (id, name) VALUES ('x', 'y')", [])?;
            Ok(())
        });
        assert!(result.is_err(), "read pool must reject writes");
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let db = Db::open_in_memory().unwrap();
        let result = db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at)
                 VALUES ('n1', 'note', 'orphan', 'no-such-area', 0, 0)",
                [],
            )?;
            Ok(())
        });
        assert!(result.is_err(), "a dangling area_id must be rejected");
    }

    #[test]
    fn node_kind_check_constraint_holds() {
        let db = Db::open_in_memory().unwrap();
        let result = db.with_write(|c| {
            c.execute(
                "INSERT INTO nodes (id, kind, title, created_at, updated_at)
                 VALUES ('n1', 'not_a_kind', 'bad', 0, 0)",
                [],
            )?;
            Ok(())
        });
        assert!(result.is_err(), "an unknown kind must be rejected");
    }
}
