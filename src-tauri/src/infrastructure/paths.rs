//! Layout de arquivos do NEXUS.
//!
//! Todo dado do usuário vive sob `%APPDATA%/Nexus/` — nunca ao lado do
//! executável, que pode estar em local somente-leitura ou versionado.

use std::path::PathBuf;

use crate::domain::errors::{NexusError, Result};

/// Onde cada coisa que o NEXUS escreve fica.
#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
    pub db: PathBuf,
    pub media: PathBuf,
    pub backups: PathBuf,
    pub exports: PathBuf,
    /// As retrospectivas anuais geradas (ARSENAL) — arquivos podados como backups
    /// (retenção de 2 anos); o dado-fonte é eterno. Ver ADR-0064.
    pub retrospectives: PathBuf,
    pub logs: PathBuf,
}

impl Paths {
    /// Resolve o diretório de dados e cria a árvore se não existir.
    ///
    /// Padrão: `%APPDATA%/Nexus` — a vida real do usuário. **Exceção (ADR-0048):**
    /// se `NEXUS_DATA_DIR` estiver setado, ancora ali. É o que mantém uma dirigida
    /// de UI (ou um `seed_demo`) fora do banco real: o dev aponta o app para uma
    /// pasta de teste sintética, e o `%APPDATA%/Nexus` só é tocado quando o próprio
    /// usuário abre o app instalado. Dado sintético nunca entra na vida real.
    pub fn resolve() -> Result<Self> {
        if let Some(dir) = std::env::var_os("NEXUS_DATA_DIR") {
            let dir = PathBuf::from(dir);
            if !dir.as_os_str().is_empty() {
                return Self::at(dir);
            }
        }
        let base = directories::BaseDirs::new().ok_or_else(|| {
            NexusError::Path("não foi possível resolver o diretório de dados".into())
        })?;
        Self::at(base.data_dir().join("Nexus"))
    }

    /// Ancora o layout numa raiz arbitrária e garante os diretórios.
    ///
    /// Público (e não `#[cfg(test)]`) porque os testes de integração compilam
    /// contra o crate como biblioteca externa e não enxergam itens de teste —
    /// e porque um dia um `--data-dir` vai querer exatamente isto.
    pub fn at(root: PathBuf) -> Result<Self> {
        let paths = Self {
            db: root.join("nexus.db"),
            media: root.join("media"),
            backups: root.join("backups"),
            exports: root.join("exports"),
            retrospectives: root.join("retrospectives"),
            logs: root.join("logs"),
            root,
        };
        paths.ensure_dirs()?;
        Ok(paths)
    }

    fn ensure_dirs(&self) -> Result<()> {
        for dir in [
            &self.root,
            &self.media,
            &self.backups,
            &self.exports,
            &self.retrospectives,
            &self.logs,
        ] {
            std::fs::create_dir_all(dir).map_err(|e| {
                NexusError::Path(format!("não foi possível criar {}: {e}", dir.display()))
            })?;
        }
        Ok(())
    }
}
