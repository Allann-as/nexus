//! O domínio: o coração do NEXUS.
//!
//! REGRA DE DEPENDÊNCIA — nada aqui pode importar `rusqlite`, `tauri` ou
//! qualquer coisa de `infrastructure`/`commands`. As regras de negócio são
//! testáveis sem banco e sem janela. `errors` cita `rusqlite` apenas para
//! convertê-lo na fronteira (ADR-0003).

pub mod entities;
pub mod errors;
pub mod ledger;
pub mod ordering;
pub mod projection;
pub mod recurrence;
pub mod schedule;
pub mod score;
pub mod streak;
