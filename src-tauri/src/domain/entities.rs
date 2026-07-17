//! Entidades do domínio.
//!
//! Puro: nenhuma dependência de `rusqlite`, `tauri` ou `infrastructure`. Tudo
//! aqui é testável sem banco e sem janela.

use serde::{Deserialize, Serialize};

use crate::domain::errors::{NexusError, Result};

/// O tipo de um node. Toda entidade do NEXUS é um node de algum `Kind`.
///
/// O `CHECK` da coluna `nodes.kind` espelha exatamente estas variantes; os dois
/// mudam na mesma migration ou não mudam.
///
/// `Ord` deriva da ordem de declaração e não tem significado de domínio: existe
/// só para o `Kind` poder ser chave de `BTreeMap` (o Hub agrupa contagens por
/// (área, kind)). Nada deve ler "Note < Task" como se dissesse algo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Note,
    Task,
    Project,
    Goal,
    Habit,
    Routine,
    Event,
    File,
    InboxItem,
    /// Um sub-desafio de uma meta ("30 dias sem açúcar").
    ///
    /// Kind próprio, e não uma `Task` com um flag: uma tarefa vaza para as
    /// listas de tarefa e para o Nexus Score, e um sub-desafio não é trabalho
    /// planejado do dia. Ver o cabeçalho da 0007.
    Milestone,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Note => "note",
            Kind::Task => "task",
            Kind::Project => "project",
            Kind::Goal => "goal",
            Kind::Habit => "habit",
            Kind::Routine => "routine",
            Kind::Event => "event",
            Kind::File => "file",
            Kind::InboxItem => "inbox_item",
            Kind::Milestone => "milestone",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "note" => Kind::Note,
            "task" => Kind::Task,
            "project" => Kind::Project,
            "goal" => Kind::Goal,
            "habit" => Kind::Habit,
            "routine" => Kind::Routine,
            "event" => Kind::Event,
            "file" => Kind::File,
            "inbox_item" => Kind::InboxItem,
            "milestone" => Kind::Milestone,
            other => {
                return Err(NexusError::Validation(format!(
                    "kind desconhecido: {other}"
                )))
            }
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Active,
    Done,
    Archived,
    Dropped,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Active => "active",
            Status::Done => "done",
            Status::Archived => "archived",
            Status::Dropped => "dropped",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "active" => Status::Active,
            "done" => Status::Done,
            "archived" => Status::Archived,
            "dropped" => Status::Dropped,
            other => {
                return Err(NexusError::Validation(format!(
                    "status desconhecido: {other}"
                )))
            }
        })
    }
}

/// Para que lado uma meta quantitativa anda.
///
/// Espelha o CHECK de `goal_details.direction` (0001). Não é dedutível de
/// `start_value` vs `target_value`: uma meta de "manter em 80 kg" tem os dois
/// iguais, e o usuário ainda assim sabe se está subindo ou descendo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    Increase,
    Decrease,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Increase => "increase",
            Direction::Decrease => "decrease",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "increase" => Direction::Increase,
            "decrease" => Direction::Decrease,
            other => {
                return Err(NexusError::Validation(format!(
                    "direção de meta desconhecida: {other} (esperado 'increase' ou 'decrease')"
                )))
            }
        })
    }
}

/// Qual barra manda no progresso de uma meta.
///
/// Espelha o CHECK de `goal_details.progress_source` (0007). A métrica e os
/// sub-desafios discordam o tempo todo — perder 3 dos 10 kg com 4 dos 5
/// sub-desafios feitos são 30% e 80% do mesmo dia. Escolher por conta própria
/// seria o app decidindo por um número que é do usuário.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProgressSource {
    Metric,
    Milestones,
}

impl ProgressSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ProgressSource::Metric => "metric",
            ProgressSource::Milestones => "milestones",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "metric" => ProgressSource::Metric,
            "milestones" => ProgressSource::Milestones,
            other => {
                return Err(NexusError::Validation(format!(
                    "fonte de progresso desconhecida: {other} (esperado 'metric' ou 'milestones')"
                )))
            }
        })
    }
}

/// O tipo de um sub-desafio. Espelha o CHECK de `milestone_details.kind` (0007).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MilestoneKind {
    /// Um checkbox e pronto.
    Simple,
    /// "21/30 dias", alimentado pelos ticks de um hábito.
    Counter,
}

impl MilestoneKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MilestoneKind::Simple => "simple",
            MilestoneKind::Counter => "counter",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "simple" => MilestoneKind::Simple,
            "counter" => MilestoneKind::Counter,
            other => {
                return Err(NexusError::Validation(format!(
                    "tipo de sub-desafio desconhecido: {other}"
                )))
            }
        })
    }
}

