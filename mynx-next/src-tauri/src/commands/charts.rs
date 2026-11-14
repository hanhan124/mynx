//! Scientific chart studio commands: data import for field mapping, template
//! manifests and installed-template listing, ZIP figure packages and template
//! package installs, plus the chart_runner.R orchestration (port of the
//! legacy `src/lib/charts/runner.ts` runChart flow).

use mynx_contracts::charts::{
    ChartImportedData, ChartRunEvent, ChartRunResult, ChartTemplateManifest, ChartZipRequest,
};
use mynx_contracts::task::{MynxError, TaskKind};
use mynx_contracts::WIRE_VERSION;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{Manager, State};

use crate::state::SharedState;

/// Preview depth applied when the request omits `preview_rows`.
const DEFAULT_PREVIEW_ROWS: u32 = 50;

/// Import a dataset for chart field mapping (first row = header, numeric
/// cells as JSON numbers). Heavy parsing runs on the blocking pool.
#[tauri::command]
pub async fn charts_import_data(
    path: String,
    preview_rows: Option<u32>,
) -> Result<ChartImportedData, MynxError> {
    let join = tauri::async_runtime::spawn_blocking(move || {
        mynx_charts::import_data(&path, preview_rows.unwrap_or(DEFAULT_PREVIEW_ROWS))
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))?
}

/// Read one template's manifest from the app resources.
#[tauri::command]
pub async fn charts_read_manifest(
    app: tauri::AppHandle,
    template_id: String,
) -> Result<ChartTemplateManifest, MynxError> {
    let resource_dir = resource_dir(&app)?;
    let join = tauri::async_runtime::spawn_blocking(move || {
        mynx_charts::read_manifest(&template_id, &resource_dir)
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))?
}

/// Installed template ids under `<resource_dir>/r/chart-templates`.
#[tauri::command]
pub async fn charts_list_templates(app: tauri::AppHandle) -> Result<Vec<String>, MynxError> {
    let resource_dir = resource_dir(&app)?;
    let join = tauri::async_runtime::spawn_blocking(move || {
        mynx_charts::list_templates(&resource_dir)
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))
}

/// Build the figure package ZIP (output figure + template resources + README
/// + sidecar JSON).
#[tauri::command]
pub async fn charts_export_zip(
    request: ChartZipRequest,
    app: tauri::AppHandle,
) -> Result<bool, MynxError> {
    let resource_dir = resource_dir(&app)?;
    let join = tauri::async_runtime::spawn_blocking(move || {
        mynx_charts::export_zip(request, &resource_dir)
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))?
}

/// Install a template package ZIP into
/// `<app_data_dir>/chart-templates/<manifest.id>/` (zip-slip hardened).
#[tauri::command]
pub async fn charts_install_template_package(
    app: tauri::AppHandle,
    zip_path: String,
) -> Result<ChartTemplateManifest, MynxError> {
    let install_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| MynxError::io(e.to_string()))?
        .join("chart-templates");
    std::fs::create_dir_all(&install_dir)
        .map_err(|e| MynxError::io(format!("无法创建模板安装目录: {e}")))?;
    let join = tauri::async_runtime::spawn_blocking(move || {
        mynx_charts::install_template_package(&zip_path, &install_dir)
    });
    join.await.map_err(|e| MynxError::internal(e.to_string()))?
}

