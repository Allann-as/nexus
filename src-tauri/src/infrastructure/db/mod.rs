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
