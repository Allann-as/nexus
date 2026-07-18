//! Ports — as fronteiras que o domínio declara e a infraestrutura implementa.
//!
//! É a inversão de dependência que sustenta a regra de camadas: os casos de uso
//! falam com estes traits, nunca com o SQLite. Trocar o storage é implementar
//! estes traits de novo, sem tocar em uma linha de regra de negócio.

use crate::domain::entities::{
    AnnualGoalKind, Area, AssetClass, BookStatus, ChallengeMetric, Direction, Kind, MilestoneKind,
    Node, ProgressSource, Status, Template,
};
use crate::domain::errors::Result;
use crate::domain::ledger::{LedgerEntry, NewLedgerEvent};
use crate::domain::recurrence::Recurrence;
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

    /// Os eventos de um tipo de entidade (ex.: 'career_milestone'), do mais
    /// recente ao mais antigo. O painel da Carreira lê os marcos por aqui.
    fn by_entity_kind(&self, entity_kind: &str, limit: i64) -> Result<Vec<LedgerEntry>>;

    fn count(&self) -> Result<i64>;
}

/* ===== Timeline: a Máquina do Tempo ===== */

/// Um mês congelado — as contagens que a visão ANO desenha.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthRollup {
    /// 'YYYY-MM'.
    pub month: String,
    pub events: i64,
    /// Conquistas (event_type = 'completed').
    pub completed: i64,
    /// Marcações de hábito ('checked').
    pub checked: i64,
}

pub trait TimelineRepository: Send + Sync {
    /// Meses ('YYYY-MM') com evento no ledger anteriores a `current_month`.
    fn ledger_months_before(&self, current_month: &str) -> Result<Vec<String>>;
    /// Meses já congelados em `timeline_rollups`.
    fn rolled_up_months(&self) -> Result<Vec<String>>;
    /// Congela um mês (idempotente).
    fn freeze_month(&self, month: &str, now: i64) -> Result<()>;
    /// Os rollups de um ano; o mês corrente é computado ao vivo.
    fn year(&self, year: &str, current_month: &str) -> Result<Vec<MonthRollup>>;
    /// "Neste dia": eventos do mesmo 'MM-DD' de anos anteriores.
    fn on_this_day(&self, today: &str) -> Result<Vec<LedgerEntry>>;
}

/* ===== Notas: corpo, wiki-links e anexos ===== */

/// O resumo de uma nota — o item da lista.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub is_pinned: bool,
    pub updated_at: i64,
}

/// Um elo de/para uma nota, com o alvo já resolvido para exibir.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLink {
    pub node_id: String,
    pub kind: Kind,
    pub title: String,
    /// 'related' | 'blocks' | 'references' | 'attached_to'.
    pub link_type: String,
}

/// Um anexo (um node 'file' linkado à nota).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub node_id: String,
    pub title: String,
    pub relative_path: String,
    pub mime: String,
    pub size_bytes: i64,
    pub sha256: String,
}

/// Uma nota inteira: corpo, elos de saída (wiki-links resolvidos + anexos) e
/// backlinks (quem aponta para ela).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFull {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub body_md: String,
    pub is_pinned: bool,
    pub updated_at: i64,
    pub outgoing: Vec<NoteLink>,
    pub backlinks: Vec<NoteLink>,
    pub attachments: Vec<Attachment>,
}

/// Os dados de um anexo já copiado para a mídia — o que o repo grava.
#[derive(Debug, Clone)]
pub struct NewAttachment {
    pub title: String,
    pub relative_path: String,
    pub mime: String,
    pub size_bytes: i64,
    pub sha256: String,
    pub area_id: Option<String>,
}

pub trait NoteRepository: Send + Sync {
    fn list(&self, area_id: Option<&str>) -> Result<Vec<NoteSummary>>;
    fn get_full(&self, id: &str) -> Result<NoteFull>;

