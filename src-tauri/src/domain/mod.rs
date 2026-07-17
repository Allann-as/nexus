//! The domain: the heart of NEXUS.
//!
//! DEPENDENCY RULE — nothing in this module may import `rusqlite`, `tauri`, or
//! anything from `infrastructure`/`commands`. Business rules stay testable
//! without a database or a window. `errors` names `rusqlite` only to convert
//! it away at the boundary.

pub mod errors;
