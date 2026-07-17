//! Ports — as fronteiras que o domínio declara e a infraestrutura implementa.
//!
//! É a inversão de dependência que sustenta a regra de camadas: os casos de uso
//! falam com estes traits, nunca com o SQLite. Trocar o storage é implementar
//! estes traits de novo, sem tocar em uma linha de regra de negócio.

use crate::domain::entities::{Area, Kind, Node, Status};
use crate::domain::errors::Result;
use crate::domain::ledger::{LedgerEntry, NewLedgerEvent};

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
}

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
