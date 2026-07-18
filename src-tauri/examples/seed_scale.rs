//! Popula um banco de TESTE com 5 anos de dados, para validar os orçamentos de
//! performance (M5). Ferramenta de dev — NÃO faz parte do app.
//!
//!   $env:NEXUS_DATA_DIR = "$PWD\.devdata-scale"
//!   cargo run --manifest-path src-tauri/Cargo.toml --example seed_scale
//!
//! SEMPRE roda num diretório de dados ISOLADO (`NEXUS_DATA_DIR`), nunca no
//! `%APPDATA%/Nexus` real — a regra permanente do ADR-0048. O `Paths::resolve`
//! honra a variável; sem ela, o exemplo aborta em vez de tocar a vida real.
//!
//! Ao contrário do `seed_demo` (que escreve pelos casos de uso, para provar as
//! REGRAS), este seed insere em LOTE direto nas tabelas: o objetivo aqui é o
//! VOLUME (400k de ledger, 50k de nodes) para medir os caminhos de LEITURA. As
//! linhas continuam válidas — o gatilho de FTS indexa cada node no INSERT, e o
//! ledger é append-only por gatilho, então o INSERT em lote é o caminho honesto
//! para a história. Determinístico (sem RNG): rodar duas vezes dá o mesmo banco.

use std::sync::Arc;
use std::time::Instant;

use rusqlite::params;

use nexus_lib::domain::schedule::{format_day, parse_day};
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;

use nexus_lib::application::ports::{Clock, IdGen};

const NODES: usize = 50_000;
const LEDGER: usize = 400_000;
const YEARS_DAYS: i64 = 5 * 365; // 1825

/// Um vocabulário curto para os títulos terem termos reais que a busca acha.
const WORDS: &[&str] = &[
    "arquitetura",
    "saúde",
    "treino",
    "leitura",
    "foco",
    "meta",
    "projeto",
    "finanças",
    "carreira",
    "estudo",
    "corrida",
    "sono",
    "hábito",
    "revisão",
    "nota",
    "ideia",
    "código",
    "livro",
    "aporte",
    "semana",
];

/// A mistura de eventos do ledger, próxima do que o app de verdade gera.
const EVENTS: &[(&str, &str)] = &[
    ("habit", "checked"),
    ("habit", "checked"),
    ("habit", "checked"),
    ("task", "completed"),
    ("focus_session", "focus_session_logged"),
    ("study_session", "study_session_logged"),
    ("goal", "value_recorded"),
    ("daily_score", "nexus_score"),
    ("contribution", "value_recorded"),
    ("achievement", "achievement_unlocked"),
];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::var("NEXUS_DATA_DIR").is_err() {
        eprintln!(
            "RECUSADO: defina NEXUS_DATA_DIR para um diretório de teste antes de rodar.\n\
             Este seed de escala NUNCA deve tocar o %APPDATA%/Nexus real (ADR-0048)."
        );
        std::process::exit(1);
    }

    let paths = Paths::resolve()?;
    println!("semeando ESCALA em {}", paths.db.display());
    let clock = SystemClock;
    let ids = Uuid7Gen;
    let today = parse_day(&clock.today_local())?;
    let now = clock.now_ms();

    let db = Arc::new(Db::open(&paths)?);

    // As Esferas do sistema (0005) para dar area_id realista aos nodes.
    let area_ids: Vec<String> = db.with_read(|c| {
        let mut stmt = c.prepare("SELECT id FROM areas ORDER BY id")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    })?;
    println!("  {} esferas do sistema", area_ids.len());

    // ===== 50k nodes (kind 'note'), espalhados por 5 anos =====
    //
    // Cada título carrega termos do vocabulário — a busca FTS tem o que achar. O
    // gatilho `nodes_fts_ai` indexa cada um no INSERT.
    let t0 = Instant::now();
    db.with_write(|conn| {
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO nodes (id, kind, title, area_id, status, created_at, updated_at)
                 VALUES (?1, 'note', ?2, ?3, 'active', ?4, ?4)",
            )?;
            for i in 0..NODES {
                let w1 = WORDS[i % WORDS.len()];
                let w2 = WORDS[(i * 7 + 3) % WORDS.len()];
                let title = format!("Nota {i:05} sobre {w1} e {w2}");
                let day_off = (i as i64) % YEARS_DAYS;
                let ts = now - day_off * 86_400_000;
                let area = if i % 6 == 0 {
                    None
                } else {
                    Some(&area_ids[i % area_ids.len()])
                };
                stmt.execute(params![ids.new_id(), title, area, ts])?;
            }
        }
        tx.commit()?;
        Ok(())
    })?;
    println!(
        "  {NODES} nodes (FTS indexado por gatilho) em {:.1}s",
        t0.elapsed().as_secs_f64()
    );

    // ===== 400k linhas de ledger, espalhadas por 5 anos =====
    //
    // day distribui uniformemente sobre 1825 dias — ~219 eventos/dia, o que
    // exercita idx_ledger_day com a densidade de uma vida ativa. entity_kind /
    // event_type saem da mistura realista acima.
    let t1 = Instant::now();
    db.with_write(|conn| {
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO ledger (ts, day, entity_id, entity_kind, event_type, payload, title_snapshot)
                 VALUES (?1, ?2, ?3, ?4, ?5, '{}', ?6)",
            )?;
            for i in 0..LEDGER {
                let day_off = (i as i64) % YEARS_DAYS;
                let d = format_day(today - chrono::Duration::days(day_off));
                let ts = now - day_off * 86_400_000 - (i as i64 % 1000);
                let (kind, event) = EVENTS[i % EVENTS.len()];
                let w = WORDS[i % WORDS.len()];
                let snap = format!("Evento de {w}");
                stmt.execute(params![ts, d, ids.new_id(), kind, event, snap])?;
            }
        }
        tx.commit()?;
        Ok(())
    })?;
    println!(
        "  {LEDGER} linhas de ledger em {:.1}s",
        t1.elapsed().as_secs_f64()
    );

    let (nodes, ledger): (i64, i64) = db.with_read(|c| {
        Ok((
            c.query_row("SELECT COUNT(*) FROM nodes", [], |r| r.get(0))?,
            c.query_row("SELECT COUNT(*) FROM ledger", [], |r| r.get(0))?,
        ))
    })?;
    // ANALYZE para o planejador ter estatísticas — o app roda no boot também.
    db.with_write(|c| {
        c.execute_batch("ANALYZE;")?;
        Ok(())
    })?;
    println!("pronto — {nodes} nodes, {ledger} eventos de ledger. Rode `bench_scale`.");
    Ok(())
}
