//! Commands de Metas e sub-desafios.

use serde::Deserialize;
use tauri::State;

use crate::application::ports::{
    Checkpoint, Goal, Milestone, NewGoal, NewGoalDetails, NewMilestone,
};
use crate::application::use_cases::goals::GoalWithProgress;
use crate::domain::entities::{Direction, GoalKind, MilestoneKind, ProgressSource};
use crate::domain::errors::Result;
use crate::state::AppState;

/// A meta vinda da UI.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGoalDto {
    pub title: String,
    #[serde(default)]
    pub area_id: Option<String>,
    /// O tipo. O padrão é 'quantitative' — é o único tipo que existia antes da
    /// 0016, e é o que o formulário oferece primeiro.
    #[serde(default = "quantitative")]
    pub goal_kind: GoalKind,
    /// Os cinco campos da métrica, todos opcionais NO DTO: uma conquista não
    /// manda nenhum. Quem exige os cinco na quantitativa — e proíbe os cinco nas
    /// outras — é o `GoalService::create`, onde o erro sai em português.
    #[serde(default)]
    pub metric_name: Option<String>,
    #[serde(default)]
    pub start_value: Option<f64>,
    #[serde(default)]
    pub target_value: Option<f64>,
    #[serde(default)]
    pub unit: Option<String>,
    /// Ausente = deduzida de `startValue` vs `targetValue`. O formulário não
    /// precisa mais mandá-la; se mandar, tem que concordar com os números.
    #[serde(default)]
    pub direction: Option<Direction>,
    #[serde(default)]
    pub deadline: Option<i64>,
    /// Qual barra manda. O padrão é a métrica: é o que a coluna da 0007 faz com
    /// as metas que já existiam. Numa meta sem métrica o serviço a força para
    /// 'milestones'.
    #[serde(default = "metric")]
    pub progress_source: ProgressSource,
}

fn metric() -> ProgressSource {
    ProgressSource::Metric
}

fn quantitative() -> GoalKind {
    GoalKind::Quantitative
}

#[tauri::command]
pub fn create_goal(state: State<'_, AppState>, goal: NewGoalDto) -> Result<Goal> {
    state.goals.create(&NewGoal {
        title: goal.title,
        area_id: goal.area_id,
        details: NewGoalDetails {
            goal_kind: goal.goal_kind,
            metric_name: goal.metric_name,
            start_value: goal.start_value,
            target_value: goal.target_value,
            unit: goal.unit,
            direction: goal.direction,
            deadline: goal.deadline,
            progress_source: goal.progress_source,
        },
    })
}

#[tauri::command]
pub fn list_goals(state: State<'_, AppState>, area_id: Option<String>) -> Result<Vec<Goal>> {
    state.goals.list(area_id.as_deref())
}

/// A tela de uma meta inteira: barra, série, sub-desafios e projeção.
#[tauri::command]
pub fn goal_with_progress(state: State<'_, AppState>, id: String) -> Result<GoalWithProgress> {
    state.goals.get_with_progress(&id)
}

/// Registra uma medição. `notedAt` ausente = agora; o passado é aceito, o
/// futuro não — igual ao `day` do tick de hábito.
#[tauri::command]
pub fn add_goal_checkpoint(
    state: State<'_, AppState>,
    id: String,
    value: f64,
    note: Option<String>,
    noted_at: Option<i64>,
) -> Result<Checkpoint> {
    state.goals.add_checkpoint(&id, value, note, noted_at)
}

/// Um sub-desafio vindo da UI.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMilestoneDto {
    pub goal_id: String,
    pub title: String,
    #[serde(default = "simple")]
    pub kind: MilestoneKind,
    /// O hábito que alimenta o contador. Obrigatório num 'counter' — o backend
    /// recusa sem ele.
    #[serde(default)]
    pub habit_id: Option<String>,
    #[serde(default)]
    pub target_count: Option<i64>,
    #[serde(default = "one")]
    pub weight: f64,
    /// 'AAAA-MM-DD': de quando o contador conta. Ausente num 'counter' = hoje.
    #[serde(default)]
    pub counts_from: Option<String>,
}

fn simple() -> MilestoneKind {
    MilestoneKind::Simple
}

fn one() -> f64 {
    1.0
}

#[tauri::command]
pub fn add_milestone(state: State<'_, AppState>, milestone: NewMilestoneDto) -> Result<Milestone> {
    state.goals.add_milestone(&NewMilestone {
        title: milestone.title,
        goal_id: milestone.goal_id,
        kind: milestone.kind,
        habit_id: milestone.habit_id,
        target_count: milestone.target_count,
        weight: milestone.weight,
        counts_from: milestone.counts_from,
    })
}

/// O checkbox de um sub-desafio. Recusa os 'counter': eles se preenchem pelos
/// ticks do hábito ligado.
#[tauri::command]
pub fn set_milestone_done(state: State<'_, AppState>, id: String, done: bool) -> Result<Milestone> {
    state.goals.set_milestone_done(&id, done)
}

/// Qual barra manda nesta meta: a métrica ou os sub-desafios.
#[tauri::command]
pub fn set_goal_progress_source(
    state: State<'_, AppState>,
    id: String,
    source: ProgressSource,
) -> Result<Goal> {
    state.goals.set_progress_source(&id, source)
}

/// Arrasta um sub-desafio para outra posição na árvore.
#[tauri::command]
pub fn move_milestone(state: State<'_, AppState>, id: String, to_index: usize) -> Result<()> {
    state.goals.move_milestone(&id, to_index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_goal_defaults_to_measuring_by_its_metric() {
        // É o que a coluna da 0007 faz com as metas que já existiam; a UI e o
        // banco têm que concordar sobre o padrão.
        let dto: NewGoalDto = serde_json::from_str(
            r#"{"title":"Perder 10 kg","metricName":"Peso","startValue":90,
                "targetValue":80,"unit":"kg","direction":"decrease"}"#,
        )
        .unwrap();
        assert_eq!(dto.progress_source, ProgressSource::Metric);
        assert!(dto.deadline.is_none());
    }

    #[test]
    fn a_direction_outside_the_vocabulary_never_reaches_the_service() {
        assert!(serde_json::from_str::<NewGoalDto>(
            r#"{"title":"X","metricName":"Peso","startValue":90,
                "targetValue":80,"unit":"kg","direction":"para_baixo"}"#
        )
        .is_err());
    }

    #[test]
    fn a_milestone_defaults_to_a_simple_checkbox_of_weight_one() {
        // O caso comum é "mais um item da lista". Exigir kind e weight em toda
        // chamada faria a UI repetir o padrão em todo lugar.
        let dto: NewMilestoneDto =
            serde_json::from_str(r#"{"goalId":"g1","title":"Comprar tênis"}"#).unwrap();
        assert_eq!(dto.kind, MilestoneKind::Simple);
        assert_eq!(dto.weight, 1.0);
        assert!(dto.habit_id.is_none());
    }

    #[test]
    fn a_counter_milestone_carries_its_habit_and_target() {
        let dto: NewMilestoneDto = serde_json::from_str(
            r#"{"goalId":"g1","title":"30 dias sem açúcar","kind":"counter",
                "habitId":"h1","targetCount":30,"weight":2}"#,
        )
        .unwrap();
        assert_eq!(dto.kind, MilestoneKind::Counter);
        assert_eq!(dto.habit_id.as_deref(), Some("h1"));
        assert_eq!(dto.target_count, Some(30));
        assert_eq!(dto.weight, 2.0);
    }
}
