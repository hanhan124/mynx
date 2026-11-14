//! qPCR commands: transform/calculate (pure Rust math) plus the R plot
//! runner orchestration (port of qpcr-plot-runner.ts).

use mynx_contracts::qpcr::{
    CalcRequest, CalcResult, ChartInjectionRequest, QpcrPlotRunConfig, QpcrPlotRunResult,
    TransformRequest, TransformResult,
};
use mynx_contracts::task::{LogLine, MynxError, TaskKind};
use mynx_contracts::WIRE_VERSION;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::{Manager, State};

use crate::state::SharedState;

/// Transform the source sheet into the Transformed Data patch (Rust math).
#[tauri::command]
pub async fn qpcr_transform(
    request: TransformRequest,
) -> Result<TransformResult, MynxError> {
    let join = tauri::async_runtime::spawn_blocking(move || mynx_qpcr::transform(request));
    join.await
        .map_err(|e| MynxError::internal(e.to_string()))?
}

/// Run the qPCR relative-quantification calculation (Rust math).
#[tauri::command]
pub async fn qpcr_calculate(request: CalcRequest) -> Result<CalcResult, MynxError> {
    let join = tauri::async_runtime::spawn_blocking(move || mynx_qpcr::calculate(request));
    join.await
        .map_err(|e| MynxError::internal(e.to_string()))?
}

/// Inject native Excel chart XML into a saved workbook (Rust zip port).
#[tauri::command]
pub async fn qpcr_inject_charts(request: ChartInjectionRequest) -> Result<bool, MynxError> {
    let join =
        tauri::async_runtime::spawn_blocking(move || mynx_qpcr::inject_charts(&request));
    join.await
        .map_err(|e| MynxError::internal(e.to_string()))?
}

/// Run qpcr_plot_runner.R. Streams log lines through the channel; returns
/// the final result (frontend keeps the invoke promise). Cancel via
/// tasks_cancel with the returned job id.
#[tauri::command]
pub async fn qpcr_plot_run(
    app: tauri::AppHandle,
    state: State<'_, SharedState>,
    config: QpcrPlotRunConfig,
    on_log: Channel<LogLine>,
) -> Result<QpcrPlotRunResult, MynxError> {
    if config.file_path.trim().is_empty() {
        return Err(MynxError::validation("请先选择 qPCR 数据文件。"));
    }
    if config.output_dir.trim().is_empty() {
        return Err(MynxError::validation("请先选择输出文件夹。"));
    }
    let app_state = state.inner().clone();
    let rscript = app_state.r.find_rscript();
    if rscript.is_empty() {
        return Err(MynxError::validation(
            "尚未安装 R，请先安装 R 后再运行 qPCR 绘图。",
        ));
    }

    let job = app_state.jobs.start(TaskKind::QpcrPlot, "qPCR 绘图");
    let token = job.token.clone();

    let log_sink: mynx_core::r::LogSink = Arc::new(move |level, message| {
        let line = LogLine { v: WIRE_VERSION, ts_ms: now_ms(), level, message };
        let _ = on_log.send(line);
    });
    let _ = &app;

    // Resolve the runner script from the resource directory.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| MynxError::io(e.to_string()))?;
    let script_path = resource_dir.join("r").join("qpcr_plot_runner.R");
    let script_path = script_path.to_string_lossy().into_owned();

    let result = mynx_core::r::runner::run_qpcr_plot(&rscript, &script_path, &config, log_sink, &token)
        .await;

    match &result {
        r if r.ok => job.succeed(),
        r if r.cancelled => job.mark_cancelled(),
        r => job.fail(r.error.clone().unwrap_or_default()),
    }
    Ok(result)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
