//! A camada de aplicação: casos de uso orquestrando o domínio via ports.
//!
//! Não conhece SQLite nem Tauri — só os traits de `ports`.

pub mod ports;
pub mod use_cases;
