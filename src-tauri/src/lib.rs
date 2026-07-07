use std::fs;
use tauri;

/// Returns the path to the current executable.
#[tauri::command]
fn app_exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// Checks if the app is running from a portable location (not in Program Files).
/// Kept for compat, always returns false for installed-only builds.
#[tauri::command]
fn is_portable() -> Result<bool, String> {
    Ok(false)
}

/// Clean up leftover .bak file from a previous portable self-update.
/// Kept for compat in case user upgrades from an older portable version.
#[tauri::command]
fn cleanup_update_bak() -> Result<(), String> {
    let current = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {}", e))?;
    let bak_path = current.with_extension("exe.bak");
    if bak_path.exists() {
        fs::remove_file(&bak_path)
            .map_err(|e| format!("Failed to remove bak file: {}", e))?;
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
