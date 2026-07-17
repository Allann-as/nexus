//! The domain's error vocabulary.
//!
//! This is the one place in `domain/` that names a foreign type: `Storage`
//! carries an already-stringified message, so the variant stays free of any
//! `rusqlite` type and the dependency rule holds.

use serde::Serialize;

pub type Result<T> = std::result::Result<T, NexusError>;

#[derive(Debug, thiserror::Error)]
pub enum NexusError {
    #[error("storage failure: {0}")]
    Storage(String),

    #[error("database integrity check failed: {0}")]
    Integrity(String),

    #[error("migration failure: {0}")]
    Migration(String),

    #[error("filesystem failure: {0}")]
    Path(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    Validation(String),
}

impl From<rusqlite::Error> for NexusError {
    fn from(e: rusqlite::Error) -> Self {
        NexusError::Storage(e.to_string())
    }
}

impl From<r2d2::Error> for NexusError {
    fn from(e: r2d2::Error) -> Self {
        NexusError::Storage(format!("connection pool: {e}"))
    }
}

impl From<rusqlite_migration::Error> for NexusError {
    fn from(e: rusqlite_migration::Error) -> Self {
        NexusError::Migration(e.to_string())
    }
}

/// Wire format for errors crossing into the UI.
///
/// Toasts must never swallow the cause, so `message` carries the full
/// `Display` text and `kind` lets the frontend branch on the category.
#[derive(Debug, Serialize)]
pub struct ErrorPayload {
    pub kind: String,
    pub message: String,
}

impl From<NexusError> for ErrorPayload {
    fn from(e: NexusError) -> Self {
        let kind = match &e {
            NexusError::Storage(_) => "storage",
            NexusError::Integrity(_) => "integrity",
            NexusError::Migration(_) => "migration",
            NexusError::Path(_) => "path",
            NexusError::NotFound(_) => "not_found",
            NexusError::Validation(_) => "validation",
        };
        ErrorPayload {
            kind: kind.into(),
            message: e.to_string(),
        }
    }
}

impl Serialize for NexusError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        let payload = ErrorPayload {
            kind: match self {
                NexusError::Storage(_) => "storage",
                NexusError::Integrity(_) => "integrity",
                NexusError::Migration(_) => "migration",
                NexusError::Path(_) => "path",
                NexusError::NotFound(_) => "not_found",
                NexusError::Validation(_) => "validation",
            }
            .into(),
            message: self.to_string(),
        };
        payload.serialize(s)
    }
}