/// O template de uma Esfera: QUE tela ela abre.
///
/// Fechado, como `Kind`, e pelo mesmo motivo: o `CHECK` de `areas.template`
/// espelha exatamente estas variantes, e os dois mudam na mesma migration ou
/// não mudam.
///
/// O template é a resposta para "por que a Esfera Saúde mostra checkpoints e a
/// Esfera Casa não?". Não é o nome nem o id: renomear "Saúde" para "Corpo" não
/// pode apagar a tela, e um id não diz nada sobre comportamento.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Template {
    Health,
    Finance,
    FinGoals,
    Career,
    Studies,
    /// O template do que o usuário cria: agenda + checklists. Deliberadamente
    /// raso — ver §3.6 do plano.
    Simple,
}

impl Template {
    pub fn as_str(self) -> &'static str {
        match self {
            Template::Health => "health",
            Template::Finance => "finance",
            Template::FinGoals => "fin_goals",
            Template::Career => "career",
            Template::Studies => "studies",
            Template::Simple => "simple",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "health" => Template::Health,
            "finance" => Template::Finance,
            "fin_goals" => Template::FinGoals,
            "career" => Template::Career,
            "studies" => Template::Studies,
            "simple" => Template::Simple,
            other => {
                return Err(NexusError::Validation(format!(
                    "template de esfera desconhecido: {other}"
                )))
            }
        })
    }

    /// Os templates que o wizard "+ Nova Esfera" oferece.
    ///
    /// Os cinco especializados são instalados pelo NEXUS, não escolhidos: uma
    /// segunda Esfera com o dashboard de Finanças dividiria o patrimônio em
    /// duas telas que nunca somam.
    pub fn user_creatable() -> &'static [Template] {
        &[Template::Simple]
    }
}

/// Uma Área da vida — uma **Esfera**, no vocabulário da UI. Tudo pertence a
/// uma Esfera; o Inbox é a única exceção, e é justamente por isso que ele
/// existe: um lugar para o que ainda não foi decidido.
///
/// Um nome nos dois mundos, de propósito: `areas` está gravado em quatro
/// migrations imutáveis e em toda FK do schema. Renomear a tabela custaria uma
/// migration de recriação por um ganho puramente cosmético. Ver ADR-0005.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i64,
    pub template: Template,
    /// Uma das 5 Esferas que o NEXUS instala. Editável e arquivável como
    /// qualquer outra — a flag só serve para o wizard não oferecer duplicá-la.
    pub is_system: bool,
    pub archived_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub kind: Kind,
    pub title: String,
    pub area_id: Option<String>,
    pub parent_id: Option<String>,
    pub status: Status,
    pub created_at: i64,
    pub updated_at: i64,
    pub archived_at: Option<i64>,
}

/// Título válido: não vazio depois de aparado e dentro de um limite sensato.
///
/// O limite não é arbitrário: um título é um rótulo, não um corpo. Notas têm
/// `body_md` para texto longo. Sem o teto, um paste acidental de 2 MB viraria
/// um título — e a lista, a busca e a timeline pagariam por isso para sempre.
pub const TITLE_MAX: usize = 500;

pub fn validate_title(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(NexusError::Validation("o título não pode ser vazio".into()));
    }
    // chars(), não len(): 'ã' ocupa 2 bytes em UTF-8 e contá-la como 2 puniria
    // texto em português.
    if trimmed.chars().count() > TITLE_MAX {
        return Err(NexusError::Validation(format!(
            "o título excede {TITLE_MAX} caracteres"
        )));
    }
    Ok(trimmed.to_string())
}

/// Cor hex `#RRGGBB`. Validada porque vai direto para o CSS: um valor inválido
/// não falha alto, ele silenciosamente pinta o elemento errado.
pub fn validate_color(raw: &str) -> Result<String> {
    let s = raw.trim();
    let valid = s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit());

    if !valid {
        return Err(NexusError::Validation(format!(
            "cor inválida: {s} (esperado #RRGGBB)"
        )));
    }
    Ok(s.to_ascii_uppercase())
}

/// A classe de um ativo — o eixo do donut de alocação (§3.2).
///
/// Espelha o CHECK de `contributions.asset_class` (0010). Fechado, e não texto
/// livre, porque é o eixo de um gráfico: uma classe digitada à mão viraria uma
/// fatia de um só, e a soma deixaria de fechar 100%.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssetClass {
    RendaFixa,
    Acoes,
    Fiis,
    EtfExterior,
    Cripto,
    Reserva,
    Outros,
}

