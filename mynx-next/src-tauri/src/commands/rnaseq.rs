//! RNA-seq commands: config defaults/merge, counts import, engine runs with
//! ASCII staging + channel logs, and run-directory history operations.

use mynx_contracts::rnaseq::{
    DeSummaryRow, ImportRequest, ImportData, ResultFileItem, RnaSeqConfig, RunDirEntry,
    RunResult,
};
use mynx_contracts::task::{LogLine, MynxError, TaskKind};
use mynx_contracts::WIRE_VERSION;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;

use crate::state::SharedState;

/// Default configuration (Rust is the single source of truth).
#[tauri::command]
pub async fn rnaseq_default_config() -> Result<RnaSeqConfig, MynxError> {
    Ok(RnaSeqConfig::default())
}

/// Deep-merge a historical params.json patch onto the default config.
#[tauri::command]
pub async fn rnaseq_merge_config(
    patch: serde_json::Value,
) -> Result<RnaSeqConfig, MynxError> {
    Ok(mynx_rnaseq::merge_params(&RnaSeqConfig::default(), &patch))
}

/// Import a counts matrix (csv/tsv/xlsx/featureCounts/htseq).
#[tauri::command]
pub async fn rnaseq_import_counts(
    request: ImportRequest,
) -> Result<ImportData, MynxError> {
    let join = tauri::async_runtime::spawn_blocking(move || {
        mynx_rnaseq::import_counts(request)
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))?
}

/// Run rnaseq_engine.R. Logs stream through the channel; the invoke promise
/// resolves with the terminal RunResult. Cancel via tasks_cancel.
#[tauri::command]
pub async fn rnaseq_run(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    config: RnaSeqConfig,
    steps: Vec<String>,
    on_log: Channel<LogLine>,
) -> Result<RunResult, MynxError> {
    let app_state = state.inner().clone();
    let rscript = app_state.r.find_rscript();
    if rscript.is_empty() {
        return Err(MynxError::validation(
            "未找到 Rscript。请安装 R(https://cloud.r-project.org)并加入 PATH;程序也会自动扫描 C:\\Program Files\\R\\R-*",
        ));
    }

    let job = app_state
        .jobs
        .start(TaskKind::RnaseqRun, format!("RNA-seq {}", config.run_name));
    let token = job.token.clone();

    let log_sink: mynx_core::r::LogSink = Arc::new(move |level, message| {
        let line = LogLine { v: WIRE_VERSION, ts_ms: now_ms(), level, message };
        let _ = on_log.send(line);
    });

    // Resolve output base / run name with the legacy fallbacks (auto names
    // come from the engine runner).
    let output_base = if config.output_dir.trim().is_empty() {
        home_output_base()
    } else {
        config.output_dir.clone()
    };

    let script_path = resource_script_path(&app, "rnaseq_engine.R")?;
    let params = serde_json::to_value(&config)
        .map_err(|e| MynxError::internal(e.to_string()))?;
    let run_name = if config.run_name.trim().is_empty() || config.run_name == "auto" {
        String::new()
    } else {
        config.run_name.clone()
    };
    let effective_steps = if steps.is_empty() {
        vec!["all".to_string()]
    } else {
        steps
    };

    let result = mynx_core::r::runner::run_engine(
        rscript,
        &params,
        &output_base,
        &run_name,
        effective_steps,
        &script_path,
        log_sink,
        &token,
    )
    .await;

    match result.status {
        mynx_contracts::rnaseq::RunStatus::Done => job.succeed(),
        mynx_contracts::rnaseq::RunStatus::Cancelled => job.mark_cancelled(),
        _ => job.fail(result_status_error(&result)),
    }
    if let Some(dir) = Some(result.output_dir.clone()) {
        app_state
            .settings
            .touch_output(&dir, TaskKind::RnaseqRun);
    }
    Ok(result)
}

/// Cancel a running analysis.
#[tauri::command]
pub async fn rnaseq_cancel(state: State<'_, SharedState>, task_id: u64) -> Result<bool, MynxError> {
    Ok(state.jobs.cancel(task_id))
}

/// List run directories under the output base (newest first).
#[tauri::command]
pub async fn rnaseq_list_runs(
    output_base: String,
) -> Result<Vec<RunDirEntry>, MynxError> {
    let join = tauri::async_runtime::spawn_blocking(move || {
        mynx_rnaseq::list_run_dirs(&output_base)
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))
}

/// Load prepared/params.json from a run directory (legacy root fallback).
#[tauri::command]
pub async fn rnaseq_load_params(run_dir: String) -> Result<RnaSeqConfig, MynxError> {
    let join = tauri::async_runtime::spawn_blocking(move || {
        mynx_rnaseq::load_run_params(&run_dir)
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))?
}

/// Read DE/DE_summary.csv rows.
#[tauri::command]
pub async fn rnaseq_read_de_summary(
    run_dir: String,
) -> Result<Vec<DeSummaryRow>, MynxError> {
    let join = tauri::async_runtime::spawn_blocking(move || {
        mynx_rnaseq::read_de_summary(&run_dir)
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))?
}

/// List result images/files in a run directory.
#[tauri::command]
pub async fn rnaseq_list_result_files(
    run_dir: String,
) -> Result<Vec<ResultFileItem>, MynxError> {
    let join = tauri::async_runtime::spawn_blocking(move || {
        Ok::<_, MynxError>(mynx_rnaseq::list_result_files(&run_dir))
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))?
}

fn result_status_error(result: &RunResult) -> String {
    match result.status {
        mynx_contracts::rnaseq::RunStatus::Failed => {
            format!("分析失败(退出码 {})", result.exit_code)
        }
        _ => "任务未完成".to_string(),
    }
}

/// `<homeDir>/Mynx/rnaseq_runs` (legacy defaultOutputBase).
fn home_output_base() -> String {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    let mut path = std::path::PathBuf::from(home);
    path.push("Mynx");
    path.push("rnaseq_runs");
    path.to_string_lossy().into_owned()
}

/// Resolve a resource script path via the injected app handle.
fn resource_script_path(
    app: &tauri::AppHandle,
    script: &str,
) -> Result<String, MynxError> {
    use tauri::Manager;
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| MynxError::io(e.to_string()))?;
    Ok(dir
        .join("r")
        .join(script)
        .to_string_lossy()
        .into_owned())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
