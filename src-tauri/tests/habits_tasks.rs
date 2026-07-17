//! Testes de integração do M2: hábitos, rotinas, tarefas e projetos.

use std::sync::Arc;

use nexus_lib::application::ports::{HabitRepository, LedgerRepository, TaskPatch, TaskRepository};
use nexus_lib::application::use_cases::{
    areas::AreaService, dashboard::DashboardService, habits::HabitService, nodes::NodeService,
    tasks::TaskService,
};
use nexus_lib::domain::entities::Template;
use nexus_lib::domain::schedule::Schedule;
use nexus_lib::domain::streak::TickStatus;
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, habit_repo::SqliteHabitRepository,
    ledger_repo::SqliteLedgerRepository, node_repo::SqliteNodeRepository,
    task_repo::SqliteTaskRepository,
};

struct H {
    areas: AreaService,
    habits: Arc<HabitService>,
    tasks: Arc<TaskService>,
    dashboard: DashboardService,
    ledger: Arc<dyn LedgerRepository>,
    habit_repo: Arc<dyn HabitRepository>,
    task_repo: Arc<dyn TaskRepository>,
    _dir: tempfile::TempDir,
}

fn harness() -> H {
    let dir = tempfile::tempdir().unwrap();
    let paths = Paths::at(dir.path().to_path_buf()).unwrap();
    let db = Arc::new(Db::open(&paths).unwrap());

    let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
    let node_repo = Arc::new(SqliteNodeRepository::new(db.clone()));
    let habit_repo = Arc::new(SqliteHabitRepository::new(db.clone()));
    let task_repo = Arc::new(SqliteTaskRepository::new(db.clone()));
    let clock = Arc::new(SystemClock);
    let ids = Arc::new(Uuid7Gen);

    let habits = Arc::new(HabitService {
        habits: habit_repo.clone(),
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    });
    let tasks = Arc::new(TaskService {
        tasks: task_repo.clone(),
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    });
    let dashboard = DashboardService {
        habits: habits.clone(),
        tasks: tasks.clone(),
        habit_repo: habit_repo.clone(),
        nodes: node_repo.clone(),
    };

    // NodeService existe para o dashboard/áreas funcionarem; não é usado direto.
    let _nodes = NodeService {
        nodes: node_repo,
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };

    H {
        areas: AreaService {
            repo: area_repo,
            ids,
            clock,
        },
        habits,
        tasks,
        dashboard,
        ledger: Arc::new(SqliteLedgerRepository::new(db.clone())),
        habit_repo,
        task_repo,
        _dir: dir,
    }
}

fn today() -> String {
    use nexus_lib::application::ports::Clock;
    SystemClock.today_local()
}

// ===== Hábitos =====

#[test]
fn ticking_a_habit_records_it_and_returns_the_streak() {
    let h = harness();
    let habit = h
        .habits
        .create(
            "Beber água",
            None,
            Schedule::Daily,
            Some(2.0),
            Some("L".into()),
            None,
            None,
        )
        .unwrap();

    let streaks = h
        .habits
        .tick(&habit.id, None, TickStatus::Done, Some(2.5))
        .unwrap();

    assert_eq!(streaks.current, 1);
    assert!(streaks.is_record);

    let ticks = h
        .habit_repo
        .ticks_in_range(&habit.id, &today(), &today())
        .unwrap();
    assert_eq!(ticks.len(), 1);
    assert_eq!(
        ticks[0].1.value,
        Some(2.5),
        "o valor quantitativo é guardado"
    );
}

#[test]
fn ticking_the_same_day_twice_overwrites_state_but_appends_history() {
    let h = harness();
    let habit = h
        .habits
        .create("Ler", None, Schedule::Daily, None, None, None, None)
        .unwrap();

    h.habits
        .tick(&habit.id, None, TickStatus::Done, None)
        .unwrap();
    h.habits
        .tick(&habit.id, None, TickStatus::Failed, None)
        .unwrap();

    // Estado atual: o último vence (PK é (habit_id, day)).
    let ticks = h
        .habit_repo
        .ticks_in_range(&habit.id, &today(), &today())
        .unwrap();
    assert_eq!(ticks.len(), 1, "um tick por dia");
    assert_eq!(ticks[0].1.status, TickStatus::Failed);

    // História: as duas marcações estão lá.
    let events = h.ledger.for_entity(&habit.id, 10).unwrap();
    assert!(
        events.len() >= 3,
        "esperado created + checked + status_changed, veio {}",
        events.len()
    );
}

