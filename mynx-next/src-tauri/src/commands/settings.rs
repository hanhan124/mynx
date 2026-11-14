//! Settings + task-center commands.

use mynx_contracts::settings::{LegacySettings, SettingsDoc};
use mynx_contracts::task::{MynxError, TaskRecord};
use tauri::State;

use crate::state::SharedState;

/// Load the full settings document (SQLite-backed, legacy-key compatible).
#[tauri::command]
pub async fn settings_load(state: State<'_, SharedState>) -> Result<SettingsDoc, MynxError> {
    let store = state.settings.clone_store_handle();
    tauri::async_runtime::spawn_blocking(move || store.load())
        .await
        .map_err(|e| MynxError::internal(e.to_string()))
}

/// Persist the full settings document.
#[tauri::command]
pub async fn settings_save(
    state: State<'_, SharedState>,
    doc: SettingsDoc,
) -> Result<(), MynxError> {
    let store = state.settings.clone_store_handle();
    tauri::async_runtime::spawn_blocking(move || store.save(&doc))
        .await
        .map_err(|e| MynxError::internal(e.to_string()))
}

/// One-time (idempotent) migration of legacy store/localStorage values.
#[tauri::command]
pub async fn settings_migrate_legacy(
    state: State<'_, SharedState>,
    legacy: LegacySettings,
) -> Result<(), MynxError> {
    let store = state.settings.clone_store_handle();
    tauri::async_runtime::spawn_blocking(move || store.migrate_legacy(&legacy))
        .await
        .map_err(|e| MynxError::internal(e.to_string()))
}

/// Live task-center snapshot (newest first).
#[tauri::command]
pub async fn tasks_list(state: State<'_, SharedState>) -> Result<Vec<TaskRecord>, MynxError> {
    Ok(state.jobs.list())
}

/// Cancel a running task (cooperative token + hard-kill hook).
#[tauri::command]
pub async fn tasks_cancel(state: State<'_, SharedState>, id: u64) -> Result<bool, MynxError> {
    Ok(state.jobs.cancel(id))
}
