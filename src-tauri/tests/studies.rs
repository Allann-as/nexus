//! Testes de integração dos Estudos (M4.6, item 7) contra um SQLite real.
//!
//! Prova a cadeia que a suíte de unidade não cobre: uma sessão registrada vira
//! progresso agregado na matéria E XP na Esfera de Estudos (a mesma query de
//! gamificação), e as estatísticas de leitura saem do estado dos livros.

use std::sync::Arc;

use nexus_lib::application::ports::{Clock, LedgerRepository};
use nexus_lib::application::use_cases::books::BookService;
use nexus_lib::application::use_cases::gamification::GamificationService;
use nexus_lib::application::use_cases::goals::GoalService;
use nexus_lib::application::use_cases::studies::StudyService;
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, book_repo::SqliteBookRepository,
    gamification_repo::SqliteGamificationRepository, goal_repo::SqliteGoalRepository,
    habit_repo::SqliteHabitRepository, insight_repo::SqliteInsightRepository,
    ledger_repo::SqliteLedgerRepository, node_repo::SqliteNodeRepository,
    study_session_repo::SqliteStudySessionRepository, subject_repo::SqliteSubjectRepository,
};

struct Studies {
    studies: StudyService,
    goals: GoalService,
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
            goals: Arc::new(SqliteGoalRepository::new(db.clone())),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        goals: GoalService {
            goals: Arc::new(SqliteGoalRepository::new(db.clone())),
            nodes: Arc::new(SqliteNodeRepository::new(db.clone())),
            areas: area_repo.clone(),
            habits: habit_repo.clone(),
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
            None,
            None,
            None,
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

/* ===== BÚSSOLA, fase D: Estudos por TRILHA ===== */

use nexus_lib::application::ports::{NewGoal, NewGoalDetails};
use nexus_lib::domain::entities::{CourseStage, GoalKind, ProgressSource, SubjectTrack};

fn subject_on(s: &Studies, title: &str, track: SubjectTrack) -> String {
    s.studies
        .create_subject(title, None, None, None, Some(track), None, None)
        .unwrap()
        .id
}

#[test]
fn each_section_sees_only_its_own_track() {
    // O BUG que a fase D corrige: as três seções eram o MESMO componente rodando
    // a MESMA query, então o Inglês criado em Idiomas aparecia em Faculdade.
    let s = setup();
    let idioma = subject_on(&s, "Inglês", SubjectTrack::Idioma);
    let faculdade = subject_on(&s, "Cálculo II", SubjectTrack::Faculdade);
    let curso = subject_on(&s, "Rust Avançado", SubjectTrack::Curso);
    let livre = subject_on(&s, "Xadrez", SubjectTrack::Livre);

    for (track, expected) in [
        (SubjectTrack::Idioma, &idioma),
        (SubjectTrack::Faculdade, &faculdade),
        (SubjectTrack::Curso, &curso),
        (SubjectTrack::Livre, &livre),
    ] {
        let found = s.studies.subjects(None, Some(track)).unwrap();
        assert_eq!(found.len(), 1, "{track:?} vazou ou perdeu itens");
        assert_eq!(&found[0].id, expected);
    }

    // E a aba "Matérias", que sempre listou TUDO, continua listando tudo.
    assert_eq!(s.studies.subjects(None, None).unwrap().len(), 4);
}

#[test]
fn a_subject_without_a_track_lands_in_the_free_track() {
    let s = setup();
    let sub = s
        .studies
        .create_subject("Cálculo", None, None, None, None, None, None)
        .unwrap();
    assert_eq!(sub.track, SubjectTrack::Livre);
    assert_eq!(
        s.studies
            .subjects(None, Some(SubjectTrack::Livre))
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn a_course_stage_is_refused_on_anything_that_is_not_a_course() {
    // Sem isto, um IDIOMA carregaria "concluído" em silêncio — e a tela de
    // Idiomas, que não tem esse campo, nunca daria como corrigir.
    let s = setup();
    let idioma = subject_on(&s, "Inglês", SubjectTrack::Idioma);
    let err = s
        .studies
        .set_course_stage(&idioma, Some(CourseStage::Concluido))
        .unwrap_err();
    assert!(
        format!("{err}").contains("curso"),
        "a mensagem tem que explicar o porquê: {err}"
    );

    // Nem pela porta da criação.
    assert!(s
        .studies
        .create_subject(
            "Alemão",
            None,
            None,
            None,
            Some(SubjectTrack::Idioma),
            Some(CourseStage::Fazendo),
            None,
        )
        .is_err());

    // Num CURSO, passa.
    let curso = subject_on(&s, "Rust Avançado", SubjectTrack::Curso);
    let updated = s
        .studies
        .set_course_stage(&curso, Some(CourseStage::Fazendo))
        .unwrap();
    assert_eq!(updated.course_stage, Some(CourseStage::Fazendo));
}

#[test]
fn the_expected_end_accepts_the_future_and_refuses_garbage() {
    // Ao contrário do dia de uma sessão, uma PREVISÃO de conclusão é futura por
    // natureza — uma previsão que já passou não previa nada.
    let s = setup();
    let curso = subject_on(&s, "Rust Avançado", SubjectTrack::Curso);
    let updated = s
        .studies
        .set_subject_expected_end(&curso, Some("2099-12-31".into()))
        .unwrap();
    assert_eq!(updated.expected_end.as_deref(), Some("2099-12-31"));

    assert!(s
        .studies
        .set_subject_expected_end(&curso, Some("31/12/2099".into()))
        .is_err());
    // E `None` remove.
    assert_eq!(
        s.studies
            .set_subject_expected_end(&curso, None)
            .unwrap()
            .expected_end,
        None
    );
}

fn make_goal(s: &Studies, title: &str, kind: GoalKind) -> String {
    let details = match kind {
        GoalKind::Quantitative => NewGoalDetails {
            goal_kind: kind,
            metric_name: Some("palavras".into()),
            start_value: Some(0.0),
            target_value: Some(1000.0),
            unit: Some("palavras".into()),
            direction: None,
            deadline: None,
            progress_source: ProgressSource::Metric,
            habit_id: None,
            daily_target: None,
        },
        _ => NewGoalDetails {
            goal_kind: kind,
            metric_name: None,
            start_value: None,
            target_value: None,
            unit: None,
            direction: None,
            deadline: None,
            progress_source: ProgressSource::Milestones,
            habit_id: None,
            daily_target: None,
        },
    };
    s.goals
        .create(&NewGoal {
            title: title.into(),
            area_id: None,
            details,
        })
        .unwrap()
        .id
}

#[test]
fn the_level_goal_of_a_language_must_be_a_staged_goal() {
    let s = setup();
    let idioma = subject_on(&s, "Inglês", SubjectTrack::Idioma);

    // A ESCADA ("Básico -> Fluente") é aceita.
    let staged = make_goal(&s, "Inglês: Básico -> Fluente", GoalKind::Staged);
    let linked = s
        .studies
        .set_subject_level_goal(&idioma, Some(staged.clone()))
        .unwrap();
    assert_eq!(linked.level_goal_id.as_deref(), Some(staged.as_str()));

    // Uma quantitativa e uma conquista, não: nenhuma das duas tem degraus
    // nomeados, e o card do idioma pediria um nível que a meta não sabe dizer.
    for kind in [GoalKind::Quantitative, GoalKind::Binary] {
        let other = make_goal(&s, &format!("outra {kind:?}"), kind);
        let err = s
            .studies
            .set_subject_level_goal(&idioma, Some(other))
            .unwrap_err();
        assert!(
            format!("{err}").contains("etapas") || format!("{err}").contains("escada"),
            "a mensagem tem que dizer que a meta precisa ser por etapas: {err}"
        );
    }
    // E o vínculo bom continua de pé — a recusa não desfez nada.
    assert_eq!(
        s.studies.subjects(None, None).unwrap()[0]
            .level_goal_id
            .as_deref(),
        Some(staged.as_str())
    );

    // Um id que não é meta nenhuma também é recusado.
    assert!(s
        .studies
        .set_subject_level_goal(&idioma, Some("fantasma".into()))
        .is_err());

    // `None` desfaz o vínculo.
    assert_eq!(
        s.studies
            .set_subject_level_goal(&idioma, None)
            .unwrap()
            .level_goal_id,
        None
    );
}

/* ===== Os itens de uma matéria (0020) ===== */

#[test]
fn a_subject_is_decomposed_into_ordered_themes_that_can_be_ticked_and_deleted() {
    // A lacuna que a 0020 fecha: "Matemática -> regra de 3, Bháskara". A MESMA
    // chamada serve a checklist de conteúdos de um curso — é a mesma forma.
    let s = setup();
    let mat = subject_on(&s, "Matemática", SubjectTrack::Livre);

    let regra = s.studies.add_subject_item(&mat, "Regra de 3").unwrap();
    let bhaskara = s.studies.add_subject_item(&mat, "Bháskara").unwrap();
    let divisao = s.studies.add_subject_item(&mat, "Divisão").unwrap();

    // Nascem por fazer e na ordem em que entraram.
    let items = s.studies.subject_items(&mat).unwrap();
    assert_eq!(
        items.iter().map(|i| i.title.as_str()).collect::<Vec<_>>(),
        vec!["Regra de 3", "Bháskara", "Divisão"]
    );
    assert!(items.iter().all(|i| !i.done));

    // Riscar dois deixa a lista em "2 de 3" — a fração que a tela desenha.
    s.studies.set_subject_item_done(&regra.id, true).unwrap();
    s.studies.set_subject_item_done(&bhaskara.id, true).unwrap();
    let done = s
        .studies
        .subject_items(&mat)
        .unwrap()
        .iter()
        .filter(|i| i.done)
        .count();
    assert_eq!(done, 2);

    // Excluir é um direito, inclusive de um item (ADR-0056).
    s.studies.delete_subject_item(&divisao.id).unwrap();
    assert_eq!(s.studies.subject_items(&mat).unwrap().len(), 2);
}

#[test]
fn an_item_without_a_title_never_reaches_the_database() {
    let s = setup();
    let mat = subject_on(&s, "Matemática", SubjectTrack::Livre);
    assert!(s.studies.add_subject_item(&mat, "   ").is_err());
    assert!(s.studies.subject_items(&mat).unwrap().is_empty());
}

#[test]
fn the_course_summary_round_trips_and_blank_means_absent() {
    // A coluna estava no schema desde a 0017 sem ninguém para escrevê-la.
    let s = setup();
    let curso = subject_on(&s, "Excel do zero", SubjectTrack::Curso);
    assert_eq!(s.studies.subjects(None, None).unwrap()[0].summary, None);

    let with = s
        .studies
        .set_subject_summary(&curso, Some("  Planilhas, do zero ao dinâmico  ".into()))
        .unwrap();
    // O texto chega aparado — e um texto em BRANCO é ausência, não um parágrafo
    // vazio, para o card não desenhar uma linha de descrição com nada dentro.
    assert_eq!(
        with.summary.as_deref(),
        Some("Planilhas, do zero ao dinâmico")
    );
    assert_eq!(
        s.studies
            .set_subject_summary(&curso, Some("   ".into()))
            .unwrap()
            .summary,
        None
    );
}
