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
use nexus_lib::application::ports::LedgerRepository;
use nexus_lib::application::ports::{
    NewContribution, NewEvent, NewEventDetails, NewGoal, NewGoalDetails, NewMilestone,
};
use nexus_lib::application::use_cases::{
    annual_goals::AnnualGoalService, areas::AreaService, books::BookService, career::CareerService,
    challenges::ChallengeService, events::EventService, fin_goals::FinGoalService,
    finance::FinanceService, goals::GoalService, habits::HabitService, nodes::NodeService,
    notes::NoteService, tasks::TaskService,
};
use nexus_lib::domain::entities::CareerMilestoneKind;
use nexus_lib::domain::entities::{
    AssetClass, Direction, GoalKind, Kind, MilestoneKind, ProgressSource, Template,
};
use nexus_lib::domain::recurrence::Recurrence;
use nexus_lib::domain::schedule::{format_day, parse_day, week_start, Schedule};
use nexus_lib::domain::streak::TickStatus;
use nexus_lib::infrastructure::clock::{SystemClock, Uuid7Gen};
use nexus_lib::infrastructure::db::Db;
use nexus_lib::infrastructure::paths::Paths;
use nexus_lib::infrastructure::repositories::skill_checkin_repo::SqliteSkillCheckinRepository;
use nexus_lib::infrastructure::repositories::{
    annual_goal_repo::SqliteAnnualGoalRepository, area_repo::SqliteAreaRepository,
    book_repo::SqliteBookRepository, challenge_repo::SqliteChallengeRepository,
    contribution_repo::SqliteContributionRepository, event_repo::SqliteEventRepository,
    fin_goal_repo::SqliteFinGoalRepository, goal_repo::SqliteGoalRepository,
    habit_repo::SqliteHabitRepository, ledger_repo::SqliteLedgerRepository,
    node_repo::SqliteNodeRepository, note_repo::SqliteNoteRepository,
    skill_repo::SqliteSkillRepository, task_repo::SqliteTaskRepository,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let paths = Paths::resolve()?;
    println!("semeando em {}", paths.db.display());

    let db = Arc::new(Db::open(&paths)?);
    let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
    let node_repo = Arc::new(SqliteNodeRepository::new(db.clone()));
    let habit_repo = Arc::new(SqliteHabitRepository::new(db.clone()));
    let task_repo = Arc::new(SqliteTaskRepository::new(db.clone()));
    let event_repo = Arc::new(SqliteEventRepository::new(db.clone()));
    let goal_repo = Arc::new(SqliteGoalRepository::new(db.clone()));
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
        habits: habit_repo.clone(),
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let tasks = TaskService {
        tasks: task_repo,
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let events = EventService {
        events: event_repo,
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let goals = GoalService {
        goals: goal_repo,
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        habits: habit_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let fin_goal_repo = Arc::new(SqliteFinGoalRepository::new(db.clone()));
    let finance = FinanceService {
        contributions: Arc::new(SqliteContributionRepository::new(db.clone())),
        fin_goals: fin_goal_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let fin_goals = FinGoalService {
        fin_goals: fin_goal_repo,
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let books = BookService {
        books: Arc::new(SqliteBookRepository::new(db.clone())),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let ledger_repo: Arc<dyn LedgerRepository> = Arc::new(SqliteLedgerRepository::new(db.clone()));
    let career = CareerService {
        skills: Arc::new(SqliteSkillRepository::new(db.clone())),
        checkins: Arc::new(SqliteSkillCheckinRepository::new(db.clone())),
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        ledger: ledger_repo,
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let notes_svc = NoteService {
        notes: Arc::new(SqliteNoteRepository::new(db.clone())),
        nodes: Arc::new(SqliteNodeRepository::new(db.clone())),
        ids: ids.clone(),
        clock: clock.clone(),
        paths: paths.clone(),
    };

    // ===== Esferas =====
    //
    // Não criamos nenhuma: as 5 do sistema já nasceram com a migration 0005.
    // Semear uma "Saúde" própria daria ao usuário duas Esferas de mesmo nome e
    // um Hub com cards duplicados — o seed tem que povoar o app que existe, não
    // um paralelo.
    //
    // O que o seed cria de Esfera é uma 'simple', para o Hub mostrar também o
    // caso do template do usuário.
    let all_areas = areas.list(false)?;
    let saude = all_areas
        .iter()
        .find(|a| a.template == Template::Health)
        .expect("a Esfera Saúde é semeada pela migration 0005");
    let carreira = all_areas
        .iter()
        .find(|a| a.template == Template::Career)
        .expect("a Esfera Carreira é semeada pela migration 0005");

    if !all_areas.iter().any(|a| a.name == "Casa") {
        areas.create("Casa", "home", "#F472B6", Template::Simple)?;
    }
    println!("  {} esferas", areas.list(false)?.len());

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
    // Um par CORRELACIONADO de propósito, para a tela de Insights ter um card que
    // passa as guardas: nos dias em que "Dormir cedo" acontece, "Acordar cedo"
    // dispara. Ambos diários → 120 dias de amostra comum (bem acima do n≥30).
    let dormir = habits.create(
        "Dormir cedo",
        Some(&saude.id),
        Schedule::Daily,
        None,
        None,
        None,
        Some("23:00".into()),
    )?;
    let acordar = habits.create(
        "Acordar cedo",
        Some(&saude.id),
        Schedule::Daily,
        None,
        None,
        None,
        Some("06:00".into()),
    )?;
    println!("  {} hábitos", habits.list(None)?.len());

    // ===== Histórico: 120 dias de ticks =====
    //
    // Determinístico de propósito (sem RNG): rodar o seed duas vezes tem que
    // produzir o mesmo heatmap, senão comparar builds vira adivinhação.
    let today = parse_day(&clock.today_local())?;
    let mut ticks = 0;

    // ===== As semanas PERFEITAS do seed =====
    //
    // Sem isto não existia NENHUMA, e a tela de Semana Perfeita (mais as
    // conquistas 4/12/26 que dependem dela) nunca teve como ser vista com dado.
    // A causa era aritmética, não intenção: "Ler" é `Daily` e deixava de ser
    // marcado sempre que `n % 7 == 0`; como `n` cai de um em um, isso acerta um
    // dia de CADA semana — todas elas, sem exceção. "Água" (`n % 9`) e "Dormir"
    // (`n % 5`) reforçavam. Uma semana perfeita não admite abono, então bastava
    // um desses para reprovar as 17 semanas do histórico.
    //
    // As semanas escolhidas por índice, contando da última COMPLETA para trás:
    // {0,1} dão a sequência atual (2), {4,5,6} dão o recorde (3), e a 10 fecha o
    // total em 6 — o bastante para o marco de 4 CAIR (estado desbloqueado) e os
    // de 12 e 26 mostrarem progresso real. Determinístico, como o resto do seed.
    let last_complete_ws = week_start(today) - chrono::Duration::weeks(1);
    let perfect_weeks: std::collections::HashSet<chrono::NaiveDate> = [0i64, 1, 4, 5, 6, 10]
        .iter()
        .map(|k| last_complete_ws - chrono::Duration::weeks(*k))
        .collect();

    for n in (1i64..=120).rev() {
        let day = today - chrono::Duration::days(n);
        let d = format_day(day);
        // Numa semana perfeita, TUDO que está agendado sai como `Done`. As regras
        // de falha abaixo continuam valendo em todas as outras.
        let perfect = perfect_weeks.contains(&week_start(day));

        // "Ler": falha a cada 7 dias, pula a cada 11 — dá streaks realistas.
        if perfect || n % 7 != 0 {
            let status = if !perfect && n % 11 == 0 {
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
            let status = if !perfect && is_friday && n % 3 == 0 {
                TickStatus::Failed
            } else {
                TickStatus::Done
            };
            habits.tick(&correr.id, Some(&d), status, None)?;
            ticks += 1;
        }

        // "Água": quase todo dia.
        if perfect || n % 9 != 0 {
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

        // O par correlacionado. "Dormir cedo" em ~80% dos dias; "Acordar cedo"
        // depende FORTE dele: quase sempre quando dormiu cedo, quase nunca quando
        // não — o que produz lift alto e phi acima do piso do template. A semana
        // perfeita liga os dois juntos, então ela REFORÇA a correlação em vez de
        // diluí-la.
        let dormiu = perfect || n % 5 != 0;
        if dormiu {
            habits.tick(&dormir.id, Some(&d), TickStatus::Done, None)?;
            ticks += 1;
        }
        let acordou = if perfect {
            true
        } else if dormiu {
            n % 13 != 0
        } else {
            n % 4 == 0
        };
        if acordou {
            habits.tick(&acordar.id, Some(&d), TickStatus::Done, None)?;
            ticks += 1;
        }
    }
    println!("  {ticks} marcações de hábito em 120 dias");

    // ===== "Neste dia": a história de anos anteriores =====
    //
    // O card "Neste dia" (Hub e Timeline) procura o mesmo 'MM-DD' em anos
    // passados. O seed só ia 120 dias para trás — logo a busca NUNCA achava
    // nada, o componente renderizava `null` por construção, e uma feature de
    // duas telas ficava invisível: nem quebrada, nem vista. Um estado que o seed
    // não produz se disfarça de "o usuário ainda não chegou lá".
    //
    // Três anos (1, 2 e 5) porque é exatamente o que a legenda promete — "há 1
    // ano", "há 2 anos", "há 5 anos" — e porque três grupos provam o
    // agrupamento, que um só não provaria.
    let mut memories = 0;
    for years_ago in [1i32, 2, 5] {
        // 29/02 não existe em todo ano: `with_year` devolve `None` e o dia é
        // pulado em vez de virar 01/03 (uma data que o usuário não viveu).
        let Some(day) = today.with_year(today.year() - years_ago) else {
            continue;
        };
        let d = format_day(day);
        for habit in [&ler, &agua, &academia] {
            habits.tick(&habit.id, Some(&d), TickStatus::Done, None)?;
            memories += 1;
        }
    }
    println!("  {memories} lembranças em 1, 2 e 5 anos atrás");

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

    // ===== Calendário (M3) =====
    //
    // O relógio de parede de um dia: `at(dia, hora, min)` -> epoch ms local. As
    // ocorrências são materializadas pela hora LOCAL, então semear por epoch cru
    // poria a terapia às 16h no fuso errado.
    let at = |day: chrono::NaiveDate, h: u32, m: u32| -> i64 {
        use chrono::TimeZone;
        chrono::Local
            .from_local_datetime(&day.and_hms_opt(h, m, 0).expect("hora válida"))
            .earliest()
            .expect("instante que existe no fuso")
            .timestamp_millis()
    };
    let min = 60_000i64;

    // A terça que vem — a âncora da série semanal.
    let next_tuesday = (1..=7)
        .map(|n| today + chrono::Duration::days(n))
        .find(|d| nexus_lib::domain::schedule::weekday_index(*d) == 2)
        .expect("uma das próximas 7 datas é terça");

    let mut created_events = 0;

    // Uma série semanal: a terapia das terças. É ela que exercita o arrasto de
    // UMA ocorrência sem reescrever a regra.
    events.create(&NewEvent {
        title: "Terapia".into(),
        area_id: Some(saude.id.clone()),
        parent_id: None,
        details: NewEventDetails {
            starts_at: at(next_tuesday, 19, 0),
            ends_at: at(next_tuesday, 19, 0) + 50 * min,
            all_day: false,
            rrule: Some(Recurrence::Weekly {
                interval: 1,
                days: vec![2],
            }),
            recurrence_end: None,
            location: Some("Consultório".into()),
            category: None,
            notes: None,
        },
    })?;
    created_events += 1;

    // Uma mensal. O prompt do M3 pedia "a terceira terça do mês" — e ela NÃO é
    // expressável: o subconjunto da RFC-5545 do ADR-0021 tem `monthly` por dia
    // do mês, e cita "na terceira sexta" como exatamente o que ficou de fora.
    // Semear o que o vocabulário tem é honesto; semear o que ele não tem exigiria
    // um INSERT cru, e o seed passaria a provar uma feature que não existe. Ver
    // ADR-0024.
    let day_15 = (0..40)
        .map(|n| today + chrono::Duration::days(n))
        .find(|d| chrono::Datelike::day(d) == 15)
        .expect("todo mês tem um dia 15");
    events.create(&NewEvent {
        title: "Reunião de condomínio".into(),
        area_id: None,
        parent_id: None,
        details: NewEventDetails {
            starts_at: at(day_15, 20, 0),
            ends_at: at(day_15, 21, 30),
            all_day: false,
            rrule: Some(Recurrence::Monthly { interval: 1 }),
            recurrence_end: None,
            location: Some("Salão de festas".into()),
            category: None,
            notes: None,
        },
    })?;
    created_events += 1;

    // O standup: uma semanal de vários dias, que enche a grade da semana.
    let tomorrow = today + chrono::Duration::days(1);
    events.create(&NewEvent {
        title: "Daily do time".into(),
        area_id: Some(carreira.id.clone()),
        parent_id: None,
        details: NewEventDetails {
            starts_at: at(tomorrow, 9, 30),
            ends_at: at(tomorrow, 9, 45),
            all_day: false,
            rrule: Some(Recurrence::Weekly {
                interval: 1,
                days: vec![1, 2, 3, 4, 5],
            }),
            recurrence_end: None,
            location: None,
            category: None,
            notes: None,
        },
    })?;
    created_events += 1;

    // DOIS que se chocam de propósito, no mesmo dia: é o único jeito de a tela
    // de conflito ter o que desenhar no seed. Um app que só é testado com a
    // agenda limpa nunca descobre que o aviso de choque não aparece.
    events.create(&NewEvent {
        title: "Dentista".into(),
        area_id: Some(saude.id.clone()),
        parent_id: None,
        details: NewEventDetails {
            starts_at: at(tomorrow, 15, 0),
            ends_at: at(tomorrow, 16, 0),
            all_day: false,
            rrule: None,
            recurrence_end: None,
            location: Some("Clínica".into()),
            category: Some("consulta".into()),
            notes: None,
        },
    })?;
    events.create(&NewEvent {
        title: "Call com o cliente".into(),
        area_id: Some(carreira.id.clone()),
        parent_id: None,
        details: NewEventDetails {
            starts_at: at(tomorrow, 15, 30),
            ends_at: at(tomorrow, 16, 30),
            all_day: false,
            rrule: None,
            recurrence_end: None,
            location: None,
            category: None,
            notes: None,
        },
    })?;
    created_events += 2;

    // Um exame com categoria: a §3.1 do M3.5 já lê `category`, e ter o dado
    // desde agora deixa a tela de Saúde nascer com o que mostrar.
    events.create(&NewEvent {
        title: "Exame de sangue".into(),
        area_id: Some(saude.id.clone()),
        parent_id: None,
        details: NewEventDetails {
            starts_at: at(today + chrono::Duration::days(5), 7, 30),
            ends_at: at(today + chrono::Duration::days(5), 8, 0),
            all_day: false,
            rrule: None,
            recurrence_end: None,
            location: Some("Laboratório".into()),
            category: Some("exame".into()),
            notes: None,
        },
    })?;
    created_events += 1;

    // Um de dia inteiro: ele não entra na detecção de conflito (é um rótulo do
    // dia, não uma reserva de horário) e a faixa própria da grade o prova.
    events.create(&NewEvent {
        title: "Feriado".into(),
        area_id: None,
        parent_id: None,
        details: NewEventDetails {
            starts_at: at(today + chrono::Duration::days(9), 0, 0),
            ends_at: at(today + chrono::Duration::days(9), 23, 59),
            all_day: true,
            rrule: None,
            recurrence_end: None,
            location: None,
            category: None,
            notes: None,
        },
    })?;
    created_events += 1;
    println!("  {created_events} eventos (2 deles se chocam de propósito)");

    // ===== Metas (M3) =====
    //
    // Uma meta com métrica e checkpoints reais, e outra medida pelos
    // sub-desafios: as duas réguas da §5 da 0007, para o toggle ter o que
    // alternar e a projeção ter uma reta de verdade.
    let peso = goals.create(&NewGoal {
        title: "Perder 10 kg".into(),
        area_id: Some(saude.id.clone()),
        details: NewGoalDetails {
            goal_kind: GoalKind::Quantitative,
            metric_name: Some("Peso".into()),
            start_value: Some(82.0),
            target_value: Some(72.0),
            unit: Some("kg".into()),
            direction: Some(Direction::Decrease),
            deadline: Some(at(today + chrono::Duration::days(150), 12, 0)),
            progress_source: ProgressSource::Metric,
            habit_id: None,
            daily_target: None,
        },
    })?;

    // Oito pesagens, uma por semana, andando para o alvo com um repique no meio
    // (a vida não é uma reta — e a projeção por mínimos quadrados existe
    // justamente para achar a tendência apesar do repique).
    for (n, value) in [
        (56i64, 82.0f64),
        (49, 81.2),
        (42, 80.9),
        (35, 79.8),
        (28, 80.1),
        (21, 78.9),
        (14, 78.2),
        (7, 77.4),
    ] {
        let day = today - chrono::Duration::days(n);
        goals.add_checkpoint(&peso.id, value, None, Some(at(day, 8, 0)))?;
    }

    for title in [
        "Cortar refrigerante",
        "Comprar tênis de corrida",
        "Marcar avaliação física",
    ] {
        goals.add_milestone(&NewMilestone {
            title: title.into(),
            goal_id: peso.id.clone(),
            kind: MilestoneKind::Simple,
            habit_id: None,
            target_count: None,
            weight: 1.0,
            counts_from: None,
        })?;
    }
    // O sub-desafio CONTÁVEL: ele se preenche sozinho pelos ticks da Academia,
    // que o seed já semeou nos últimos 120 dias.
    goals.add_milestone(&NewMilestone {
        title: "30 dias de academia".into(),
        goal_id: peso.id.clone(),
        kind: MilestoneKind::Counter,
        habit_id: Some(academia.id.clone()),
        target_count: Some(30),
        weight: 2.0,
        // Conta desde 8 semanas atrás, e não de hoje (o padrão): o seed existe
        // para a tela ter o que mostrar, e um contador recém-nascido mostraria
        // 0/30. Backdatar aqui é o mesmo pedido legítimo que a UI oferece —
        // "conte desde o início do mês".
        counts_from: Some(format_day(today - chrono::Duration::days(56))),
    })?;

    let done = goals.get_with_progress(&peso.id)?;
    if let Some(first) = done.milestones.first() {
        goals.set_milestone_done(&first.milestone.id, true)?;
    }

    // A segunda meta mede pelos SUB-DESAFIOS: ela não tem checkpoint nenhum, e
    // é assim que a tela mostra a régua alternativa (e a ausência honesta de
    // projeção: uma reta precisa de dois pontos).
    let livros = goals.create(&NewGoal {
        title: "Ler 12 livros no ano".into(),
        area_id: Some(carreira.id.clone()),
        details: NewGoalDetails {
            goal_kind: GoalKind::Quantitative,
            metric_name: Some("Livros lidos".into()),
            start_value: Some(0.0),
            target_value: Some(12.0),
            unit: Some("livros".into()),
            direction: Some(Direction::Increase),
            deadline: None,
            progress_source: ProgressSource::Milestones,
            habit_id: None,
            daily_target: None,
        },
    })?;
    for (i, title) in [
        "Terminar 'O Espírito da Programação'",
        "Terminar 'Clean Architecture'",
        "Escolher o terceiro livro",
        "Ler 20 páginas por dia por um mês",
    ]
    .iter()
    .enumerate()
    {
        let m = goals.add_milestone(&NewMilestone {
            title: (*title).into(),
            goal_id: livros.id.clone(),
            kind: MilestoneKind::Simple,
            habit_id: None,
            target_count: None,
            weight: 1.0,
            counts_from: None,
        })?;
        // Os dois primeiros já foram: a barra por sub-desafios precisa estar em
        // 50% para dizer alguma coisa.
        if i < 2 {
            goals.set_milestone_done(&m.id, true)?;
        }
    }
    println!("  {} metas com sub-desafios", goals.list(None)?.len());

    // ===== Finanças (M3.5) =====
    //
    // Aportes ao longo de 8 meses, em várias classes e dois bancos: é o que dá
    // à área acumulada uma curva, ao donut fatias, às barras bancos, e à Saúde
    // Financeira as quatro parcelas (regularidade, diversificação, consistência
    // — e a de objetivos redistribuída, que chega no M4).
    //
    // Determinístico: (mês, banco, classe, centavos). Um aporte por mês, com um
    // extra em alguns, para a média de 6m e a série terem textura.
    let aportes: &[(u32, &str, AssetClass, i64)] = &[
        (7, "acct-btg-invest", AssetClass::RendaFixa, 120_000),
        (6, "acct-btg-invest", AssetClass::Acoes, 80_000),
        (6, "acct-nubank", AssetClass::Reserva, 50_000),
        (5, "acct-btg-invest", AssetClass::Fiis, 60_000),
        (4, "acct-btg-invest", AssetClass::RendaFixa, 100_000),
        (4, "acct-btg-invest", AssetClass::EtfExterior, 70_000),
        (3, "acct-btg-invest", AssetClass::Acoes, 90_000),
        (2, "acct-btg-invest", AssetClass::Cripto, 40_000),
        (2, "acct-nubank", AssetClass::Reserva, 50_000),
        (1, "acct-btg-invest", AssetClass::RendaFixa, 110_000),
        (0, "acct-btg-invest", AssetClass::Fiis, 65_000),
    ];
    use chrono::Datelike;
    let mut n_aportes = 0;
    for (months_ago, account, class, cents) in aportes {
        // O dia 5 de cada mês — uma data estável para o mês bater na série.
        let day = today
            .checked_sub_months(chrono::Months::new(*months_ago))
            .map(|d| d.with_day(5).unwrap_or(d))
            .unwrap_or(today);
        finance.contribute(&NewContribution {
            account_id: (*account).into(),
            asset_class: *class,
            amount_cents: *cents,
            happened_on: format_day(day),
            note: None,
        })?;
        n_aportes += 1;
    }
    // Um resgate, para a lista mostrar o vermelho e o líquido fechar certo.
    finance.contribute(&NewContribution {
        account_id: "acct-btg-invest".into(),
        asset_class: AssetClass::Cripto,
        amount_cents: -15_000,
        happened_on: format_day(today - chrono::Duration::days(10)),
        note: Some("realização parcial".into()),
    })?;
    n_aportes += 1;
    println!("  {n_aportes} aportes em 8 meses");

    // ===== Objetivos Financeiros — as caixinhas (M4) =====
    //
    // Duas caixinhas com histórias diferentes: uma quase fechando (para a barra
    // encher e a projeção dar uma data perto), e uma recém-começada (para a
    // projeção mostrar um horizonte mais longo). Depósitos ao longo de 3 meses
    // para a média mensal ter substância.
    let fin_goals_area = all_areas
        .iter()
        .find(|a| a.template == Template::FinGoals)
        .expect("a Esfera Objetivos Financeiros é semeada pela 0005");

    let ps5 = fin_goals.create(
        "PlayStation 5",
        Some(fin_goals_area.id.clone()),
        450_000,
        Some("acct-btg-invest".into()),
        None,
        Some("🎮".into()),
    )?;
    let viagem = fin_goals.create(
        "Viagem ao Japão",
        Some(fin_goals_area.id.clone()),
        1_800_000,
        Some("acct-nubank".into()),
        today
            .checked_add_months(chrono::Months::new(10))
            .map(format_day),
        Some("🗾".into()),
    )?;

    let mut n_deposits = 0;
    // PS5: três depósitos, chegando perto do alvo (mas sem fechar — a celebração
    // é para o usuário disparar clicando).
    for (months_ago, cents) in [(2u32, 120_000i64), (1, 130_000), (0, 150_000)] {
        let day = today
            .checked_sub_months(chrono::Months::new(months_ago))
            .map(|d| d.with_day(8).unwrap_or(d))
            .unwrap_or(today);
        fin_goals.deposit(&ps5.id, cents, Some(format_day(day)), None)?;
        n_deposits += 1;
    }
    // Viagem: começou agora, dois depósitos.
    for (months_ago, cents) in [(1u32, 200_000i64), (0, 250_000)] {
        let day = today
            .checked_sub_months(chrono::Months::new(months_ago))
            .map(|d| d.with_day(12).unwrap_or(d))
            .unwrap_or(today);
        fin_goals.deposit(&viagem.id, cents, Some(format_day(day)), None)?;
        n_deposits += 1;
    }
    println!("  2 caixinhas com {n_deposits} depósitos");

    // ===== Biblioteca (M4) =====
    //
    // Livros em estados variados, para a estante ter fila, leitura em andamento e
    // terminados com nota — e a meta anual, para o anel ter numerador.
    let estudos = all_areas
        .iter()
        .find(|a| a.template == Template::Studies)
        .expect("a Esfera Estudos é semeada pela 0005");

    let nome_do_vento = books.create(
        "O Nome do Vento",
        Some(estudos.id.clone()),
        Some("Patrick Rothfuss".into()),
        Some(656),
        Some("ficcao".into()),
    )?;
    books.set_progress(&nome_do_vento.id, 320)?; // lendo, ~metade

    let clean = books.create(
        "Código Limpo",
        Some(estudos.id.clone()),
        Some("Robert C. Martin".into()),
        Some(431),
        Some("carreira".into()),
    )?;
    books.finish(
        &clean.id,
        Some(5),
        Some("Mudou como escrevo funções.".into()),
    )?;

    let sapiens = books.create(
        "Sapiens",
        Some(estudos.id.clone()),
        Some("Yuval Harari".into()),
        Some(443),
        Some("pessoal".into()),
    )?;
    books.finish(&sapiens.id, Some(4), None)?;

    books.create(
        "A Guerra dos Tronos",
        Some(estudos.id.clone()),
        Some("George R. R. Martin".into()),
        Some(694),
        Some("ficcao".into()),
    )?; // fila

    books.set_reading_goal(12)?;
    println!("  4 livros na estante + meta de leitura");

    // ===== Carreira: um marco (M4) =====
    career.record_milestone(
        "Promovido a Engenheiro Sênior",
        CareerMilestoneKind::Promotion,
        Some(format_day(today - chrono::Duration::days(40))),
        Some("Depois de 2 anos no time de plataforma.".into()),
    )?;
    println!("  1 marco de carreira");

    // ===== Notas com wiki-links (M4) =====
    //
    // Duas notas que se citam: a segunda ganha um backlink automático da primeira.
    let protocolo = notes_svc.create("Protocolo de sono", Some(saude.id.clone()))?;
    let diario = notes_svc.create("Diário — semana", Some(saude.id.clone()))?;
    notes_svc.save_body(
        &protocolo.id,
        "# Protocolo de sono\n\n- Dormir 7h30 por noite\n- Sem telas 1h antes\n\nRelacionado: [[Diário — semana]]",
    )?;
    notes_svc.save_body(
        &diario.id,
        "Segui o [[Protocolo de sono]] 5 de 7 dias. Melhor disposição.\n\n- [x] segunda\n- [ ] domingo",
    )?;
    println!("  2 notas com wiki-links e backlinks");

    // ===== Um evento recorrente por dia-da-semana (ADR-0024) =====
    //
    // "Reunião de equipe, toda 3ª terça": a variante MonthlyByWeekday do M4,
    // materializada como qualquer outra recorrência.
    if let Some(first) = today.with_day(1) {
        events.create(&NewEvent {
            title: "Reunião de equipe".into(),
            area_id: Some(carreira.id.clone()),
            parent_id: None,
            details: NewEventDetails {
                starts_at: at(first, 10, 0),
                ends_at: at(first, 11, 0),
                all_day: false,
                rrule: Some(Recurrence::MonthlyByWeekday {
                    interval: 1,
                    week: 3,
                    weekday: 2,
                }),
                recurrence_end: None,
                location: Some("Sala 3".into()),
                category: None,
                notes: None,
            },
        })?;
        println!("  1 série 'toda 3ª terça'");
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

    // ===== Temporadas (M4.5) =====
    let challenges = ChallengeService {
        challenges: Arc::new(SqliteChallengeRepository::new(db.clone())),
        nodes: node_repo.clone(),
        areas: area_repo.clone(),
        habits: Arc::new(SqliteHabitRepository::new(db.clone())),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    // Ligada à Academia: conta os ticks dos últimos 60 dias na janela.
    challenges.create(
        "90 dias de treino",
        Some(saude.id.clone()),
        &format_day(today - chrono::Duration::days(60)),
        &format_day(today + chrono::Duration::days(30)),
        "habit_days",
        Some(academia.id.clone()),
        30,
    )?;
    // Manual, com progresso parcial marcado à mão.
    let ingles = challenges.create(
        "Q3 sem faltar inglês",
        Some(carreira.id.clone()),
        &format_day(today - chrono::Duration::days(10)),
        &format_day(today + chrono::Duration::days(80)),
        "manual",
        None,
        60,
    )?;
    for _ in 0..18 {
        challenges.increment(&ingles.challenge.id, 1)?;
    }
    println!("  2 temporadas");

    // ===== Metas Anuais (M4.5) =====
    let annual = AnnualGoalService {
        annual_goals: Arc::new(SqliteAnnualGoalRepository::new(db.clone())),
        areas: area_repo.clone(),
        ids: ids.clone(),
        clock: clock.clone(),
    };
    let year: i64 = clock.today_local()[..4].parse().unwrap_or(2026);
    let ler_ano = annual.create(
        "Ler 12 livros",
        Some(carreira.id.clone()),
        year,
        "quantitative",
        Some("livros".into()),
        Some(12.0),
        Some("livros".into()),
    )?;
    annual.update_progress(&ler_ano.goal.id, 5.0)?;
    annual.create(
        "Correr uma meia-maratona",
        Some(saude.id.clone()),
        year,
        "binary",
        None,
        None,
        None,
    )?;
    // Uma meta para o ano QUE VEM — planejar o futuro desde já (§2.3).
    annual.create(
        "Aprender alemão",
        Some(carreira.id.clone()),
        year + 1,
        "binary",
        None,
        None,
        None,
    )?;
    println!("  3 metas anuais ({year} e {})", year + 1);

    println!(
        "pronto — {} nodes no total",
        nodes.count(&Default::default())?
    );
    Ok(())
}
