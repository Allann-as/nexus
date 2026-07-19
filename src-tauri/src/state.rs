//! Composition root.
//!
//! O ÚNICO lugar onde as implementações concretas encontram os ports. É aqui —
//! e só aqui — que se sabe que `NodeRepository` é SQLite. Trocar o storage é
//! reescrever este arquivo.

use std::sync::Arc;

use crate::application::ports::{LedgerRepository, SearchRepository};
use crate::application::use_cases::{
    annual_goals::AnnualGoalService,
    areas::AreaService,
    books::BookService,
    career::CareerService,
    challenges::ChallengeService,
    dashboard::DashboardService,
    events::EventService,
    fin_goals::FinGoalService,
    finance::FinanceService,
    focus::FocusService,
    gamification::GamificationService,
    goals::GoalService,
    habits::HabitService,
    insights::{InsightService, InsightWorker},
    links::LinkService,
    nodes::NodeService,
    notes::NoteService,
    perfect_weeks::PerfectWeekService,
    period_stats::PeriodStatsService,
    records::RecordsService,
    score_history::ScoreHistoryService,
    spheres::SphereService,
    studies::StudyService,
    tasks::TaskService,
    timeline::TimelineService,
    weekly_review::WeeklyReviewService,
};
use crate::domain::errors::Result;
use crate::infrastructure::backup::BackupEngine;
use crate::infrastructure::clock::{SystemClock, Uuid7Gen};
use crate::infrastructure::db::Db;
use crate::infrastructure::export::ExportEngine;
use crate::infrastructure::fts::SqliteSearchRepository;
use crate::infrastructure::paths::Paths;
use crate::infrastructure::repositories::{
    annual_goal_repo::SqliteAnnualGoalRepository, area_repo::SqliteAreaRepository,
    book_repo::SqliteBookRepository, challenge_repo::SqliteChallengeRepository,
    contribution_repo::SqliteContributionRepository, event_repo::SqliteEventRepository,
    fin_goal_repo::SqliteFinGoalRepository, focus_session_repo::SqliteFocusSessionRepository,
    gamification_repo::SqliteGamificationRepository, goal_repo::SqliteGoalRepository,
    habit_repo::SqliteHabitRepository, insight_repo::SqliteInsightRepository,
    ledger_repo::SqliteLedgerRepository, link_repo::SqliteLinkRepository,
    node_repo::SqliteNodeRepository, note_repo::SqliteNoteRepository,
    period_repo::SqlitePeriodStatsRepository, records_repo::SqliteRecordsRepository,
    skill_repo::SqliteSkillRepository, sphere_repo::SqliteSphereRepository,
    study_session_repo::SqliteStudySessionRepository, subject_repo::SqliteSubjectRepository,
    task_repo::SqliteTaskRepository, timeline_repo::SqliteTimelineRepository,
};
use crate::infrastructure::security::SecurityService;

pub struct AppState {
    pub db: Arc<Db>,
    pub paths: Paths,
    pub areas: AreaService,
    pub nodes: NodeService,
    pub habits: Arc<HabitService>,
    pub tasks: Arc<TaskService>,
    pub events: EventService,
    pub goals: GoalService,
    pub finance: FinanceService,
    pub fin_goals: FinGoalService,
    pub books: BookService,
    pub career: CareerService,
    pub studies: StudyService,
    pub focus: FocusService,
    pub timeline: TimelineService,
    pub notes: NoteService,
    pub links: LinkService,
    pub dashboard: DashboardService,
    pub spheres: SphereService,
    pub insights: Arc<InsightService>,
    pub insights_worker: InsightWorker,
    pub gamification: GamificationService,
    pub perfect_weeks: PerfectWeekService,
    pub records: RecordsService,
    pub period_stats: PeriodStatsService,
    pub challenges: ChallengeService,
    pub annual_goals: AnnualGoalService,
    pub score_history: ScoreHistoryService,
    pub weekly_review: WeeklyReviewService,
    pub ledger: Arc<dyn LedgerRepository>,
    pub search: Arc<dyn SearchRepository>,
    /// O motor de backup (M5): snapshot consistente, poda por retenção e restauro.
    pub backups: BackupEngine,
    /// A exportação humana (M5): JSON por tabela + CSVs + mídia + README.
    pub exports: ExportEngine,
    /// A tela de bloqueio por PIN (M5.5 §3.5): privacidade de tela, não de disco.
    pub security: SecurityService,
}