    /// Salva o corpo (upsert em `note_details`), RESINCRONIZA os wiki-links
    /// (substitui os elos 'references' desta nota pelos `resolved`) e grava o
    /// evento — tudo na mesma transação. Os elos 'attached_to' (anexos) NÃO são
    /// tocados: eles não vêm do texto.
    fn save_body_with_event(
        &self,
        id: &str,
        body_md: &str,
        resolved: &[String],
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<NoteFull>;

    fn set_pinned(&self, id: &str, pinned: bool) -> Result<()>;

    /// Resolve um título para o id de um node (case-insensitive, o mais recente),
    /// exceto o próprio `exclude_id`. `None` = elo pendente (o alvo não existe).
    fn find_by_title(&self, title: &str, exclude_id: &str) -> Result<Option<String>>;

    /// Se já existe um arquivo com este SHA, devolve o caminho relativo dele — a
    /// dedup: o mesmo conteúdo é gravado uma vez só.
    fn path_for_sha(&self, sha256: &str) -> Result<Option<String>>;

    /// Cria o node 'file', o satélite e o link 'attached_to' com a nota, e grava
    /// o evento — na mesma transação.
    fn attach_with_event(
        &self,
        file_id: &str,
        note_id: &str,
        att: &NewAttachment,
        now: i64,
        event: &NewLedgerEvent,
    ) -> Result<Attachment>;
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

/* ===== Eventos (o Calendário) ===== */

#[derive(Debug, Clone)]
pub struct NewEventDetails {
    pub starts_at: i64,
    pub ends_at: i64,
    pub all_day: bool,
    /// A regra. `None` = evento único — que **também** ganha uma ocorrência.
    pub rrule: Option<Recurrence>,
    /// Até quando a regra vale. `None` = para sempre (a materialização ainda
    /// para no horizonte de 18 meses; ver `EventService`).
    pub recurrence_end: Option<i64>,
    pub location: Option<String>,
    /// Exame, consulta, reunião… O rótulo que distingue um compromisso do
    /// outro sem exigir uma tabela por tipo. Ver a §2 da 0007.
    pub category: Option<String>,
}

/// Tudo que criar um evento precisa, num pacote só.
///
/// Struct e não sete parâmetros soltos: a assinatura passaria do teto do
/// `too_many_arguments`, e uma lista de `Option<i64>` em sequência é o tipo de
/// coisa que se troca de lugar em silêncio.
#[derive(Debug, Clone)]
pub struct NewEvent {
    pub title: String,
    pub area_id: Option<String>,
    pub details: NewEventDetails,
}

/// Um evento: o node + o satélite, já juntos. É a REGRA, não o que o calendário
/// desenha — para isso existe `Occurrence`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub status: String,
    pub starts_at: i64,
    pub ends_at: i64,
    pub all_day: bool,
    pub rrule: Option<Recurrence>,
    pub recurrence_end: Option<i64>,
    pub location: Option<String>,
    pub category: Option<String>,
}

/// Alteração parcial de um evento. `None` = não mexer.
///
/// Sem `rrule`: trocar a regra de uma série é reescrever ocorrências que o
/// usuário já remarcou ou cancelou à mão. Enquanto não houver uma resposta para
/// "o que acontece com as exceções", a operação não existe.
///
/// Sem `title`: renomear é do `NodeService`, que já grava o evento de ledger.
/// Um segundo caminho para o mesmo fato seria um rename fora da história.
#[derive(Debug, Clone, Default)]
pub struct EventPatch {
    pub location: Option<Option<String>>,
    pub category: Option<Option<String>>,
}

/// Uma ocorrência a materializar.
#[derive(Debug, Clone)]
pub struct NewOccurrence {
    pub starts_at: i64,
    pub ends_at: i64,
    /// 'YYYY-MM-DD' LOCAL. Redundante com `starts_at` de propósito — ver a §3
    /// da 0007.
    pub day: String,
}

/// O que o calendário desenha: uma ocorrência, já com o que ela herda do node.
///
/// O evento único também tem uma — é o que permite ao calendário ler UMA tabela
/// em vez de unir "avulsos" com "séries" a cada troca de mês.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Occurrence {
    pub event_id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub starts_at: i64,
    pub ends_at: i64,
    pub day: String,
    /// 'scheduled' | 'cancelled' | 'moved'.
    pub status: String,
    pub all_day: bool,
    pub location: Option<String>,
    pub category: Option<String>,
    /// A ocorrência pertence a uma série. A UI mostra o ícone de repetição, e
    /// arrastar uma delas avisa que só aquela se move.
    pub is_recurring: bool,
}

/// Uma ocorrência mudando de lugar (o arrasto do timeblocking).
///
/// A chave é (event_id, starts_at) — a PK da tabela. `event_id` sozinho não
/// identifica ocorrência nenhuma numa série de 78 terças.
#[derive(Debug, Clone)]
pub struct OccurrenceMove<'a> {
    pub event_id: &'a str,
    pub from_start: i64,
    pub to_start: i64,
    pub to_end: i64,
    pub to_day: &'a str,
    /// Uma ocorrência remarcada solta-se da série ('moved'); um evento único
    /// não tem série de que se soltar e segue 'scheduled'.
    pub detach: bool,
}

/// Uma série cuja materialização acaba antes do horizonte pedido.
///
/// O que a extensão precisa saber para continuar a série de onde ela parou, e
/// nada além: a regra, a âncora e a borda atual.
///
/// `anchor_*` é o evento ORIGINAL, não a última ocorrência. É a âncora que
/// define a fase — "a cada 2 semanas" contado a partir da última materializada
/// escorregaria de semana a cada extensão, e a série se deslocaria um pouco
/// mais a cada vez que o usuário navegasse para longe.
#[derive(Debug, Clone)]
pub struct SeriesTail {
    pub event_id: String,
    pub anchor_starts_at: i64,
    pub anchor_ends_at: i64,
    pub rrule: Recurrence,
    pub recurrence_end: Option<i64>,
    /// O `rule_start` do último turno que existe hoje — a borda.
    ///
    /// `rule_start` e não `starts_at`: a última ocorrência pode ter sido
    /// arrastada para longe, e o que a extensão quer saber é até onde a REGRA
    /// já foi aplicada. Ver a 0008.
    pub last_materialised: i64,
}

