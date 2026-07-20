//! O domínio: o coração do NEXUS.
//!
//! REGRA DE DEPENDÊNCIA — nada aqui pode importar `rusqlite`, `tauri` ou
//! qualquer coisa de `infrastructure`/`commands`. As regras de negócio são
//! testáveis sem banco e sem janela. `errors` cita `rusqlite` apenas para
//! convertê-lo na fronteira (ADR-0003).

pub mod achievements;
pub mod backup;
pub mod burnout;
pub mod correlation;
pub mod entities;
pub mod errors;
pub mod financial_health;
pub mod ledger;
pub mod ordering;
pub mod perfect_week;
pub mod projection;
pub mod recurrence;
pub mod savings;
pub mod schedule;
pub mod score;
pub mod skill_level;
pub mod streak;
pub mod wikilink;
pub mod xp;
