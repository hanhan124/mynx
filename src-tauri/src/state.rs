//! Shared application state handed to every command handler.

use mynx_core::r::RRuntime;
use mynx_core::settings::SettingsStore;
use mynx_jobs::JobManager;
use std::sync::Arc;

pub struct AppState {
    pub settings: SettingsStore,
    pub jobs: Arc<JobManager>,
    pub r: RRuntime,
}

pub type SharedState = Arc<AppState>;
