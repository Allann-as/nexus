//! Commands Tauri: a camada de interface.
//!
//! Deliberadamente finos — recebem input, chamam um caso de uso, mapeiam o erro.
//! Nenhuma regra de negócio mora aqui. Todo command tem exatamente um wrapper
//! tipado em `src/lib/ipc.ts` no frontend.

pub mod areas;
pub mod books;
pub mod career;
pub mod events;
pub mod fin_goals;
pub mod finance;
pub mod goals;
pub mod habits;
pub mod nodes;
pub mod notes;
pub mod search;
pub mod spheres;
pub mod system;
pub mod tasks;
pub mod timeline;
