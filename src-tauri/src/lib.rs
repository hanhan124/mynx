use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Maximum allowed VBS script size (512 KB).
const MAX_VBS_SIZE: usize = 512 * 1024;

fn validate_vbs_content(content: &str) -> Result<(), String> {
    if content.len() > MAX_VBS_SIZE {
        return Err(format!(
            "VBS script too large: {} bytes (max {})",
            content.len(),
            MAX_VBS_SIZE
        ));
    }

    let dangerous_patterns = [
        "WScript.Shell",
        "Scripting.FileSystemObject",
        "Shell.Application",
    ];

    let lower = content.to_ascii_lowercase();
    for pattern in &dangerous_patterns {
        let pl = pattern.to_ascii_lowercase();
        if lower.contains(&pl) {
            return Err(format!(
                "VBS script contains restricted COM object: {}",
                pattern
            ));
        }
    }

    Ok(())
}

/// Writes VBS script content to a temp file, executes it via cscript, and returns stdout.
#[tauri::command]
async fn run_vbs_script(vbs_content: String) -> Result<String, String> {
    validate_vbs_content(&vbs_content)?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?
        .as_millis();
    let pid = std::process::id();
    let vbs_path = std::env::temp_dir().join(format!("mynx_charts_{}_{}.vbs", timestamp, pid));

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        fs::write(&vbs_path, &vbs_content)
            .map_err(|e| format!("Failed to write VBS file: {}", e))?;

        let vbs_path_str = vbs_path
            .to_str()
            .ok_or("Invalid temp path encoding")?;

        let output = Command::new("cscript")
            .args(["//nologo", vbs_path_str])
            .output()
            .map_err(|e| format!("Failed to execute cscript: {}", e))?;

        let _ = fs::remove_file(&vbs_path);

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();

        if stdout.contains("SUCCESS:") {
            Ok(stdout)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr_hint = if stderr.is_empty() {
                "no stderr output".to_string()
            } else {
                stderr.chars().take(200).collect::<String>()
            };
            Err(format!(
                "Chart generation failed. stdout: {}, stderr: {}",
                stdout.chars().take(200).collect::<String>(),
                stderr_hint
            ))
        }
    })
    .await
    .map_err(|e| format!("Task execution error: {}", e))?;

    result
}

/// Returns the path to the current executable.
#[tauri::command]
fn app_exe_path() -> Result<String, String> {
    std::env::current_exe().map(|p| p.to_string_lossy().to_string()).map_err(|e| e.to_string())
}

/// Checks if the app is running from a portable location (not in Program Files).
#[tauri::command]
fn is_portable() -> Result<bool, String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get exe path: {}", e))?;
    let path_str = exe_path.to_string_lossy().to_lowercase();
    Ok(!path_str.contains("program files"))
}

/// Portable self-update: rename old exe as .bak, move new exe in, spawn new, exit.
/// The new process will clean up the .bak file on next startup.
#[tauri::command]
fn portable_self_update(new_exe_path: String) -> Result<(), String> {
    let current = std::env::current_exe()
        .map_err(|e| format!("Failed to get current exe: {}", e))?;

    let new_path = std::path::Path::new(&new_exe_path);
    if !new_path.exists() {
        return Err(format!("New exe not found: {}", new_exe_path));
    }

    if !new_path.is_file() {
        return Err(format!("Not a file: {}", new_exe_path));
    }

    let bak_path = current.with_extension("exe.bak");

    // 1. Rename current exe → .bak
    if current.exists() {
        let _ = fs::remove_file(&bak_path);
        fs::rename(&current, &bak_path)
            .map_err(|e| format!("Failed to rename current exe: {}", e))?;
    }

    // 2. Move new exe to current exe's location
    fs::rename(new_path, &current)
        .map_err(|e| {
            // Rollback: try to restore old exe
            let _ = fs::rename(&bak_path, &current);
            format!("Failed to move new exe: {}", e)
        })?;

    // 3. Clean up .bak
    let _ = fs::remove_file(&bak_path);

    // 4. Spawn new exe and exit
    Command::new(&current)
        .spawn()
        .map_err(|e| format!("Failed to spawn new exe: {}", e))?;

    std::process::exit(0);
}

/// Clean up leftover .bak file from a previous portable self-update.
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
            run_vbs_script,
            app_exe_path,
            is_portable,
            portable_self_update,
            cleanup_update_bak
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

