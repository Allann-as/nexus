//! Ports — as fronteiras que o domínio declara e a infraestrutura implementa.
//!
//! É a inversão de dependência que sustenta a regra de camadas: os casos de uso
//! falam com estes traits, nunca com o SQLite. Trocar o storage é implementar
//! estes traits de novo, sem tocar em uma linha de regra de negócio.

use crate::domain::entities::{Area, Kind, Node, Status, Template};
use crate::domain::errors::Result;
use crate::domain::ledger::{LedgerEntry, NewLedgerEvent};
use crate::domain::schedule::Schedule;
use crate::domain::streak::TickStatus;

/// O tempo, como dependência explícita.
///
/// Sem isto, todo caso de uso chamaria `Utc::now()` direto e seria intestável:
/// não daria para verificar "streak não quebra em dia não agendado" sem esperar
/// a meia-noite de verdade. Com o port, o teste injeta o dia que quiser.
pub trait Clock: Send + Sync {
    /// Epoch em milissegundos, UTC.
    fn now_ms(&self) -> i64;

    /// O dia corrente no fuso LOCAL, como 'YYYY-MM-DD'.
    ///
    /// Local e não UTC de propósito: "fiz o hábito hoje?" é uma pergunta sobre
    /// o dia do usuário. Em UTC, quem marca um hábito às 22h em Brasília veria
    /// o tick cair no dia seguinte.
    fn today_local(&self) -> String;
}

/// Gerador de identidade.
pub trait IdGen: Send + Sync {
    /// UUIDv7: ordenável por tempo, então os inserts caem no fim da B-tree em
    /// vez de espalhar page splits pelo índice inteiro.
    fn new_id(&self) -> String;
}

#[derive(Debug, Clone)]
pub struct NewArea {
    pub name: String,
    pub icon: String,
    pub color: String,
    pub template: Template,
}

/// Sem `template`: uma Esfera não troca de tela depois de criada.
///
/// Não é limitação técnica, é proteção. Virar "Saúde" em "Agenda simples"
/// deixaria os checkpoints e o histórico de treino órfãos — dados vivos sem
/// tela que os mostre. Nome, cor e ícone são cosméticos e mudam à vontade; o
/// template é estrutural.
#[derive(Debug, Clone)]
pub struct AreaPatch {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i64>,
}

pub trait AreaRepository: Send + Sync {
    fn create(&self, id: &str, area: &NewArea) -> Result<Area>;
    fn get(&self, id: &str) -> Result<Area>;
    fn list(&self, include_archived: bool) -> Result<Vec<Area>>;
    fn update(&self, id: &str, patch: &AreaPatch) -> Result<Area>;
    fn archive(&self, id: &str, at: i64) -> Result<()>;
    fn exists(&self, id: &str) -> Result<bool>;
}

#[derive(Debug, Clone)]
pub struct NewNode {
    pub kind: Kind,
    pub title: String,
    pub area_id: Option<String>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct NodeFilter {
    pub kind: Option<Kind>,
    pub status: Option<Status>,
    pub area_id: Option<String>,
    pub parent_id: Option<String>,
    pub limit: i64,
    pub offset: i64,
}

/// Alteração parcial de um node. `None` em um campo = não mexer.
///
/// `area_id` é `Option<Option<_>>` de propósito: o externo diz "mexer ou não",
/// o interno carrega o valor — que pode ser `None` para desassociar da Área.
/// Sem os dois níveis, "tirar a área" e "não mexer na área" seriam
/// indistinguíveis.
#[derive(Debug, Clone, Default)]
pub struct NodePatch<'a> {
    pub title: Option<&'a str>,
    pub status: Option<Status>,
    pub area_id: Option<Option<&'a str>>,
    pub kind: Option<Kind>,
}