#[test]
fn a_habit_cannot_be_ticked_in_the_future() {
    let h = harness();
    let habit = h
        .habits
        .create("Correr", None, Schedule::Daily, None, None, None, None)
        .unwrap();

    let err = h
        .habits
        .tick(&habit.id, Some("2099-01-01"), TickStatus::Done, None)
        .unwrap_err();
    assert!(err.to_string().contains("futuro"), "veio: {err}");
}

#[test]
fn a_quantitative_habit_rejects_a_negative_value() {
    let h = harness();
    let habit = h
        .habits
        .create(
            "Água",
            None,
            Schedule::Daily,
            Some(2.0),
            Some("L".into()),
            None,
            None,
        )
        .unwrap();

    assert!(h
        .habits
        .tick(&habit.id, None, TickStatus::Done, Some(-1.0))
        .is_err());
    assert!(h
        .habits
        .tick(&habit.id, None, TickStatus::Done, Some(f64::NAN))
        .is_err());
}

#[test]
fn unticking_removes_the_tick_and_records_the_correction() {
    let h = harness();
    let habit = h
        .habits
        .create("Meditar", None, Schedule::Daily, None, None, None, None)
        .unwrap();

    h.habits
        .tick(&habit.id, None, TickStatus::Done, None)
        .unwrap();
    let streaks = h.habits.untick(&habit.id, None).unwrap();

    assert_eq!(streaks.current, 0);
    assert!(h
        .habit_repo
        .ticks_in_range(&habit.id, &today(), &today())
        .unwrap()
        .is_empty());

    // A correção também é história.
    let events = h.ledger.for_entity(&habit.id, 10).unwrap();
    assert!(events.iter().any(|e| e.payload.contains("unticked")));
}

#[test]
fn unticking_a_day_that_was_never_ticked_is_an_error() {
    let h = harness();
    let habit = h
        .habits
        .create("Alongar", None, Schedule::Daily, None, None, None, None)
        .unwrap();
    assert!(h.habits.untick(&habit.id, None).is_err());
}

#[test]
fn invalid_schedules_are_rejected_at_creation() {
    let h = harness();
    assert!(h
        .habits
        .create(
            "Ruim",
            None,
            Schedule::Weekdays { days: vec![] },
            None,
            None,
            None,
            None
        )
        .is_err());
    assert!(h
        .habits
        .create(
            "Ruim",
            None,
            Schedule::TimesPerWeek { n: 0 },
            None,
            None,
            None,
            None
        )
        .is_err());
}

#[test]
fn an_invalid_reminder_time_is_rejected() {
    let h = harness();
    assert!(h
        .habits
        .create(
            "X",
            None,
            Schedule::Daily,
            None,
            None,
            None,
            Some("25:00".into())
        )
        .is_err());
}

// ===== Rotinas =====

#[test]
fn completing_a_routine_ticks_every_habit_in_one_transaction() {
    let h = harness();
    let routine = h.habits.create_routine("Rotina matinal", None).unwrap();

    for title in ["Beber água", "Alongar", "Meditar"] {
        h.habits
            .create(
                title,
                None,
                Schedule::Daily,
                None,
                None,
                Some(routine.clone()),
                Some("07:00".into()),
            )
            .unwrap();
    }

    let n = h.habits.complete_routine(&routine, None).unwrap();
    assert_eq!(n, 3);

    // Os três ficaram marcados.
    let ticks = h.habit_repo.ticks_on_day(&today()).unwrap();
    assert_eq!(ticks.len(), 3);
    assert!(ticks.iter().all(|(_, t)| t.status == TickStatus::Done));

    // E cada um gerou seu evento, apontando a rotina que o marcou.
    let members = h.habit_repo.list_in_routine(&routine).unwrap();
    for m in members {
        let events = h.ledger.for_entity(&m.id, 10).unwrap();
        assert!(
            events.iter().any(|e| e.payload.contains("via_routine")),
            "o hábito '{}' precisa registrar que veio da rotina",
            m.title
        );
    }
}

#[test]
fn an_empty_routine_cannot_be_completed() {
    let h = harness();
    let routine = h.habits.create_routine("Vazia", None).unwrap();
    let err = h.habits.complete_routine(&routine, None).unwrap_err();
    assert!(err.to_string().contains("não tem hábitos"), "veio: {err}");
}

