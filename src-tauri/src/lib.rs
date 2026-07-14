use std::path::PathBuf;
use tauri;
use thiserror::Error;

/// Unified, serializable error type for all Tauri commands.
///
/// `thiserror` derives `Display` (used by `Debug` in the default error trace)
/// and `serde` makes it cross the IPC boundary as a structured string the
/// frontend can read via the rejected `Promise` message — replacing every
/// ad-hoc `.unwrap()` / `.expect()` / `e.to_string()` pattern.
#[derive(Debug, Error)]
pub enum CommandError {
    /// Failed to resolve the current executable path.
    #[error("Failed to resolve executable path: {0}")]
    ExePath(String),

    /// A filesystem operation failed (creating/removing the .bak file, etc.).
    #[error("Filesystem error: {0}")]
    Io(String),

    /// The builder failed to start the application.
    #[error("Failed to run Tauri application: {0}")]
    Builder(String),
}

// Tauri v2 requires command error types to be `Serialize` so they can be sent
// back to the frontend over IPC. `thiserror` already gives us `Display`;
// serde then serializes the `Display` string as the error payload.
impl serde::Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.to_string().as_ref())
    }
}

/// Convert any `io::Error` into our unified `CommandError`.
fn io_err(e: std::io::Error) -> CommandError {
    CommandError::Io(e.to_string())
}

/// Returns the path to the current executable.
///
/// Async so it never blocks the Tauri main thread; resolves the path on the
/// Tokio runtime. Errors are returned as `Result` rather than panicking.
#[tauri::command]
async fn app_exe_path() -> Result<String, CommandError> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| CommandError::ExePath(e.to_string()))
}

/// Checks if the app is running from a portable location (not in Program Files).
/// Kept for compat, always returns false for installed-only builds.
#[tauri::command]
async fn is_portable() -> Result<bool, CommandError> {
    Ok(false)
}

/// Clean up leftover .bak file from a previous portable self-update.
/// Kept for compat in case a user upgrades from an older portable version.
///
/// Uses `tokio::fs` so the (rare) blocking file removal never stalls the
/// command thread pool.
#[tauri::command]
async fn cleanup_update_bak() -> Result<(), CommandError> {
    let current: PathBuf = std::env::current_exe()
        .map_err(|e| CommandError::ExePath(e.to_string()))?;

    #[cfg(windows)]
    let bak_path = current.with_extension("exe.bak");
    #[cfg(not(windows))]
    let bak_path = current.with_extension("bak");

    if bak_path.exists() {
        // Best-effort removal; an error here is non-fatal but we still surface
        // it to the caller instead of silently swallowing it.
        tokio::fs::remove_file(&bak_path)
            .await
            .map_err(io_err)?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            app_exe_path,
            is_portable,
            cleanup_update_bak
        ])
        .setup(|app| {
            // No shared state is currently needed (commands are stateless),
            // but if future commands require managed state it must be added
            // here as `Arc<Mutex<T>>` (use `tokio::sync::Mutex` for async
            // commands) and injected via `app.manage(...)`.
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .map_err(|e| CommandError::Builder(e.to_string()))
        // The builder's `run` is the top-level entry point and must own the
        // process. We cannot return a `Result` here, so we fall back to
        // printing the error and exiting instead of `expect()`-ing — which
        // would panic with an opaque message on production builds.
        .unwrap_or_else(|e| {
            eprintln!("[mynx] fatal: {e}");
            std::process::exit(1);
        });
}
