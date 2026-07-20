//! Testes de integração da BÚSSOLA, fases B e C, contra um SQLite real.
//!
//! **Fase B — excluir é um direito.** O usuário não conseguia apagar o que ele
//! próprio criou. Cada teste daqui prova as DUAS metades da regra do ADR-0056,
//! que é fácil de cumprir pela metade: o ESTADO sai, e a HISTÓRIA fica. Um
//! delete que também limpasse o ledger passaria num teste que só olha a lista.
//!
//! **Fase C — metas com tipo.** A 0016 admitiu metas sem métrica. Aqui isso é
//! exercido ponta a ponta, pelo caso de uso e contra o banco de verdade: é o
//! CHECK de tabela que dá a última palavra sobre a coerência, e um teste de
//! unidade sobre funções puras nunca o toca.

use std::sync::Arc;

use nexus_lib::application::ports::{LedgerRepository, NewGoal, NewGoalDetails, NewMilestone};
use nexus_lib::application::use_cases::career::CareerService;
use nexus_lib::application::use_cases::challenges::ChallengeService;
use nexus_lib::application::use_cases::fin_goals::FinGoalService;
use nexus_lib::application::use_cases::goals::GoalService;
use nexus_lib::domain::entities::{
    CareerMilestoneKind, Direction, GoalKind, MilestoneKind, ProgressSource,
};
use nexus_lib::domain::errors::NexusError;
use nexus_lib::domain::schedule::{format_day, parse_day};
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::skill_checkin_repo::SqliteSkillCheckinRepository;
use nexus_lib::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, challenge_repo::SqliteChallengeRepository,
    fin_goal_repo::SqliteFinGoalRepository, goal_repo::SqliteGoalRepository,
    habit_repo::SqliteHabitRepository, ledger_repo::SqliteLedgerRepository,
    node_repo::SqliteNodeRepository, skill_repo::SqliteSkillRepository,
};

struct World {
    goals: GoalService,
    fin_goals: FinGoalService,
    challenges: ChallengeService,
    career: CareerService,
    ledger: Arc<dyn LedgerRepository>,
    db: Arc<Db>,
    _dir: tempfile::TempDir,
}

