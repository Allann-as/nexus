//! Composition root.
//!
//! O ÚNICO lugar onde as implementações concretas encontram os ports. É aqui —
//! e só aqui — que se sabe que `NodeRepository` é SQLite. Trocar o storage é
//! reescrever este arquivo.

use std::sync::Arc;

use crate::application::ports::{LedgerRepository, SearchRepository};
use crate::application::use_cases::{
    areas::AreaService, dashboard::DashboardService, habits::HabitService, nodes::NodeService,
    spheres::SphereService, tasks::TaskService,
};
use crate::domain::errors::Result;
use crate::infrastructure::clock::{SystemClock, Uuid7Gen};
use crate::infrastructure::db::Db;
use crate::infrastructure::fts::SqliteSearchRepository;
use crate::infrastructure::paths::Paths;
use crate::infrastructure::repositories::{
    area_repo::SqliteAreaRepository, habit_repo::SqliteHabitRepository,
    ledger_repo::SqliteLedgerRepository, node_repo::SqliteNodeRepository,
    sphere_repo::SqliteSphereRepository, task_repo::SqliteTaskRepository,
};

pub struct AppState {
    pub db: Arc<Db>,
    pub paths: Paths,
    pub areas: AreaService,
    pub nodes: NodeService,
    pub habits: Arc<HabitService>,
    pub tasks: Arc<TaskService>,
    pub dashboard: DashboardService,
    pub spheres: SphereService,
    pub ledger: Arc<dyn LedgerRepository>,
    pub search: Arc<dyn SearchRepository>,
}

impl AppState {
    pub fn new(db: Db, paths: Paths) -> Result<Self> {
        let db = Arc::new(db);

        let area_repo = Arc::new(SqliteAreaRepository::new(db.clone()));
        let node_repo = Arc::new(SqliteNodeRepository::new(db.clone()));
        let habit_repo = Arc::new(SqliteHabitRepository::new(db.clone()));
        let task_repo = Arc::new(SqliteTaskRepository::new(db.clone()));
        let sphere_repo = Arc::new(SqliteSphereRepository::new(db.clone()));
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

        let dashboard = DashboardService {
            habits: habits.clone(),
            tasks: tasks.clone(),
            habit_repo: habit_repo.clone(),
            nodes: node_repo.clone(),
        };

        let spheres = SphereService {
            areas: area_repo.clone(),
            habits: habit_repo,
            spheres: sphere_repo,
            clock: clock.clone(),
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
            dashboard,
            spheres,
            ledger,
            search,
            db,
            paths,
        })
    }
}
