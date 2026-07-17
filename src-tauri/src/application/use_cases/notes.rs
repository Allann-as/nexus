//! Casos de uso das Notas — corpo, wiki-links e anexos.

use std::sync::Arc;

use serde_json::json;
use sha2::{Digest, Sha256};

use crate::application::ports::{
    Attachment, Clock, IdGen, NewAttachment, NewNode, NodeRepository, NoteFull, NoteRepository,
    NoteSummary,
};
use crate::domain::entities::{validate_title, Kind};
use crate::domain::errors::{NexusError, Result};
use crate::domain::ledger::{EventType, LedgerEntityKind, NewLedgerEvent};
use crate::domain::wikilink;
use crate::infrastructure::paths::Paths;

pub struct NoteService {
    pub notes: Arc<dyn NoteRepository>,
    pub nodes: Arc<dyn NodeRepository>,
    pub ids: Arc<dyn IdGen>,
    pub clock: Arc<dyn Clock>,
    pub paths: Paths,
}

impl NoteService {
    pub fn list(&self, area_id: Option<&str>) -> Result<Vec<NoteSummary>> {
        self.notes.list(area_id)
    }

    pub fn get(&self, id: &str) -> Result<NoteFull> {
        self.notes.get_full(id)
    }

    /// Cria uma nota vazia. O corpo chega no primeiro `save_body`.
    pub fn create(&self, title: &str, area_id: Option<String>) -> Result<NoteFull> {
        let title = validate_title(title)?;
        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::Note),
            event_type: EventType::Created,
            payload: json!({ "kind": "note" }),
            title_snapshot: title.clone(),
        };
        self.nodes.create_with_event(
            &id,
            &NewNode {
                kind: Kind::Note,
                title,
                area_id,
                parent_id: None,
            },
            &event,
        )?;
        self.notes.get_full(&id)
    }

    /// Salva o corpo e resincroniza os wiki-links.
    ///
    /// Cada `[[Título]]` é resolvido para o node de mesmo título; os que existem
    /// viram elos 'references' (e backlinks do outro lado). Os que não existem
    /// ficam como elos pendentes — texto que a UI pinta diferente, sem link no
    /// banco (não se pode apontar para o que não há).
    pub fn save_body(&self, id: &str, body_md: &str) -> Result<NoteFull> {
        let titles = wikilink::extract(body_md);
        let mut resolved: Vec<String> = Vec::new();
        for title in titles {
            if let Some(target) = self.notes.find_by_title(&title, id)? {
                if !resolved.contains(&target) {
                    resolved.push(target);
                }
            }
        }

        let now = self.clock.now_ms();
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.to_string(),
            entity_kind: LedgerEntityKind::Node(Kind::Note),
            event_type: EventType::NoteEdited,
            payload: json!({ "links": resolved.len() }),
            // O título do node não muda aqui; a UI renomeia por outro caminho.
            title_snapshot: self.nodes.get(id)?.title,
        };
        self.notes
            .save_body_with_event(id, body_md, &resolved, now, &event)
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        self.notes.set_pinned(id, pinned)
    }

    /// Anexa um arquivo à nota: copia os bytes para `media/AAAA/MM/<sha>.<ext>`
    /// (dedup por SHA-256) e cria o node 'file' linkado. Colar imagem do
    /// clipboard cai aqui também — são só bytes.
    pub fn attach(&self, note_id: &str, filename: &str, bytes: &[u8]) -> Result<Attachment> {
        if bytes.is_empty() {
            return Err(NexusError::Validation(
                "um anexo vazio não é um anexo".into(),
            ));
        }
        // O node destino tem que ser uma nota existente — e dá a Esfera do anexo.
        let note = self.notes.get_full(note_id)?;

        let sha = hex(&Sha256::digest(bytes));
        let ext = extension(filename);
        let mime = mime_for(&ext).to_string();

        // Dedup: se o conteúdo já existe na mídia, reusa o caminho — nada é
        // copiado duas vezes. Senão, grava sob AAAA/MM do dia.
        let relative_path = match self.notes.path_for_sha(&sha)? {
            Some(existing) => existing,
            None => {
                let ym = self.clock.today_local(); // 'YYYY-MM-DD'
                let (year, month) = (&ym[..4], &ym[5..7]);
                let dir = self.paths.media.join(year).join(month);
                std::fs::create_dir_all(&dir).map_err(|e| {
                    NexusError::Path(format!("não foi possível criar {}: {e}", dir.display()))
                })?;
                let file_name = if ext.is_empty() {
                    sha.clone()
                } else {
                    format!("{sha}.{ext}")
                };
                let abs = dir.join(&file_name);
                std::fs::write(&abs, bytes).map_err(|e| {
                    NexusError::Path(format!("não foi possível gravar o anexo: {e}"))
                })?;
                format!("media/{year}/{month}/{file_name}")
            }
        };

        let id = self.ids.new_id();
        let now = self.clock.now_ms();
        let title = filename.trim();
        let title = if title.is_empty() { "anexo" } else { title };
        let event = NewLedgerEvent {
            ts: now,
            day: self.clock.today_local(),
            entity_id: id.clone(),
            entity_kind: LedgerEntityKind::Node(Kind::File),
            event_type: EventType::Created,
            payload: json!({ "attachedTo": note_id, "mime": mime }),
            title_snapshot: title.to_string(),
        };

        self.notes.attach_with_event(
            &id,
            note_id,
            &NewAttachment {
                title: title.to_string(),
                relative_path,
                mime,
                size_bytes: bytes.len() as i64,
                sha256: sha,
                area_id: note.area_id,
            },
            now,
            &event,
        )
    }
}

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// A extensão em minúsculas, sem o ponto. "" quando não há.
fn extension(filename: &str) -> String {
    filename
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .filter(|e| !e.is_empty() && e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_default()
}

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" => "text/plain",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_extension_is_lowercased_and_guarded() {
        assert_eq!(extension("print.PNG"), "png");
        assert_eq!(extension("foto.jpeg"), "jpeg");
        assert_eq!(extension("semponto"), "");
        assert_eq!(
            extension("nome.esquisão"),
            "",
            "extensão não-ascii é ignorada"
        );
        assert_eq!(extension("arquivo.tar.gz"), "gz");
    }

    #[test]
    fn mime_maps_the_common_cases() {
        assert_eq!(mime_for("png"), "image/png");
        assert_eq!(mime_for("pdf"), "application/pdf");
        assert_eq!(mime_for("xyz"), "application/octet-stream");
    }

    #[test]
    fn hex_encodes_bytes() {
        assert_eq!(hex(&[0x00, 0x0f, 0xff]), "000fff");
    }
}
