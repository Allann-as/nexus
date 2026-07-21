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
use nexus_lib::application::use_cases::habits::HabitService;
use nexus_lib::application::use_cases::nodes::NodeService;
use nexus_lib::domain::entities::{
    CareerMilestoneKind, Direction, GoalKind, MilestoneKind, ProgressSource,
};
use nexus_lib::domain::errors::NexusError;
use nexus_lib::domain::schedule::{format_day, parse_day, Schedule};
use nexus_lib::domain::streak::TickStatus;
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
    /// A constância é um HÁBITO por baixo (ADR-0077): sem o serviço de hábitos
    /// não há como marcar um dia, e sem marcar um dia não há o que testar.
    habits: HabitService,
    /// Apagar um hábito é apagar um NODE — a operação é a mesma para todas as
    /// 16 espécies (ADR-0056), e é por ela que se prova que a meta sobrevive.
    nodes: NodeService,
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

    let habit_repo = Arc::new(SqliteHabitRepository::new(db.clone()));

    World {
        goals: GoalService {
            goals: Arc::new(SqliteGoalRepository::new(db.clone())),
            nodes: node_repo.clone(),
            areas: area_repo.clone(),
            habits: habit_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        habits: HabitService {
            habits: habit_repo,
            nodes: node_repo.clone(),
            areas: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        },
        nodes: NodeService {
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
COCKPIT fase 3c — a CLASSE do defeito que a 0018 achou

A 0018 consertou TRÊS colunas `habit_id`. Mas o defeito não era das três: era
da FORMA `REFERENCES nodes(id)` escrita sem cláusula `ON DELETE`, que o SQLite
lê como NO ACTION — *"recuse apagar o pai"*. Enquanto essa forma existir em
alguma coluna viva, existe um caminho pelo qual o usuário clica em "excluir" e
recebe `FOREIGN KEY constraint failed`.

Os testes daqui atacam a forma, não os casos: o primeiro varre o schema inteiro
e não deixa a próxima coluna nascer errada; os demais exercem os três caminhos
que a varredura encontrou.
=================================================================== */

/// Toda FK que aponta para `nodes` declara o que fazer quando o node sai.
///
/// `nodes` é a tabela das 16 espécies que o usuário cria — e portanto a única
/// cujas linhas ele apaga com um clique. Uma FK NO ACTION para cá é um botão de
/// excluir que o banco recusa. (`areas` e `accounts` ficam de fora de propósito:
/// nenhuma das duas tem caminho de exclusão — a área se arquiva, e as contas são
/// semeadas pela migration. No dia em que alguma ganhar um delete, esta guarda
/// precisa crescer junto.)
#[test]
fn no_foreign_key_to_a_node_refuses_the_delete() {
    let w = setup();
    let offenders: Vec<String> =
        w.db.with_read(|c| {
            let mut tables = c.prepare(
                "SELECT name FROM sqlite_master
                  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            )?;
            let names: Vec<String> = tables
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<_>>()?;

            let mut found = Vec::new();
            for table in names {
                let mut fks = c.prepare(&format!("PRAGMA foreign_key_list('{table}')"))?;
                let rows: Vec<(String, String, String)> = fks
                    .query_map([], |r| {
                        Ok((
                            r.get::<_, String>(2)?, // tabela referenciada
                            r.get::<_, String>(3)?, // coluna daqui
                            r.get::<_, String>(6)?, // on_delete
                        ))
                    })?
                    .collect::<rusqlite::Result<_>>()?;
                for (target, column, on_delete) in rows {
                    if target == "nodes" && on_delete == "NO ACTION" {
                        found.push(format!("{table}.{column}"));
                    }
                }
            }
            Ok(found)
        })
        .unwrap();

    assert!(
        offenders.is_empty(),
        "estas colunas recusam o DELETE do node que elas apontam, \
         e o usuário vê 'FOREIGN KEY constraint failed': {offenders:?}"
    );
}

#[test]
fn deleting_a_project_takes_its_tasks_with_it_and_records_each_one() {
    // `nodes.parent_id` é a FK NO ACTION mais antiga do schema (0001) e a de
    // maior alcance: ela liga projeto→tarefa, matéria→tema (ADR-0077) e
    // objetivo→sub-desafio. Apagar qualquer pai falhava com o erro de storage.
    //
    // A escolha aqui não é `ON DELETE CASCADE` sozinho: um CASCADE silencioso
    // apagaria as tarefas SEM evento no ledger, e a história de que elas
    // existiram sumiria com elas — o oposto do ADR-0056. O serviço desce a
    // árvore, apenda um `deleted` por node e apaga tudo numa transação só.
    let w = setup();
    let project = w
        .nodes
        .create(
            nexus_lib::domain::entities::Kind::Project,
            "Reforma",
            None,
            None,
        )
        .unwrap();
    let tasks: Vec<String> = ["Orçamento", "Pintura"]
        .iter()
        .map(|t| {
            w.nodes
                .create(
                    nexus_lib::domain::entities::Kind::Task,
                    t,
                    None,
                    Some(&project.id),
                )
                .unwrap()
                .id
        })
        .collect();
    // Um neto, para provar que a descida é recursiva e não de um nível só.
    let subtask = w
        .nodes
        .create(
            nexus_lib::domain::entities::Kind::Task,
            "Comprar tinta",
            None,
            Some(&tasks[1]),
        )
        .unwrap()
        .id;

    w.nodes.delete(&project.id).unwrap();

    // O ESTADO sai inteiro — nada de tarefa órfã boiando na lista.
    for id in [&project.id, &tasks[0], &tasks[1], &subtask] {
        assert_eq!(w.nodes_with(id), 0, "sobrou o node {id}");
    }

    // E a HISTÓRIA de cada uma fica, com o próprio `deleted`.
    for id in [&tasks[0], &tasks[1], &subtask] {
        let events = w.events_of(id);
        assert!(
            events.contains(&"deleted".to_string()),
            "a tarefa {id} sumiu sem o ledger registrar"
        );
        assert!(events.contains(&"created".to_string()));
    }
}

#[test]
fn deleting_a_routine_leaves_its_habits_standing() {
    // `habit_details.routine_id` (0001). O caso é o espelho do projeto: a rotina
    // é um AGRUPAMENTO, e o hábito existe fora dela. Apagar a "Rotina da manhã"
    // não pode apagar "Beber água" — nem ser recusado por causa dele.
    let w = setup();
    let routine = w.habits.create_routine("Rotina da manhã", None).unwrap();
    let habit = w
        .habits
        .create(
            "Beber água",
            None,
            Schedule::Daily,
            None,
            None,
            Some(routine.clone()),
            None,
        )
        .unwrap()
        .id;

    w.nodes.delete(&routine).unwrap();

    assert_eq!(w.nodes_with(&routine), 0);
    assert_eq!(w.nodes_with(&habit), 1, "o hábito foi junto com a rotina");
    assert!(
        w.habits.habits.get(&habit).unwrap().routine_id.is_none(),
        "o vínculo tinha que ir a NULL"
    );
}

#[test]
fn deleting_the_ladder_goal_of_a_language_leaves_the_language() {
    // `subject_details.level_goal_id` (0016). Um idioma guarda QUAL meta é a
    // escada dele. Apagar essa meta pela tela de Metas não pode ser recusada
    // porque um idioma aponta para ela — o idioma só volta a ficar sem escada.
    let w = setup();
    let goal = w
        .goals
        .create(&metricless("Inglês: Básico a Fluente", GoalKind::Staged))
        .unwrap();
    let subject = w
        .nodes
        .create(
            nexus_lib::domain::entities::Kind::Subject,
            "Inglês",
            None,
            None,
        )
        .unwrap();
    w.db.with_write(|c| {
        c.execute(
            "INSERT INTO subject_details (node_id, track, level_goal_id)
             VALUES (?1, 'idioma', ?2)",
            rusqlite::params![subject.id, goal.id],
        )?;
        Ok(())
    })
    .unwrap();

    // Uma meta se apaga como todo node se apaga — é o `delete_node` que a tela
    // de Metas chama.
    w.nodes.delete(&goal.id).unwrap();

    assert_eq!(
        w.nodes_with(&subject.id),
        1,
        "o idioma foi junto com a meta"
    );
    assert_eq!(
        w.count(
            "SELECT COUNT(*) FROM subject_details
              WHERE node_id = ?1 AND level_goal_id IS NULL",
            &subject.id
        ),
        1,
        "a escada tinha que ir a NULL"
    );
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
            habit_id: None,
            daily_target: None,
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
            habit_id: None,
            daily_target: None,
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

/* ===================================================================
COCKPIT fase 3b — a CONSTÂNCIA, contra o CHECK da 0017 e contra os ticks
=================================================================== */

/// Uma constância como o formulário a manda: alvo, unidade, e o hábito que a
/// alimenta. Sem métrica e sem partida — ela começa em zero e acumula.
fn constancia(title: &str, target: f64, unit: &str, daily: Option<f64>, habit: &str) -> NewGoal {
    NewGoal {
        title: title.into(),
        area_id: None,
        details: NewGoalDetails {
            goal_kind: GoalKind::Constancia,
            metric_name: None,
            start_value: None,
            target_value: Some(target),
            unit: Some(unit.into()),
            direction: None,
            deadline: None,
            progress_source: ProgressSource::Metric,
            habit_id: Some(habit.into()),
            daily_target: daily,
        },
    }
}

/// Um hábito diário, que é o que uma constância sempre precisa por baixo.
fn daily_habit(w: &World, title: &str) -> String {
    w.habits
        .create(title, None, Schedule::Daily, None, None, None, None)
        .unwrap()
        .id
}

/// Retrocede a CRIAÇÃO de uma meta em N dias.
///
/// Existe porque o piso de uma constância é o dia em que ela foi criada
/// (`nodes.created_at`, a lição do `counts_from` da 0009 sem coluna nova): sem
/// retroceder, um teste só consegue marcar HOJE, e nenhuma série de vários dias
/// seria testável. É a mesma manobra que o teste da conquista concluída faz com
/// `nodes.status` — o fixture escreve o passado, e o serviço o lê.
fn born_days_ago(w: &World, goal_id: &str, days: i64) {
    let ms = (chrono::Local::now() - chrono::Duration::days(days)).timestamp_millis();
    w.db.with_write(|c| {
        c.execute(
            "UPDATE nodes SET created_at = ?2 WHERE id = ?1",
            rusqlite::params![goal_id, ms],
        )?;
        Ok(())
    })
    .unwrap();
}

#[test]
fn a_constancia_accumulates_the_ticks_of_the_habit_that_feeds_it() {
    // O teste que prova o ADR-0077 inteiro: NÃO há tabela nova e NÃO há um
    // segundo lugar onde registrar. Marcar o hábito nos Checkpoints do dia é o
    // que move a meta — e é por isso que a meta e o checklist diário nunca
    // discordam.
    let w = setup();
    let habit = daily_habit(&w, "Guardar dinheiro");
    let goal = w
        .goals
        .create(&constancia(
            "Guardar R$ 10 por dia",
            300.0,
            "R$",
            Some(10.0),
            &habit,
        ))
        .unwrap();

    // A direção é derivada, não perguntada: uma constância só anda para frente.
    assert_eq!(goal.direction, Some(Direction::Increase));
    assert_eq!(goal.daily_target, Some(10.0));
    assert_eq!(goal.habit_id.as_deref(), Some(habit.as_str()));

    // Zero dias: a barra é zero, mas a leitura já se explica.
    let start = w.goals.get_with_progress(&goal.id).unwrap();
    let c0 = start.constancia.as_ref().expect("uma constância tem série");
    assert_eq!(c0.accumulated, 0.0);
    assert_eq!(c0.days_marked, 0);
    assert_eq!(c0.habit_id.as_deref(), Some(habit.as_str()));

    // A meta existe há uma semana, para haver dias dentro da janela dela.
    born_days_ago(&w, &goal.id, 7);

    // Três dias: dois no combinado (marcados sem digitar) e um com valor.
    let today = chrono::Local::now().date_naive();
    for (back, value) in [(2i64, None), (1, Some(30.0)), (0, None)] {
        let day = format_day(today - chrono::Duration::days(back));
        w.habits
            .tick(&habit, Some(&day), TickStatus::Done, value)
            .unwrap();
    }

    let full = w.goals.get_with_progress(&goal.id).unwrap();
    let c = full.constancia.expect("uma constância tem série");
    // 10 (combinado) + 30 (digitado) + 10 (combinado) = 50.
    assert_eq!(c.accumulated, 50.0);
    assert_eq!(c.days_marked, 3);
    assert_eq!(c.days.len(), 3);
    assert!((full.progress.ratio - 50.0 / 300.0).abs() < 1e-9);
    assert!(full.progress.formula.contains("3 dias marcados"));

    // A série do heatmap sai em ordem, e o dia com valor carrega o valor dele.
    assert!(c.days.iter().all(|d| d.status == "done"));
    assert_eq!(c.days.iter().map(|d| d.value).sum::<f64>(), 50.0);
}

#[test]
fn a_constancia_without_a_daily_target_counts_days() {
    // "30 dias sem fritura": a unidade É o dia, e um valor no tick não muda isso.
    let w = setup();
    let habit = daily_habit(&w, "Sem fritura");
    let goal = w
        .goals
        .create(&constancia(
            "30 dias sem fritura",
            30.0,
            "dias",
            None,
            &habit,
        ))
        .unwrap();
    assert!(goal.daily_target.is_none());
    born_days_ago(&w, &goal.id, 7);

    let today = chrono::Local::now().date_naive();
    for back in 0..3i64 {
        w.habits
            .tick(
                &habit,
                Some(&format_day(today - chrono::Duration::days(back))),
                TickStatus::Done,
                None,
            )
            .unwrap();
    }

    let full = w.goals.get_with_progress(&goal.id).unwrap();
    let c = full.constancia.unwrap();
    assert_eq!(c.accumulated, 3.0, "três dias são três, não três reais");
    assert!((full.progress.ratio - 0.1).abs() < 1e-9);
}

#[test]
fn a_constancia_does_not_count_the_habits_past_life() {
    // A lição do `counts_from` da 0009, agora sem coluna nova: o piso é o dia em
    // que a META foi criada. Sem ele, uma constância criada hoje sobre um hábito
    // com meses de histórico nasceria completa — um desafio ganho sem se fazer
    // nada.
    let w = setup();
    let habit = daily_habit(&w, "Guardar dinheiro");

    let today = chrono::Local::now().date_naive();
    for back in 1..=5i64 {
        w.habits
            .tick(
                &habit,
                Some(&format_day(today - chrono::Duration::days(back))),
                TickStatus::Done,
                None,
            )
            .unwrap();
    }

    // A meta nasce DEPOIS dos cinco dias.
    let goal = w
        .goals
        .create(&constancia("30 dias seguidos", 30.0, "dias", None, &habit))
        .unwrap();
    let c = w
        .goals
        .get_with_progress(&goal.id)
        .unwrap()
        .constancia
        .unwrap();

    assert_eq!(c.counts_from, format_day(today));
    assert_eq!(
        c.days_marked, 0,
        "os cinco dias anteriores à meta não são progresso dela"
    );
    assert_eq!(c.accumulated, 0.0);
}

#[test]
fn a_skipped_day_shows_up_but_does_not_accumulate() {
    // Pulado é um FATO — ele aparece no heatmap. O que ele não é é progresso.
    let w = setup();
    let habit = daily_habit(&w, "Guardar dinheiro");
    let goal = w
        .goals
        .create(&constancia("Guardar", 300.0, "R$", Some(10.0), &habit))
        .unwrap();
    born_days_ago(&w, &goal.id, 7);

    let today = chrono::Local::now().date_naive();
    w.habits
        .tick(
            &habit,
            Some(&format_day(today - chrono::Duration::days(1))),
            TickStatus::Skipped,
            None,
        )
        .unwrap();
    w.habits
        .tick(&habit, Some(&format_day(today)), TickStatus::Done, None)
        .unwrap();

    let c = w
        .goals
        .get_with_progress(&goal.id)
        .unwrap()
        .constancia
        .unwrap();
    assert_eq!(c.days.len(), 2, "o dia pulado está na série");
    assert_eq!(c.days_marked, 1);
    assert_eq!(c.accumulated, 10.0);
    let skipped = c.days.iter().find(|d| d.status == "skipped").unwrap();
    assert_eq!(skipped.value, 0.0);
}

#[test]
fn a_constancia_is_not_measured_with_a_measurement() {
    // Ela TEM unidade e alvo, então passaria pela guarda de `add_checkpoint` —
    // e escreveria uma série paralela que barra nenhuma lê. São dois números
    // dizendo a mesma coisa, que é exatamente o que o ADR-0077 evitou.
    let w = setup();
    let habit = daily_habit(&w, "Guardar dinheiro");
    let goal = w
        .goals
        .create(&constancia("Guardar", 300.0, "R$", Some(10.0), &habit))
        .unwrap();

    let err = w
        .goals
        .add_checkpoint(&goal.id, 50.0, None, None)
        .unwrap_err();
    match err {
        NexusError::Validation(m) => assert!(m.contains("marcando o dia"), "mensagem opaca: {m}"),
        other => panic!("esperava Validation, veio {other:?}"),
    }
    assert!(w
        .goals
        .get_with_progress(&goal.id)
        .unwrap()
        .checkpoints
        .is_empty());
}

#[test]
fn a_habit_that_feeds_a_constancia_can_still_be_deleted() {
    // O teste que ACHOU o defeito da 0018. Antes dela, isto devolvia
    // `Storage("FOREIGN KEY constraint failed")`: a promessa do ADR-0077 — a
    // meta sobrevive ao hábito — era inalcançável, porque o hábito não podia ser
    // apagado. `ON DELETE SET NULL` desfaz o vínculo e deixa as duas de pé.
    let w = setup();
    let habit = daily_habit(&w, "Guardar dinheiro");
    let goal = w
        .goals
        .create(&constancia("Guardar", 300.0, "R$", Some(10.0), &habit))
        .unwrap();
    w.habits
        .tick(
            &habit,
            Some(&format_day(chrono::Local::now().date_naive())),
            TickStatus::Done,
            None,
        )
        .unwrap();

    w.nodes.delete(&habit).unwrap();

    let full = w.goals.get_with_progress(&goal.id).unwrap();
    let c = full
        .constancia
        .expect("a meta continua sendo uma constância");
    assert!(
        c.habit_id.is_none(),
        "o vínculo tinha que ter ido a NULL, não segurado o hábito"
    );
    assert!(c.days.is_empty());
    assert!(full.progress.formula.contains("não tem um hábito ligado"));
    assert_eq!(
        w.goals.list(None).unwrap().len(),
        1,
        "a meta sobrevive ao hábito"
    );
    // E ela volta a andar assim que outro hábito é ligado — é o "+ Ligar hábito"
    // da tela de detalhe fazendo o conserto.
    let outro = daily_habit(&w, "Guardar de novo");
    assert_eq!(
        w.goals
            .set_habit(&goal.id, Some(&outro))
            .unwrap()
            .habit_id
            .as_deref(),
        Some(outro.as_str())
    );
}

#[test]
fn a_habit_that_feeds_a_counted_sub_challenge_can_be_deleted_too() {
    // O MESMO defeito, e ele não nasceu na 0017: `milestone_details.habit_id`
    // tem a mesma forma de FK desde a 0007. Apagar o hábito "Academia" com um
    // sub-desafio "30 dias de academia" pendurado nele falhava com
    // `FOREIGN KEY constraint failed` — em contradição direta com a fase B da
    // BÚSSOLA (ADR-0056), que prometeu que excluir é um direito.
    let w = setup();
    let habit = daily_habit(&w, "Academia");
    let goal = w.goals.create(&quantitative("Perder 10 kg")).unwrap();
    let sub = w
        .goals
        .add_milestone(&NewMilestone {
            title: "30 dias de academia".into(),
            goal_id: goal.id.clone(),
            kind: MilestoneKind::Counter,
            habit_id: Some(habit.clone()),
            target_count: Some(30),
            weight: 1.0,
            counts_from: None,
        })
        .unwrap();

    w.nodes.delete(&habit).unwrap();

    // O contador sobrevive ao hábito, parado — e a leitura não explode.
    let full = w.goals.get_with_progress(&goal.id).unwrap();
    let m = full
        .milestones
        .iter()
        .find(|m| m.milestone.id == sub.id)
        .unwrap();
    assert!(
        m.milestone.habit_id.is_none(),
        "o vínculo tinha que ir a NULL"
    );
    assert_eq!(m.ratio, 0.0);
    assert!(
        m.milestone.current_count.is_none(),
        "sem hábito, não conta nada"
    );
}

#[test]
fn a_habit_can_be_linked_and_unlinked_but_only_on_a_constancia() {
    // O "+ Ligar hábito" da tela de detalhe, e o conserto do caso acima.
    let w = setup();
    let habit = daily_habit(&w, "Guardar dinheiro");
    let other = daily_habit(&w, "Guardar mais");
    let goal = w
        .goals
        .create(&constancia("Guardar", 300.0, "R$", Some(10.0), &habit))
        .unwrap();

    let relinked = w.goals.set_habit(&goal.id, Some(&other)).unwrap();
    assert_eq!(relinked.habit_id.as_deref(), Some(other.as_str()));

    let unlinked = w.goals.set_habit(&goal.id, None).unwrap();
    assert!(unlinked.habit_id.is_none());
    let full = w.goals.get_with_progress(&goal.id).unwrap();
    assert!(full.constancia.as_ref().unwrap().habit_id.is_none());
    assert!(full.progress.formula.contains("não tem um hábito ligado"));

    // Numa meta que não é constância a coluna nem existe (o CHECK da 0017 a
    // proíbe): o serviço recusa antes de o banco recusar.
    let plain = w
        .goals
        .create(&metricless("Conseguir um emprego", GoalKind::Binary))
        .unwrap();
    assert!(matches!(
        w.goals.set_habit(&plain.id, Some(&habit)).unwrap_err(),
        NexusError::Validation(_)
    ));
}

#[test]
fn a_constancia_can_only_be_fed_by_a_habit() {
    // `habit_id` referencia `nodes(id)`, e `nodes` guarda as 16 espécies: para o
    // BANCO, apontar para uma meta é uma FK perfeitamente válida. Quem sabe que
    // só hábito serve é a camada de aplicação.
    let w = setup();
    let victim = w
        .goals
        .create(&metricless("Uma meta qualquer", GoalKind::Binary))
        .unwrap();

    let err = w
        .goals
        .create(&constancia("Guardar", 300.0, "R$", Some(10.0), &victim.id))
        .unwrap_err();
    assert!(
        matches!(err, NexusError::Validation(ref m) if m.contains("não é um hábito")),
        "{err:?}"
    );
    assert_eq!(
        w.goals.list(None).unwrap().len(),
        1,
        "a meta ruim não nasceu"
    );
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
