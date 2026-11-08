//! Tauri command adapters for the image → PNG batch converter.

use crate::error::CommandError;
use crate::services::image_convert as svc;
use crate::tasks::TaskId;
use tauri::ipc::Channel;

/// Expands files/folders into the flat list of supported image inputs.
#[tauri::command]
pub(crate) async fn image_collect_files(paths: Vec<String>) -> Result<Vec<String>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || svc::collect_files(&paths))
        .await
        .map_err(|error| CommandError::Image(error.to_string()))
}

/// Starts a background conversion job; progress streams through the channel.
#[tauri::command]
pub(crate) async fn image_convert_start(
    options: svc::ConvertOptions,
    on_progress: Channel<svc::ConvertEvent>,
) -> Result<TaskId, CommandError> {
    Ok(TaskId(svc::start(options, on_progress)))
}

/// Requests cancellation of a running conversion task.
#[tauri::command]
pub(crate) async fn image_convert_cancel(task_id: TaskId) -> Result<bool, CommandError> {
    Ok(svc::cancel(task_id.0))
}

/// Renders a small PNG thumbnail (base64 data URL) for the file list.
#[tauri::command]
pub(crate) async fn image_thumbnail(
    path: String,
    max_size: Option<u32>,
) -> Result<svc::Thumbnail, CommandError> {
    let max_size = max_size.unwrap_or(96);
    tauri::async_runtime::spawn_blocking(move || svc::thumbnail(&path, max_size))
        .await
        .map_err(|error| CommandError::Image(error.to_string()))?
        .map_err(CommandError::Image)
}
