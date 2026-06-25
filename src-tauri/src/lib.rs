use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Maximum allowed VBS script size (512 KB).
const MAX_VBS_SIZE: usize = 512 * 1024;

/// Validates VBS script content before execution.
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
            is_portable
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

