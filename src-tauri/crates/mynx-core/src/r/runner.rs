//! R 引擎运行器 — ports the legacy frontend `runR`/`runScript`
//! (`src/lib/rnaseq/runner.ts` lines 300-541).
//!
//! Windows wraps the run in PowerShell (any output directory is writable;
//! when the output path contains non-ASCII characters the whole run is staged
//! in an ASCII temp directory first and copied back afterwards), Unix uses
//! `bash -lc` with `exec`. Parameters travel via params.json in the temp
//! directory; the engine writes results directly into the `output_dir` from
//! the params. Cancellation logs the legacy note and hard-kills the R process
//! tree.

use mynx_contracts::rnaseq::{RunResult, RunStatus};
use mynx_contracts::task::LogLevel;
use mynx_contracts::WIRE_VERSION;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

use super::proc;
use super::{classify_line, LogSink};

static TASK_SEQ: AtomicU64 = AtomicU64::new(0);

/// Logged by the cancel watcher before the tree kill (legacy cancel note).
const CANCEL_NOTE: &str = "收到取消请求,正在终止 R 进程…";

fn separator() -> String {
    "─".repeat(50)
}

/// Legacy taskId shape: `t{millis}_{seq}` (used only for temp file names).
fn next_task_id() -> String {
    let seq = TASK_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("t{millis}_{seq}")
}

/// Directory join with platform separators (legacy joinPath).
fn join_path(parts: &[&str]) -> String {
    let mut path = PathBuf::new();
    for part in parts {
        if !part.is_empty() {
            path.push(part);
        }
    }
    path.to_string_lossy().into_owned()
}

/// Legacy `hasNonAsciiOutput`: any code point above 127.
fn has_non_ascii(value: &str) -> bool {
    value.chars().any(|c| (c as u32) > 127)
}

async fn remove_temp_files(tmp_runner_params: &str, tmp_target_params: &str) {
    let _ = tokio::fs::remove_file(tmp_runner_params).await;
    if tmp_target_params != tmp_runner_params {
        let _ = tokio::fs::remove_file(tmp_target_params).await;
    }
}

// ── Wrapper scripts (runner.ts lines 415-453, byte-for-byte) ─────────────────

/// Windows wrapper. Note: `New-Item` on Windows PowerShell 5.1 has no
/// `-LiteralPath`; the .NET `CreateDirectory` robustly handles any path
/// (brackets/Unicode included).
// Parameter list mirrors the legacy staging contract one-to-one; grouping
// into a struct would obscure the line-by-line correspondence.
#[allow(clippy::too_many_arguments)]
fn build_windows_script(
    staging: bool,
    output_dir: &str,
    prepared_dir: &str,
    stage_base: &str,
    stage_output_dir: &str,
    tmp_runner_params: &str,
    tmp_target_params: &str,
    rscript: &str,
    script_path: &str,
    params_path: &str,
) -> String {
    let q = proc::ps_quote;
    if staging {
        let mut lines: Vec<String> = Vec::with_capacity(19);
        lines.push("$ErrorActionPreference = 'Stop'".to_string());
        lines.push(format!(
            "[System.IO.Directory]::CreateDirectory({}) | Out-Null",
            q(output_dir)
        ));
        lines.push(format!(
            "[System.IO.Directory]::CreateDirectory({}) | Out-Null",
            q(prepared_dir)
        ));
        lines.push(format!(
            "[System.IO.Directory]::CreateDirectory({}) | Out-Null",
            q(stage_base)
        ));
        lines.push("$exitCode = 1".to_string());
        lines.push("try {".to_string());
        lines.push(format!(
            "Copy-Item -LiteralPath {} -Destination {} -Recurse -Force",
            q(output_dir),
            q(stage_base)
        ));
        lines.push(format!(
            "[System.IO.Directory]::CreateDirectory({}) | Out-Null",
            q(stage_output_dir)
        ));
        lines.push(format!(
            "Copy-Item -LiteralPath {} -Destination {} -Force",
            q(tmp_target_params),
            q(params_path)
        ));
        lines.push(format!("& {} {} {}", q(rscript), q(script_path), q(tmp_runner_params)));
        lines.push("$exitCode = $LASTEXITCODE".to_string());
        lines.push("if ($exitCode -eq 0) {".to_string());
        lines.push(format!(
            "Get-ChildItem -LiteralPath {} -Force | Copy-Item -Destination {} -Recurse -Force",
            q(stage_output_dir),
            q(output_dir)
        ));
        lines.push(format!(
            "Copy-Item -LiteralPath {} -Destination {} -Force",
            q(tmp_target_params),
            q(params_path)
        ));
        lines.push("}".to_string());
        lines.push("} finally {".to_string());
        lines.push(format!(
            "Remove-Item -LiteralPath {} -Recurse -Force -ErrorAction SilentlyContinue",
            q(stage_base)
        ));
        lines.push("}".to_string());
        lines.push("exit $exitCode".to_string());
        lines.join("\n")
    } else {
        format!(
            "[System.IO.Directory]::CreateDirectory({0}) | Out-Null; \
             [System.IO.Directory]::CreateDirectory({1}) | Out-Null; \
             Copy-Item -LiteralPath {2} -Destination {3} -Force; \
             & {4} {5} {6}",
            q(output_dir),
            q(prepared_dir),
            q(tmp_runner_params),
            q(params_path),
            q(rscript),
            q(script_path),
            q(tmp_runner_params),
        )
    }
}

