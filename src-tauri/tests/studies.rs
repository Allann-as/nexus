//! Testes de integração dos Estudos (M4.6, item 7) contra um SQLite real.
//!
//! Prova a cadeia que a suíte de unidade não cobre: uma sessão registrada vira
//! progresso agregado na matéria E XP na Esfera de Estudos (a mesma query de
//! gamificação), e as estatísticas de leitura saem do estado dos livros.

use std::sync::Arc;

use nexus_lib::application::ports::{Clock, LedgerRepository};
use nexus_lib::application::use_cases::books::BookService;
use nexus_lib::application::use_cases::gamification::GamificationService;
use nexus_lib::application::use_cases::studies::StudyService;
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, book_repo::SqliteBookRepository,
    gamification_repo::SqliteGamificationRepository, habit_repo::SqliteHabitRepository,
    insight_repo::SqliteInsightRepository, ledger_repo::SqliteLedgerRepository,
    study_session_repo::SqliteStudySessionRepository, subject_repo::SqliteSubjectRepository,
};

struct Studies {
    studies: StudyService,
    books: BookService,
    gami: GamificationService,
    _dir: tempfile::TempDir,
}

fn setup() -> Studies {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();
    let db = Arc::new(Db::open(&paths).unwrap());

    let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
    let habit_repo = Arc::new(SqliteHabitRepository::new(db.clone()));
    let ledger: Arc<dyn LedgerRepository> = Arc::new(SqliteLedgerRepository::new(db.clone()));
    let clock = Arc::new(SystemClock);
    let ids = Arc::new(Uuid7Gen);

    Studies {
        studies: StudyService {
            subjects: Arc::new(SqliteSubjectRepository::new(db.clone())),
            sessions: Arc::new(SqliteStudySessionRepository::new(db.clone())),
            areas: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        books: BookService {
            books: Arc::new(SqliteBookRepository::new(db.clone())),
            areas: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        gami: GamificationService {
            gami: Arc::new(SqliteGamificationRepository::new(db.clone())),
            habits: habit_repo,
            ledger,
            insights: Arc::new(SqliteInsightRepository::new(db.clone())),
            clock,
        },
        _dir: dir,
    }
}

#[test]
fn a_session_becomes_subject_progress_and_sphere_xp() {
    let s = setup();
    // A Esfera de Estudos é semeada pela 0005 (só `simple` é criável à mão, ADR-0035).
    let area_id = "sphere-studies".to_string();
    let subject = s
        .studies
        .create_subject(
            "Cálculo",
            Some(area_id.clone()),
            Some("Faculdade".into()),
            Some(600),
        )
        .unwrap();

    // Três sessões: 40 + 50 = 90 min na matéria, mais uma sessão de tópico livre
    // sem matéria (não conta no progresso da matéria, mas conta no XP geral).
    s.studies
        .log_session(
            Some(subject.id.clone()),
            None,
            None,
            Some("limites".into()),
            40,
            None,
        )
        .unwrap();
    s.studies
        .log_session(
            Some(subject.id.clone()),
            None,
            None,
            Some("derivadas".into()),
            50,
            None,
        )
        .unwrap();
    s.studies
        .log_session(None, None, None, Some("leitura solta".into()), 25, None)
        .unwrap();

    // O progresso agrega as sessões da matéria — 90 min, 2 sessões, 15% da meta de 600.
    let prog = s.studies.subject_progress(&subject.id).unwrap();
    assert_eq!(prog.total_minutes, 90);
    assert_eq!(prog.session_count, 2);
    assert!((prog.target_progress.unwrap() - 0.15).abs() < 1e-9);
    assert_eq!(prog.recent.len(), 2);

    // As três sessões renderam XP; a Esfera de Estudos recebeu o das ligadas.
    let over = s.gami.overview().unwrap();
    assert!(over.overall.xp >= 30, "três sessões = 3 × 10 XP no geral");
    assert!(
        over.spheres
            .iter()
            .any(|sp| sp.area_id == area_id && sp.level.xp >= 20),
        "as sessões ligadas à matéria deram XP à Esfera de Estudos"
    );
}

#[test]
fn study_stats_window_and_constancy_add_up() {
    let s = setup();

    // Duas sessões hoje (mesmo dia → 1 dia ativo) e uma bem antiga (fora da semana).
    s.studies
        .log_session(None, None, None, Some("a".into()), 30, None)
        .unwrap();
    s.studies
        .log_session(None, None, None, Some("b".into()), 20, None)
        .unwrap();
    s.studies
        .log_session(
            None,
            None,
            None,
            Some("velho".into()),
            99,
            Some("2020-01-01".into()),
        )
        .unwrap();

    let stats = s.studies.study_stats(None).unwrap();
    assert_eq!(
        stats.minutes_last_7, 50,
        "só as duas de hoje entram na semana"
    );
    assert_eq!(
        stats.active_days_30, 1,
        "duas sessões no mesmo dia = 1 dia ativo"
    );
    assert_eq!(stats.total_sessions, 3);
    assert!(stats.formula.contains("Constância"));
}

#[test]
fn a_future_session_is_refused() {
    let s = setup();
    assert!(s
        .studies
        .log_session(None, None, None, None, 10, Some("2999-01-01".into()))
        .is_err());
    // Minutos não-positivos também.
    assert!(s
        .studies
        .log_session(None, None, None, None, 0, None)
        .is_err());
}

#[test]
fn reading_stats_measure_pace_and_time_to_finish() {
    let s = setup();
    let year = SystemClock.today_local()[..4].to_string();

    // Um livro de 300 páginas, começado e terminado neste ano.
    let book = s
        .books
        .create("SICP", None, Some("Abelson".into()), Some(300), None)
        .unwrap();
    // Marca começar e terminar via o fluxo de status/finish (as datas vêm do clock).
    s.books
        .set_status(&book.id, nexus_lib::domain::entities::BookStatus::Lendo)
        .unwrap();
    s.books.finish(&book.id, Some(5), None).unwrap();

    let stats = s.books.reading_stats(None).unwrap();
    assert_eq!(stats.year, year);
    assert_eq!(stats.books_finished_year, 1);
    assert_eq!(stats.pages_this_year, 300);
    assert!(stats.pages_per_day.unwrap() > 0.0);
    // Começou e terminou no mesmo dia (o clock não anda no teste) → 0 dias, amostra 1.
    assert_eq!(stats.sample_size, 1);
    assert_eq!(stats.avg_days_to_finish, Some(0.0));
}
