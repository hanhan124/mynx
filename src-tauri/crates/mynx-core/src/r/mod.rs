//! External R runtime management: Rscript discovery, dependency status,
//! runtime/package installs and log classification. A 1:1 port of the legacy
//! frontend runner (`src/lib/rnaseq/runner.ts`) plus the quoting helpers from
//! `src/lib/rnaseq/io.ts`.

pub mod proc;
pub mod runner;

use mynx_contracts::r::{RDependencyStatus, RInstallResult, RScriptStatus};
use mynx_contracts::task::LogLevel;
use mynx_contracts::WIRE_VERSION;
use std::sync::{Arc, Mutex};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

/// Log sink shared by the R runtime and the engine runner.
pub type LogSink = std::sync::Arc<dyn Fn(LogLevel, String) + Send + Sync>;

// ── R expressions (byte-for-byte the legacy runner.ts strings) ───────────────

const DEP_CHECK_EXPR: &str = "pkgs <- commandArgs(trailingOnly = TRUE); missing <- pkgs[!vapply(pkgs, requireNamespace, quietly = TRUE, FUN.VALUE = logical(1))]; writeLines(missing)";

const CRAN_INSTALL_EXPR: &str = "args <- commandArgs(trailingOnly = TRUE); repo <- args[1]; pkgs <- args[-1]; options(repos = c(CRAN = repo)); if (length(pkgs)) install.packages(pkgs, dependencies = TRUE)";

const BIOCONDUCTOR_INSTALL_EXPR: &str = "args <- commandArgs(trailingOnly = TRUE); manager <- args[1]; installer <- args[2]; pkgs <- args[-c(1, 2)]; if (!requireNamespace(manager, quietly = TRUE)) install.packages(manager); if (length(pkgs)) getExportedValue(manager, installer)(pkgs, ask = FALSE, update = FALSE)";

/// Packages the Bioconductor installer handles (legacy installRDependencies).
const BIOC_PACKAGES: [&str; 3] = ["edgeR", "DESeq2", "ComplexHeatmap"];

// ── Log classification ───────────────────────────────────────────────────────

/// Legacy `classifyLine`: `/^Error|\bError in\b|Execution halted|\[ERROR\]/`
/// → error; `/^Warning|\[WARN\]/` → warning; `[OK]`/`[DONE]` → success;
/// everything else is info.
pub fn classify_line(line: &str) -> LogLevel {
    if line.starts_with("Error")
        || contains_word_error_in(line)
        || line.contains("Execution halted")
        || line.contains("[ERROR]")
    {
        return LogLevel::Error;
    }
    if line.starts_with("Warning") || line.contains("[WARN]") {
        return LogLevel::Warning;
    }
    // [OK] = 步骤级成功;[DONE] = 流程级完成
    if line.contains("[OK]") || line.contains("[DONE]") {
        return LogLevel::Success;
    }
    LogLevel::Info
}

