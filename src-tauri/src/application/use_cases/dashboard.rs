//! O Dashboard — a tela que responde "como está hoje?".

use std::sync::Arc;

use serde::Serialize;

use crate::application::ports::{HabitRepository, NodeFilter, NodeRepository, Task};
use crate::application::use_cases::{
    habits::{HabitService, HabitWithStats},
    tasks::TaskService,
};
use crate::domain::entities::{Kind, Status};
use crate::domain::errors::Result;
use crate::domain::score::{self, Score, ScoreInputs};
use crate::domain::streak::TickStatus;

/// Antes disso, um hábito é "matinal". Heurística, não ciência — mas explícita:
/// o score fala em "rotina matinal" e alguma linha precisava definir manhã.
const MORNING_BEFORE_HOUR: u32 = 12;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Today {
    pub day: String,
    pub habits: Vec<HabitWithStats>,
    pub tasks: Vec<Task>,
    pub score: Score,
    pub inbox_open: i64,
}

pub struct DashboardService {
    pub habits: Arc<HabitService>,
    pub tasks: Arc<TaskService>,
    pub habit_repo: Arc<dyn HabitRepository>,
    pub nodes: Arc<dyn NodeRepository>,
}

impl DashboardService {
    pub fn today(&self) -> Result<Today> {
        let habits = self.habits.today()?;
        let tasks = self.tasks.today()?;
        let (tasks_planned, tasks_done) = self.tasks.today_counts()?;

        let inbox_open = self.nodes.count(&NodeFilter {
            kind: Some(Kind::InboxItem),
            status: Some(Status::Active),
            limit: 1,
            ..Default::default()
        })?;

        let habits_scheduled = habits.len() as u32;
        let habits_done = habits
            .iter()
            .filter(|h| h.today == Some(TickStatus::Done))
            .count() as u32;

        let (routine_total, routine_done) = self.morning_routine_progress(&habits);

        let score = score::compute(ScoreInputs {
            habits_scheduled,
            habits_done,
            tasks_planned,
            tasks_done,
            routine_total,
            routine_done,
            inbox_open: inbox_open.max(0) as u32,
        });

        Ok(Today {
            day: self.habits.clock.today_local(),
            habits,
            tasks,
            score,
            inbox_open,
        })
    }

    /// Progresso da rotina matinal de hoje.
    ///
    /// Não existe uma flag "esta é a rotina matinal" — seria mais uma decisão
    /// para o usuário tomar antes de poder usar o app. A rotina matinal é
    /// inferida: a que tem algum hábito com lembrete antes das 12h. Se houver
    /// mais de uma, vence a de lembrete mais cedo. Sem nenhuma, devolve (0,0) e
    /// o peso de 20% se redistribui (ver `domain::score`).
    fn morning_routine_progress(&self, today: &[HabitWithStats]) -> (u32, u32) {
        let morning_routine = today
            .iter()
            .filter_map(|h| {
                let routine = h.habit.routine_id.as_ref()?;
                let hour = h
                    .habit
                    .reminder_time
                    .as_deref()
                    .and_then(|t| t.split_once(':'))
                    .and_then(|(h, _)| h.parse::<u32>().ok())?;
                (hour < MORNING_BEFORE_HOUR).then_some((hour, routine.clone()))
            })
            .min_by_key(|(hour, _)| *hour)
            .map(|(_, routine)| routine);

        let Some(routine_id) = morning_routine else {
            return (0, 0);
        };

        let members: Vec<_> = today
            .iter()
            .filter(|h| h.habit.routine_id.as_deref() == Some(routine_id.as_str()))
            .collect();

        let done = members
            .iter()
            .filter(|h| h.today == Some(TickStatus::Done))
            .count() as u32;

        (members.len() as u32, done)
    }
}
