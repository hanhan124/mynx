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

    // Every run gets its own folder: `auto` becomes a timestamped name, and an
    // explicit name must be one plain folder name inside the output base.
    let run_name = resolve_run_name(&config.run_name)?;

    let job = app_state
        .jobs
        .start(TaskKind::RnaseqRun, format!("RNA-seq {run_name}"));
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
        app_state.settings.touch_project(&dir, "rnaseqRun");
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

/// `auto` / empty → `run_YYYYMMDD_HHMMSS` (UTC; the frontend normally sends a
/// local-time name already). Explicit names are validated as a single folder
/// name so a run can never write outside the chosen output base.
fn resolve_run_name(raw: &str) -> Result<String, MynxError> {
    let name = raw.trim();
    if name.is_empty() || name.eq_ignore_ascii_case("auto") {
        return Ok(auto_run_name(now_ms()));
    }
    let forbidden = |c: char| {
        matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()
    };
    if name.contains("..") || name.ends_with('.') || name.chars().any(forbidden) || name.chars().count() > 120 {
        return Err(MynxError::validation(format!(
            "运行名称“{name}”不可用：不能包含 / \\ : * ? \" < > | 或 ..，不能以点结尾，最长 120 个字符"
        )));
    }
    Ok(name.to_string())
}

fn auto_run_name(ms: i64) -> String {
    let secs = ms.div_euclid(1000);
    let (year, month, day) = civil_from_days(secs.div_euclid(86_400));
    let rem = secs.rem_euclid(86_400);
    format!(
        "run_{year:04}{month:02}{day:02}_{:02}{:02}{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// Days since 1970-01-01 → (year, month, day) (H. Hinnant's civil algorithm).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod run_name_tests {
    use super::*;

    #[test]
    fn auto_names_are_timestamped_folders() {
        // 2026-11-23 01:53:07 UTC
        assert_eq!(auto_run_name(1_795_398_787_000), "run_20261123_015307");
        assert!(resolve_run_name("auto").unwrap().starts_with("run_"));
        assert!(resolve_run_name("  ").unwrap().starts_with("run_"));
    }

    #[test]
    fn explicit_names_stay_inside_the_output_base() {
        assert_eq!(resolve_run_name(" 实验 A ").unwrap(), "实验 A");
        for bad in ["..", "..\\outside", "a/b", "C:x", "name.", "a|b"] {
            assert!(resolve_run_name(bad).is_err(), "{bad} should be rejected");
        }
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