pub trait EventRepository: Send + Sync {
    /// Cria o node, o satélite, as ocorrências E o evento de ledger — tudo na
    /// MESMA transação.
    ///
    /// A assinatura força isso: um evento cujo node existe mas cujas
    /// ocorrências não seria um compromisso invisível no calendário, e o
    /// usuário só descobriria no dia em que ele não tocou.
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        details: &NewEventDetails,
        occurrences: &[NewOccurrence],
        event: &NewLedgerEvent,
    ) -> Result<Event>;

    fn get(&self, id: &str) -> Result<Event>;

    /// Tudo que cai entre dois dias LOCAIS — a leitura do mês. UMA query.
    fn range(&self, from_day: &str, to_day: &str) -> Result<Vec<Occurrence>>;

    /// Ocorrências que tocam a janela epoch-ms — a entrada da detecção de
    /// conflito. Por ms e não por dia: um evento das 23h às 1h pertence a dois
    /// dias e a uma única janela.
    fn overlapping_window(&self, from_ms: i64, to_ms: i64) -> Result<Vec<Occurrence>>;

    /// As próximas ocorrências de uma categoria, de `from_day` em diante.
    ///
    /// A entrada dos exames da Saúde (§3.1): eventos com `category='exame'`, o
    /// próximo primeiro. Categoria e não uma tabela `exams` — um exame é um
    /// compromisso com hora e lugar, e a categoria é a única coisa que o
    /// distingue de um almoço (ver a §2 da 0007).
    fn upcoming_by_category(
        &self,
        category: &str,
        from_day: &str,
        limit: i64,
    ) -> Result<Vec<Occurrence>>;

    fn update(&self, id: &str, patch: &EventPatch, updated_at: i64) -> Result<Event>;

    /// Remarca UMA ocorrência e grava o evento, na mesma transação.
    fn move_occurrence_with_event(
        &self,
        m: &OccurrenceMove<'_>,
        event: &NewLedgerEvent,
    ) -> Result<Occurrence>;

    /// "Toda terça, MENOS a de 25/11."
    fn cancel_occurrence_with_event(
        &self,
        event_id: &str,
        starts_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<()>;

    /// As séries cujo último TURNO cai antes de `until_ms` — as que a extensão
    /// tem trabalho a fazer.
    ///
    /// Filtra no SQL e não em Rust: a resposta normal desta pergunta é uma lista
    /// VAZIA (o usuário está dentro da janela já materializada), e trazer todas
    /// as séries do banco para descobrir isso seria pagar por um trabalho que
    /// quase nunca existe.
    fn series_needing_extension(&self, until_ms: i64) -> Result<Vec<SeriesTail>>;

    /// Grava a continuação de uma série. Devolve quantas linhas eram novas.
    ///
    /// Idempotente por contrato: chamar duas vezes com o mesmo horizonte insere
    /// zero na segunda. A UI dispara isto ao navegar, e navegar de outubro para
    /// novembro e voltar não pode custar uma reescrita da série.
    fn append_occurrences(&self, event_id: &str, occurrences: &[NewOccurrence]) -> Result<usize>;
}

/* ===== Metas e sub-desafios ===== */

#[derive(Debug, Clone)]
pub struct NewGoalDetails {
    pub metric_name: String,
    pub start_value: f64,
    pub target_value: f64,
    pub unit: String,
    pub direction: Direction,
    pub deadline: Option<i64>,
    pub progress_source: ProgressSource,
}

#[derive(Debug, Clone)]
pub struct NewGoal {
    pub title: String,
    pub area_id: Option<String>,
    pub details: NewGoalDetails,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub status: String,
    pub metric_name: String,
    pub start_value: f64,
    pub target_value: f64,
    pub unit: String,
    pub direction: Direction,
    pub deadline: Option<i64>,
    pub progress_source: ProgressSource,
}

/// Uma medição da métrica, com a data em que foi tomada.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub goal_id: String,
    pub value: f64,
    pub noted_at: i64,
    pub note: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewCheckpoint {
    pub goal_id: String,
    pub value: f64,
    pub noted_at: i64,
    pub note: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewMilestone {
    pub title: String,
    pub goal_id: String,
    pub kind: MilestoneKind,
    /// O hábito que alimenta o contador. Obrigatório em 'counter'.
    pub habit_id: Option<String>,
    pub target_count: Option<i64>,
    pub weight: f64,
    /// 'YYYY-MM-DD' local: o dia a partir do qual o contador conta.
    ///
    /// `None` num 'counter' vira HOJE no serviço — "30 dias de academia" pedido
    /// hoje conta de hoje. Uma data anterior é aceita ("conte desde o início do
    /// mês"); o futuro, não. Ver a 0009.
    pub counts_from: Option<String>,
}

/// Um sub-desafio. `status == "done"` É o checkbox — ver a §4 da 0007.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    pub id: String,
    pub goal_id: String,
    pub title: String,
    pub status: String,
    pub kind: MilestoneKind,
    pub habit_id: Option<String>,
    pub target_count: Option<i64>,
    pub weight: f64,
    pub sort_order: f64,
    /// O dia a partir do qual o contador conta. `None` = desde sempre, que é o
    /// que dizem as linhas nascidas antes da 0009.
    pub counts_from: Option<String>,
    /// Ticks 'done' do hábito ligado, **a partir de `counts_from`**. `None` num
    /// 'simple' — ele não conta nada. Vem de query: nunca é um número que o
    /// usuário digitou.
    pub current_count: Option<i64>,
}

