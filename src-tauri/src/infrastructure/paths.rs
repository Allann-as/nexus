//! Filesystem layout for NEXUS.
//!
//! All user data lives under `%APPDATA%/Nexus/` — never beside the executable,
//! which may sit in a read-only or version-managed location.

use std::path::PathBuf;

use crate::domain::errors::{NexusError, Result};

/// Resolved locations of everything NEXUS writes.
#[derive(Debug, Clone)]
pub struct Paths {
    pub root: PathBuf,
    pub db: PathBuf,
    pub media: PathBuf,
    pub backups: PathBuf,
    pub exports: PathBuf,
    pub logs: PathBuf,
}

impl Paths {
    /// Resolves `%APPDATA%/Nexus` and creates the directory tree if absent.
    pub fn resolve() -> Result<Self> {
        let base = directories::BaseDirs::new()
            .ok_or_else(|| NexusError::Path("could not resolve the user data directory".into()))?;

        let root = base.data_dir().join("Nexus");
        let paths = Self {
            db: root.join("nexus.db"),
            media: root.join("media"),
            backups: root.join("backups"),
            exports: root.join("exports"),
            logs: root.join("logs"),
            root,
        };
        paths.ensure_dirs()?;
        Ok(paths)
    }

    /// Points every path at a scratch directory. Test-only.
    #[cfg(test)]
    pub fn for_test(root: PathBuf) -> Result<Self> {
        let paths = Self {
            db: root.join("nexus.db"),
            media: root.join("media"),
            backups: root.join("backups"),
            exports: root.join("exports"),
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
            &self.logs,
        ] {
            std::fs::create_dir_all(dir).map_err(|e| {
                NexusError::Path(format!("could not create {}: {e}", dir.display()))
            })?;
        }
        Ok(())
    }
}