/// Unix wrapper (`bash -lc`): prepare directories, copy params, `exec` into
/// Rscript so the pid is the leaf process.
fn build_unix_script(
    output_dir: &str,
    prepared_dir: &str,
    tmp_runner_params: &str,
    params_path: &str,
    rscript: &str,
    script_path: &str,
) -> String {
    let s = proc::sh_quote;
    format!(
        "mkdir -p {0} && mkdir -p {1} && cp {2} {3} && exec {4} {5} {6}",
        s(output_dir),
        s(prepared_dir),
        s(tmp_runner_params),
        s(params_path),
        s(rscript),
        s(script_path),
        s(tmp_runner_params),
    )
}

/// Start one R engine run (DEG analysis or single-plot export).
///
/// `rscript` is pre-resolved by the caller (empty string = not found, which
/// reproduces the legacy exit-127 path). `params` is the FULL engine config;
/// `output_dir`, `run_name` and `steps` are injected here exactly like the
/// legacy runner did. Returns a [`RunResult`] with `task_id: 0` — the caller
/// stamps the job id.
#[allow(clippy::too_many_arguments)]
pub async fn run_engine(
    rscript: String,
    params: &serde_json::Value,
    output_base: &str,
    run_name: &str,
    steps: Vec<String>,
    script_path: &str,
    log: LogSink,
    token: &CancellationToken,
) -> RunResult {
    let task_id = next_task_id();
    // The engine writes everything into params.output_dir itself, so R sees
    // <output base>/<run_name> and no run-name joining happens on the R side.
    let output_dir = join_path(&[output_base, run_name]);
    let tmp_dir = std::env::temp_dir().to_string_lossy().into_owned();

    let mut result = RunResult {
        v: WIRE_VERSION,
        task_id: 0,
        status: RunStatus::Failed,
        exit_code: 1,
        output_dir: output_dir.clone(),
        run_name: run_name.to_string(),
    };

    if rscript.is_empty() {
        log(
            LogLevel::Error,
            "未找到 Rscript。请安装 R(https://cloud.r-project.org)并加入 PATH;程序也会自动扫描 C:\\Program Files\\R\\R-*"
                .to_string(),
        );
        result.exit_code = 127;
        return result;
    }

    // Some Windows R runtimes cannot read work directories containing
    // non-ASCII characters; stage the whole computation in an ASCII temp
    // directory and copy back through PowerShell on success.
    let staging = cfg!(windows) && has_non_ascii(&output_dir);
    let stage_base = if staging {
        join_path(&[&tmp_dir, &format!("mynx_rnaseq_stage_{task_id}")])
    } else {
        String::new()
    };
    let stage_output_dir = if staging {
        join_path(&[&stage_base, run_name])
    } else {
        String::new()
    };

    // Engine params: output_dir → <base>/<run_name> (the batch covariate is
    // part of the config contract and reaches the engine untouched).
    let mut target_params = params.clone();
    if let serde_json::Value::Object(map) = &mut target_params {
        map.insert(
            "output_dir".to_string(),
            serde_json::Value::String(output_dir.clone()),
        );
        map.insert(
            "run_name".to_string(),
            serde_json::Value::String(run_name.to_string()),
        );
        map.insert(
            "steps".to_string(),
            serde_json::Value::Array(
                steps.iter().cloned().map(serde_json::Value::String).collect(),
            ),
        );
    }
    let mut runner_params = target_params.clone();
    if staging {
        if let serde_json::Value::Object(map) = &mut runner_params {
            map.insert(
                "output_dir".to_string(),
                serde_json::Value::String(stage_output_dir.clone()),
            );
        }
    }

    // params.json is written to the temp directory first, then the wrapper
    // shell copies it to the target (bypassing any scope restrictions);
    // Rscript always reads the temp file.
    let tmp_runner_params =
        join_path(&[&tmp_dir, &format!("mynx_rnaseq_runner_{task_id}.json")]);
    let tmp_target_params = if staging {
        join_path(&[&tmp_dir, &format!("mynx_rnaseq_target_{task_id}.json")])
    } else {
        tmp_runner_params.clone()
    };
    let runner_json = serde_json::to_string_pretty(&runner_params)
        .unwrap_or_else(|_| "{}".to_string());
    let target_json = serde_json::to_string_pretty(&target_params)
        .unwrap_or_else(|_| "{}".to_string());
    if let Err(err) = tokio::fs::write(&tmp_runner_params, runner_json.as_bytes()).await {
        log(LogLevel::Error, format!("启动失败: {err}"));
        return result;
    }
    if staging {
        if let Err(err) = tokio::fs::write(&tmp_target_params, target_json.as_bytes()).await {
            log(LogLevel::Error, format!("启动失败: {err}"));
            return result;
        }
    }

    let prepared_dir = join_path(&[&output_dir, "prepared"]);
    let params_path = join_path(&[&prepared_dir, "params.json"]);

    let script = if cfg!(windows) {
        build_windows_script(
            staging,
            &output_dir,
            &prepared_dir,
            &stage_base,
            &stage_output_dir,
            &tmp_runner_params,
            &tmp_target_params,
            &rscript,
            script_path,
            &params_path,
        )
    } else {
        build_unix_script(
            &output_dir,
            &prepared_dir,
            &tmp_runner_params,
            &params_path,
            &rscript,
            script_path,
        )
    };

    log(LogLevel::Info, format!("Rscript: {rscript}"));
    log(LogLevel::Info, format!("输出目录: {output_dir}"));
    log(LogLevel::Info, format!("步骤: {}", steps.join(", ")));
    if staging {
        log(
            LogLevel::Info,
            "输出路径含中文字符：将在临时工作目录运行 R，完成后自动复制回此处".to_string(),
        );
    }
    log(LogLevel::Info, separator());

    let sink: proc::LineSink = {
        let line_log = log.clone();
        Arc::new(move |line: &str| line_log(classify_line(line), line.to_string()))
    };

    let exit = proc::run_streamed_shell(&script, token, &sink, Some(CANCEL_NOTE)).await;

    if let Some(err) = &exit.spawn_error {
        log(LogLevel::Error, format!("启动失败: {err}"));
        remove_temp_files(&tmp_runner_params, &tmp_target_params).await;
        return result;
    }

    let code = exit.code;
    result.exit_code = code;
    log(LogLevel::Info, separator());
    if code == 0 {
        result.status = RunStatus::Done;
        log(
            LogLevel::Success,
            format!("[DONE] 分析完成(退出码 {code})。输出: {output_dir}"),
        );
    } else if exit.cancelled {
        result.status = RunStatus::Cancelled;
        log(
            LogLevel::Warning,
            format!("已取消(退出码 {code});已生成的文件保留在输出目录"),
        );
    } else {
        result.status = RunStatus::Failed;
        log(LogLevel::Error, format!("分析失败(退出码 {code})"));
    }

    remove_temp_files(&tmp_runner_params, &tmp_target_params).await;
    result
}

