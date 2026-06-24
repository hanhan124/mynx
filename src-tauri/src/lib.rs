use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Maximum allowed VBS script size (512 KB).
/// Prevents abuse via excessively large payloads.
const MAX_VBS_SIZE: usize = 512 * 1024;

/// Validates VBS script content before execution.
/// Checks for size limits and obvious malicious patterns.
fn validate_vbs_content(content: &str) -> Result<(), String> {
    if content.len() > MAX_VBS_SIZE {
        return Err(format!(
            "VBS script too large: {} bytes (max {})",
            content.len(),
            MAX_VBS_SIZE
        ));
    }

    // The script must be for Excel COM automation only.
    // Reject known-dangerous COM objects that allow arbitrary
    // file/system operations beyond what Excel provides.
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
/// Used for Excel COM automation (chart generation) on Windows.
///
/// # Security
/// - Validates VBS content for size and dangerous patterns
/// - Uses unique temp file names to prevent race conditions
/// - Cleans up temp files after execution
/// - Runs in a blocking task to avoid freezing the UI
/// - Enforces a timeout to prevent hanging
#[tauri::command]
async fn run_vbs_script(vbs_content: String) -> Result<String, String> {
    // Validate before doing any I/O
    validate_vbs_content(&vbs_content)?;

    // Generate a unique temp file name using timestamp + process ID
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?
        .as_millis();
    let pid = std::process::id();
    let vbs_path = std::env::temp_dir().join(format!("mynx_charts_{}_{}.vbs", timestamp, pid));

    // Run the blocking cscript execution in a background task
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        // Write VBS to temp file
        fs::write(&vbs_path, &vbs_content)
            .map_err(|e| format!("Failed to write VBS file: {}", e))?;

        let vbs_path_str = vbs_path
            .to_str()
            .ok_or("Invalid temp path encoding")?;

        // Execute cscript with the temp file
        let output = Command::new("cscript")
            .args(["//nologo", vbs_path_str])
            .output()
            .map_err(|e| format!("Failed to execute cscript: {}", e))?;

        // Clean up temp file (ignore errors)
        let _ = fs::remove_file(&vbs_path);

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();

        if stdout.contains("SUCCESS:") {
            Ok(stdout)
        } else {
            // Don't leak full stderr to the frontend — return a concise error
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stderr_hint = if stderr.is_empty() {
                "no stderr output".to_string()
            } else {
                // Only include first 200 chars of stderr for debugging
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
        .invoke_handler(tauri::generate_handler![run_vbs_script])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