pub trait GoalRepository: Send + Sync {
    /// Node + satélite + ledger, na mesma transação.
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        details: &NewGoalDetails,
        event: &NewLedgerEvent,
    ) -> Result<Goal>;

    fn get(&self, id: &str) -> Result<Goal>;
    fn list(&self, area_id: Option<&str>) -> Result<Vec<Goal>>;

    /// Registra a medição E o evento de ledger, na mesma transação.
    fn add_checkpoint_with_event(
        &self,
        id: &str,
        cp: &NewCheckpoint,
        event: &NewLedgerEvent,
    ) -> Result<Checkpoint>;

    /// A série inteira, do mais antigo ao mais recente — a entrada da projeção.
    fn checkpoints(&self, goal_id: &str) -> Result<Vec<Checkpoint>>;

    fn add_milestone_with_event(
        &self,
        id: &str,
        node: &NewNode,
        milestone: &NewMilestone,
        event: &NewLedgerEvent,
    ) -> Result<Milestone>;

    /// Os sub-desafios da meta, com o contador dos 'counter' já preenchido.
    /// UMA query: uma meta com 12 sub-desafios não pode virar 13 idas ao banco.
    fn list_milestones(&self, goal_id: &str) -> Result<Vec<Milestone>>;

    fn get_milestone(&self, id: &str) -> Result<Milestone>;

    /// Marca/desmarca o checkbox e grava o evento, na mesma transação.
    fn set_milestone_done_with_event(
        &self,
        id: &str,
        done: bool,
        event: &NewLedgerEvent,
    ) -> Result<Milestone>;

    /// Qual das duas barras manda nesta meta.
    ///
    /// Sem evento de ledger, igual ao `update_schedule` dos hábitos: trocar a
    /// régua não é um fato da vida do usuário, é a configuração de como o fato é
    /// medido. Ver ADR-0023.
    fn set_progress_source(&self, goal_id: &str, source: ProgressSource) -> Result<Goal>;

    /// A coordenada dos vizinhos da posição `index` na árvore da meta.
    ///
    /// Gêmeo do `neighbours` das tarefas, e pela mesma razão: mover é a média
    /// dos dois: UM update de UMA linha. Ver `domain::ordering`.
    fn milestone_neighbours(
        &self,
        goal_id: &str,
        index: usize,
    ) -> Result<(Option<f64>, Option<f64>)>;

    fn reorder_milestone(&self, id: &str, new_order: f64) -> Result<()>;

    /// Reespaça a árvore em inteiros quando a média satura.
    fn renumber_milestones(&self, goal_id: &str) -> Result<()>;
}

/* ===== Finanças: aportes e patrimônio ===== */

/// Uma conta/banco. Espelha a tabela `accounts` (0005).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    /// 'banking' | 'investment'. Só 'investment' entra na alocação: dinheiro
    /// parado na conta corrente não é patrimônio investido.
    pub kind: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone)]
pub struct NewContribution {
    pub account_id: String,
    pub asset_class: AssetClass,
    /// Centavos. Negativo é resgate.
    pub amount_cents: i64,
    pub happened_on: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contribution {
    pub id: String,
    pub account_id: String,
    pub asset_class: String,
    pub amount_cents: i64,
    pub happened_on: String,
    pub note: Option<String>,
    pub created_at: i64,
}

/// Um total por chave (classe ou banco), já somado no SQL — as fatias do donut e
/// das barras. `key` é a `AssetClass::as_str()` ou o `account_id`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub key: String,
    pub label: String,
    pub cents: i64,
}

/// O aporte total de um mês — o ponto da área acumulada.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthTotal {
    /// 'YYYY-MM'.
    pub month: String,
    pub cents: i64,
}

pub trait ContributionRepository: Send + Sync {
    fn accounts(&self) -> Result<Vec<Account>>;

