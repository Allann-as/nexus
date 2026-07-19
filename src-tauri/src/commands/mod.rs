//! Commands Tauri: a camada de interface.
//!
//! Deliberadamente finos — recebem input, chamam um caso de uso, mapeiam o erro.
//! Nenhuma regra de negócio mora aqui. Todo command tem exatamente um wrapper
//! tipado em `src/lib/ipc.ts` no frontend.

pub mod annual_goals;
pub mod areas;
pub mod backup;
pub mod books;
pub mod career;
pub mod challenges;
pub mod events;
pub mod fin_goals;
pub mod finance;
pub mod focus;
pub mod gamification;
pub mod goals;
pub mod habits;
pub mod insights;
pub mod links;
pub mod nodes;
pub mod notes;
pub mod perfect_weeks;
pub mod score;
pub mod search;
pub mod security;
pub mod spheres;
pub mod studies;
pub mod system;
pub mod tasks;
pub mod timeline;
pub mod weekly_review;
