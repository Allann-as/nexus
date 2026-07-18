//! Infraestrutura: adaptadores concretos para o mundo externo (SQLite, disco,
//! logs). Implementa os ports declarados pela camada de aplicação.

pub mod backup;
pub mod clock;
pub mod db;
pub mod export;
pub mod fts;
pub mod logging;
pub mod paths;
pub mod repositories;