    /// Grava o aporte E o evento de ledger, na mesma transação. Um aporte é um
    /// fato da vida do usuário (ADR-0023): ele existe na história.
    fn create_with_event(
        &self,
        id: &str,
        c: &NewContribution,
        created_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Contribution>;

    /// Os aportes mais recentes — a lista da tab.
    fn recent(&self, limit: i64) -> Result<Vec<Contribution>>;

    /// Total líquido por classe de ativo, do mais alto ao mais baixo — o donut e
    /// a diversificação. Agrupa pela `asset_class` que o aporte declara: a
    /// classe é a aposta, e cada aporte já diz a sua (inclusive 'reserva').
    fn totals_by_class(&self) -> Result<Vec<Bucket>>;

    /// Total líquido por banco — as barras. Só as contas com saldo positivo
    /// aparecem; um banco zerado por resgate não é uma barra.
    fn totals_by_account(&self) -> Result<Vec<Bucket>>;

    /// Aporte somado por mês, dos últimos `months` meses, do mais antigo ao mais
    /// recente. A entrada da área acumulada e das médias.
    fn monthly_totals(&self, months: i64) -> Result<Vec<MonthTotal>>;

    /// O total informado à mão para um mês, se houver. `None` = o usuário nunca
    /// registrou o patrimônio daquele mês.
    fn latest_snapshot_cents(&self) -> Result<Option<i64>>;

    /// Grava/atualiza o retrato do patrimônio de um mês (INSERT OR REPLACE).
    fn set_snapshot(&self, month: &str, total_cents: i64, noted_at: i64) -> Result<()>;
}

/* ===== Objetivos Financeiros: as "caixinhas" ===== */

#[derive(Debug, Clone)]
pub struct NewFinGoal {
    pub title: String,
    pub area_id: Option<String>,
    /// Centavos. O alvo é sempre positivo.
    pub target_cents: i64,
    /// O banco onde o dinheiro está guardado. Opcional: uma caixinha pode ser só
    /// uma intenção antes de ter conta.
    pub account_id: Option<String>,
    /// 'YYYY-MM-DD' local. Opcional.
    pub deadline: Option<String>,
    pub emoji: String,
}

/// Uma caixinha: o node + o satélite + o total já guardado, juntos.
///
/// `saved_cents` vem de query (a soma dos depósitos), nunca de um número
/// digitado — é o mesmo princípio do contador do sub-desafio.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinGoal {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub status: String,
    pub target_cents: i64,
    pub account_id: Option<String>,
    /// O nome do banco, se houver conta — a UI mostra o badge sem uma 2ª query.
    pub account_name: Option<String>,
    pub deadline: Option<String>,
    pub emoji: String,
    pub saved_cents: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct NewFinGoalDeposit {
    pub goal_id: String,
    /// Centavos. Negativo é um saque da caixinha (mudei de ideia, tirei de volta).
    pub amount_cents: i64,
    pub happened_on: String,
    pub note: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinGoalDeposit {
    pub id: String,
    pub goal_id: String,
    pub amount_cents: i64,
    pub happened_on: String,
    pub note: Option<String>,
    pub created_at: i64,
}

pub trait FinGoalRepository: Send + Sync {
    /// Node + satélite + ledger, na mesma transação.
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewFinGoal,
        event: &NewLedgerEvent,
    ) -> Result<FinGoal>;

    fn get(&self, id: &str) -> Result<FinGoal>;

    /// As caixinhas de uma Esfera (ou todas, com `None`), com `saved_cents` já
    /// somado. Devolve também o total depositado desde `rate_since` (o começo da
    /// janela de projeção) — na MESMA query, para a projeção não custar N idas ao
    /// banco.
    fn list(&self, area_id: Option<&str>, rate_since: &str) -> Result<Vec<(FinGoal, i64)>>;

    /// Grava o depósito E o evento, na mesma transação. Se `completion` for
    /// `Some`, o node vira 'done' e o evento de conquista entra junto — tudo
    /// atômico, para a caixinha nunca ficar "fechada sem conquista" nem o
    /// contrário.
    fn deposit_with_event(
        &self,
        id: &str,
        deposit: &NewFinGoalDeposit,
        created_at: i64,
        deposit_event: &NewLedgerEvent,
        completion: Option<&NewLedgerEvent>,
    ) -> Result<FinGoalDeposit>;

    /// Os depósitos de uma caixinha, do mais recente ao mais antigo.
    fn deposits(&self, goal_id: &str) -> Result<Vec<FinGoalDeposit>>;

    /// A média de progresso (saved/target, 0..=1) das caixinhas ATIVAS, ou
    /// `None` quando não há nenhuma. Alimenta a parcela "Objetivos" da Saúde
    /// Financeira (ADR-0028).
    fn active_progress(&self) -> Result<Option<f64>>;
}

/* ===== Biblioteca: os livros ===== */

#[derive(Debug, Clone)]
pub struct NewBook {
    pub title: String,
    pub area_id: Option<String>,
    pub author: Option<String>,
    pub total_pages: Option<i64>,
    pub shelf: Option<String>,
}

/// Um livro: o node + o satélite. `node_status` é o do node (para a busca e a
/// timeline); `status` é o de LEITURA (fila/lendo/lido/abandonado).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub author: Option<String>,
    pub total_pages: Option<i64>,
    pub current_page: i64,
    pub status: BookStatus,
    pub rating: Option<i64>,
    pub shelf: Option<String>,
    pub started_on: Option<String>,
    pub finished_on: Option<String>,
    pub created_at: i64,
}

