//! R runtime commands: discovery, dependency checks, install tasks.

use mynx_contracts::r::{RDependencyStatus, RInstallEvent, RInstallResult, RScriptStatus};
use mynx_contracts::task::{LogLine, MynxError, TaskKind};
use mynx_contracts::WIRE_VERSION;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{Emitter, State};

use crate::state::SharedState;

/// Rscript discovery status (cached in-process).
#[tauri::command]
pub async fn r_status(state: State<'_, SharedState>) -> Result<RScriptStatus, MynxError> {
    let app_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || app_state.r.status())
        .await
        .map_err(|e| MynxError::internal(e.to_string()))
}

/// Check required R packages without loading them.
#[tauri::command]
pub async fn r_check_dependencies(
    state: State<'_, SharedState>,
    packages: Vec<String>,
) -> Result<RDependencyStatus, MynxError> {
    Ok(state.r.check_dependencies(&packages).await)
}

/// Install R via the system package manager. Streams progress on the
/// `mynx://r-install-log` event; returns the task id.
#[tauri::command]
pub async fn r_install_runtime(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
) -> Result<u64, MynxError> {
    let job = state.jobs.start(TaskKind::RInstall, "R");
    let app_handle = app.clone();
    let log: mynx_core::r::LogSink = Arc::new(move |level, message| {
        let line = LogLine { v: WIRE_VERSION, ts_ms: now_ms(), level, message };
        let _ = app_handle.emit("mynx://r-install-log", line);
    });

    let result = mynx_core::r::RRuntime::install_runtime(log).await;
    finish_install(&job, result.ok, result.cancelled, result.error, "R 安装失败")
}

/// Install required R packages (CRAN + Bioconductor). Streams progress on
/// `mynx://r-install-log` and through the channel; cancellable.
#[tauri::command]
pub async fn r_install_packages(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    packages: Vec<String>,
    on_progress: Channel<RInstallEvent>,
) -> Result<u64, MynxError> {
    let job = state.jobs.start(TaskKind::RInstall, "R 依赖");
    let token = job.token.clone();
    let app_handle = app.clone();
    let log: mynx_core::r::LogSink = Arc::new(move |level, message| {
        let line = LogLine { v: WIRE_VERSION, ts_ms: now_ms(), level, message: message.clone() };
        let _ = app_handle.emit("mynx://r-install-log", line);
        let _ = on_progress.send(RInstallEvent { v: WIRE_VERSION, level, message });
    });

    let result = state.r.install_packages(&packages, log, &token).await;
    finish_install(&job, result.ok, result.cancelled, result.error, "R 依赖安装失败")
}

/// Settle the install job and tell the caller how it ended: a failed or
/// cancelled install rejects, so the page never reports success for it.
fn finish_install(
    job: &mynx_jobs::JobHandle<'_>,
    ok: bool,
    cancelled: bool,
    error: Option<String>,
    fallback: &str,
) -> Result<u64, MynxError> {
    if ok {
        job.succeed();
        return Ok(job.id);
    }
    if cancelled {
        job.mark_cancelled();
        return Err(MynxError::cancelled());
    }
    let message = error.filter(|text| !text.trim().is_empty()).unwrap_or_else(|| fallback.to_string());
    job.fail(message.clone());
    Err(MynxError::process(message))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Unused result alias kept for signature clarity in install variants.
#[allow(unused)]
type InstallResult = RInstallResult;
