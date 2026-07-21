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

/// O nome de fábrica. O app nasce sabendo o nome do dono, mas não CRAVADO nele.
pub const DEFAULT_DISPLAY_NAME: &str = "Allan";

fn default_close_to_tray() -> bool {
    true
}

fn default_display_name() -> String {
    DEFAULT_DISPLAY_NAME.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Fechar a janela minimiza para a bandeja em vez de sair. Ligado de fábrica.
    #[serde(default = "default_close_to_tray")]
    pub close_to_tray: bool,
    /// Como o app chama quem está na frente dele — toda saudação lê daqui.
    ///
    /// Mora aqui, e não no banco, porque é preferência de CHROME (como o tema e a
    /// bandeja), não dado da vida do usuário: não vira evento no ledger, não entra
    /// em backup de dados, e a tela de bloqueio precisa dele ANTES do PIN — logo
    /// não pode depender do banco nem ficar atrás da cortina. Ver ADR-0075.
    #[serde(default = "default_display_name")]
    pub display_name: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            close_to_tray: default_close_to_tray(),
            display_name: default_display_name(),
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

    /// O nome que as saudações usam.
    pub fn display_name(&self) -> String {
        self.cache
            .read()
            .expect("settings lock")
            .display_name
            .clone()
    }

    /// Troca o nome de exibição e persiste.
    ///
    /// O nome é APARADO e, se sobrar vazio, volta ao padrão: um campo de texto
    /// livre sempre acaba recebendo espaços ou um apagão inteiro, e "Boa noite, "
    /// com o vazio pendurado é pior que qualquer nome. Um teto de 40 caracteres
    /// impede que a saudação do Hub quebre o layout.
    pub fn set_display_name(&self, value: &str) -> Result<AppSettings> {
        let trimmed = value.trim();
        let name = if trimmed.is_empty() {
            default_display_name()
        } else {
            trimmed.chars().take(40).collect()
        };
        let updated = {
            let mut guard = self.cache.write().expect("settings lock");
            guard.display_name = name;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (SettingsStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        (SettingsStore::load(&paths), dir)
    }

    #[test]
    fn display_name_defaults_to_the_owner() {
        let (s, _d) = store();
        assert_eq!(s.display_name(), DEFAULT_DISPLAY_NAME);
    }

    #[test]
    fn set_display_name_trims_and_persists() {
        let (s, dir) = store();
        s.set_display_name("  Bea  ").unwrap();
        assert_eq!(s.display_name(), "Bea");

        // Releitura do disco: o nome sobrevive ao reinício do app.
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        assert_eq!(SettingsStore::load(&paths).display_name(), "Bea");
    }

    #[test]
    fn empty_name_falls_back_to_the_default() {
        let (s, _d) = store();
        s.set_display_name("Bea").unwrap();
        // Apagar o campo inteiro não pode deixar "Boa noite, " pendurado.
        s.set_display_name("   ").unwrap();
        assert_eq!(s.display_name(), DEFAULT_DISPLAY_NAME);
    }

    #[test]
    fn display_name_is_capped() {
        let (s, _d) = store();
        s.set_display_name(&"a".repeat(120)).unwrap();
        assert_eq!(s.display_name().chars().count(), 40);
    }

    /// A GARANTIA DE COMPATIBILIDADE: um `settings.json` gravado ANTES da v1.3 não
    /// tem `displayName`. Sem `#[serde(default)]` no campo novo, a desserialização
    /// falharia inteira, o `unwrap_or_default()` do `load` engoliria o erro e o
    /// usuário perderia silenciosamente o `closeToTray` que havia escolhido.
    #[test]
    fn a_pre_v13_settings_file_keeps_its_tray_choice() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::at(dir.path().to_path_buf()).unwrap();
        fs::write(paths.root.join("settings.json"), r#"{"closeToTray":false}"#).unwrap();

        let s = SettingsStore::load(&paths);
        assert!(!s.close_to_tray(), "a escolha antiga tem de sobreviver");
        assert_eq!(s.display_name(), DEFAULT_DISPLAY_NAME);
    }
}
