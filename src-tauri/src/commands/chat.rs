//! AI chat (chat-next) persistence + keychain commands. Thin adapters over
//! `mynx_core::chat_store` and `mynx_core::secrets`; documents are opaque
//! JSON owned by the frontend chat model.

use mynx_contracts::task::MynxError;
use mynx_core::chat_store::ChatDump;
use serde_json::Value;
use tauri::State;

use crate::state::SharedState;

fn joined<T>(result: Result<Result<T, String>, tauri::Error>) -> Result<T, MynxError> {
    result
        .map_err(|e| MynxError::internal(e.to_string()))?
        .map_err(|e| MynxError::io(e))
}

#[tauri::command]
pub async fn chat_store_load(state: State<'_, SharedState>) -> Result<ChatDump, MynxError> {
    let store = state.chat.clone();
    joined(tauri::async_runtime::spawn_blocking(move || store.load_all().map_err(|e| e.to_string())).await)
}

#[tauri::command]
pub async fn chat_store_is_empty(state: State<'_, SharedState>) -> Result<bool, MynxError> {
    let store = state.chat.clone();
    joined(tauri::async_runtime::spawn_blocking(move || store.is_empty().map_err(|e| e.to_string())).await)
}

#[tauri::command]
pub async fn chat_store_put_conversation(
    state: State<'_, SharedState>,
    conversation: Value,
    nodes: Vec<Value>,
) -> Result<(), MynxError> {
    let store = state.chat.clone();
    joined(
        tauri::async_runtime::spawn_blocking(move || {
            store.put_conversation(&conversation, &nodes).map_err(|e| e.to_string())
        })
        .await,
    )
}

#[tauri::command]
pub async fn chat_store_delete_conversation(state: State<'_, SharedState>, id: String) -> Result<bool, MynxError> {
    let store = state.chat.clone();
    joined(tauri::async_runtime::spawn_blocking(move || store.delete_conversation(&id).map_err(|e| e.to_string())).await)
}

#[tauri::command]
pub async fn chat_store_put_meta(state: State<'_, SharedState>, key: String, value: Value) -> Result<(), MynxError> {
    let store = state.chat.clone();
    joined(tauri::async_runtime::spawn_blocking(move || store.put_meta(&key, &value).map_err(|e| e.to_string())).await)
}

#[tauri::command]
pub async fn chat_secret_get(name: String) -> Result<Option<String>, MynxError> {
    joined(tauri::async_runtime::spawn_blocking(move || mynx_core::secrets::get_secret(&name)).await)
}

#[tauri::command]
pub async fn chat_secret_set(name: String, value: String) -> Result<(), MynxError> {
    joined(tauri::async_runtime::spawn_blocking(move || mynx_core::secrets::set_secret(&name, &value)).await)
}

#[tauri::command]
pub async fn chat_secret_delete(name: String) -> Result<bool, MynxError> {
    joined(tauri::async_runtime::spawn_blocking(move || mynx_core::secrets::delete_secret(&name)).await)
}