/// Alteração parcial de um livro. `None` = não mexer. Progresso, status,
/// prateleira e nota — nenhum é um FATO da vida (é estado de leitura), então não
/// grava no ledger. Terminar um livro é o fato, e tem caminho próprio.
#[derive(Debug, Clone, Default)]
pub struct BookPatch {
    pub current_page: Option<i64>,
    pub status: Option<BookStatus>,
    pub rating: Option<Option<i64>>,
    pub shelf: Option<Option<String>>,
    /// Datas derivadas de mudanças de status (começou a ler → `started_on`).
    pub started_on: Option<Option<String>>,
    pub finished_on: Option<Option<String>>,
    /// O status do NODE, quando o de leitura muda (lido → done, abandonado →
    /// dropped). O serviço decide; o repo só aplica.
    pub node_status: Option<Status>,
}

/// A resenha de 1 frase que vira uma nota linkada ao livro (§2.2).
#[derive(Debug, Clone)]
pub struct ReviewNote {
    pub note_id: String,
    pub title: String,
    pub body_md: String,
    pub event: NewLedgerEvent,
}

pub trait BookRepository: Send + Sync {
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewBook,
        event: &NewLedgerEvent,
    ) -> Result<Book>;

    fn get(&self, id: &str) -> Result<Book>;

    /// Todos os livros de uma Esfera (ou todos). Os filtros de status/prateleira/
    /// nota são do front: uma estante pessoal tem dezenas de livros, não milhares.
    fn list(&self, area_id: Option<&str>) -> Result<Vec<Book>>;

    /// Aplica um patch de estado de leitura. Sem ledger (ADR-0023).
    fn update(&self, id: &str, patch: &BookPatch) -> Result<Book>;

    /// Termina o livro: status 'lido', nota, `finished_on`, node 'done' e o
    /// evento de conquista — na mesma transação. Se `review` for `Some`, cria a
    /// nota linkada (o primeiro consumidor de `links`) junto, atômico.
    fn finish_with_event(
        &self,
        id: &str,
        rating: Option<i64>,
        finished_on: &str,
        now: i64,
        completion: &NewLedgerEvent,
        review: Option<&ReviewNote>,
    ) -> Result<Book>;

    /// Quantos livros foram marcados 'lido' num ano ('YYYY') — a meta anual.
    fn finished_in_year(&self, year: &str) -> Result<i64>;

    /// A meta anual de leitura de um ano, se houver.
    fn reading_goal(&self, year: &str) -> Result<Option<i64>>;

    /// Grava/atualiza a meta anual (INSERT OR REPLACE).
    fn set_reading_goal(&self, year: &str, target: i64, noted_at: i64) -> Result<()>;
}

/* ===== BI engine (M4.5) ===== */

/// A série de um hábito ativo, com os dias em que foi cumprido — a matéria-prima
/// das correlações. `done_days` são os dias com tick 'done' ('YYYY-MM-DD'); o
/// resto (dias agendados sem 'done') é "não fez", deduzido pela agenda.
#[derive(Debug, Clone)]
pub struct HabitSeries {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub schedule: Schedule,
    pub done_days: Vec<String>,
}

/// Uma linha do `insight_cache`.
#[derive(Debug, Clone)]
pub struct CachedInsight {
    pub payload_json: String,
    pub input_hash: String,
    pub computed_at: i64,
}

/// As leituras que o `bi_engine` faz — todas do pool `query_only`, nunca da UI.
///
/// O cache é o contrato com o frontend: ele SEMPRE lê `cache_get` (instantâneo),
/// e o motor recomputa em background quando `input_signature` muda (DATA_MODEL §5).
pub trait InsightRepository: Send + Sync {
    /// Todos os hábitos ativos com seus dias cumpridos — para as correlações.
    fn active_habit_series(&self) -> Result<Vec<HabitSeries>>;

    /// Contagem de ticks 'done' por dia local, no intervalo — carga de hábitos.
    fn done_ticks_by_day(&self, from_day: &str, to_day: &str) -> Result<Vec<(String, i64)>>;

    /// Contagem de ocorrências de evento por dia local, no intervalo — a outra
    /// metade da carga da semana (converte `starts_at` ms → dia local).
    fn event_count_by_day(&self, from_day: &str, to_day: &str) -> Result<Vec<(String, i64)>>;

    /// Tarefas PLANEJADAS por dia local (`scheduled_at`) — para o Score congelado.
    fn scheduled_tasks_by_day(&self, from_day: &str, to_day: &str) -> Result<Vec<(String, i64)>>;

    /// Tarefas CONCLUÍDAS por dia local (`completed_at`) — para o Score congelado.
    fn completed_tasks_by_day(&self, from_day: &str, to_day: &str) -> Result<Vec<(String, i64)>>;

    /// Lê uma entrada do cache de insights.
    fn cache_get(&self, key: &str) -> Result<Option<CachedInsight>>;

    /// Grava (upsert) uma entrada do cache.
    fn cache_put(&self, key: &str, payload_json: &str, input_hash: &str, now: i64) -> Result<()>;

    /// Uma assinatura barata das tabelas-fonte. Se ela não mudou desde o último
    /// cálculo, recomputar seria trabalho jogado fora — o motor pula. É o
    /// `input_hash` do DATA_MODEL §5.
    fn input_signature(&self) -> Result<String>;
}

