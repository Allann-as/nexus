//! Casos de uso de Áreas.

use std::sync::Arc;

use crate::application::ports::{AreaPatch, AreaRepository, Clock, IdGen, NewArea};
use crate::domain::entities::{validate_color, validate_title, Area};
use crate::domain::errors::{NexusError, Result};

pub struct AreaService {
    pub repo: Arc<dyn AreaRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
}

impl AreaService {
    /// Cria uma Área.
    ///
    /// Áreas não geram evento de ledger: elas são a *estrutura* da vida do
    /// usuário, não algo que aconteceu nela. A timeline conta o que você fez,
    /// não como você organizou as gavetas.
    pub fn create(&self, name: &str, icon: &str, color: &str) -> Result<Area> {
        let area = NewArea {
            name: validate_title(name)?,
            icon: validate_icon(icon)?,
            color: validate_color(color)?,
        };
        self.repo.create(&self.ids.new_id(), &area)
    }

    pub fn list(&self, include_archived: bool) -> Result<Vec<Area>> {
        self.repo.list(include_archived)
    }

    pub fn get(&self, id: &str) -> Result<Area> {
        self.repo.get(id)
    }

    pub fn update(
        &self,
        id: &str,
        name: Option<&str>,
        icon: Option<&str>,
        color: Option<&str>,
        sort_order: Option<i64>,
    ) -> Result<Area> {
        let patch = AreaPatch {
            name: name.map(validate_title).transpose()?,
            icon: icon.map(validate_icon).transpose()?,
            color: color.map(validate_color).transpose()?,
            sort_order,
        };
        self.repo.update(id, &patch)
    }

    /// Arquiva (nunca apaga).
    ///
    /// Apagar uma Área levaria junto, por CASCADE, todo node que aponta para
    /// ela — anos de notas e projetos. Arquivar preserva tudo e só some da UI.
    /// Regra 4 da constituição: dados são sagrados.
    pub fn archive(&self, id: &str) -> Result<()> {
        self.repo.archive(id, self.clock.now_ms())
    }
}

/// Nomes de ícone Lucide: minúsculas, dígitos e hífen.
///
/// Validado porque o valor vira um lookup na UI: um nome inválido não falha
/// alto, ele só renderiza um buraco. E como isto vira chave de componente,
/// recusar caracteres estranhos aqui evita surpresa no front.
fn validate_icon(raw: &str) -> Result<String> {
    let s = raw.trim();
    let ok = !s.is_empty()
        && s.len() <= 40
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');

    if !ok {
        return Err(NexusError::Validation(format!(
            "ícone inválido: {s} (esperado kebab-case, ex: 'circle')"
        )));
    }
    Ok(s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_names_are_validated() {
        assert_eq!(validate_icon("circle").unwrap(), "circle");
        assert_eq!(validate_icon(" trending-up ").unwrap(), "trending-up");
        assert_eq!(validate_icon("box-3d").unwrap(), "box-3d");
        assert!(validate_icon("").is_err());
        assert!(
            validate_icon("Circle").is_err(),
            "maiúscula não é kebab-case"
        );
        assert!(validate_icon("circle;drop table").is_err());
        assert!(validate_icon(&"a".repeat(41)).is_err());
    }
}