pub trait NodeRepository: Send + Sync {
    /// Cria o node E grava o evento de ledger na MESMA transação.
    ///
    /// A assinatura força isso de propósito: se `create` e `append` fossem
    /// chamadas separadas, um dia alguém esqueceria a segunda e a história
    /// ficaria com um buraco silencioso. Ou os dois acontecem, ou nenhum.
    fn create_with_event(&self, id: &str, node: &NewNode, event: &NewLedgerEvent) -> Result<Node>;

    fn get(&self, id: &str) -> Result<Node>;
    fn list(&self, filter: &NodeFilter) -> Result<Vec<Node>>;
    fn count(&self, filter: &NodeFilter) -> Result<i64>;

    /// Aplica o patch e registra o evento, na mesma transação.
    fn update_with_event(
        &self,
        id: &str,
        patch: &NodePatch<'_>,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Node>;

    fn delete_with_event(&self, id: &str, event: &NewLedgerEvent) -> Result<()>;
}

/* ===== Esferas (o Hub) ===== */

/// As leituras em lote do Hub.
///
/// Existe como port separado, e não como mais dois métodos em
/// `HabitRepository`/`NodeRepository`, porque a pergunta é de outra natureza:
/// os repositórios existentes respondem sobre UMA entidade ("os ticks do hábito
/// X"), e o Hub pergunta sobre TODAS de uma vez ("os ticks de todo mundo").
/// Misturar as duas faria a tela mais aberta do app cair no N+1 sem que
/// ninguém percebesse.
pub trait SphereRepository: Send + Sync {
    /// Todos os ticks de todos os hábitos desde um dia, em UMA query.
    /// Devolve (habit_id, day, tick). Usa `idx_ticks_day` (0005).
    fn ticks_since(&self, from_day: &str) -> Result<Vec<(String, String, Tick)>>;

    /// Nodes ativos por (area_id, kind), em UMA query.
    /// `None` no area_id = os órfãos (Inbox).
    fn active_node_counts_by_area(&self) -> Result<Vec<(Option<String>, Kind, i64)>>;
}

pub trait LedgerRepository: Send + Sync {
    fn append(&self, event: &NewLedgerEvent) -> Result<i64>;
    fn range(
        &self,
        from_day: &str,
        to_day: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<LedgerEntry>>;
    fn for_entity(&self, entity_id: &str, limit: i64) -> Result<Vec<LedgerEntry>>;
    fn count(&self) -> Result<i64>;
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub node_id: String,
    pub kind: String,
    pub title: String,
    pub snippet: String,
    /// bm25 do FTS5: MENOR é mais relevante (é uma distância, não uma nota).
    pub rank: f64,
}

pub trait SearchRepository: Send + Sync {
    fn search(&self, query: &str, limit: i64, offset: i64) -> Result<Vec<SearchHit>>;
    fn rebuild(&self) -> Result<()>;
}

/* ===== Hábitos ===== */

#[derive(Debug, Clone)]
pub struct NewHabitDetails {
    pub schedule: Schedule,
    pub target_value: Option<f64>,
    pub unit: Option<String>,
    pub routine_id: Option<String>,
    pub reminder_time: Option<String>,
}

/// Um hábito: o node + os detalhes do satélite, já juntos.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub status: String,
    pub schedule: Schedule,
    pub target_value: Option<f64>,
    pub unit: Option<String>,
    pub routine_id: Option<String>,
    pub routine_order: Option<i64>,
    pub reminder_time: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct Tick {
    pub status: TickStatus,
    pub value: Option<f64>,
}

pub trait HabitRepository: Send + Sync {
    fn create_details(&self, node_id: &str, details: &NewHabitDetails) -> Result<()>;
    fn get(&self, id: &str) -> Result<Habit>;
    fn list(&self, area_id: Option<&str>, include_archived: bool) -> Result<Vec<Habit>>;
    fn list_in_routine(&self, routine_id: &str) -> Result<Vec<Habit>>;
    fn update_schedule(&self, id: &str, schedule: &Schedule) -> Result<()>;

