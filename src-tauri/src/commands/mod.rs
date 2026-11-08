//! Tauri command adapters. Window-specific orchestration stays here; reusable
//! URL and network behavior lives in `services`.

pub(crate) mod app;
pub(crate) mod image_convert;
pub(crate) mod weather;