/// JS `\bError in\b`: "Error in" bounded by non-word characters on both sides
/// (so "MyError in" does not match, "…::Error in" does).
fn contains_word_error_in(line: &str) -> bool {
    const NEEDLE: &[u8] = b"Error in";
    let bytes = line.as_bytes();
    let mut from = 0usize;
    while from + NEEDLE.len() <= bytes.len() {
        let Some(rel) = find_subslice(&bytes[from..], NEEDLE) else {
            break;
        };
        let abs = from + rel;
        let before_ok = abs == 0 || !is_word_byte(bytes[abs - 1]);
        let after = abs + NEEDLE.len();
        let after_ok = after >= bytes.len() || !is_word_byte(bytes[after]);
        if before_ok && after_ok {
            return true;
        }
        from = abs + 1;
    }
    false
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if haystack.len() < needle.len() {
        return None;
    }
    (0..=haystack.len() - needle.len())
        .find(|&i| &haystack[i..i + needle.len()] == needle)
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

// ── Rscript discovery ────────────────────────────────────────────────────────

/// Cached Rscript locator (legacy findRscript / resetRscriptCache).
pub struct RRuntime {
    cache: Mutex<Option<String>>,
}

impl Default for RRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl RRuntime {
    pub fn new() -> Self {
        Self { cache: Mutex::new(None) }
    }

    /// Forget the cached Rscript path (after a runtime install).
    pub fn reset_cache(&self) {
        *self.cache.lock().unwrap() = None;
    }

    /// Locate Rscript (cached; an empty string means "not found").
    ///
    /// Windows: scan PATH directories for `Rscript.exe`, then
    /// `C:\Program Files\R\R-*` newest-first preferring `bin\x64\Rscript.exe`
    /// and falling back to `bin\Rscript.exe`.
    /// Unix: known absolute paths first, then PATH.
    pub fn find_rscript(&self) -> String {
        if let Some(found) = self.cache.lock().unwrap().clone() {
            return found;
        }
        let found = locate_rscript();
        if !found.is_empty() {
            *self.cache.lock().unwrap() = Some(found.clone());
        }
        found
    }

    /// Status payload for the UI (`rscript` path + `found` flag).
    pub fn status(&self) -> RScriptStatus {
        let rscript = self.find_rscript();
        RScriptStatus { v: WIRE_VERSION, found: !rscript.is_empty(), rscript }
    }

    /// Check which of `packages` are missing without loading them
    /// (legacy checkRDependencies). Runs `--vanilla -e` through the platform
    /// wrapper; stdout lines are the missing package names.
    pub async fn check_dependencies(&self, packages: &[String]) -> RDependencyStatus {
        let rscript = self.find_rscript();
        if rscript.is_empty() {
            return RDependencyStatus {
                v: WIRE_VERSION,
                rscript_found: false,
                missing: Vec::new(),
                error: None,
            };
        }
        let script = r_expression_script(&rscript, DEP_CHECK_EXPR, packages);
        let exit = proc::run_captured_shell(&script).await;
        if let Some(err) = &exit.spawn_error {
            return RDependencyStatus {
                v: WIRE_VERSION,
                rscript_found: true,
                missing: Vec::new(),
                error: Some(err.clone()),
            };
        }
        if exit.code != 0 {
            return RDependencyStatus {
                v: WIRE_VERSION,
                rscript_found: true,
                missing: Vec::new(),
                error: Some(capture_error(&exit, "R 依赖检测失败")),
            };
        }
        RDependencyStatus {
            v: WIRE_VERSION,
            rscript_found: true,
            missing: exit
                .stdout
                .lines()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect(),
            error: None,
        }
    }

    /// Install the R runtime via the system package manager; only called
    /// after user confirmation (legacy installRRuntime).
    /// Windows: winget / macOS: brew / Linux: apt-get.
    pub async fn install_runtime(log: LogSink) -> RInstallResult {
        let sink = logging_sink(&log);
        let token = CancellationToken::new();
        let exit = if cfg!(windows) {
            let mut cmd = Command::new("winget");
            cmd.args([
                "install",
                "--id",
                "RProject.R",
                "--exact",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ]);
            proc::run_streamed_cmd(cmd, &token, &sink, None).await
        } else if cfg!(target_os = "macos") {
            let mut cmd = Command::new("brew");
            cmd.args(["install", "--cask", "r"]);
            proc::run_streamed_cmd(cmd, &token, &sink, None).await
        } else {
            let mut cmd = Command::new("apt-get");
            cmd.args(["install", "-y", "r-base"]);
            proc::run_streamed_cmd(cmd, &token, &sink, None).await
        };
        let cancelled = exit.cancelled;
        let ok = exit.spawn_error.is_none() && exit.code == 0 && !cancelled;
        let error = if ok || cancelled {
            None
        } else {
            Some(capture_error(&exit, "R 安装未完成"))
        };
        RInstallResult { v: WIRE_VERSION, ok, error, cancelled }
    }

    /// Install CRAN and Bioconductor dependencies (legacy installRDependencies).
    /// CRAN packages go through cloud.r-project.org; Bioconductor packages
    /// through BiocManager. Cancellation kills the install process.
    pub async fn install_packages(
        &self,
        packages: &[String],
        log: LogSink,
        token: &CancellationToken,
    ) -> RInstallResult {
        let rscript = self.find_rscript();
        if rscript.is_empty() {
            return RInstallResult {
                v: WIRE_VERSION,
                ok: false,
                error: Some("未找到 Rscript".to_string()),
                cancelled: false,
            };
        }
        let sink = logging_sink(&log);
        let bioc: Vec<String> = packages
            .iter()
            .filter(|p| BIOC_PACKAGES.contains(&p.as_str()))
            .cloned()
            .collect();
        let cran: Vec<String> = packages
            .iter()
            .filter(|p| !bioc.iter().any(|b| b == *p))
            .cloned()
            .collect();

        if !cran.is_empty() {
            let mut args = vec!["https://cloud.r-project.org".to_string()];
            args.extend(cran.iter().cloned());
            let script = r_expression_script(&rscript, CRAN_INSTALL_EXPR, &args);
            let exit = proc::run_streamed_shell(&script, token, &sink, None).await;
            if exit.cancelled {
                return RInstallResult {
                    v: WIRE_VERSION,
                    ok: false,
                    error: None,
                    cancelled: true,
                };
            }
            if exit.spawn_error.is_some() || exit.code != 0 {
                return RInstallResult {
                    v: WIRE_VERSION,
                    ok: false,
                    error: Some(capture_error(&exit, "R 包安装未完成")),
                    cancelled: false,
                };
            }
        }

        if !bioc.is_empty() {
            let mut args = vec!["BiocManager".to_string(), "install".to_string()];
            args.extend(bioc.iter().cloned());
            let script = r_expression_script(&rscript, BIOCONDUCTOR_INSTALL_EXPR, &args);
            let exit = proc::run_streamed_shell(&script, token, &sink, None).await;
            if exit.cancelled {
                return RInstallResult {
                    v: WIRE_VERSION,
                    ok: false,
                    error: None,
                    cancelled: true,
                };
            }
            if exit.spawn_error.is_some() || exit.code != 0 {
                return RInstallResult {
                    v: WIRE_VERSION,
                    ok: false,
                    error: Some(capture_error(&exit, "Bioconductor 包安装未完成")),
                    cancelled: false,
                };
            }
        }

        RInstallResult { v: WIRE_VERSION, ok: true, error: None, cancelled: false }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Build the `Rscript --vanilla -e 'expr' 'args…'` wrapper script exactly like
/// legacy `executeRExpression` (PowerShell `& 'Rscript' …` on Windows,
/// plain `'rscript' …` on Unix).
fn r_expression_script(rscript: &str, expression: &str, args: &[String]) -> String {
    let windows = cfg!(windows);
    let quote = if windows { proc::ps_quote } else { proc::sh_quote };
    let mut script = if windows {
        format!("& {} --vanilla -e {}", quote(rscript), quote(expression))
    } else {
        format!("{} --vanilla -e {}", quote(rscript), quote(expression))
    };
    for arg in args {
        script.push(' ');
        script.push_str(&quote(arg));
    }
    script
}

/// Wrap a [`proc::LineSink`] so every raw line is classified before logging.
fn logging_sink(log: &LogSink) -> proc::LineSink {
    let log = log.clone();
    Arc::new(move |line: &str| log(classify_line(line), line.to_string()))
}

/// Legacy error extraction: `(stderr || stdout || fallback).trim()` with JS
/// truthiness (first non-empty string wins).
fn capture_error(exit: &proc::StreamExit, fallback: &str) -> String {
    let stderr = exit.stderr.trim();
    let stdout = exit.stdout.trim();
    if !stderr.is_empty() {
        stderr.to_string()
    } else if !stdout.is_empty() {
        stdout.to_string()
    } else {
        fallback.to_string()
    }
}

/// Scan PATH directories for an executable (Unix variant checks the exec bit).
fn find_in_path(file_name: &str, executable: bool) -> Option<String> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(file_name);
        if executable && is_executable(&candidate) {
            return Some(candidate.to_string_lossy().into_owned());
        }
        if !executable && candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

/// Executable check (Unix verifies the exec bit; Windows existence suffices).
#[allow(unused)]
fn is_executable(path: &std::path::Path) -> bool {
    #[cfg(windows)]
    {
        path.is_file()
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(path) {
            Ok(md) => md.is_file() && md.permissions().mode() & 0o111 != 0,
            Err(_) => false,
        }
    }
}

#[cfg(windows)]
fn locate_rscript() -> String {
    // 1. PATH (legacy Get-Command Rscript)
    if let Some(found) = find_in_path("Rscript.exe", false) {
        return found;
    }
    // 2. C:\Program Files\R\R-* newest-first (legacy Sort-Object Name -Descending)
    let root = std::path::Path::new(r"C:\Program Files\R");
    let mut versions: Vec<std::path::PathBuf> = match std::fs::read_dir(root) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|p| p.is_dir())
            .collect(),
        Err(_) => Vec::new(),
    };
    versions.sort_by(|a, b| {
        let a_name = a.file_name().unwrap_or_default();
        let b_name = b.file_name().unwrap_or_default();
        b_name.cmp(a_name)
    });
    for dir in versions {
        for candidate in [
            dir.join("bin").join("x64").join("Rscript.exe"),
            dir.join("bin").join("Rscript.exe"),
        ] {
            if candidate.is_file() {
                return candidate.to_string_lossy().into_owned();
            }
        }
    }
    String::new()
}

#[cfg(not(windows))]
fn locate_rscript() -> String {
    // 1. Known absolute paths (legacy homebrew / framework locations)
    const KNOWN: &[&str] = &[
        "/opt/homebrew/bin/Rscript",
        "/usr/local/bin/Rscript",
        "/Library/Frameworks/R.framework/Resources/Rscript",
    ];
    for known in KNOWN {
        if is_executable(std::path::Path::new(known)) {
            return (*known).to_string();
        }
    }
    // 2. PATH (legacy `command -v Rscript`)
    find_in_path("Rscript", true).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn level(line: &str) -> LogLevel {
        classify_line(line)
    }

    #[test]
    fn classify_line_matches_legacy_table() {
        // error: /^Error|\bError in\b|Execution halted|\[ERROR\]/
        assert!(matches!(level("Error: object 'x' not found"), LogLevel::Error));
        assert!(matches!(level("Error in if (cond) :"), LogLevel::Error));
        assert!(matches!(level("Execution halted"), LogLevel::Error));
        assert!(matches!(level("[ERROR] step failed"), LogLevel::Error));
        assert!(matches!(level("dplyr::Error in mutate()"), LogLevel::Error));
        // word-boundary parity with \bError in\b (no boundary → info)
        assert!(matches!(level("MyError in foo"), LogLevel::Info));
        assert!(matches!(level("package::Error inside foo"), LogLevel::Info));
        // ^Error is a prefix match without a boundary check (legacy parity)
        assert!(matches!(level("Errors in total: 3"), LogLevel::Error));
        // ^Error prefix still wins over a mid-line boundary check
        assert!(matches!(level("Error inside function"), LogLevel::Error));

        // warning: /^Warning|\[WARN\]/
        assert!(matches!(level("Warning messages"), LogLevel::Warning));
        assert!(matches!(
            level("Warning: package 'DESeq2' was built under R"),
            LogLevel::Warning
        ));
        assert!(matches!(level("[WARN] low memory"), LogLevel::Warning));

        // success: [OK] (step-level) / [DONE] (pipeline-level)
        assert!(matches!(level("[OK] prepare done"), LogLevel::Success));
        assert!(matches!(level("[DONE] 分析完成(退出码 0)"), LogLevel::Success));

        // info fallback
        assert!(matches!(level("Reading counts matrix..."), LogLevel::Info));
        assert!(matches!(level("R version 4.4.1 (2024-06-14)"), LogLevel::Info));
        assert!(matches!(level("* using checked arguments"), LogLevel::Info));
        assert!(matches!(level(""), LogLevel::Info));
    }

    #[test]
    fn r_expression_script_quotes_arguments() {
        // On this platform the cfg! branch is fixed; both shapes are covered
        // by the quote-helper tests in proc.rs.
        let script = r_expression_script(
            "C:\\Program Files\\R\\Rscript.exe",
            "pkgs <- commandArgs(trailingOnly = TRUE)",
            &["DESeq2".to_string(), "a b".to_string()],
        );
        assert!(script.contains("--vanilla -e 'pkgs <- commandArgs(trailingOnly = TRUE)'"));
        assert!(script.contains("'DESeq2'"));
        assert!(script.contains("'a b'"));
    }

    #[test]
    fn capture_error_prefers_stderr_then_stdout_then_fallback() {
        let mut exit = proc::StreamExit {
            code: 1,
            stdout: "stdout text".to_string(),
            stderr: String::new(),
            cancelled: false,
            spawn_error: None,
        };
        assert_eq!(capture_error(&exit, "fallback"), "stdout text");
        exit.stderr = "  stderr text  ".to_string();
        assert_eq!(capture_error(&exit, "fallback"), "stderr text");
        exit.stderr = String::new();
        exit.stdout = "   ".to_string();
        assert_eq!(capture_error(&exit, "fallback"), "fallback");
    }
}
