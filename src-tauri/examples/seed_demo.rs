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

use nexus_lib::application::ports::Clock;
use nexus_lib::application::use_cases::{
    areas::AreaService, habits::HabitService, nodes::NodeService, tasks::TaskService,
};
use nexus_lib::domain::entities::Kind;
use nexus_lib::domain::schedule::{format_day, parse_day, Schedule};
use nexus_lib::domain::streak::TickStatus;
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, habit_repo::SqliteHabitRepository,
    node_repo::SqliteNodeRepository, task_repo::SqliteTaskRepository,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let paths = Paths::resolve()?;
    println!("semeando em {}", paths.db.display());

    let db = Arc::new(Db::open(&paths)?);
    let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
    let node_repo = Arc::new(SqliteNodeRepository::new(db.clone()));
    let habit_repo = Arc::new(SqliteHabitRepository::new(db.clone()));
    let task_repo = Arc::new(SqliteTaskRepository::new(db.clone()));
    let clock = Arc::new(SystemClock);
    let ids = Arc::new(Uuid7Gen);

    let areas = AreaService {
        repo: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let nodes = NodeService {
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let habits = HabitService {
        habits: habit_repo,
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let tasks = TaskService {
        tasks: task_repo,
        nodes: node_repo,
        areas: area_repo,
        ids,
        clock: clock.clone(),
    };

    // ===== Áreas =====
    for (name, icon, color) in [
        ("Saúde", "heart", "#4ADE80"),
        ("Carreira", "briefcase", "#7C8CF8"),
        ("Finanças", "wallet", "#FBBF24"),
    ] {
        areas.create(name, icon, color)?;
    }
    let all_areas = areas.list(false)?;
    let saude = all_areas.iter().find(|a| a.name == "Saúde").unwrap();
    let carreira = all_areas.iter().find(|a| a.name == "Carreira").unwrap();
    println!("  {} áreas", all_areas.len());

    // ===== Rotina matinal =====
    let routine = habits.create_routine("Rotina matinal", Some(&saude.id))?;
    for (title, time) in [("Beber 500ml de água", "07:00"), ("Alongar", "07:10")] {
        habits.create(
            title,
            Some(&saude.id),
            Schedule::Daily,
            None,
            None,
            Some(routine.clone()),
            Some(time.into()),
        )?;
    }

    // ===== Hábitos avulsos =====
    let ler = habits.create(
        "Ler 20 páginas",
        Some(&carreira.id),
        Schedule::Daily,
        Some(20.0),
        Some("páginas".into()),
        None,
        None,
    )?;
    let correr = habits.create(
        "Correr",
        Some(&saude.id),
        Schedule::Weekdays {
            days: vec![1, 3, 5],
        },
        None,
        None,
        None,
        None,
    )?;
    let agua = habits.create(
        "Beber 2L de água",
        Some(&saude.id),
        Schedule::Daily,
        Some(2.0),
        Some("L".into()),
        None,
        None,
    )?;
    let academia = habits.create(
        "Academia",
        Some(&saude.id),
        Schedule::TimesPerWeek { n: 3 },
        None,
        None,
        None,
        None,
    )?;
    println!("  {} hábitos", habits.list(None)?.len());

    // ===== Histórico: 120 dias de ticks =====
    //
    // Determinístico de propósito (sem RNG): rodar o seed duas vezes tem que
    // produzir o mesmo heatmap, senão comparar builds vira adivinhação.
    let today = parse_day(&clock.today_local())?;
    let mut ticks = 0;

    for n in (1i64..=120).rev() {
        let day = today - chrono::Duration::days(n);
        let d = format_day(day);

        // "Ler": falha a cada 7 dias, pula a cada 11 — dá streaks realistas.
        if n % 7 != 0 {
            let status = if n % 11 == 0 {
                TickStatus::Skipped
            } else {
                TickStatus::Done
            };
            let value = (status == TickStatus::Done).then_some(20.0 + (n % 15) as f64);
            habits.tick(&ler.id, Some(&d), status, value)?;
            ticks += 1;
        }

        // "Correr": só seg/qua/sex, e falha às sextas de vez em quando —
        // é o que faz o gráfico de "ofensores" ter o que mostrar.
        if correr.schedule.is_scheduled_on(day) {
            let is_friday = nexus_lib::domain::schedule::weekday_index(day) == 5;
            let status = if is_friday && n % 3 == 0 {
                TickStatus::Failed
            } else {
                TickStatus::Done
            };
            habits.tick(&correr.id, Some(&d), status, None)?;
            ticks += 1;
        }

        // "Água": quase todo dia.
        if n % 9 != 0 {
            habits.tick(
                &agua.id,
                Some(&d),
                TickStatus::Done,
                Some(1.5 + (n % 4) as f64 * 0.5),
            )?;
            ticks += 1;
        }

        // "Academia": 3x/semana (seg, qua, sáb).
        let wd = nexus_lib::domain::schedule::weekday_index(day);
        if matches!(wd, 1 | 3 | 6) {
            habits.tick(&academia.id, Some(&d), TickStatus::Done, None)?;
            ticks += 1;
        }
    }
    println!("  {ticks} marcações de hábito em 120 dias");

    // ===== Projeto com tarefas =====
    let project = tasks.create_project("Lançar o site pessoal", Some(&carreira.id))?;
    for (title, priority, dur) in [
        ("Escrever o texto da home", 1, Some(90)),
        ("Escolher a tipografia", 3, Some(30)),
        ("Montar o layout", 2, Some(120)),
        ("Configurar o domínio", 2, Some(45)),
        ("Publicar", 1, Some(20)),
    ] {
        tasks.create(
            title,
            Some(&carreira.id),
            Some(&project),
            None,
            None,
            dur,
            priority,
            None,
        )?;
    }
    // Duas já concluídas, para a barra de progresso ter o que mostrar.
    let created = tasks.list_for_project(&project, false)?;
    tasks.set_completed(&created[0].id, true)?;
    tasks.set_completed(&created[1].id, true)?;

    // ===== Tarefas agendadas para hoje =====
    let now = clock.now_ms();
    let hour = 3_600_000i64;
    for (title, offset, dur) in [
        ("Revisar o PR do time", hour, Some(45)),
        ("Ligar para o contador", 3 * hour, Some(20)),
    ] {
        tasks.create(
            title,
            Some(&carreira.id),
            None,
            None,
            Some(now + offset),
            dur,
            2,
            Some("deep".into()),
        )?;
    }

    // ===== Inbox =====
    for title in [
        "Ideia: newsletter sobre arquitetura de software",
        "Renegociar plano de internet",
        "Pesquisar tênis de corrida",
    ] {
        nodes.capture_inbox(title)?;
    }

    // ===== Uma nota =====
    nodes.create(
        Kind::Note,
        "Protocolo de sono: 7h30 por noite",
        Some(&saude.id),
        None,
    )?;

    println!(
        "pronto — {} nodes no total",
        nodes.count(&Default::default())?
    );
    Ok(())
}