    /// Marca um hábito num dia E grava o evento, na mesma transação.
    fn tick_with_event(
        &self,
        habit_id: &str,
        day: &str,
        tick: Tick,
        ts: i64,
        event: &NewLedgerEvent,
    ) -> Result<()>;

    /// Desmarca (o usuário errou o clique).
    fn untick_with_event(&self, habit_id: &str, day: &str, event: &NewLedgerEvent) -> Result<()>;

    /// Ticks de um hábito num intervalo de dias — a série do heatmap.
    fn ticks_in_range(&self, habit_id: &str, from: &str, to: &str) -> Result<Vec<(String, Tick)>>;

    /// Ticks de TODOS os hábitos num único dia. Uma query, não N.
    fn ticks_on_day(&self, day: &str) -> Result<Vec<(String, Tick)>>;

    /// Marca uma rotina inteira: N ticks + N eventos, UMA transação.
    fn complete_routine(
        &self,
        routine_id: &str,
        day: &str,
        ts: i64,
        events: &[(String, NewLedgerEvent)],
    ) -> Result<u32>;

    /// Taxa de falha por dia da semana (0=domingo). Alimenta os "ofensores".
    fn failure_rate_by_weekday(&self, habit_id: &str, since: &str) -> Result<Vec<(u8, u32, u32)>>;
}

/* ===== Tarefas ===== */

#[derive(Debug, Clone, Default)]
pub struct NewTaskDetails {
    pub due_at: Option<i64>,
    pub scheduled_at: Option<i64>,
    pub duration_min: Option<i64>,
    pub priority: i64,
    pub energy: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub parent_id: Option<String>,
    pub status: String,
    pub due_at: Option<i64>,
    pub scheduled_at: Option<i64>,
    pub duration_min: Option<i64>,
    pub priority: i64,
    pub energy: Option<String>,
    pub completed_at: Option<i64>,
    pub sort_order: f64,
}

#[derive(Debug, Clone, Default)]
pub struct TaskPatch {
    pub due_at: Option<Option<i64>>,
    pub scheduled_at: Option<Option<i64>>,
    pub duration_min: Option<Option<i64>>,
    pub priority: Option<i64>,
    pub energy: Option<Option<String>>,
}

/// Progresso de um projeto = tarefas concluídas / total.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub done: i64,
    pub total: i64,
}

pub trait TaskRepository: Send + Sync {
    fn create_details(&self, node_id: &str, details: &NewTaskDetails) -> Result<()>;
    fn get(&self, id: &str) -> Result<Task>;
    fn list_for_project(&self, project_id: &str, include_done: bool) -> Result<Vec<Task>>;

    /// Tarefas agendadas para um dia (janela epoch-ms) — a coluna "Hoje".
    fn scheduled_between(&self, from_ms: i64, to_ms: i64) -> Result<Vec<Task>>;

    fn update(&self, id: &str, patch: &TaskPatch) -> Result<Task>;

    /// Conclui/reabre e grava o evento, na mesma transação.
    fn set_completed_with_event(
        &self,
        id: &str,
        completed_at: Option<i64>,
        event: &NewLedgerEvent,
    ) -> Result<Task>;

    /// Reordena por média dos vizinhos: um update, uma linha.
    fn reorder(&self, id: &str, new_order: f64) -> Result<()>;

    /// Vizinhos de uma posição, para calcular a média do arrasto.
    fn neighbours(&self, project_id: &str, index: usize) -> Result<(Option<f64>, Option<f64>)>;

    /// Reespaça a ordem quando o intervalo entre vizinhos satura o double.
    fn renumber_project_tasks(&self, project_id: &str) -> Result<()>;

    fn progress(&self, project_id: &str) -> Result<Progress>;

    /// Contagem de tarefas planejadas/concluídas num dia — entrada do score.
    fn day_counts(&self, from_ms: i64, to_ms: i64) -> Result<(u32, u32)>;
}