/// Simplified streaming variant for chart / qPCR-plot R scripts. No staging
/// here — those callers own their own staging logic.
pub async fn run_script(
    rscript: &str,
    script_path: &str,
    params_path: &str,
    log: LogSink,
    token: &CancellationToken,
) -> proc::StreamExit {
    let sink: proc::LineSink = {
        let line_log = log.clone();
        Arc::new(move |line: &str| line_log(classify_line(line), line.to_string()))
    };
    let script = if cfg!(windows) {
        format!(
            "& {} {} {}",
            proc::ps_quote(rscript),
            proc::ps_quote(script_path),
            proc::ps_quote(params_path),
        )
    } else {
        format!(
            "{} {} {}",
            proc::sh_quote(rscript),
            proc::sh_quote(script_path),
            proc::sh_quote(params_path),
        )
    };
    proc::run_streamed_shell(&script, token, &sink, Some(CANCEL_NOTE)).await
}

/// qPCR plot runner orchestration (port of qpcr-plot-runner.ts): copy the
/// workbook to an ASCII temp path, write the config JSON beside it, run
/// qpcr_plot_runner.R, clean up temp files and classify the result.
pub async fn run_qpcr_plot(
    rscript: &str,
    script_path: &str,
    config: &mynx_contracts::qpcr::QpcrPlotRunConfig,
    log: LogSink,
    token: &CancellationToken,
) -> mynx_contracts::qpcr::QpcrPlotRunResult {
    
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp = std::env::temp_dir();
    let params_path = tmp.join(format!("mynx_qpcr_plot_{timestamp}.json"));
    let input_copy = tmp.join(format!("mynx_qpcr_input_{timestamp}.xlsx"));

    let result =
        run_qpcr_plot_inner(rscript, script_path, config, &params_path, &input_copy, log, token)
            .await;

    let _ = tokio::fs::remove_file(&params_path).await;
    let _ = tokio::fs::remove_file(&input_copy).await;
    result
}

