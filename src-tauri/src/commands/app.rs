use std::path::PathBuf;

use crate::error::CommandError;

fn io_err(error: std::io::Error) -> CommandError {
    CommandError::Io(error.to_string())
}

/// Returns the path to the current executable.
#[tauri::command]
pub(crate) async fn app_exe_path() -> Result<String, CommandError> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| CommandError::ExePath(error.to_string()))
}

/// Checks if the app is running from a portable location.
#[tauri::command]
pub(crate) async fn is_portable() -> Result<bool, CommandError> {
    Ok(false)
}

/// Removes a leftover backup executable from a previous update.
#[tauri::command]
pub(crate) async fn cleanup_update_bak() -> Result<(), CommandError> {
    let current: PathBuf =
        std::env::current_exe().map_err(|error| CommandError::ExePath(error.to_string()))?;

    #[cfg(windows)]
    let backup_path = current.with_extension("exe.bak");
    #[cfg(not(windows))]
    let backup_path = current.with_extension("bak");

    if backup_path.exists() {
        tokio::fs::remove_file(&backup_path).await.map_err(io_err)?;
    }
    Ok(())
}