/* ===== Metas Anuais (M4.5) ===== */

/// Uma meta anual a criar.
#[derive(Debug, Clone)]
pub struct NewAnnualGoal {
    pub title: String,
    pub area_id: Option<String>,
    pub year: i64,
    pub goal_kind: AnnualGoalKind,
    /// Só para `quantitative`.
    pub metric_name: Option<String>,
    pub target_value: Option<f64>,
    pub unit: Option<String>,
}

/// Uma meta anual lida.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnualGoal {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    /// active/done/dropped/archived — o status É o do node (ADR-0036).
    pub status: String,
    pub year: i64,
    pub goal_kind: String,
    pub metric_name: Option<String>,
    pub target_value: Option<f64>,
    pub current_value: f64,
    pub unit: Option<String>,
    pub created_at: i64,
}

pub trait AnnualGoalRepository: Send + Sync {
    /// Cria o node 'annual_goal' + o satélite + o evento `created`, atômico.
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewAnnualGoal,
        event: &NewLedgerEvent,
    ) -> Result<AnnualGoal>;

    fn get(&self, id: &str) -> Result<AnnualGoal>;

    /// As metas de um ano (as arquivadas somem).
    fn list_by_year(&self, year: i64) -> Result<Vec<AnnualGoal>>;

    /// Os anos que já têm ao menos uma meta (para o seletor de ano), do mais
    /// recente ao mais antigo.
    fn years(&self) -> Result<Vec<i64>>;

    /// Atualiza `current_value` de uma quantitativa e grava o checkpoint no
    /// ledger; se `completion` vier, marca 'done' e grava também — na mesma
    /// transação.
    fn set_progress(
        &self,
        id: &str,
        current_value: f64,
        updated_at: i64,
        checkpoint: &NewLedgerEvent,
        completion: Option<&NewLedgerEvent>,
    ) -> Result<AnnualGoal>;

    /// Muda o status (concluir binária, abandonar, arquivar) e grava o evento.
    fn set_status(
        &self,
        id: &str,
        status: &str,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<AnnualGoal>;

    /// Apaga a meta (o node; o satélite vai por CASCADE) e grava o `deleted`.
    fn delete_with_event(&self, id: &str, event: &NewLedgerEvent) -> Result<()>;
}

/* ===== Temporadas / Desafios (M4.5) ===== */

/// Uma temporada a criar. `habit_id` só importa para `metric = HabitDays`.
#[derive(Debug, Clone)]
pub struct NewChallenge {
    pub title: String,
    pub area_id: Option<String>,
    pub starts_on: String,
    pub ends_on: String,
    pub metric: ChallengeMetric,
    pub habit_id: Option<String>,
    pub target_count: i64,
}

/// Uma temporada lida, com o placar já computado.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    /// O `nodes.status`: active/done/dropped/archived. "Vencida" é DERIVADO na
    /// camada de cima (ADR-0036), não uma coluna.
    pub status: String,
    pub starts_on: String,
    pub ends_on: String,
    pub metric: String,
    pub habit_id: Option<String>,
    pub habit_title: Option<String>,
    pub target_count: i64,
    pub manual_count: i64,
    /// O placar: para `habit_days`, ticks 'done' na janela; para `manual`, o contador.
    pub progress_count: i64,
    pub created_at: i64,
}

pub trait ChallengeRepository: Send + Sync {
    /// Cria o node 'challenge' + o satélite + o evento `challenge_started`, atômico.
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewChallenge,
        event: &NewLedgerEvent,
    ) -> Result<Challenge>;

    fn get(&self, id: &str) -> Result<Challenge>;

    /// As temporadas de uma Esfera (ou todas). `include_finished=false` esconde
    /// as arquivadas.
    fn list(&self, area_id: Option<&str>) -> Result<Vec<Challenge>>;

    /// Soma `delta` ao contador manual (nunca abaixo de zero), grava o evento.
    fn bump_manual(
        &self,
        id: &str,
        delta: i64,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Challenge>;

    /// Marca a temporada 'done' e grava `challenge_completed`, atômico. No-op se
    /// já estiver 'done' (idempotente — o sync pode chamar duas vezes).
    fn complete(&self, id: &str, updated_at: i64, event: &NewLedgerEvent) -> Result<()>;

    /// Muda o status (ex.: abandonar → 'dropped') e grava o evento.
    fn set_status(
        &self,
        id: &str,
        status: &str,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Challenge>;

    /// As temporadas ATIVAS cujo placar já bateu o alvo — candidatas a fechar.
    /// Lidas de uma vez para o `sync` não fazer N+1.
    fn active_reached(&self) -> Result<Vec<Challenge>>;
}

/* ===== Carreira: competências (M4.6) ===== */

/// Uma competência a criar. O nível começa em 1; `max_level` é um teto opcional.
#[derive(Debug, Clone)]
pub struct NewSkill {
    pub title: String,
    pub area_id: Option<String>,
    pub category: Option<String>,
    pub max_level: Option<i64>,
}

/// Uma competência: o node 'skill' + o satélite. `level` é o estado ATUAL; a
/// trilha de evolução é a série de eventos `skill_level_up` no ledger.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub title: String,
    pub area_id: Option<String>,
    pub status: String,
    pub level: i64,
    pub category: Option<String>,
    pub max_level: Option<i64>,
    pub created_at: i64,
}

