//! Casos de uso de Tarefas e Projetos.

use std::sync::Arc;

use serde_json::json;

use crate::application::ports::{
    AreaRepository, Clock, IdGen, NewNode, NewTaskDetails, NodeRepository, Progress, Task,
    TaskPatch, TaskRepository,
};
use crate::domain::entities::{validate_title, Kind, Status};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, NewLedgerEvent};
use crate::domain::ordering::order_between;

pub struct TaskService {
    pub tasks: Arc<dyn TaskRepository>,
    pub nodes: Arc<dyn NodeRepository>,
    pub areas: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl TaskService {
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        title: &str,
        area_id: Option<&str>,
        project_id: Option<&str>,
        due_at: Option<i64>,
        scheduled_at: Option<i64>,
        duration_min: Option<i64>,
        priority: i64,
        energy: Option<String>,
    ) -> Result<Task> {
        let title = validate_title(title)?;

        if !(1..=3).contains(&priority) {
            return Err(NexusError::Validation(format!(
                "prioridade inválida: {priority} (1=alta, 2=média, 3=baixa)"
            )));
        }
        if let Some(e) = &energy {
            if e != "deep" && e != "shallow" {
                return Err(NexusError::Validation(format!(
                    "energia inválida: {e} (esperado 'deep' ou 'shallow')"
                )));
            }
        }
        if let Some(d) = duration_min {
            if d <= 0 || d > 24 * 60 {
                return Err(NexusError::Validation(format!("duração inválida: {d} min")));
            }
        }
        if let Some(aid) = area_id {
            if !self.areas.exists(aid)? {
                return Err(NexusError::NotFound(format!("área {aid} não existe")));
            }
        }
        if let Some(pid) = project_id {
            let project = self.nodes.get(pid)?;
            if project.kind != Kind::Project {
                return Err(NexusError::Validation(
                    "uma tarefa só pode pertencer a um projeto".into(),
                ));
            }
        }

        let id = self.ids.new_id();
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: Kind::Task.into(),
            event_type: EventType::Created,
            payload: json!({ "priority": priority, "project": project_id }),
            title_snapshot: title.clone(),
        };

        self.nodes.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Task,
                title,
                area_id: area_id.map(str::to_string),
                parent_id: project_id.map(str::to_string),
            },
            &event,
        )?;

        self.tasks.create_details(
            &id,
            &NewTaskDetails {
                due_at,
                scheduled_at,
                duration_min,
                priority,
                energy,
            },
        )?;

        self.tasks.get(&id)
    }

    pub fn create_project(&self, title: &str, area_id: Option<&str>) -> Result<String> {
        let title = validate_title(title)?;
        if let Some(aid) = area_id {
            if !self.areas.exists(aid)? {
                return Err(NexusError::NotFound(format!("área {aid} não existe")));
            }
        }

        let id = self.ids.new_id();
        let event = NewLedgerEvent {
            ts: self.clock.now_ms(),
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: Kind::Project.into(),
            event_type: EventType::Created,
            payload: json!({}),
            title_snapshot: title.clone(),
        };
        self.nodes.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Project,
                title,
                area_id: area_id.map(str::to_string),
                parent_id: None,
            },
            &event,
        )?;
        Ok(id)
    }

    pub fn list_for_project(&self, project_id: &str, include_done: bool) -> Result<Vec<Task>> {
        self.tasks.list_for_project(project_id, include_done)
    }

    pub fn get(&self, id: &str) -> Result<Task> {
        self.tasks.get(id)
    }

    pub fn progress(&self, project_id: &str) -> Result<Progress> {
        self.tasks.progress(project_id)
    }

    /// Conclui (ou reabre) uma tarefa.
    ///
    /// `task_details.completed_at` e `nodes.status` são duas representações do
    /// mesmo fato; o repositório escreve as duas — e o evento — numa única
    /// transação. UM evento, não dois: concluir uma tarefa é um acontecimento
    /// na vida do usuário, não dois.
    pub fn set_completed(&self, id: &str, done: bool) -> Result<Task> {
        let task = self.tasks.get(id)?;
        let now = self.clock.now_ms();

        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: Kind::Task.into(),
            // 'completed' é o que o BI conta como conclusão. Reabrir não é
            // uma conclusão negativa — é outra coisa.
            event_type: if done {
                EventType::Completed
            } else {
                EventType::StatusChanged
            },
            payload: json!({
                "done": done,
                "status": if done { Status::Done } else { Status::Active }.as_str(),
            }),
            title_snapshot: task.title,
        };

        self.tasks
            .set_completed_with_event(id, done.then_some(now), &event)
    }

    pub fn update(&self, id: &str, patch: &TaskPatch) -> Result<Task> {
        if let Some(p) = patch.priority {
            if !(1..=3).contains(&p) {
                return Err(NexusError::Validation(format!(
                    "prioridade inválida: {p} (1=alta, 2=média, 3=baixa)"
                )));
            }
        }
        self.tasks.update(id, patch)
    }

    /// Move uma tarefa para a posição `to_index` dentro do projeto.
    ///
    /// A nova ordem é a MÉDIA dos vizinhos, então mover é UM update de UMA
    /// linha — não renumerar a lista inteira. Quando os vizinhos ficam perto
    /// demais para a média significar algo, reespaça primeiro e recalcula.
    pub fn move_to(&self, id: &str, project_id: &str, to_index: usize) -> Result<()> {
        let (before, after) = self.tasks.neighbours(project_id, to_index)?;

        let new_order = match order_between(before, after) {
            Some(order) => order,
            None => {
                // Saturou: reespaça e refaz a conta com folga.
                self.tasks.renumber_project_tasks(project_id)?;
                let (a, b) = self.tasks.neighbours(project_id, to_index)?;
                // O reespaçamento devolve folga 1.0 entre vizinhos, então a
                // média não pode saturar de novo — e se saturasse, 0.0 é a
                // origem de uma lista que acabou de ser renumerada.
                order_between(a, b).unwrap_or(0.0)
            }
        };

        self.tasks.reorder(id, new_order)
    }

    /// Tarefas agendadas para hoje, em ordem cronológica.
    pub fn today(&self) -> Result<Vec<Task>> {
        let (from, to) = self.day_window()?;
        self.tasks.scheduled_between(from, to)
    }

    /// (planejadas, concluídas) de hoje — entrada do Nexus Score.
    pub fn today_counts(&self) -> Result<(u32, u32)> {
        let (from, to) = self.day_window()?;
        self.tasks.day_counts(from, to)
    }

    /// A janela epoch-ms do dia LOCAL corrente.
    ///
    /// `scheduled_at` é epoch UTC, mas "hoje" é uma pergunta local. Sem
    /// converter, quem agenda às 21h em Brasília veria a tarefa cair amanhã.
    fn day_window(&self) -> Result<(i64, i64)> {
        use chrono::TimeZone;
        let today = crate::domain::schedule::parse_day(&self.clock.today_local())?;

        let start = chrono::Local
            .from_local_datetime(&today.and_hms_opt(0, 0, 0).expect("meia-noite existe"))
            .single()
            .ok_or_else(|| {
                // Horário de verão pode tornar a meia-noite local ambígua ou
                // inexistente. Raro, mas explodir aqui seria pior que assumir.
                NexusError::Validation("meia-noite ambígua no fuso local".into())
            })?
            .timestamp_millis();

        Ok((start, start + 86_400_000))
    }
}
