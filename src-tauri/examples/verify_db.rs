//! Verificador de integridade de um arquivo de banco — a apólice em forma de
//! ferramenta.
//!
//! Existe por causa da lição do ADR-0069: *"uma linha de documentação não é uma
//! garantia"*. Antes de qualquer migration tocar um banco com dados reais, o
//! backup precisa ser CONFERIDO, não presumido — e conferir quer dizer abrir o
//! arquivo e perguntar ao SQLite se ele está inteiro.
//!
//! Abre SOMENTE-LEITURA de propósito: verificar um backup jamais pode escrever
//! nele (um `-wal` criado pela verificação já seria uma alteração do artefato
//! que se queria preservar).
//!
//! ```powershell
//! cargo run --manifest-path src-tauri/Cargo.toml --example verify_db -- <caminho.db>
//! ```
//!
//! Sai com código 0 se o banco está íntegro, 1 se não. Imprime `quick_check`,
//! `user_version`, `foreign_key_check` e uma contagem de linhas das tabelas que
//! doem se sumirem.

use std::path::PathBuf;
use std::process::ExitCode;

use rusqlite::{Connection, OpenFlags};

fn main() -> ExitCode {
    let Some(path) = std::env::args().nth(1).map(PathBuf::from) else {
        eprintln!("uso: verify_db <caminho para o .db>");
        return ExitCode::FAILURE;
    };

    if !path.exists() {
        eprintln!("nao existe: {}", path.display());
        return ExitCode::FAILURE;
    }

    // SOMENTE-LEITURA: verificar um backup não pode alterá-lo.
    let conn = match Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("nao abriu: {e}");
            return ExitCode::FAILURE;
        }
    };

    println!("arquivo   : {}", path.display());

    let quick: String = match conn.query_row("PRAGMA quick_check", [], |r| r.get(0)) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("quick_check falhou: {e}");
            return ExitCode::FAILURE;
        }
    };
    println!("quick_check: {quick}");

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(-1);
    println!("user_version: {version}");

    // `foreign_key_check` não devolve linha nenhuma quando está tudo certo.
    let mut fk_ok = true;
    if let Ok(mut stmt) = conn.prepare("PRAGMA foreign_key_check") {
        if let Ok(mut rows) = stmt.query([]) {
            if matches!(rows.next(), Ok(Some(_))) {
                fk_ok = false;
            }
        }
    }
    println!(
        "foreign_key_check: {}",
        if fk_ok { "ok" } else { "REFERENCIA ORFA" }
    );

    // As tabelas cuja perda seria irreparável. Uma tabela ausente vira 0 aqui e
    // aparece no relatório em vez de explodir a verificação.
    for table in [
        "nodes",
        "ledger",
        "habit_ticks",
        "contributions",
        "goal_details",
        "areas",
    ] {
        let n: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap_or(-1);
        println!("  {table:<16} {n}");
    }

    if quick == "ok" && fk_ok {
        println!("INTEGRO");
        ExitCode::SUCCESS
    } else {
        eprintln!("INTEGRIDADE COMPROMETIDA");
        ExitCode::FAILURE
    }
}