impl AssetClass {
    pub fn as_str(self) -> &'static str {
        match self {
            AssetClass::RendaFixa => "renda_fixa",
            AssetClass::Acoes => "acoes",
            AssetClass::Fiis => "fiis",
            AssetClass::EtfExterior => "etf_exterior",
            AssetClass::Cripto => "cripto",
            AssetClass::Reserva => "reserva",
            AssetClass::Outros => "outros",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s {
            "renda_fixa" => AssetClass::RendaFixa,
            "acoes" => AssetClass::Acoes,
            "fiis" => AssetClass::Fiis,
            "etf_exterior" => AssetClass::EtfExterior,
            "cripto" => AssetClass::Cripto,
            "reserva" => AssetClass::Reserva,
            "outros" => AssetClass::Outros,
            other => {
                return Err(NexusError::Validation(format!(
                    "classe de ativo desconhecida: {other}"
                )))
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_round_trips() {
        for k in [
            Kind::Note,
            Kind::Task,
            Kind::Project,
            Kind::Goal,
            Kind::Habit,
            Kind::Routine,
            Kind::Event,
            Kind::File,
            Kind::InboxItem,
            Kind::Milestone,
        ] {
            assert_eq!(Kind::parse(k.as_str()).unwrap(), k);
        }
    }

    #[test]
    fn kind_strings_match_the_check_constraint() {
        // O CHECK de `nodes.kind` (recriado na 0007) espelha exatamente estas
        // strings. Divergir aqui faz o INSERT falhar na máquina do usuário, não
        // neste teste.
        assert_eq!(Kind::Milestone.as_str(), "milestone");
        assert_eq!(Kind::InboxItem.as_str(), "inbox_item");
    }

    #[test]
    fn goal_vocabularies_match_their_check_constraints() {
        // Idem: `goal_details.direction` (0001), `goal_details.progress_source`
        // e `milestone_details.kind` (0007).
        for d in [Direction::Increase, Direction::Decrease] {
            assert_eq!(Direction::parse(d.as_str()).unwrap(), d);
        }
        for s in [ProgressSource::Metric, ProgressSource::Milestones] {
            assert_eq!(ProgressSource::parse(s.as_str()).unwrap(), s);
        }
        for k in [MilestoneKind::Simple, MilestoneKind::Counter] {
            assert_eq!(MilestoneKind::parse(k.as_str()).unwrap(), k);
        }
        assert_eq!(ProgressSource::Milestones.as_str(), "milestones");
        assert!(Direction::parse("subir").is_err());
        assert!(ProgressSource::parse("vibes").is_err());
        assert!(MilestoneKind::parse("timer").is_err());
    }

    #[test]
    fn status_round_trips() {
        for s in [
            Status::Active,
            Status::Done,
            Status::Archived,
            Status::Dropped,
        ] {
            assert_eq!(Status::parse(s.as_str()).unwrap(), s);
        }
    }

    #[test]
    fn unknown_kind_is_rejected() {
        assert!(Kind::parse("pizza").is_err());
    }

    #[test]
    fn template_round_trips() {
        for t in [
            Template::Health,
            Template::Finance,
            Template::FinGoals,
            Template::Career,
            Template::Studies,
            Template::Simple,
        ] {
            assert_eq!(Template::parse(t.as_str()).unwrap(), t);
        }
    }

    #[test]
    fn template_strings_match_the_check_constraint() {
        // Estas strings estão no CHECK de `areas.template` (0005) e no banco do
        // usuário. Mudar uma aqui faz o INSERT falhar em produção, não aqui.
        assert_eq!(Template::FinGoals.as_str(), "fin_goals");
        assert_eq!(Template::Health.as_str(), "health");
        assert!(Template::parse("espiritualidade").is_err());
    }

    #[test]
    fn only_the_simple_template_is_user_creatable() {
        // Duas Esferas com o dashboard de Finanças dividiriam o patrimônio em
        // duas telas que nunca somam.
        assert_eq!(Template::user_creatable(), &[Template::Simple]);
    }

    #[test]
    fn title_is_trimmed() {
        assert_eq!(validate_title("  Ler  ").unwrap(), "Ler");
    }

    #[test]
    fn blank_title_is_rejected() {
        assert!(validate_title("   ").is_err());
        assert!(validate_title("").is_err());
        assert!(validate_title("\t\n").is_err());
    }

    #[test]
    fn title_limit_counts_chars_not_bytes() {
        // 500 'ã' = 1000 bytes. Deve passar: o limite é de caracteres.
        let accented = "ã".repeat(TITLE_MAX);
        assert!(validate_title(&accented).is_ok());
        assert!(validate_title(&"a".repeat(TITLE_MAX + 1)).is_err());
    }

    #[test]
    fn color_is_validated_and_normalised() {
        assert_eq!(validate_color("#7c8cf8").unwrap(), "#7C8CF8");
        assert!(validate_color("7C8CF8").is_err(), "sem #");
        assert!(validate_color("#7C8CF").is_err(), "curto demais");
        assert!(validate_color("#GGGGGG").is_err(), "não é hex");
        assert!(validate_color("red").is_err(), "nome CSS não serve");
    }
}
