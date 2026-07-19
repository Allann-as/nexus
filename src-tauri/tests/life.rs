//! Testes de integração do M4.5 "Vida": o bi_engine, a gamificação e as Metas
//! Anuais ponta a ponta, contra um SQLite real em arquivo.
//!
//! Espelha o `seed_demo`: um par de hábitos correlacionado de propósito prova que
//! o motor de correlação dispara um card respeitando as guardas (n ≥ 30, faixa
//! morta) — a validação que o prompt pede, sem depender de dirigir a GUI.

use std::sync::Arc;

use nexus_lib::application::ports::LedgerRepository;
use nexus_lib::application::use_cases::annual_goals::AnnualGoalService;
use nexus_lib::application::use_cases::areas::AreaService;
use nexus_lib::application::use_cases::gamification::GamificationService;
use nexus_lib::application::use_cases::habits::HabitService;
use nexus_lib::application::use_cases::insights::InsightService;
use nexus_lib::domain::entities::Template;
use nexus_lib::domain::schedule::{format_day, parse_day, Schedule};
use nexus_lib::domain::streak::TickStatus;
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    annual_goal_repo::SqliteAnnualGoalRepository, area_repo::SqliteAreaRepository,
    gamification_repo::SqliteGamificationRepository, habit_repo::SqliteHabitRepository,
    insight_repo::SqliteInsightRepository, ledger_repo::SqliteLedgerRepository,
    node_repo::SqliteNodeRepository,
};

struct Life {
    areas: AreaService,
    habits: HabitService,
    insights: InsightService,
    gami: GamificationService,
    annual: AnnualGoalService,
    _dir: tempfile::TempDir,
}

fn setup() -> Life {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();
    let db = Arc::new(Db::open(&paths).unwrap());

    let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
    let node_repo = Arc::new(SqliteNodeRepository::new(db.clone()));
    let habit_repo = Arc::new(SqliteHabitRepository::new(db.clone()));
    let ledger: Arc<dyn LedgerRepository> = Arc::new(SqliteLedgerRepository::new(db.clone()));
    let clock = Arc::new(SystemClock);
    let ids = Arc::new(Uuid7Gen);

    Life {
        areas: AreaService {
            repo: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        habits: HabitService {
            habits: habit_repo.clone(),
            nodes: node_repo.clone(),
            areas: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        insights: InsightService {
            insights: Arc::new(SqliteInsightRepository::new(db.clone())),
            clock: clock.clone(),
        },
        gami: GamificationService {
            gami: Arc::new(SqliteGamificationRepository::new(db.clone())),
            habits: habit_repo,
            ledger,
            insights: Arc::new(SqliteInsightRepository::new(db.clone())),
            clock: clock.clone(),
        },
        annual: AnnualGoalService {
            annual_goals: Arc::new(SqliteAnnualGoalRepository::new(db.clone())),
            areas: area_repo,
            ids,
            clock,
        },
        _dir: dir,
    }
}

/// Semeia o par correlacionado do `seed_demo`: "Dormir cedo" (~80% dos dias) e
/// "Acordar cedo" (depende forte dele). Devolve o id da Esfera.
fn seed_correlated(life: &Life) -> String {
    let area = life
        .areas
        .create("Saúde", "heart", "#34D399", Template::Simple)
        .unwrap();
    let dormir = life
        .habits
        .create(
            "Dormir cedo",
            Some(&area.id),
            Schedule::Daily,
            None,
            None,
            None,
            None,
        )
        .unwrap();
    let acordar = life
        .habits
        .create(
            "Acordar cedo",
            Some(&area.id),
            Schedule::Daily,
            None,
            None,
            None,
            None,
        )
        .unwrap();

    let today = parse_day(&life.habits.clock.today_local()).unwrap();
    for n in (1i64..=120).rev() {
        let day = today - chrono::Duration::days(n);
        let d = format_day(day);
        let dormiu = n % 5 != 0;
        if dormiu {
            life.habits
                .tick(&dormir.id, Some(&d), TickStatus::Done, None)
                .unwrap();
        }
        let acordou = if dormiu { n % 13 != 0 } else { n % 4 == 0 };
        if acordou {
            life.habits
                .tick(&acordar.id, Some(&d), TickStatus::Done, None)
                .unwrap();
        }
    }
    area.id
}

#[test]
fn the_correlated_pair_becomes_a_card_that_respects_the_guards() {
    let life = setup();
    seed_correlated(&life);

    let value = life.insights.refresh_if_stale().unwrap();
    let correlations = value["correlations"].as_array().unwrap();

    assert!(
        !correlations.is_empty(),
        "o par correlacionado tinha que virar ao menos um card"
    );
    let card = &correlations[0];
    // A guarda de amostra: nunca abaixo de 30.
    assert!(
        card["sampleSize"].as_u64().unwrap() >= 30,
        "a amostra tem que respeitar n ≥ 30"
    );
    // Dormir cedo AJUDA acordar cedo — lift alto, phi acima do piso.
    assert_eq!(card["direction"], "helps");
    assert!(
        card["lift"].as_f64().unwrap() >= 1.3,
        "lift acima do piso do template"
    );
    assert!(card["formula"].as_str().unwrap().contains("lift"));
}

#[test]
fn xp_accrues_to_the_sphere_and_the_gallery_lists_the_whole_catalog() {
    let life = setup();
    seed_correlated(&life);

    let overview = life.gami.overview().unwrap();
    // Os ticks deram XP à Esfera de Saúde.
    assert!(overview.overall.xp > 0, "cumprir hábitos rende XP");
    assert!(
        overview.spheres.iter().any(|s| s.level.xp > 0),
        "a Esfera com os hábitos tem XP"
    );
    // A galeria lista o catálogo INTEIRO (desbloqueadas + silhuetas).
    assert_eq!(
        overview.achievements.len(),
        nexus_lib::domain::achievements::catalog().len()
    );
}

#[test]
fn syncing_achievements_is_idempotent() {
    let life = setup();
    seed_correlated(&life);

    let first = life.gami.sync_achievements().unwrap();
    let second = life.gami.sync_achievements().unwrap();
    // Rodar de novo não desbloqueia nada de novo — o entity_id = key é a UNIQUE.
    assert!(
        second.is_empty(),
        "a segunda sincronização não pode redesbloquear (idempotente)"
    );
    // O que caiu na primeira aparece marcado na galeria.
    let overview = life.gami.overview().unwrap();
    let unlocked_in_gallery = overview.achievements.iter().filter(|a| a.unlocked).count();
    assert_eq!(
        unlocked_in_gallery,
        first.len(),
        "a galeria reflete o ledger"
    );
}

#[test]
fn an_annual_goal_progresses_and_the_year_overview_adds_up() {
    let life = setup();
    let year: i64 = life.annual.years().unwrap()[0]; // o ano corrente sempre existe

    let goal = life
        .annual
        .create(
            "Ler 12 livros",
            None,
            year,
            "quantitative",
            Some("livros".into()),
            Some(12.0),
            Some("livros".into()),
        )
        .unwrap();
    assert_eq!(goal.progress_ratio, 0.0);

    let updated = life.annual.update_progress(&goal.goal.id, 6.0).unwrap();
    assert!((updated.progress_ratio - 0.5).abs() < 1e-9, "6/12 = 0,5");

    let ov = life.annual.year_overview(year).unwrap();
    assert_eq!(ov.goals.len(), 1);
    assert!((ov.aggregate_progress - 0.5).abs() < 1e-9);
    assert!(ov.year_elapsed_ratio > 0.0, "o ano corrente já começou");
}
