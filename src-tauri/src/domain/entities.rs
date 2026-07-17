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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

/// Uma Área da vida. Tudo pertence a uma Área — o Inbox é a única exceção,
/// e é justamente por isso que ele existe: um lugar para o que ainda não foi
/// decidido.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub sort_order: i64,
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
        ] {
            assert_eq!(Kind::parse(k.as_str()).unwrap(), k);
        }
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
