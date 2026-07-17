//! O domínio: o coração do NEXUS.
//!
//! REGRA DE DEPENDÊNCIA — nada aqui pode importar `rusqlite`, `tauri` ou
//! qualquer coisa de `infrastructure`/`commands`. As regras de negócio são
//! testáveis sem banco e sem janela. `errors` cita `rusqlite` apenas para
//! convertê-lo na fronteira (ADR-0003).

pub mod entities;
pub mod errors;
pub mod ledger;