#[test]
fn completing_a_routine_twice_is_idempotent_in_state() {
    let h = harness();
    let routine = h.habits.create_routine("Matinal", None).unwrap();
    h.habits
        .create(
            "Água",
            None,
            Schedule::Daily,
            None,
            None,
            Some(routine.clone()),
            None,
        )
        .unwrap();

    h.habits.complete_routine(&routine, None).unwrap();
    h.habits.complete_routine(&routine, None).unwrap();

    assert_eq!(
        h.habit_repo.ticks_on_day(&today()).unwrap().len(),
        1,
        "continua um tick por hábito por dia"
    );
}

#[test]
fn habits_keep_their_order_inside_a_routine() {
    let h = harness();
    let routine = h.habits.create_routine("Matinal", None).unwrap();
    for title in ["Primeiro", "Segundo", "Terceiro"] {
        h.habits
            .create(
                title,
                None,
                Schedule::Daily,
                None,
                None,
                Some(routine.clone()),
                None,
            )
            .unwrap();
    }

    let members = h.habit_repo.list_in_routine(&routine).unwrap();
    let titles: Vec<&str> = members.iter().map(|m| m.title.as_str()).collect();
    assert_eq!(titles, vec!["Primeiro", "Segundo", "Terceiro"]);
}

// ===== Tarefas e projetos =====

#[test]
fn project_progress_counts_completed_tasks() {
    let h = harness();
    let project = h.tasks.create_project("Lançar o site", None).unwrap();

    let t1 = h
        .tasks
        .create(
            "Escrever copy",
            None,
            Some(&project),
            None,
            None,
            None,
            2,
            None,
        )
        .unwrap();
    h.tasks
        .create(
            "Desenhar a home",
            None,
            Some(&project),
            None,
            None,
            None,
            2,
            None,
        )
        .unwrap();

    assert_eq!(h.tasks.progress(&project).unwrap().done, 0);
    assert_eq!(h.tasks.progress(&project).unwrap().total, 2);

    h.tasks.set_completed(&t1.id, true).unwrap();
    let p = h.tasks.progress(&project).unwrap();
    assert_eq!((p.done, p.total), (1, 2));
}

#[test]
fn completing_a_task_keeps_node_status_and_completed_at_in_sync() {
    let h = harness();
    let task = h
        .tasks
        .create("Entregar", None, None, None, None, None, 1, None)
        .unwrap();

    let done = h.tasks.set_completed(&task.id, true).unwrap();
    assert!(done.completed_at.is_some());
    assert_eq!(done.status, "done", "nodes.status espelha completed_at");

    let reopened = h.tasks.set_completed(&task.id, false).unwrap();
    assert!(reopened.completed_at.is_none());
    assert_eq!(reopened.status, "active");
}

#[test]
fn completed_tasks_leave_the_open_list() {
    let h = harness();
    let project = h.tasks.create_project("P", None).unwrap();
    let t = h
        .tasks
        .create(
            "Some quando pronta",
            None,
            Some(&project),
            None,
            None,
            None,
            2,
            None,
        )
        .unwrap();

    assert_eq!(h.tasks.list_for_project(&project, false).unwrap().len(), 1);
    h.tasks.set_completed(&t.id, true).unwrap();
    assert_eq!(h.tasks.list_for_project(&project, false).unwrap().len(), 0);
    assert_eq!(
        h.tasks.list_for_project(&project, true).unwrap().len(),
        1,
        "mas continua existindo"
    );
}

#[test]
fn invalid_task_input_is_rejected() {
    let h = harness();
    assert!(
        h.tasks
            .create("X", None, None, None, None, None, 9, None)
            .is_err(),
        "prioridade fora de 1..3"
    );
    assert!(
        h.tasks
            .create("X", None, None, None, None, None, 2, Some("média".into()))
            .is_err(),
        "energia precisa ser deep|shallow"
    );
    assert!(
        h.tasks
            .create("X", None, None, None, None, Some(-5), 2, None)
            .is_err(),
        "duração negativa"
    );
}

#[test]
fn a_task_can_only_belong_to_a_project() {
    let h = harness();
    // Uma rotina não é um projeto.
    let routine = h.habits.create_routine("R", None).unwrap();
    assert!(h
        .tasks
        .create("X", None, Some(&routine), None, None, None, 2, None)
        .is_err());
}

// ===== Reordenação =====