/// Run chart_runner.R. Every stdout/stderr line is forwarded through the
/// channel as a ChartRunEvent (`chart_runtime.R` prints one JSON object per
/// line; non-JSON lines become `{stage: "log"}` events with the shared log
/// classification). The invoke promise resolves with the terminal result.
/// Cancel via charts_cancel / tasks_cancel with the returned task id.
///
/// The config arrives as raw JSON and is converted by
/// [`mynx_charts::chart_run_config_from_value`]: a typed `ChartRunConfig`
/// parameter would overflow the stack, because the contract's container-level
/// `#[serde(default)]` invokes its own `Default` impl on every
/// deserialization and that impl parses a partial JSON (infinite recursion —
/// verified against serde_derive 1.0.229 codegen).
#[tauri::command]
pub async fn charts_run(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    config: serde_json::Value,
    on_event: Channel<ChartRunEvent>,
) -> Result<ChartRunResult, MynxError> {
    let config = mynx_charts::chart_run_config_from_value(&config)?;

    // Legacy runner.ts validation order and messages.
    if config.template.trim().is_empty() {
        return Err(MynxError::validation("请选择图表模板。"));
    }
    if config.file_path.trim().is_empty() {
        return Err(MynxError::validation("请先选择数据文件。"));
    }
    if config.output_dir.trim().is_empty() {
        return Err(MynxError::validation("请先选择输出文件夹。"));
    }
    let app_state = state.inner().clone();
    let rscript = app_state.r.find_rscript();
    if rscript.is_empty() {
        return Err(MynxError::validation("尚未安装 R。请先安装 R 后再生成图表。"));
    }

    let job = app_state
        .jobs
        .start(TaskKind::ChartRun, format!("科研绘图 {}", config.template));
    job.output_dir(config.output_dir.clone());
    let token = job.token.clone();

    let log_sink: mynx_core::r::LogSink = Arc::new(move |level, message| {
        let event = mynx_charts::chart_event_from_line(&message, now_ms(), level);
        let _ = on_event.send(event);
    });

    let resource_dir = resource_dir(&app)?;
    let script_path = resource_dir
        .join("r")
        .join("chart_runner.R")
        .to_string_lossy()
        .into_owned();

    // Params travel via a temp file (legacy mynx_chart_<ts>.json); verified
    // template runs get outputPath + templateDir injected like the legacy
    // payload so the R side renders into the expected file.
    let params_path = std::env::temp_dir().join(format!("mynx_chart_{}.json", now_ms()));
    let mut params = serde_json::to_value(&config)
        .map_err(|e| MynxError::internal(e.to_string()))?;
    if config.verified == Some(true) {
        if let Some(object) = params.as_object_mut() {
            object.insert(
                "outputPath".to_string(),
                serde_json::Value::String(mynx_charts::output_file_path(
                    &config.output_dir,
                    &config.template,
                    &config.format,
                )),
            );
            object.insert(
                "templateDir".to_string(),
                serde_json::Value::String(
                    resource_dir
                        .join("r")
                        .join("chart-templates")
                        .join(&config.template)
                        .to_string_lossy()
                        .into_owned(),
                ),
            );
        }
    }
    let params_json = serde_json::to_string(&params)
        .map_err(|e| MynxError::internal(e.to_string()))?;
    std::fs::write(&params_path, params_json.as_bytes())
        .map_err(|e| MynxError::io(format!("写入临时配置失败: {e}")))?;

    let exit = mynx_core::r::runner::run_script(
        &rscript,
        &script_path,
        &params_path.to_string_lossy(),
        log_sink,
        &token,
    )
    .await;
    let _ = std::fs::remove_file(&params_path);

    let result = if exit.spawn_error.is_some() {
        // Legacy: logs.take() || spawn error message || "R 进程启动失败"
        let error = non_empty(&exit.stderr).unwrap_or_else(|| {
            exit.spawn_error
                .clone()
                .unwrap_or_else(|| "R 进程启动失败".to_string())
        });
        job.fail(error.clone());
        ChartRunResult {
            v: WIRE_VERSION,
            ok: false,
            output_path: None,
            output_dir: None,
            files: Vec::new(),
            error: Some(error),
            cancelled: false,
        }
    } else if token.is_cancelled() {
        // Legacy sentinel: CHART_RUN_CANCELLED
        job.mark_cancelled();
        ChartRunResult {
            v: WIRE_VERSION,
            ok: false,
            output_path: None,
            output_dir: None,
            files: Vec::new(),
            error: Some("CHART_RUN_CANCELLED".to_string()),
            cancelled: true,
        }
    } else if exit.code != 0 {
        // Legacy: logs.trim() || "R 未能生成图表" (captured stderr here)
        let error = non_empty(&exit.stderr).unwrap_or_else(|| "R 未能生成图表".to_string());
        job.fail(error.clone());
        ChartRunResult {
            v: WIRE_VERSION,
            ok: false,
            output_path: None,
            output_dir: None,
            files: Vec::new(),
            error: Some(error),
            cancelled: false,
        }
    } else {
        let output_path =
            mynx_charts::output_file_path(&config.output_dir, &config.template, &config.format);
        let files = mynx_charts::list_output_files(&config.output_dir, &config.template);
        // Sidecar JSON next to the figure; failures are ignored
        // (legacy `.catch(() => {})`).
        let _ = mynx_charts::write_sidecar(
            &config,
            &config.output_dir,
            &config.template,
            &config.format,
            now_ms(),
        );
        job.succeed();
        app_state
            .settings
            .touch_output(&config.output_dir, TaskKind::ChartRun);
        app_state
            .settings
            .touch_project(&config.output_dir, "chartRun");
        ChartRunResult {
            v: WIRE_VERSION,
            ok: true,
            output_path: Some(output_path),
            output_dir: Some(config.output_dir.clone()),
            files,
            error: None,
            cancelled: false,
        }
    };
    Ok(result)
}

/// Cancel a chart run (job registry cancel: cooperative token + tree kill).
#[tauri::command]
pub async fn charts_cancel(state: State<'_, SharedState>, task_id: u64) -> Result<bool, MynxError> {
    Ok(state.jobs.cancel(task_id))
}

fn resource_dir(app: &tauri::AppHandle) -> Result<PathBuf, MynxError> {
    app.path().resource_dir().map_err(|e| MynxError::io(e.to_string()))
}

/// `stderr.trim()` when non-empty (legacy JS truthiness fallback chain).
fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
