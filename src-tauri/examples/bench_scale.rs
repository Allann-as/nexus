//! Mede os orçamentos de performance (M5) contra o banco de escala do
//! `seed_scale`. Ferramenta de dev — NÃO faz parte do app.
//!
//!   $env:NEXUS_DATA_DIR = "$PWD\.devdata-scale"
//!   cargo run --release --manifest-path src-tauri/Cargo.toml --example bench_scale
//!
//! Abre o banco A FRIO (processo novo, cache vazio) e cronometra os caminhos de
//! leitura que a UI usa — os MESMOS repositórios, não SQL paralelo. Os orçamentos
//! de scroll (60fps) e RAM (<300MB) exigem o app rodando e ficam para a dirigida
//! ao vivo; aqui medimos o que é medível de forma determinística: abertura do
//! banco, busca FTS e um mês da Timeline num banco de 5 anos.
//!
//! Rode em --release: o app instalado é release, e medir o debug mentiria para
//! cima nos números.

use std::sync::Arc;
use std::time::Instant;

use nexus_lib::application::ports::{LedgerRepository, SearchRepository};
use nexus_lib::domain::schedule::{format_day, parse_day};
use nexus_lib::infrastructure::clock::SystemClock;
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::fts::SqliteSearchRepository;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::ledger_repo::SqliteLedgerRepository;

use nexus_lib::application::ports::Clock;

/// Mediana de N repetições em ms — o número que se reporta (menos ruído que uma
/// medição só, e mais honesto que o melhor caso).
fn median_ms(mut samples: Vec<f64>) -> f64 {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    samples[samples.len() / 2]
}

fn line(name: &str, measured_ms: f64, budget_ms: f64) {
    let ok = if measured_ms <= budget_ms {
        "OK "
    } else {
        "ESTOUROU"
    };
    println!("  [{ok}] {name:<28} {measured_ms:>8.2} ms   (orçamento {budget_ms:.0} ms)");
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("NEXUS_DATA_DIR").is_err() {
        eprintln!("Defina NEXUS_DATA_DIR para o banco de escala do seed_scale.");
        std::process::exit(1);
    }
    let paths = Paths::resolve()?;
    let clock = SystemClock;

    // ===== Abertura a frio (proxy da parcela de banco do cold start) =====
    let t0 = Instant::now();
    let db = Arc::new(Db::open(&paths)?);
    let open_ms = t0.elapsed().as_secs_f64() * 1000.0;

    let (nodes, ledger): (i64, i64) = db.with_read(|c| {
        Ok((
            c.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0))?,
            c.query_row("SELECT COUNT(*) FROM ledger", [], |r| r.get(0))?,
        ))
    })?;
    println!("banco: {nodes} nodes, {ledger} eventos de ledger");
    println!("orçamentos (M5):");

    // ===== Busca FTS (orçamento < 50 ms) =====
    let search = SqliteSearchRepository::new(db.clone());
    // Primeira consulta paga o carregamento do índice; medimos a mediana das
    // seguintes — o "digitar de novo" que o usuário sente.
    let _ = search.search("arquitetura", 20, 0)?;
    let mut search_samples = Vec::new();
    for q in [
        "arquitetura",
        "saúde treino",
        "leitura foco",
        "meta projeto",
        "código livro",
    ] {
        let t = Instant::now();
        let hits = search.search(q, 20, 0)?;
        search_samples.push(t.elapsed().as_secs_f64() * 1000.0);
        std::hint::black_box(hits);
    }

    // ===== Um mês da Timeline (orçamento < 100 ms) =====
    let ledger_repo = SqliteLedgerRepository::new(db.clone());
    let today = parse_day(&clock.today_local())?;
    let mut month_samples = Vec::new();
    // Meses variados ao longo dos 5 anos, inclusive os mais antigos.
    for months_ago in [1i64, 12, 24, 36, 59] {
        let anchor = today - chrono::Duration::days(months_ago * 30);
        let from = format!("{}-01", &format_day(anchor)[..7]);
        let to = format!("{}-31", &format_day(anchor)[..7]);
        let t = Instant::now();
        // A UI pagina o mês (50 por página) — a primeira página é o que abre.
        let rows = ledger_repo.range(&from, &to, 50, 0)?;
        month_samples.push(t.elapsed().as_secs_f64() * 1000.0);
        std::hint::black_box(rows);
    }

    line("Abertura do banco (frio)", open_ms, 1500.0);
    line("Busca FTS", median_ms(search_samples), 50.0);
    line("Um mês da Timeline", median_ms(month_samples), 100.0);

    println!("\nscroll 60fps e RAM < 300MB: exigem o app rodando (dirigida ao vivo).");
    Ok(())
}