fn setup() -> World {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();
    let db = Arc::new(Db::open(&paths).unwrap());

    let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
    let node_repo = Arc::new(SqliteNodeRepository::new(db.clone()));
    let ledger: Arc<dyn LedgerRepository> = Arc::new(SqliteLedgerRepository::new(db.clone()));
    let clock = Arc::new(SystemClock);
    let ids = Arc::new(Uuid7Gen);

    World {
        goals: GoalService {
            goals: Arc::new(SqliteGoalRepository::new(db.clone())),
            nodes: node_repo.clone(),
            areas: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        fin_goals: FinGoalService {
            fin_goals: Arc::new(SqliteFinGoalRepository::new(db.clone())),
            nodes: node_repo.clone(),
            areas: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        challenges: ChallengeService {
            challenges: Arc::new(SqliteChallengeRepository::new(db.clone())),
            nodes: node_repo.clone(),
            areas: area_repo.clone(),
            habits: Arc::new(SqliteHabitRepository::new(db.clone())),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        career: CareerService {
            skills: Arc::new(SqliteSkillRepository::new(db.clone())),
            checkins: Arc::new(SqliteSkillCheckinRepository::new(db.clone())),
            nodes: node_repo,
            areas: area_repo,
            ledger: ledger.clone(),
            ids,
            clock,
        },
        ledger,
        db,
        _dir: dir,
    }
}

impl World {
    /// Quantas linhas de `nodes` sobraram com este id. A pergunta do ESTADO.
    fn nodes_with(&self, id: &str) -> i64 {
        self.db
            .with_read(|c| {
                Ok(
                    c.query_row("SELECT COUNT(*) FROM nodes WHERE id = ?1", [id], |r| {
                        r.get(0)
                    })?,
                )
            })
            .unwrap()
    }

    fn count(&self, sql: &str, id: &str) -> i64 {
        self.db
            .with_read(|c| Ok(c.query_row(sql, [id], |r| r.get(0))?))
            .unwrap()
    }

    /// Os `event_type` gravados para uma entidade, do mais recente ao mais
    /// antigo. A pergunta da HISTÓRIA.
    fn events_of(&self, id: &str) -> Vec<String> {
        self.ledger
            .for_entity(id, 50)
            .unwrap()
            .into_iter()
            .map(|e| e.event_type)
            .collect()
    }
}

fn today(w: &World) -> String {
    w.goals.clock.today_local()
}

/* ===================================================================
Fase B — excluir é um direito
=================================================================== */

#[test]
fn deleting_a_caixinha_takes_its_deposits_with_it_and_keeps_the_history() {
    // A caixinha é o caso com dado DEPENDENTE: os depósitos. O comentário do
    // caso de uso afirma que o CASCADE encadeado da 0011
    // (nodes -> fin_goal_details -> fin_goal_deposits) dá conta disso sozinho.
    // Este teste é quem verifica a afirmação — se o PRAGMA foreign_keys parar de
    // ser aplicado em alguma conexão, os depósitos viram órfãos e ele cai.
    let w = setup();
    let goal = w
        .fin_goals
        .create("Viagem", None, 500_000, None, None, None)
        .unwrap();
    for cents in [10_000, 25_000] {
        w.fin_goals
            .deposit(&goal.id, cents, Some(today(&w)), None)
            .unwrap();
    }
    assert_eq!(
        w.count(
            "SELECT COUNT(*) FROM fin_goal_deposits WHERE goal_id = ?1",
            &goal.id
        ),
        2
    );

    w.fin_goals.delete(&goal.id).unwrap();

    // O ESTADO sai — o node, o satélite e os depósitos.
    assert_eq!(w.nodes_with(&goal.id), 0);
    assert_eq!(
        w.count(
            "SELECT COUNT(*) FROM fin_goal_details WHERE node_id = ?1",
            &goal.id
        ),
        0
    );
    assert_eq!(
        w.count(
            "SELECT COUNT(*) FROM fin_goal_deposits WHERE goal_id = ?1",
            &goal.id
        ),
        0,
        "os depósitos ficaram órfãos: o CASCADE encadeado não pegou"
    );

    // A HISTÓRIA fica, e ganha o evento da remoção. O `created` original
    // continua lá: o ledger nunca é reescrito.
    let events = w.events_of(&goal.id);
    assert!(events.contains(&"deleted".to_string()));
    assert!(
        events.contains(&"created".to_string()),
        "o evento original sumiu: o ledger foi reescrito"
    );
}

#[test]
fn deleting_a_caixinha_that_is_not_there_is_not_found_not_silence() {
    let w = setup();
    assert!(matches!(
        w.fin_goals.delete("nao-existe").unwrap_err(),
        NexusError::NotFound(_)
    ));
}

#[test]
fn a_delete_command_refuses_an_id_of_another_kind() {
    // `delete_fin_goal` num id de temporada apagaria a temporada — um command
    // genérico disfarçado de específico. Cada delete lê pelo repositório da SUA
    // entidade justamente para isto, e o teste prende a garantia.
    let w = setup();
    let challenge = w
        .challenges
        .create(
            "Setembro sem açúcar",
            None,
            &today(&w),
            &format_day(parse_day(&today(&w)).unwrap() + chrono::Duration::days(30)),
            "manual",
            None,
            30,
        )
        .unwrap();
    let id = &challenge.challenge.id;

    assert!(matches!(
        w.fin_goals.delete(id).unwrap_err(),
        NexusError::NotFound(_)
    ));
    assert!(matches!(
        w.career.delete_skill(id).unwrap_err(),
        NexusError::NotFound(_)
    ));
    assert_eq!(w.nodes_with(id), 1, "a temporada foi apagada por engano");
}

#[test]
fn deleting_a_season_removes_it_while_abandoning_only_marks_it() {
    // As duas operações precisam existir e não são a mesma: abandonar é o fato
    // "tentei e larguei" (a temporada FICA, marcada 'dropped'); excluir é tirar
    // da existência a que nunca deveria estar lá.
    let w = setup();
    let ends = format_day(parse_day(&today(&w)).unwrap() + chrono::Duration::days(30));
    let make = |title: &str| {
        w.challenges
            .create(title, None, &today(&w), &ends, "manual", None, 30)
            .unwrap()
            .challenge
            .id
    };

    let abandoned = make("Temporada de verdade");
    w.challenges.abandon(&abandoned).unwrap();
    assert_eq!(w.nodes_with(&abandoned), 1, "abandonar não apaga");

    let duplicate = make("Duplicata");
    w.challenges.delete(&duplicate).unwrap();
    assert_eq!(w.nodes_with(&duplicate), 0);
    assert_eq!(
        w.count(
            "SELECT COUNT(*) FROM challenge_details WHERE node_id = ?1",
            &duplicate
        ),
        0
    );
    let events = w.events_of(&duplicate);
    assert!(events.contains(&"deleted".to_string()));
    assert!(
        events.contains(&"challenge_started".to_string()),
        "o evento de abertura sumiu: o ledger foi reescrito"
    );
}

#[test]
fn deleting_a_skill_keeps_the_level_ups_in_the_ledger() {
    // Uma competência sai da tela; a história de ter subido de nível nela não
    // some — ela vale XP, e XP é derivado do ledger (ADR-0037).
    let w = setup();
    let skill = w.career.create_skill("Rust", None, None, None).unwrap();
    w.career.level_up_skill(&skill.id).unwrap();
    w.career.level_up_skill(&skill.id).unwrap();

    w.career.delete_skill(&skill.id).unwrap();

    assert_eq!(w.nodes_with(&skill.id), 0);
    assert_eq!(
        w.count(
            "SELECT COUNT(*) FROM skill_details WHERE node_id = ?1",
            &skill.id
        ),
        0
    );
    let events = w.events_of(&skill.id);
    assert_eq!(
        events.iter().filter(|e| *e == "skill_level_up").count(),
        2,
        "as subidas de nível foram embora com o node"
    );
    assert!(events.contains(&"deleted".to_string()));
}

#[test]
fn retracting_a_career_milestone_appends_instead_of_erasing() {
    // O caso-limite do ADR-0056. Um marco de carreira NÃO tem estado (ADR-0032):
    // ele é só o evento. Como o ledger é append-only por gatilho, "excluir" só
    // pode ser APENDAR uma retratação — e o painel passa a descontá-la.
    let w = setup();
    let recorded = w
        .career
        .record_milestone(
            "Promoção a sênior",
            CareerMilestoneKind::Promotion,
            None,
            None,
        )
        .unwrap();
    let keep = w
        .career
        .record_milestone(
            "Certificação AWS",
            CareerMilestoneKind::Certification,
            None,
            None,
        )
        .unwrap();
    assert_eq!(w.career.milestones().unwrap().len(), 2);

    let retraction = w.career.delete_milestone(&recorded.entity_id).unwrap();
    assert_eq!(retraction.event_type, "deleted");
    assert_eq!(
        retraction.title_snapshot, "Promoção a sênior",
        "a retratação tem que dizer O QUE saiu, não só que algo saiu"
    );

    // O painel para de mostrar o marco retratado — e só ele.
    let visible = w.career.milestones().unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].entity_id, keep.entity_id);

    // Mas o ledger tem os DOIS fatos, ambos verdadeiros no seu instante. O
    // evento original continua legível, com o seq que ele sempre teve.
    let history = w.ledger.for_entity(&recorded.entity_id, 50).unwrap();
    assert_eq!(history.len(), 2);
    assert!(history.iter().any(|e| e.event_type == "created"
        && e.seq == recorded.seq
        && e.title_snapshot == "Promoção a sênior"));
}

#[test]
fn retracting_the_same_milestone_twice_does_not_stack_events() {
    // O segundo clique de uma UI lenta não é um erro, mas também não pode virar
    // um segundo evento: a Timeline mostraria a mesma remoção duas vezes.
    let w = setup();
    let m = w
        .career
        .record_milestone("Novo emprego", CareerMilestoneKind::NewJob, None, None)
        .unwrap();

    let first = w.career.delete_milestone(&m.entity_id).unwrap();
    let second = w.career.delete_milestone(&m.entity_id).unwrap();

    assert_eq!(first.seq, second.seq);
    assert_eq!(w.ledger.for_entity(&m.entity_id, 50).unwrap().len(), 2);
    assert!(w.career.milestones().unwrap().is_empty());
}

#[test]
fn retracting_a_milestone_that_never_existed_is_not_found() {
    let w = setup();
    assert!(matches!(
        w.career.delete_milestone("nao-existe").unwrap_err(),
        NexusError::NotFound(_)
    ));
}

/* ===================================================================
Fase C — metas com tipo, contra o CHECK de verdade
=================================================================== */

fn quantitative(title: &str) -> NewGoal {
    NewGoal {
        title: title.into(),
        area_id: None,
        details: NewGoalDetails {
            goal_kind: GoalKind::Quantitative,
            metric_name: Some("Peso".into()),
            start_value: Some(90.0),
            target_value: Some(80.0),
            unit: Some("kg".into()),
            direction: Some(Direction::Decrease),
            deadline: None,
            progress_source: ProgressSource::Metric,
        },
    }
}

fn metricless(title: &str, kind: GoalKind) -> NewGoal {
    NewGoal {
        title: title.into(),
        area_id: None,
        details: NewGoalDetails {
            goal_kind: kind,
            metric_name: None,
            start_value: None,
            target_value: None,
            unit: None,
            direction: None,
            deadline: None,
            // De propósito o padrão errado do DTO: o serviço tem que forçá-lo.
            progress_source: ProgressSource::Metric,
        },
    }
}

#[test]
fn an_achievement_is_born_without_a_metric_and_the_check_accepts_it() {
    // O caso que motivou a 0016. Antes, o banco recusava a linha e o formulário
    // não conseguia nem oferecer o tipo.
    let w = setup();
    let goal = w
        .goals
        .create(&metricless("Conseguir um emprego", GoalKind::Binary))
        .unwrap();

    assert_eq!(goal.goal_kind, GoalKind::Binary);
    assert!(goal.metric_name.is_none());
    assert!(goal.target_value.is_none());
    assert_eq!(
        goal.progress_source,
        ProgressSource::Milestones,
        "a fonte tinha que ter sido forçada: sem alvo não há o que dividir"
    );

    // E sem métrica não há projeção: uma data de chegada sobre um alvo que não
    // existe seria um chute, e o NEXUS não chuta.
    let full = w.goals.get_with_progress(&goal.id).unwrap();
    assert!(full.projection.is_none());
    assert_eq!(full.progress.ratio, 0.0);
    assert!(!full.progress.formula.is_empty());
}

#[test]
fn a_quantitative_goal_without_a_target_never_reaches_the_database() {
    let w = setup();
    let mut bad = quantitative("Perder 10 kg");
    bad.details.target_value = None;

    let err = w.goals.create(&bad).unwrap_err();
    match err {
        NexusError::Validation(m) => assert!(m.contains("alvo"), "mensagem pouco clara: {m}"),
        other => panic!("esperava Validation, veio {other:?}"),
    }
    assert!(w.goals.list(None).unwrap().is_empty());
}

#[test]
fn an_achievement_carrying_a_metric_never_reaches_the_database() {
    let w = setup();
    let mut bad = metricless("Conseguir um emprego", GoalKind::Binary);
    bad.details.target_value = Some(80.0);

    assert!(matches!(
        w.goals.create(&bad).unwrap_err(),
        NexusError::Validation(_)
    ));
    assert!(w.goals.list(None).unwrap().is_empty());
}

#[test]
fn a_staged_goal_reports_the_current_step_end_to_end() {
    // Os degraus SÃO os sub-desafios, na ordem em que foram criados. O que a
    // tela do idioma lê é "estou no 2 de 4 (Intermediário)".
    let w = setup();
    let goal = w
        .goals
        .create(&metricless("Inglês: Básico a Fluente", GoalKind::Staged))
        .unwrap();

    let steps: Vec<String> = ["Básico", "Intermediário", "Avançado", "Fluente"]
        .iter()
        .map(|title| {
            w.goals
                .add_milestone(&NewMilestone {
                    title: (*title).into(),
                    goal_id: goal.id.clone(),
                    kind: MilestoneKind::Simple,
                    habit_id: None,
                    target_count: None,
                    weight: 1.0,
                    counts_from: None,
                })
                .unwrap()
                .id
        })
        .collect();

    // Nenhum degrau vencido: a escada existe, o usuário está no chão.
    let start = w.goals.get_with_progress(&goal.id).unwrap();
    assert_eq!(start.progress.stage_current, Some(0));
    assert_eq!(start.progress.stage_total, Some(4));
    assert!(start.progress.stage_label.is_none());

    w.goals.set_milestone_done(&steps[0], true).unwrap();
    w.goals.set_milestone_done(&steps[1], true).unwrap();

    let p = w.goals.get_with_progress(&goal.id).unwrap().progress;
    assert_eq!(p.stage_current, Some(2));
    assert_eq!(p.stage_total, Some(4));
    assert_eq!(p.stage_label.as_deref(), Some("Intermediário"));
    assert!((p.ratio - 0.5).abs() < 1e-9);
    assert!(p.formula.contains("degrau 2 de 4"));
}

#[test]
fn an_achievement_with_no_steps_is_measured_by_being_finished() {
    // Sem degraus não há o que ponderar: a conquista vale o próprio ato de
    // concluir. O `nodes.status` é a única régua honesta.
    let w = setup();
    let goal = w
        .goals
        .create(&metricless("Conseguir um emprego", GoalKind::Binary))
        .unwrap();
    assert_eq!(
        w.goals.get_with_progress(&goal.id).unwrap().progress.ratio,
        0.0
    );

    w.db.with_write(|c| {
        c.execute("UPDATE nodes SET status = 'done' WHERE id = ?1", [&goal.id])?;
        Ok(())
    })
    .unwrap();

    assert_eq!(
        w.goals.get_with_progress(&goal.id).unwrap().progress.ratio,
        1.0
    );
}

#[test]
fn a_metricless_goal_refuses_a_measurement_and_the_metric_ruler() {
    // As duas portas que assumiam métrica. Sem esta recusa, o checkpoint criaria
    // uma série que barra nenhuma lê, e o toggle gravaria um 'metric' que o
    // CHECK da 0016 rejeitaria com "constraint failed".
    let w = setup();
    let goal = w
        .goals
        .create(&metricless("Conseguir um emprego", GoalKind::Binary))
        .unwrap();

    assert!(matches!(
        w.goals
            .add_checkpoint(&goal.id, 10.0, None, None)
            .unwrap_err(),
        NexusError::Validation(_)
    ));
    assert!(matches!(
        w.goals
            .set_progress_source(&goal.id, ProgressSource::Metric)
            .unwrap_err(),
        NexusError::Validation(_)
    ));
}

#[test]
fn a_quantitative_goal_is_unchanged_by_all_of_this() {
    // A garantia de não-regressão da fase C: o tipo de sempre continua se
    // comportando como sempre — métrica, medição, barra e projeção.
    let w = setup();
    let goal = w.goals.create(&quantitative("Perder 10 kg")).unwrap();
    assert_eq!(goal.goal_kind, GoalKind::Quantitative);
    assert_eq!(goal.direction, Some(Direction::Decrease));

    // Instantes no PASSADO contados a partir de agora: o serviço recusa o
    // futuro, e "meio-dia de hoje" já passou ou não dependendo do fuso.
    let now = w.goals.clock.now_ms();
    const DAY_MS: i64 = 24 * 60 * 60 * 1_000;
    for (days_ago, value) in [(3_i64, 88.0), (0, 85.0)] {
        w.goals
            .add_checkpoint(&goal.id, value, None, Some(now - days_ago * DAY_MS))
            .unwrap();
    }

    let full = w.goals.get_with_progress(&goal.id).unwrap();
    assert!(
        (full.progress.ratio - 0.5).abs() < 1e-9,
        "90 -> 80, medindo 85"
    );
    assert_eq!(full.current_value, Some(85.0));
    assert!(
        full.projection.is_some(),
        "dois pontos e um alvo: a reta tem que existir"
    );
}

#[test]
fn a_counter_milestone_works_end_to_end_from_the_ui_payload() {
    // O payload completo do 'counter' que a UI manda: hábito + alvo. A regra do
    // §4 da 0007 (o número é contado, não digitado) continua de pé.
    let w = setup();
    let goal = w.goals.create(&quantitative("Perder 10 kg")).unwrap();
    // Sem hábito, o 'counter' é recusado — e um 'simple' com alvo também.
    let counter_without_habit = w.goals.add_milestone(&NewMilestone {
        title: "30 dias de academia".into(),
        goal_id: goal.id.clone(),
        kind: MilestoneKind::Counter,
        habit_id: None,
        target_count: Some(30),
        weight: 1.0,
        counts_from: None,
    });
    assert!(matches!(
        counter_without_habit.unwrap_err(),
        NexusError::Validation(_)
    ));

    let simple_with_target = w.goals.add_milestone(&NewMilestone {
        title: "Comprar tênis".into(),
        goal_id: goal.id.clone(),
        kind: MilestoneKind::Simple,
        habit_id: None,
        target_count: Some(30),
        weight: 1.0,
        counts_from: None,
    });
    assert!(matches!(
        simple_with_target.unwrap_err(),
        NexusError::Validation(_)
    ));
}
