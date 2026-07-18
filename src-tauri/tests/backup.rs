//! Teste de integração do backup (M5) contra um SQLite real.
//!
//! A regra do arquiteto: **um backup só existe se a restauração funciona.** Este
//! arquivo prova o CICLO COMPLETO, que é o único teste que importa aqui:
//!
//!   backup → corromper o banco → restaurar → quick_check → dados IDÊNTICOS
//!
//! (compara contagens E amostras). Cobre também os dois modos de falhar com
//! segurança: senha errada e zip corrompido NÃO substituem o banco vivo.

use std::sync::Arc;

use nexus_lib::infrastructure::backup::{restore_from_zip, BackupEngine};
use nexus_lib::infrastructure::clock::SystemClock;
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;

/// O retrato do banco que a restauração precisa devolver bit a bit: as contagens
/// e a AMOSTRA (os títulos, em ordem) — não só "tem o mesmo número de linhas".
#[derive(Debug, PartialEq, Eq)]
struct StateSnapshot {
    areas: i64,
    nodes: i64,
    titles: Vec<String>,
}

fn seed(db: &Db) {
    db.with_write(|c| {
        c.execute_batch(
            "INSERT INTO areas (id, name) VALUES ('a-saude', 'Saúde'), ('a-fin', 'Finanças');
             INSERT INTO nodes (id, kind, title, area_id, created_at, updated_at) VALUES
               ('n1', 'note', 'Correr 5km',       'a-saude', 100, 100),
               ('n2', 'note', 'Revisar orçamento', 'a-fin',   200, 200),
               ('n3', 'task', 'Comprar tênis',     'a-saude', 300, 300);",
        )?;
        Ok(())
    })
    .unwrap();
}

fn snapshot(db: &Db) -> StateSnapshot {
    db.with_read(|c| {
        let areas: i64 = c.query_row("SELECT COUNT(*) FROM areas", [], |r| r.get(0))?;
        let nodes: i64 = c.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0))?;
        let mut stmt = c.prepare("SELECT title FROM nodes ORDER BY id")?;
        let titles = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(StateSnapshot {
            areas,
            nodes,
            titles,
        })
    })
    .unwrap()
}

/// Faz o backup, devolve (caminho do zip, retrato do banco na hora do backup) e
/// FECHA o banco (solta o lock do arquivo, para o restore poder substituí-lo).
fn backup_then_close(paths: &Paths, password: Option<&str>) -> (std::path::PathBuf, StateSnapshot) {
    let db = Arc::new(Db::open(paths).unwrap());
    seed(&db);
    let before = snapshot(&db);

    let engine = BackupEngine::new(db.clone(), paths.clone(), Arc::new(SystemClock));
    let info = engine.create(password).unwrap();
    let zip = paths.backups.join(&info.name);
    assert!(zip.exists(), "o zip do backup deveria existir");
    assert!(info.size_bytes > 0, "um backup vazio não é backup");

    drop(engine);
    drop(db); // último Arc → fecha as conexões → libera o nexus.db
    (zip, before)
}

fn corrupt(paths: &Paths) {
    // Sobrescreve o banco vivo com lixo — o cabeçalho deixa de ser "SQLite format 3".
    std::fs::write(&paths.db, b"isto definitivamente nao e um banco sqlite").unwrap();
    // Sidecars do WAL antigo, se sobraram, pertencem ao arquivo que acabou de morrer.
    let _ = std::fs::remove_file(paths.db.with_extension("db-wal"));
    let _ = std::fs::remove_file(paths.db.with_extension("db-shm"));
}

#[test]
fn full_cycle_backup_corrupt_restore_gives_identical_data() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();

    let (zip, before) = backup_then_close(&paths, None);
    corrupt(&paths);

    restore_from_zip(&paths, &zip, None).unwrap();

    // Reabrir passa pelo quick_check do Db::open — se o restore devolvesse um
    // arquivo quebrado, isto falharia aqui.
    let db = Db::open(&paths).unwrap();
    let after = snapshot(&db);
    assert_eq!(
        before, after,
        "o banco restaurado tem que ser idêntico ao do backup"
    );
}

#[test]
fn encrypted_backup_round_trips_with_the_password() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();

    let (zip, before) = backup_then_close(&paths, Some("senha-forte-do-allan"));
    corrupt(&paths);

    restore_from_zip(&paths, &zip, Some("senha-forte-do-allan")).unwrap();

    let db = Db::open(&paths).unwrap();
    assert_eq!(before, snapshot(&db));
}

#[test]
fn a_wrong_password_fails_and_leaves_the_live_db_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();

    // Um banco vivo, saudável, que NÃO pode ser destruído por um restore que falha.
    let db = Arc::new(Db::open(&paths).unwrap());
    seed(&db);
    let healthy = snapshot(&db);
    let engine = BackupEngine::new(db.clone(), paths.clone(), Arc::new(SystemClock));
    let info = engine.create(Some("a-senha-certa")).unwrap();
    let zip = paths.backups.join(&info.name);

    let err = restore_from_zip(&paths, &zip, Some("a-senha-errada"));
    assert!(err.is_err(), "senha errada tem que falhar");

    // O banco vivo continua íntegro e com os mesmos dados.
    assert_eq!(
        healthy,
        snapshot(&db),
        "um restore falho não pode tocar o banco vivo"
    );
}

#[test]
fn a_corrupt_backup_is_refused_by_quick_check() {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();

    // Um "backup" que é um zip válido mas cujo conteúdo NÃO é um banco.
    let bogus = paths.backups.join("nexus-20260101-000000.zip");
    {
        use std::io::Write;
        let file = std::fs::File::create(&bogus).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("nexus.db", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"lixo que passa por banco").unwrap();
        zip.finish().unwrap();
    }

    // Prepara um banco vivo saudável e confirma que ele SOBREVIVE ao restore falho.
    let db = Arc::new(Db::open(&paths).unwrap());
    seed(&db);
    let healthy = snapshot(&db);

    let err = restore_from_zip(&paths, &bogus, None);
    assert!(
        err.is_err(),
        "um backup que não passa no quick_check tem que ser recusado"
    );
    assert_eq!(healthy, snapshot(&db), "o banco vivo continua intacto");
}
