//! As preferências de SO do NEXUS (ARSENAL) — a bandeja.
//!
//! Vive FORA do banco (`settings.json` na raiz de dados), como a config do PIN e
//! do backup: é preferência de chrome do app, não dado do usuário, e o handler de
//! fechamento da janela (no loop de eventos do Tauri) precisa lê-la sem depender
//! do banco. Ver ADR-0065.

use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::domain::errors::{NexusError, Result};
use crate::infrastructure::paths::Paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Fechar a janela minimiza para a bandeja em vez de sair. Ligado de fábrica.
    pub close_to_tray: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
        }
    }
}

/// O guardião das preferências: lê/grava o `settings.json` e mantém uma cópia em
/// memória para o handler de fechamento consultar sem tocar o disco a cada evento.
pub struct SettingsStore {
    path: PathBuf,
    cache: RwLock<AppSettings>,
}

impl SettingsStore {
    /// Carrega do disco (ou o padrão) na abertura do app.
    pub fn load(paths: &Paths) -> Self {
        let path = paths.root.join("settings.json");
        let settings = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<AppSettings>(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            cache: RwLock::new(settings),
        }
    }

    /// O snapshot atual — o que a UI mostra.
    pub fn get(&self) -> AppSettings {
        self.cache.read().expect("settings lock").clone()
    }

    /// `true` se fechar a janela deve minimizar para a bandeja.
    pub fn close_to_tray(&self) -> bool {
        self.cache.read().expect("settings lock").close_to_tray
    }

    /// Troca o "fechar para a bandeja" e persiste.
    pub fn set_close_to_tray(&self, value: bool) -> Result<AppSettings> {
        let updated = {
            let mut guard = self.cache.write().expect("settings lock");
            guard.close_to_tray = value;
            guard.clone()
        };
        self.persist(&updated)?;
        Ok(updated)
    }

    fn persist(&self, settings: &AppSettings) -> Result<()> {
        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| NexusError::Path(format!("serializar settings: {e}")))?;
        fs::write(&self.path, json)
            .map_err(|e| NexusError::Path(format!("gravar settings.json: {e}")))?;
        Ok(())
    }
}
