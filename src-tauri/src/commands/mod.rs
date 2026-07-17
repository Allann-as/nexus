//! Tauri commands: the interface layer.
//!
//! Deliberately thin — parse input, call a use case, map the error. No business
//! logic lives here. Every command has exactly one typed wrapper in
//! `src/lib/` on the frontend side.

pub mod system;
