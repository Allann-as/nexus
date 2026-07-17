//! NEXUS — a local-first Personal Operating System.
//!
//! Layering (see docs/ARCHITECTURE.md):
//!
//!   commands -> application -> domain <- infrastructure
//!
//! The arrows point at `domain`, and `domain` points at nothing. That is the
//! whole rule.

// Building a cdylib with the MSVC toolchain makes the linker print an
// informational "Creating library ..." line on stdout, which rustc's
// `linker_messages` lint then reports as a warning. It is pure noise and there
// is no way to quiet the linker itself. Scoped to this crate so the zero-warning
// gate stays meaningful; see docs/DECISIONS.md (ADR-0004).
#![allow(linker_messages)]

pub mod commands;
pub mod domain;
pub mod infrastructure;

use commands::system::AppState;
use infrastructure::{db::Db, logging, paths::Paths};

/// Builds state and runs the app.
///
/// Startup deliberately fails loudly: a database that cannot be opened or
/// migrated must not reach a half-alive UI that appears to accept writes.
pub fn run() {
    let paths = match Paths::resolve() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("NEXUS could not resolve its data directory: {e}");
            std::process::exit(1);
        }
    };

    let _log_guard = logging::init(&paths);
    tracing::info!(root = %paths.root.display(), "starting NEXUS");

    let db = match Db::open(&paths) {
        Ok(db) => db,
        Err(e) => {
            tracing::error!(error = %e, "could not open the database");
            eprintln!("NEXUS could not open its database: {e}");
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .manage(AppState { db, paths })
        .invoke_handler(tauri::generate_handler![commands::system::system_info])
        .build(tauri::generate_context!())
        .expect("could not build the NEXUS window")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                // Best-effort: refresh planner statistics on the way out. A
                // failure here must not block exit.
                if let Some(state) = app.try_state::<AppState>() {
                    if let Err(e) = state.db.optimize() {
                        tracing::warn!(error = %e, "PRAGMA optimize failed on shutdown");
                    }
                }
                tracing::info!("NEXUS stopped");
            }
        });
}
