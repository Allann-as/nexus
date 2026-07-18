//! Testes de integração da Revisão Semanal (M5) contra um SQLite real.
//!
//! Prova os dois cuidados de produto: o ritual é RETOMÁVEL (o rascunho sobrevive
//! a "fechar e voltar") e o evento `weekly_review_completed` só entra no ledger na
//! CONCLUSÃO — uma revisão abandonada não vira fato. E os números dos hábitos são
//! o desempenho real da semana.

use std::sync::Arc;

use chrono::{Datelike, Duration, Local};
use nexus_lib::application::ports::LedgerRepository;
use nexus_lib::application::use_cases::weekly_review::WeeklyReviewService;
use nexus_lib::infrastructure::clock::SystemClock;
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    habit_repo::SqliteHabitRepository, ledger_repo::SqliteLedgerRepository,
};

struct Setup {
    svc: WeeklyReviewService,
    paths: Paths,
    _dir: tempfile::TempDir,
}

fn setup() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();
    let db = Arc::new(Db::open(&paths).unwrap());
    let ledger: Arc<dyn LedgerRepository> = Arc::new(SqliteLedgerRepository::new(db.clone()));
    let svc = WeeklyReviewService {
        ledger,
        habits: Arc::new(SqliteHabitRepository::new(db.clone())),
        clock: Arc::new(SystemClock),
        paths: paths.clone(),
    };
    Setup {
        svc,
        paths,
        _dir: dir,
    }
}

/// Um novo serviço apontando para a MESMA pasta — simula "fechar e reabrir o app".
fn reopen(paths: &Paths) -> WeeklyReviewService {
    let db = Arc::new(Db::open(paths).unwrap());
    WeeklyReviewService {
        ledger: Arc::new(SqliteLedgerRepository::new(db.clone())),
        habits: Arc::new(SqliteHabitRepository::new(db.clone())),
        clock: Arc::new(SystemClock),
        paths: paths.clone(),
    }
}

#[test]
fn a_draft_survives_closing_and_reopening() {
    let s = setup();

    // Começa a revisão e para no passo 3 com um texto no meio.
    s.svc
        .save_progress(3, "estava indo bem quando fechei".into())
        .unwrap();

    // "Fecha e reabre": um serviço novo, mesma pasta.
    let reopened = reopen(&s.paths);
    let state = reopened.state().unwrap();
    assert_eq!(state.step, 3, "voltou no passo em que parou");
    assert_eq!(state.reflection, "estava indo bem quando fechei");
    assert!(!state.completed_this_week, "ainda não é fato");
}

#[test]
fn an_abandoned_review_never_becomes_a_fact() {
    let s = setup();
    // Chega até o passo 4 e para (o usuário fechou o app e não voltou).
    s.svc
        .save_progress(4, "comecei mas larguei".into())
        .unwrap();

    // O rascunho existe (é retomável)...
    assert_eq!(s.svc.state().unwrap().step, 4);
    // ...mas NADA entrou no ledger: sem `complete`, não há fato.
    assert_eq!(
        s.svc.ledger.count().unwrap(),
        0,
        "abandonar não escreve história"
    );
    assert!(!s.svc.state().unwrap().completed_this_week);
}

#[test]
fn completing_writes_the_event_clears_the_draft_and_is_idempotent() {
    let s = setup();
    s.svc
        .save_progress(6, "semana difícil, mas fechei".into())
        .unwrap();

    let entry = s.svc.complete("semana difícil, mas fechei".into()).unwrap();
    assert_eq!(entry.event_type, "weekly_review_completed");
    assert_eq!(entry.entity_kind, "weekly_review");

    // O evento está no ledger e a semana consta como revisada.
    let state = s.svc.state().unwrap();
    assert!(state.completed_this_week, "a semana virou fato");
    // O rascunho sumiu: o passo volta a zero (sem rascunho retomável).
    assert_eq!(state.step, 0, "o rascunho foi apagado após a conclusão");

    // Idempotência: concluir de novo a mesma semana é recusado.
    assert!(
        s.svc.complete("de novo".into()).is_err(),
        "um review por semana"
    );
}

#[test]
fn habits_this_week_reports_real_scheduled_and_done() {
    let s = setup();

    // Um hábito diário, com dois ticks 'done' nesta semana.
    let today = Local::now().date_naive();
    let monday = today - Duration::days(today.weekday().num_days_from_monday() as i64);
    let d0 = monday.format("%Y-%m-%d").to_string();
    let d1 = (monday + Duration::days(1)).format("%Y-%m-%d").to_string();

    let db = Arc::new(Db::open(&s.paths).unwrap());
    db.with_write(|c| {
        c.execute_batch(&format!(
            "INSERT INTO nodes (id, kind, title, created_at, updated_at)
               VALUES ('h1', 'habit', 'Meditar', 1, 1);
             INSERT INTO habit_details (node_id, schedule_json)
               VALUES ('h1', '{{\"type\":\"daily\"}}');
             INSERT INTO habit_ticks (habit_id, day, status, ts) VALUES
               ('h1', '{d0}', 'done', 10),
               ('h1', '{d1}', 'done', 20);"
        ))?;
        Ok(())
    })
    .unwrap();

    // O serviço lê o MESMO banco (mesma pasta).
    let svc = reopen(&s.paths);
    let habits = svc.habits_this_week().unwrap();
    let meditar = habits.iter().find(|h| h.habit_id == "h1").unwrap();
    assert_eq!(meditar.scheduled, 7, "diário = agendado nos 7 dias");
    assert_eq!(meditar.done, 2, "dois dias cumpridos nesta semana");
}