impl AppState {
    pub fn new(db: Db, paths: Paths) -> Result<Self> {
        let db = Arc::new(db);

        let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
        let node_repo = Arc::new(SqliteNodeRepository::new(db.clone()));
        let habit_repo = Arc::new(SqliteHabitRepository::new(db.clone()));
        let task_repo = Arc::new(SqliteTaskRepository::new(db.clone()));
        let sphere_repo = Arc::new(SqliteSphereRepository::new(db.clone()));
        let event_repo = Arc::new(SqliteEventRepository::new(db.clone()));
        let goal_repo = Arc::new(SqliteGoalRepository::new(db.clone()));
        let contribution_repo = Arc::new(SqliteContributionRepository::new(db.clone()));
        let fin_goal_repo = Arc::new(SqliteFinGoalRepository::new(db.clone()));
        let ledger: Arc<dyn LedgerRepository> = Arc::new(SqliteLedgerRepository::new(db.clone()));
        let search: Arc<dyn SearchRepository> = Arc::new(SqliteSearchRepository::new(db.clone()));

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
            tasks: task_repo,
            nodes: node_repo.clone(),
            areas: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        });

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
            ids: ids.clone(),
            clock: clock.clone(),
        };

        let finance = FinanceService {
            contributions: contribution_repo,
            fin_goals: fin_goal_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        };

        let fin_goals = FinGoalService {
            fin_goals: fin_goal_repo,
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

        let career = CareerService {
            skills: Arc::new(SqliteSkillRepository::new(db.clone())),
            areas: area_repo.clone(),
            ledger: ledger.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        };

        // Os Estudos (item 7): matérias (nodes 'subject') e sessões (um LOG), com
        // estatísticas determinísticas. A sessão grava estado + ledger juntos.
        let studies = StudyService {
            subjects: Arc::new(SqliteSubjectRepository::new(db.clone())),
            sessions: Arc::new(SqliteStudySessionRepository::new(db.clone())),
            areas: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        };

        // O Modo Foco (M5): blocos de foco (um LOG), com estatísticas
        // determinísticas. O bloco grava estado + ledger juntos, e vale XP.
        let focus = FocusService {
            sessions: Arc::new(SqliteFocusSessionRepository::new(db.clone())),
            nodes: node_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        };

        let timeline = TimelineService {
            timeline: Arc::new(SqliteTimelineRepository::new(db.clone())),
            ledger: ledger.clone(),
            clock: clock.clone(),
        };

        let notes = NoteService {
            notes: Arc::new(SqliteNoteRepository::new(db.clone())),
            nodes: node_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
            paths: paths.clone(),
        };

        let links = LinkService {
            links: Arc::new(SqliteLinkRepository::new(db.clone())),
            nodes: node_repo.clone(),
            clock: clock.clone(),
        };

        let dashboard = DashboardService {
            habits: habits.clone(),
            tasks: tasks.clone(),
            habit_repo: habit_repo.clone(),
            nodes: node_repo.clone(),
        };

        let spheres = SphereService {
            areas: area_repo.clone(),
            habits: habit_repo.clone(),
            spheres: sphere_repo,
            clock: clock.clone(),
        };

        // O bi_engine: um serviço de leitura + um worker que aquece o cache no
        // boot e recomputa debounced. Ver ADR-0040.
        let insights = Arc::new(InsightService {
            insights: Arc::new(SqliteInsightRepository::new(db.clone())),
            clock: clock.clone(),
        });
        let insights_worker = InsightWorker::spawn(insights.clone());

        // A gamificação: XP derivado do estado (ADR-0037) e a galeria de
        // conquistas, cujo desbloqueio é gravado no ledger (ADR-0038).
        let gamification = GamificationService {
            gami: Arc::new(SqliteGamificationRepository::new(db.clone())),
            habits: habit_repo.clone(),
            ledger: ledger.clone(),
            insights: Arc::new(SqliteInsightRepository::new(db.clone())),
            clock: clock.clone(),
        };

        // Semana perfeita (ARSENAL): o calendário e a sequência, DERIVADOS das
        // séries de hábito — nada gravado.
        let perfect_weeks = PerfectWeekService {
            insights: Arc::new(SqliteInsightRepository::new(db.clone())),
            clock: clock.clone(),
        };

        // Recordes pessoais (ARSENAL): máximos DERIVADOS do estado, e o momento em
        // que a régua sobe congelado no ledger (ADR-0060).
        let records = RecordsService {
            records: Arc::new(SqliteRecordsRepository::new(db.clone())),
            habits: habit_repo.clone(),
            ledger: ledger.clone(),
            clock: clock.clone(),
        };

        // Comparativo de períodos (ARSENAL): mês/ano até-a-data vs o anterior,
        // por somas de intervalo indexado (ADR-0062).
        let period_stats = PeriodStatsService {
            period: Arc::new(SqlitePeriodStatsRepository::new(db.clone())),
            ledger: ledger.clone(),
            clock: clock.clone(),
        };

        // As temporadas/desafios (§2.2): nodes 'challenge' com placar computado.
        let challenges = ChallengeService {
            challenges: Arc::new(SqliteChallengeRepository::new(db.clone())),
            areas: area_repo.clone(),
            habits: habit_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        };

        // As Metas Anuais (§2.3): nodes 'annual_goal' organizados por ano.
        let annual_goals = AnnualGoalService {
            annual_goals: Arc::new(SqliteAnnualGoalRepository::new(db.clone())),
            areas: area_repo.clone(),
            ids: ids.clone(),
            clock: clock.clone(),
        };

        // O Nexus Score congelado (ADR-0039): congela os dias fechados no ledger.
        let score_history = ScoreHistoryService {
            insights: Arc::new(SqliteInsightRepository::new(db.clone())),
            ledger: ledger.clone(),
            clock: clock.clone(),
        };

        // O motor de backup (M5): adjacente ao storage, usa o domínio para a
        // política de retenção. `paths.clone()` porque `paths` é movido logo abaixo.
        let backups = BackupEngine::new(db.clone(), paths.clone(), clock.clone());
        let exports = ExportEngine::new(db.clone(), paths.clone(), clock.clone());

        // A tela de bloqueio (M5.5 §3.5): semeia o PIN de fábrica no primeiro boot
        // (idempotente). Vive em disco, fora do banco — sobrevive a um restauro.
        let security = SecurityService::new(paths.clone());
        security.ensure_seeded()?;

        // A Revisão Semanal (M5): o ritual de 6 passos. O rascunho vive em disco
        // (retomável); o evento só entra no ledger quando os 6 passos fecham.
        let weekly_review = WeeklyReviewService {
            ledger: ledger.clone(),
            habits: habit_repo.clone(),
            clock: clock.clone(),
            paths: paths.clone(),
        };

        Ok(Self {
            areas: AreaService {
                repo: area_repo.clone(),
                ids: ids.clone(),
                clock: clock.clone(),
            },
            nodes: NodeService {
                nodes: node_repo,
                areas: area_repo,
                ids,
                clock,
            },
            habits,
            tasks,
            events,
            goals,
            finance,
            fin_goals,
            books,
            career,
            studies,
            focus,
            timeline,
            notes,
            links,
            dashboard,
            spheres,
            insights,
            insights_worker,
            gamification,
            perfect_weeks,
            records,
            period_stats,
            challenges,
            annual_goals,
            score_history,
            weekly_review,
            ledger,
            search,
            backups,
            exports,
            security,
            db,
            paths,
        })
    }
}
