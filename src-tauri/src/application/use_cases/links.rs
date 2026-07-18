//! Casos de uso de links entre nodes (M4.6).
//!
//! O linking GENÉRICO e voltado ao usuário: uma meta de carreira que "conta para"
//! (`contributes_to`, ADR-0046) uma Meta Anual ou um item de Estudos. As notas têm
//! o seu próprio caminho (wiki-links, no `NoteService`); este é o resto.

use std::sync::Arc;

use crate::application::ports::{Clock, LinkRepository, NodeLinks, NodeRepository};
use crate::domain::errors::{NexusError, Result};

/// Os tipos de link que a UI cria pela mão. `references`/`attached_to` são das
/// notas/anexos (caminhos próprios) e não entram por aqui.
const USER_LINK_TYPES: &[&str] = &["related", "contributes_to"];

pub struct LinkService {
    pub links: Arc<dyn LinkRepository>,
    pub nodes: Arc<dyn NodeRepository>,
    pub clock: Arc<dyn Clock>,
}

impl LinkService {
    /// Cria um link direcional (source → target) e devolve os links do source já
    /// atualizados, para a UI redesenhar sem refetch.
    pub fn link(&self, source: &str, target: &str, link_type: &str) -> Result<NodeLinks> {
        if source == target {
            return Err(NexusError::Validation(
                "um item não se vincula a si mesmo".into(),
            ));
        }
        if !USER_LINK_TYPES.contains(&link_type) {
            return Err(NexusError::Validation(format!(
                "tipo de vínculo não permitido: {link_type}"
            )));
        }
        // Existência dos dois lados: um 404 honesto em vez do erro de FK cru.
        self.nodes.get(source)?;
        self.nodes.get(target)?;
        self.links
            .create(source, target, link_type, self.clock.now_ms())?;
        self.links.links_of(source)
    }

    /// Remove um link e devolve os links do source atualizados.
    pub fn unlink(&self, source: &str, target: &str, link_type: &str) -> Result<NodeLinks> {
        self.links.remove(source, target, link_type)?;
        self.links.links_of(source)
    }

    /// Os links de um node, nos dois sentidos (outgoing + backlinks).
    pub fn links_of(&self, node_id: &str) -> Result<NodeLinks> {
        self.links.links_of(node_id)
    }
}
