//! Popula o banco real (`%APPDATA%/Nexus`) com dados de demonstração.
//!
//! Ferramenta de desenvolvimento — NÃO faz parte do app. Serve para inspecionar
//! a UI com conteúdo e, mais adiante (M5), vira a base do seed de 5 anos que
//! valida os orçamentos de performance.
//!
//!   cargo run --example seed_demo
//!
//! Escreve pelos MESMOS casos de uso que a UI usa, e não por INSERT cru: assim
//! os dados semeados passam pelas validações e geram eventos de ledger de
//! verdade. Um seed que burla as regras produz um app que só funciona no seed.

use std::sync::Arc;

use nexus_lib::application::use_cases::{areas::AreaService, nodes::NodeService};
use nexus_lib::domain::entities::Kind;
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, node_repo::SqliteNodeRepository,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let paths = Paths::resolve()?;
    println!("semeando em {}", paths.db.display());

    let db = Arc::new(Db::open(&paths)?);
    let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
    let node_repo = Arc::new(SqliteNodeRepository::new(db.clone()));
    let clock = Arc::new(SystemClock);
    let ids = Arc::new(Uuid7Gen);

    let areas = AreaService {
        repo: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let nodes = NodeService {
        nodes: node_repo,
        areas: area_repo,
        ids,
        clock,
    };

    for (name, icon, color) in [
        ("Saúde", "heart", "#4ADE80"),
        ("Carreira", "briefcase", "#7C8CF8"),
        ("Finanças", "wallet", "#FBBF24"),
    ] {
        let area = areas.create(name, icon, color)?;
        println!("  área: {}", area.name);
    }

    let saude = areas
        .list(false)?
        .into_iter()
        .find(|a| a.name == "Saúde")
        .expect("área Saúde recém-criada");

    for title in [
        "Marcar consulta com o dentista",
        "Pesquisar tênis de corrida",
        "Ideia: newsletter sobre arquitetura de software",
        "Renegociar plano de internet",
        "Ler o artigo sobre WAL do SQLite",
    ] {
        nodes.capture_inbox(title)?;
    }

    // Um par já triado, para a UI não parecer só um Inbox.
    let note = nodes.create(
        Kind::Note,
        "Protocolo de sono: 7h30 por noite",
        Some(&saude.id),
        None,
    )?;
    println!("  nota: {}", note.title);

    println!(
        "pronto — {} nodes, {} áreas",
        nodes.count(&Default::default())?,
        areas.list(false)?.len()
    );
    Ok(())
}
