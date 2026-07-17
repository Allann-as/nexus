//! Logging to `%APPDATA%/Nexus/logs/`, rotated daily.
//!
//! Local files only — a log that phones anywhere would violate the zero-network
//! rule. Logs exist so a toast can show a cause and the details stay on disk.

use tracing_subscriber::{fmt, prelude::*, EnvFilter};

use crate::infrastructure::paths::Paths;

/// Guard that flushes buffered log lines on drop. The caller must hold it for
/// the lifetime of the process, or the last writes are lost.
pub struct LogGuard(#[allow(dead_code)] tracing_appender::non_blocking::WorkerGuard);

pub fn init(paths: &Paths) -> LogGuard {
    let appender = tracing_appender::rolling::daily(&paths.logs, "nexus.log");
    let (writer, guard) = tracing_appender::non_blocking(appender);

    let filter = EnvFilter::try_from_env("NEXUS_LOG").unwrap_or_else(|_| EnvFilter::new("info"));

    let file_layer = fmt::layer()
        .with_writer(writer)
        .with_ansi(false)
        .with_target(true);

    let registry = tracing_subscriber::registry().with(filter).with(file_layer);

    // A console layer is only useful when a console exists; the bundled app
    // runs windowed and has none.
    #[cfg(debug_assertions)]
    let registry = registry.with(fmt::layer().with_target(false));

    registry.init();
    LogGuard(guard)
}
