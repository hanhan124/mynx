//! App-level commands: info, update-artifact cleanup and output-dir opening.

use crate::error::CommandError;
use mynx_contracts::settings::AppInfo;
use mynx_contracts::WIRE_VERSION;
use tauri::Manager;

/// Version / executable info for the about dialog.
#[tauri::command]
pub async fn app_info() -> Result<AppInfo, CommandError> {
    Ok(AppInfo {
        v: WIRE_VERSION,
        version: env!("CARGO_PKG_VERSION").to_string(),
        exe_path: std::env::current_exe()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_default(),
        is_portable: false,
    })
}

/// Delete the `.bak` file a previous updater run may have left next to the
/// executable (Windows: `Mynx.exe.bak`).
#[tauri::command]
pub async fn cleanup_update_bak() -> Result<(), CommandError> {
    let exe = std::env::current_exe().map_err(|e| CommandError::io(e.to_string()))?;
    let mut bak = exe.clone().into_os_string();
    bak.push(".bak");
    if tokio::fs::try_exists(&bak)
        .await
        .map_err(|e| CommandError::io(e.to_string()))?
    {
        tokio::fs::remove_file(&bak)
            .await
            .map_err(|e| CommandError::io(e.to_string()))?;
    }
    Ok(())
}

/// Open a file or directory with the system default handler (Explorer /
/// Finder). Used for output directories and result files.
#[tauri::command]
pub async fn open_path(path: String) -> Result<bool, CommandError> {
    if cfg!(target_os = "windows") {
        let _ = std::process::Command::new("explorer")
            .arg(&path)
            .spawn();
        Ok(true)
    } else if cfg!(target_os = "macos") {
        let _ = std::process::Command::new("open")
            .arg(&path)
            .spawn();
        Ok(true)
    } else {
        let _ = std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn();
        Ok(true)
    }
}

/// Resolve a resource path (`resourceDir()/r/...`) for the R scripts.
#[tauri::command]
pub async fn resource_r_path(
    app: tauri::AppHandle,
    script: String,
) -> Result<String, CommandError> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| CommandError::io(e.to_string()))?;
    Ok(dir.join("r").join(script).to_string_lossy().into_owned())
}

/// Current window always-on-top state.
#[tauri::command]
pub async fn is_always_on_top(window: tauri::WebviewWindow) -> Result<bool, CommandError> {
    window
        .is_always_on_top()
        .map_err(|e| CommandError::io(e.to_string()))
}