#[test]
fn moving_a_task_changes_only_its_own_order() {
    let h = harness();
    let project = h.tasks.create_project("P", None).unwrap();
    let a = h
        .tasks
        .create("A", None, Some(&project), None, None, None, 2, None)
        .unwrap();
    let b = h
        .tasks
        .create("B", None, Some(&project), None, None, None, 2, None)
        .unwrap();
    let c = h
        .tasks
        .create("C", None, Some(&project), None, None, None, 2, None)
        .unwrap();

    let order = |h: &H| -> Vec<String> {
        h.tasks
            .list_for_project(&project, false)
            .unwrap()
            .into_iter()
            .map(|t| t.title)
            .collect()
    };
    assert_eq!(order(&h), vec!["A", "B", "C"]);

    // Move C para o topo.
    h.tasks.move_to(&c.id, &project, 0).unwrap();
    assert_eq!(order(&h), vec!["C", "A", "B"]);

    // Move A para o fim (índice 3 = depois de todos).
    h.tasks.move_to(&a.id, &project, 3).unwrap();
    assert_eq!(order(&h), vec!["C", "B", "A"]);

    // E os ids continuam os mesmos — reordenar não recria nada.
    let ids: Vec<String> = h
        .tasks
        .list_for_project(&project, false)
        .unwrap()
        .into_iter()
        .map(|t| t.id)
        .collect();
    assert!(ids.contains(&a.id) && ids.contains(&b.id) && ids.contains(&c.id));
}

#[test]
fn repeated_moves_into_the_same_gap_survive_double_saturation() {
    // A ordem é REAL e mover é a média dos vizinhos. Repetir no mesmo ponto
    // esgota a precisão do double; o repositório precisa reespaçar sozinho.
    let h = harness();
    let project = h.tasks.create_project("P", None).unwrap();

    for i in 0..6 {
        h.tasks
            .create(
                &format!("T{i}"),
                None,
                Some(&project),
                None,
                None,
                None,
                2,
                None,
            )
            .unwrap();
    }

    // Empurra a última para a posição 1, muitas vezes seguidas.
    for _ in 0..60 {
        let tasks = h.tasks.list_for_project(&project, false).unwrap();
        let last = tasks.last().unwrap().id.clone();
        h.tasks.move_to(&last, &project, 1).unwrap();
    }

    let tasks = h.tasks.list_for_project(&project, false).unwrap();
    assert_eq!(tasks.len(), 6, "nenhuma tarefa pode se perder no processo");

    // A ordem tem que continuar estritamente crescente — sem empates causados
    // por médias que colapsaram no mesmo double.
    let orders: Vec<f64> = tasks.iter().map(|t| t.sort_order).collect();
    for w in orders.windows(2) {
        assert!(
            w[0] < w[1],
            "ordens colapsaram: {orders:?} — o reespaçamento não funcionou"
        );
    }
}

#[test]
fn renumbering_preserves_the_visible_order() {
    let h = harness();
    let project = h.tasks.create_project("P", None).unwrap();
    for t in ["A", "B", "C"] {
        h.tasks
            .create(t, None, Some(&project), None, None, None, 2, None)
            .unwrap();
    }
    let before: Vec<String> = h
        .tasks
        .list_for_project(&project, false)
        .unwrap()
        .into_iter()
        .map(|t| t.title)
        .collect();

    h.task_repo.renumber_project_tasks(&project).unwrap();

    let after: Vec<String> = h
        .tasks
        .list_for_project(&project, false)
        .unwrap()
        .into_iter()
        .map(|t| t.title)
        .collect();
    assert_eq!(before, after, "reespaçar não pode reordenar");
}

// ===== Patch de tarefa =====

#[test]
fn a_task_patch_can_clear_a_field_without_touching_the_others() {
    let h = harness();
    let task = h
        .tasks
        .create(
            "X",
            None,
            None,
            Some(1_000),
            Some(2_000),
            Some(30),
            1,
            Some("deep".into()),
        )
        .unwrap();

    // Some(None) = limpar; None = não mexer.
    let patched = h
        .tasks
        .update(
            &task.id,
            &TaskPatch {
                due_at: Some(None),
                ..Default::default()
            },
        )
        .unwrap();

    assert_eq!(patched.due_at, None, "due_at foi limpo");
    assert_eq!(patched.scheduled_at, Some(2_000), "scheduled_at intocado");
    assert_eq!(patched.duration_min, Some(30), "duration intocada");
    assert_eq!(patched.priority, 1, "prioridade intocada");
    assert_eq!(patched.energy.as_deref(), Some("deep"), "energia intocada");
}

// ===== Dashboard e Nexus Score =====

