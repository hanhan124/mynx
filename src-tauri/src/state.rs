//! Shared application state handed to every command handler.

use mynx_core::chat_store::ChatStore;
use mynx_core::r::RRuntime;
use mynx_core::settings::SettingsStore;
use mynx_jobs::JobManager;
use std::sync::Arc;

pub struct AppState {
    pub settings: SettingsStore,
    /// AI chat (chat-next) conversations, assistants, providers.
    pub chat: ChatStore,
    pub jobs: Arc<JobManager>,
    pub r: RRuntime,
}

pub type SharedState = Arc<AppState>;
