//! Image conversion commands. The heavy pipeline lives in `mynx-image`; this
//! adapter owns task-center lifecycle bridging and the cancellation hook.

use mynx_contracts::image::{ConvertEvent, ConvertOptions, Thumbnail};
use mynx_contracts::task::{MynxError, TaskKind, TaskStatus};
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;

use crate::state::SharedState;

/// Expand files/folders into the flat list of supported image inputs.
#[tauri::command]
pub async fn image_collect_files(paths: Vec<String>) -> Result<Vec<String>, MynxError> {
    tauri::async_runtime::spawn_blocking(move || {
        mynx_image::collect_files(&paths).map_err(MynxError::validation)
    })
    .await
    .map_err(|e| MynxError::internal(e.to_string()))?
}

/// Start a batch conversion job. Progress streams through the channel while
/// the task center mirrors lifecycle from the same event stream; cancelling
/// the returned job id (feature page or task center) reaches the pipeline
/// through the job's kill hook.
#[tauri::command]
pub async fn image_convert_start(
    state: State<'_, SharedState>,
    options: ConvertOptions,
    on_progress: Channel<ConvertEvent>,
) -> Result<u64, MynxError> {
    let app_state = state.inner().clone();
    let job = app_state.jobs.start(TaskKind::ImageConvert, "PNG 转换");
    let job_id = job.id;

    let channel = on_progress.clone();
    let jobs_for_emitter = app_state.jobs.clone();
    let emitter = move |event: ConvertEvent| {
        match &event {
            ConvertEvent::Started { total } => {
                let total = *total;
                jobs_for_emitter.update(job_id, |record| {
                    record.detail = Some(format!("{total} files"));
                    record.status = TaskStatus::Running;
                });
            }
            ConvertEvent::Item { index, total, .. } => {
                let (index, total) = (*index, *total);
                if total > 0 {
                    jobs_for_emitter.update(job_id, |record| {
                        record.progress = Some((index as f64) / (total as f64));
                    });
                }
            }
            ConvertEvent::Finished { status, .. } => match status.as_str() {
                "completed" => jobs_for_emitter.update(job_id, |record| {
                    record.status = TaskStatus::Succeeded;
                    record.progress = Some(1.0);
                    record.finished_at_ms = Some(now_ms());
                }),
                "cancelled" => jobs_for_emitter.update(job_id, |record| {
                    record.status = TaskStatus::Cancelled;
                    record.finished_at_ms = Some(now_ms());
                }),
                _ => jobs_for_emitter.update(job_id, |record| {
                    record.status = TaskStatus::Failed;
                    record.finished_at_ms = Some(now_ms());
                }),
            },
        }
        let _ = channel.send(event);
    };

    let image_task_id = mynx_image::start(options, emitter);

    // Hard-kill hook: task-center cancel reaches the pipeline's flag.
    job.on_cancel(Arc::new(move || {
        mynx_image::cancel(image_task_id);
    }));

    Ok(job_id)
}

/// Request cancellation of a running conversion. The task id is the job id;
/// the pipeline's internal id is reached via the job's kill hook.
#[tauri::command]
pub async fn image_convert_cancel(
    state: State<'_, SharedState>,
    task_id: u64,
) -> Result<bool, MynxError> {
    Ok(state.jobs.cancel(task_id))
}

/// Render a small PNG thumbnail (base64 data URL) for the file list.
#[tauri::command]
pub async fn image_thumbnail(
    path: String,
    max_size: Option<u32>,
) -> Result<Thumbnail, MynxError> {
    let max_size = max_size.unwrap_or(96);
    tauri::async_runtime::spawn_blocking(move || {
        mynx_image::thumbnail(&path, max_size).map_err(MynxError::validation)
    })
    .await
    .map_err(|e| MynxError::internal(e.to_string()))?
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