#[test]
fn the_dashboard_scores_a_day_with_nothing_scheduled_as_none() {
    let h = harness();
    let t = h.dashboard.today().unwrap();
    assert_eq!(t.score.value, None, "sem nada agendado não há score");
    assert!(t.habits.is_empty());
}

#[test]
fn the_dashboard_score_climbs_as_the_day_is_done() {
    let h = harness();
    h.habits
        .create("Ler", None, Schedule::Daily, None, None, None, None)
        .unwrap();
    let h2 = h
        .habits
        .create("Correr", None, Schedule::Daily, None, None, None, None)
        .unwrap();

    let before = h.dashboard.today().unwrap();
    assert_eq!(before.habits.len(), 2, "os dois são diários: contam hoje");
    let start = before.score.value.unwrap();

    h.habits.tick(&h2.id, None, TickStatus::Done, None).unwrap();

    let after = h.dashboard.today().unwrap();
    assert!(
        after.score.value.unwrap() > start,
        "cumprir um hábito tem que subir o score ({start} -> {:?})",
        after.score.value
    );
}

#[test]
fn habits_not_scheduled_today_stay_out_of_the_dashboard() {
    let h = harness();
    // Um hábito agendado num dia da semana que não é hoje.
    use nexus_lib::domain::schedule::{parse_day, weekday_index};
    let today_idx = weekday_index(parse_day(&today()).unwrap());
    let other = (today_idx + 3) % 7;

    h.habits
        .create(
            "Só noutro dia",
            None,
            Schedule::Weekdays { days: vec![other] },
            None,
            None,
            None,
            None,
        )
        .unwrap();

    let t = h.dashboard.today().unwrap();
    assert!(t.habits.is_empty(), "hoje não é dia dele");
    assert_eq!(t.score.value, None, "e não havia mais nada a fazer");
}

#[test]
fn the_score_always_explains_itself() {
    let h = harness();
    h.habits
        .create("Ler", None, Schedule::Daily, None, None, None, None)
        .unwrap();

    let t = h.dashboard.today().unwrap();
    assert!(
        !t.score.formula.is_empty(),
        "o card tem que responder 'como calculamos?'"
    );
    for c in &t.score.components {
        assert!(!c.detail.is_empty());
    }
}

#[test]
fn the_morning_routine_is_inferred_from_reminder_times() {
    let h = harness();
    let routine = h.habits.create_routine("Matinal", None).unwrap();
    h.habits
        .create(
            "Água",
            None,
            Schedule::Daily,
            None,
            None,
            Some(routine.clone()),
            Some("07:00".into()),
        )
        .unwrap();

    let t = h.dashboard.today().unwrap();
    let labels: Vec<&str> = t
        .score
        .components
        .iter()
        .map(|c| c.label.as_str())
        .collect();
    assert!(
        labels.contains(&"Rotina matinal"),
        "um hábito com lembrete às 07:00 numa rotina torna a rotina matinal: {labels:?}"
    );
}

#[test]
fn an_evening_routine_is_not_counted_as_the_morning_one() {
    let h = harness();
    let routine = h.habits.create_routine("Noturna", None).unwrap();
    h.habits
        .create(
            "Diário",
            None,
            Schedule::Daily,
            None,
            None,
            Some(routine),
            Some("22:00".into()),
        )
        .unwrap();

    let t = h.dashboard.today().unwrap();
    let labels: Vec<&str> = t
        .score
        .components
        .iter()
        .map(|c| c.label.as_str())
        .collect();
    assert!(
        !labels.contains(&"Rotina matinal"),
        "22:00 não é manhã: {labels:?}"
    );
}

// ===== Áreas continuam íntegras com o M2 =====

#[test]
fn a_habit_in_a_nonexistent_area_is_rejected() {
    let h = harness();
    assert!(h
        .habits
        .create(
            "X",
            Some("fantasma"),
            Schedule::Daily,
            None,
            None,
            None,
            None
        )
        .is_err());
}

#[test]
fn habits_can_be_filtered_by_area() {
    let h = harness();
    let saude = h
        .areas
        .create("Saúde", "heart", "#4ADE80", Template::Simple)
        .unwrap();
    h.habits
        .create(
            "Correr",
            Some(&saude.id),
            Schedule::Daily,
            None,
            None,
            None,
            None,
        )
        .unwrap();
    h.habits
        .create("Avulso", None, Schedule::Daily, None, None, None, None)
        .unwrap();

    assert_eq!(h.habits.list(Some(&saude.id)).unwrap().len(), 1);
    assert_eq!(h.habits.list(None).unwrap().len(), 2);
}