async fn run_qpcr_plot_inner(
    rscript: &str,
    script_path: &str,
    config: &mynx_contracts::qpcr::QpcrPlotRunConfig,
    params_path: &std::path::Path,
    input_copy: &std::path::Path,
    log: LogSink,
    token: &CancellationToken,
) -> mynx_contracts::qpcr::QpcrPlotRunResult {
    use mynx_contracts::qpcr::QpcrPlotRunResult;
    let failed = |error: String| QpcrPlotRunResult {
        v: WIRE_VERSION,
        ok: false,
        output_dir: None,
        files: vec![],
        statistics_file: None,
        error: Some(error),
        cancelled: false,
    };

    // Always copy the workbook to the ASCII temp path (legacy behavior:
    // readFile + writeFile unconditionally, config.filePath repointed).
    if let Err(error) = tokio::fs::copy(&config.file_path, input_copy).await {
        return failed(format!("读取输入文件失败: {error}"));
    }

    // Config JSON with filePath repointed to the ASCII copy.
    let mut config_value = match serde_json::to_value(config) {
        Ok(value) => value,
        Err(error) => return failed(format!("序列化配置失败: {error}")),
    };
    if let Some(obj) = config_value.as_object_mut() {
        obj.insert(
            "filePath".to_string(),
            serde_json::Value::String(input_copy.to_string_lossy().into_owned()),
        );
    }
    if let Err(error) = std::fs::File::create(params_path)
        .and_then(|mut file| {
            
            serde_json::to_writer_pretty(&mut file, &config_value)
                .map_err(std::io::Error::other)
        })
    {
        return failed(format!("写入临时配置失败: {error}"));
    }

    let exit = run_script(
        rscript,
        script_path,
        &params_path.to_string_lossy(),
        log,
        token,
    )
    .await;
    if token.is_cancelled() {
        return QpcrPlotRunResult {
            v: WIRE_VERSION,
            ok: false,
            output_dir: None,
            files: vec![],
            statistics_file: None,
            error: Some("QPCR_PLOT_CANCELLED".to_string()),
            cancelled: true,
        };
    }
    if exit.code != 0 {
        let stderr = exit.stderr.trim();
        let failure_note = if stderr.is_empty() {
            "R 未能生成 qPCR 图表".to_string()
        } else {
            stderr.to_string()
        };
        return failed(failure_note);
    }

    let statistics_file = if config.kind == "bar" {
        let sig = if config.sig_file.trim().is_empty() {
            "statistical_analysis_summary.csv"
        } else {
            config.sig_file.trim()
        };
        Some(join_path(&[&config.output_dir, sig]))
    } else {
        None
    };
    QpcrPlotRunResult {
        v: WIRE_VERSION,
        ok: true,
        output_dir: Some(config.output_dir.clone()),
        files: vec![],
        statistics_file,
        error: None,
        cancelled: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_ascii_detection_matches_legacy() {
        assert!(has_non_ascii("D:/数据/结果"));
        assert!(has_non_ascii("out\u{00e9}"));
        assert!(!has_non_ascii("D:/data/out"));
        assert!(!has_non_ascii(""));
    }

    #[test]
    fn windows_staging_script_mirrors_legacy() {
        let script = build_windows_script(
            true,
            "C:/out/run",
            "C:/out/run/prepared",
            "C:/t/stage",
            "C:/t/stage/run",
            "C:/t/runner.json",
            "C:/t/target.json",
            "R",
            "engine.R",
            "C:/out/run/prepared/params.json",
        );
        assert!(script.starts_with("$ErrorActionPreference = 'Stop'\n"));
        assert!(script.contains("[System.IO.Directory]::CreateDirectory('C:/out/run') | Out-Null"));
        assert!(script
            .contains("[System.IO.Directory]::CreateDirectory('C:/out/run/prepared') | Out-Null"));
        assert!(script.contains("[System.IO.Directory]::CreateDirectory('C:/t/stage') | Out-Null"));
        assert!(script.contains("$exitCode = 1\ntry {"));
        assert!(script.contains(
            "Copy-Item -LiteralPath 'C:/out/run' -Destination 'C:/t/stage' -Recurse -Force"
        ));
        assert!(script
            .contains("[System.IO.Directory]::CreateDirectory('C:/t/stage/run') | Out-Null"));
        assert!(script.contains(
            "Copy-Item -LiteralPath 'C:/t/target.json' -Destination 'C:/out/run/prepared/params.json' -Force"
        ));
        assert!(script.contains("& 'R' 'engine.R' 'C:/t/runner.json'"));
        assert!(script.contains("$exitCode = $LASTEXITCODE"));
        assert!(script.contains(
            "Get-ChildItem -LiteralPath 'C:/t/stage/run' -Force | Copy-Item -Destination 'C:/out/run' -Recurse -Force"
        ));
        assert!(script.contains("} finally {"));
        assert!(script.contains(
            "Remove-Item -LiteralPath 'C:/t/stage' -Recurse -Force -ErrorAction SilentlyContinue"
        ));
        assert!(script.ends_with("exit $exitCode"));
    }

    #[test]
    fn windows_non_staging_script_mirrors_legacy() {
        let script = build_windows_script(
            false,
            "C:/out/run",
            "C:/out/run/prepared",
            "",
            "",
            "C:/t/runner.json",
            "C:/t/runner.json",
            "R",
            "engine.R",
            "C:/out/run/prepared/params.json",
        );
        assert_eq!(
            script,
            "[System.IO.Directory]::CreateDirectory('C:/out/run') | Out-Null; \
             [System.IO.Directory]::CreateDirectory('C:/out/run/prepared') | Out-Null; \
             Copy-Item -LiteralPath 'C:/t/runner.json' -Destination 'C:/out/run/prepared/params.json' -Force; \
             & 'R' 'engine.R' 'C:/t/runner.json'"
        );
    }

    #[test]
    fn unix_script_mirrors_legacy() {
        let script = build_unix_script(
            "/home/u/out/run",
            "/home/u/out/run/prepared",
            "/tmp/runner.json",
            "/home/u/out/run/prepared/params.json",
            "/usr/local/bin/Rscript",
            "/res/r/rnaseq_engine.R",
        );
        assert_eq!(
            script,
            "mkdir -p '/home/u/out/run' && \
             mkdir -p '/home/u/out/run/prepared' && \
             cp '/tmp/runner.json' '/home/u/out/run/prepared/params.json' && \
             exec '/usr/local/bin/Rscript' '/res/r/rnaseq_engine.R' '/tmp/runner.json'"
        );
    }

    #[test]
    fn join_path_uses_platform_separator() {
        let joined = join_path(&["C:\\base", "run", "prepared", "params.json"]);
        assert!(joined.starts_with("C:\\base"));
        assert!(joined.contains("run"));
        assert!(joined.ends_with("params.json"));
        assert!(!joined.contains("params.json\\"), "parts split correctly");
    }

    #[test]
    fn task_id_has_legacy_shape() {
        let id = next_task_id();
        assert!(id.starts_with('t'));
        let rest = &id[1..];
        let mut parts = rest.split('_');
        assert!(parts.next().unwrap().chars().all(|c| c.is_ascii_digit()));
        assert!(parts.next().unwrap().chars().all(|c| c.is_ascii_digit()));
    }
}
