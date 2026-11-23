//! Mynx core services: SQLite-backed settings & task history, external R
//! runtime management, and shared application services.

pub mod atomic_file;
pub mod chat_store;
pub mod r;
pub mod secrets;
pub mod settings;