pub trait SkillRepository: Send + Sync {
    /// Node 'skill' + satélite + evento `created`, na mesma transação.
    fn create_with_event(
        &self,
        id: &str,
        node: &NewNode,
        new: &NewSkill,
        event: &NewLedgerEvent,
    ) -> Result<Skill>;

    fn get(&self, id: &str) -> Result<Skill>;

    /// As competências de uma Esfera (ou todas). As arquivadas somem.
    fn list(&self, area_id: Option<&str>) -> Result<Vec<Skill>>;

    /// Sobe UM nível E grava o evento `skill_level_up`, na mesma transação. O
    /// incremento é atômico (`level = level + 1`); recusa se já está no teto
    /// (`max_level`). Devolve a competência já com o novo nível.
    fn level_up_with_event(
        &self,
        id: &str,
        updated_at: i64,
        event: &NewLedgerEvent,
    ) -> Result<Skill>;

    /// A série da trilha: (dia, nível) do 'created' (nível 1) e de cada
    /// 'skill_level_up' (o nível é a posição na ordem), do mais antigo ao recente.
    /// A UI omite o sparkline quando há um ponto só (competência nova).
    fn level_history(&self, id: &str) -> Result<Vec<(String, i64)>>;

    /// As competências de uma Esfera que subiram de nível desde `since_day` — as
    /// "em evolução" do painel. Maior nível primeiro.
    fn evolving_since(&self, area_id: &str, since_day: &str) -> Result<Vec<Skill>>;
}

/* ===== Links entre nodes (M4.6) ===== */

/// Uma ponta de um link, já resolvida para exibir: o node do OUTRO lado + o tipo.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkEnd {
    pub node_id: String,
    pub kind: Kind,
    pub title: String,
    pub area_id: Option<String>,
    /// 'related' | 'blocks' | 'references' | 'attached_to' | 'contributes_to'.
    pub link_type: String,
}

/// Os links de um node, nos dois sentidos — o backlink aparece dos dois lados.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeLinks {
    /// Links onde este node é o SOURCE (ele aponta para o outro).
    pub outgoing: Vec<LinkEnd>,
    /// Links onde este node é o TARGET (o outro aponta para ele) — os backlinks.
    pub incoming: Vec<LinkEnd>,
}

pub trait LinkRepository: Send + Sync {
    /// Cria um link (idempotente — INSERT OR IGNORE na PK composta).
    fn create(&self, source: &str, target: &str, link_type: &str, created_at: i64) -> Result<()>;

    /// Remove um link (no-op se não existe).
    fn remove(&self, source: &str, target: &str, link_type: &str) -> Result<()>;

    /// Os links de um node, resolvidos (título/kind do outro lado), nos dois sentidos.
    fn links_of(&self, node_id: &str) -> Result<NodeLinks>;
}

/* ===== Gamificação (M4.5) ===== */

/// Os pontos por feito, injetados do domínio (`domain::xp`) para o SQL não
/// duplicar a tabela de pontos — a fonte da verdade continua sendo uma só.
#[derive(Debug, Clone, Copy)]
pub struct XpPoints {
    pub habit_done: i64,
    pub task_done: i64,
    pub goal_checkpoint: i64,
    pub milestone_done: i64,
    pub skill_level_up: i64,
    pub book_finished: i64,
    pub fin_goal_done: i64,
    pub challenge_done: i64,
    pub annual_goal_done: i64,
}

/// Os contadores simples que alimentam o crivo de conquistas (os que são um
/// `COUNT` direto; streak de hábito e de aporte são computados à parte).
#[derive(Debug, Clone, Copy, Default)]
pub struct AchievementCounts {
    pub goals_completed: i64,
    pub fin_goals_completed: i64,
    pub books_finished: i64,
    pub weekly_reviews: i64,
    pub challenges_completed: i64,
    pub annual_goals_completed: i64,
}

/// As leituras da gamificação — XP derivado do estado (ADR-0037), agrupado por
/// Esfera, e os contadores das conquistas. Tudo do pool `query_only`.
pub trait GamificationRepository: Send + Sync {
    /// XP por Esfera (`area_id`): a soma dos pontos de tudo que o usuário fez,
    /// atribuído pela `area_id` do node. `None` = feitos sem Esfera (contam no
    /// total, não num card). Uma query só (UNION das fontes), pontos vindos do
    /// domínio como parâmetros.
    fn xp_by_area(&self, points: XpPoints) -> Result<Vec<(Option<String>, i64)>>;

    /// Os contadores diretos das conquistas.
    fn achievement_counts(&self) -> Result<AchievementCounts>;

    /// Os meses ('YYYY-MM') com ao menos um aporte, ordenados — para o streak de
    /// "meses seguidos investindo".
    fn contribution_months(&self) -> Result<Vec<String>>;
}
