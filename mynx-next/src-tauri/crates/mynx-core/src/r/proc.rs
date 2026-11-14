//! Process plumbing for external R invocations.
//!
//! Security policy: every spawned program name is an inline string literal
//! (`Command::new("powershell")`, `Command::new("bash")`, `Command::new("winget")`,
//! `Command::new("taskkill")`, …); user-controlled data only ever enters via
//! argv lists (`.args(...)`) or via `ps_quote`/`sh_quote`-escaped wrapper
//! scripts (ports of `io.ts` psQuote/shQuote, lines 20-26).
//!
//! All wrapper processes run with `kill_on_drop(true)` and piped stdout/stderr,
//! no console window flash on Windows (`CREATE_NO_WINDOW`), and honor a
//! `CancellationToken` with a hard tree kill (`taskkill /T /F` on Windows,
//! SIGKILL on Unix) — mirroring the legacy plugin-shell cancel semantics.

use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

/// `CREATE_NO_WINDOW` — suppress console window flash for wrapper processes.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Raw line sink: one call per complete stdout/stderr line (CRLF stripped,
/// empty lines skipped, exactly like the legacy `createLineHandler`).
pub type LineSink = Arc<dyn Fn(&str) + Send + Sync>;

/// Outcome of a streamed/captured process run.
#[derive(Debug, Clone)]
pub struct StreamExit {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub cancelled: bool,
    /// Set when the process could not be spawned at all (legacy: the
    /// spawn promise rejected / the `error` event fired).
    pub spawn_error: Option<String>,
}

impl StreamExit {
    fn failed_spawn(message: String) -> Self {
        Self {
            code: 1,
            stdout: String::new(),
            stderr: String::new(),
            cancelled: false,
            spawn_error: Some(message),
        }
    }
}

/// PowerShell single-quoted literal (legacy io.ts psQuote): `'` → `''`.
pub fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// POSIX shell single-quoted literal (legacy io.ts shQuote): `'` → `'\''`.
pub fn sh_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Hard-kill a process and its children. Windows: `taskkill /PID <pid> /T /F`;
/// Unix: SIGKILL (runners `exec` into Rscript, so the pid is the leaf).
pub async fn kill_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output().await;
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .await;
    }
}

/// Run a wrapper script: PowerShell on Windows (legacy plugin-shell flags
/// `-NoProfile -ExecutionPolicy Bypass -Command`), `bash -lc` on Unix.
/// Streams stdout/stderr lines to `on_line` and captures the full output.
/// On cancellation (`token`) the optional note is logged first, then the
/// process tree is hard-killed — the legacy "收到取消请求" flow.
pub async fn run_streamed_shell(
    script: &str,
    token: &CancellationToken,
    on_line: &LineSink,
    cancel_note: Option<&'static str>,
) -> StreamExit {
    let cmd = if cfg!(windows) {
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
        c
    } else {
        let mut c = Command::new("bash");
        c.args(["-lc", script]);
        c
    };
    run_streamed_cmd(cmd, token, on_line, cancel_note).await
}

/// Run a wrapper script and capture stdout/stderr without streaming to a log
/// (legacy `.execute()` semantics used by the dependency check).
pub async fn run_captured_shell(script: &str) -> StreamExit {
    let token = CancellationToken::new();
    let noop: LineSink = Arc::new(|_: &str| {});
    run_streamed_shell(script, &token, &noop, None).await
}

/// Spawn `cmd`, stream merged stdout/stderr lines to `on_line`, capture the
/// full output, and honor `token` cancellation (optional note first, then a
/// hard tree kill). The cancel watcher is aborted once the process exits, so
/// no task is left behind.
pub async fn run_streamed_cmd(
    mut cmd: Command,
    token: &CancellationToken,
    on_line: &LineSink,
    cancel_note: Option<&'static str>,
) -> StreamExit {
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.kill_on_drop(true);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(err) => return StreamExit::failed_spawn(err.to_string()),
    };
    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .expect("run_streamed_cmd: stdout must be piped");
    let stderr = child
        .stderr
        .take()
        .expect("run_streamed_cmd: stderr must be piped");

    // Cancel watcher: log the note immediately on cancel, then kill the tree.
    let watcher = {
        let token = token.clone();
        let on_line = on_line.clone();
        tokio::spawn(async move {
            token.cancelled().await;
            if let Some(note) = cancel_note {
                on_line(note);
            }
            if let Some(pid) = pid {
                kill_process_tree(pid).await;
            }
        })
    };

    let (stdout_text, stderr_text) = tokio::join!(
        pump_lines(stdout, on_line.clone()),
        pump_lines(stderr, on_line.clone()),
    );

    let status = child.wait().await.ok();
    watcher.abort();

    StreamExit {
        code: status.and_then(|s| s.code()).unwrap_or(1),
        stdout: stdout_text,
        stderr: stderr_text,
        cancelled: token.is_cancelled(),
        spawn_error: None,
    }
}

/// Read one stream to the end, forwarding each complete line (CRLF stripped,
/// empty lines skipped) and returning the captured text. Invalid UTF-8 is
/// replaced rather than dropping the remainder of the stream.
async fn pump_lines<R>(reader: R, on_line: LineSink) -> String
where
    R: AsyncRead + Unpin,
{
    let mut reader = BufReader::with_capacity(8192, reader);
    let mut acc = String::new();
    let mut buf: Vec<u8> = Vec::with_capacity(512);
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let text = String::from_utf8_lossy(&buf);
        let line = text.trim_end_matches('\n');
        let line = line.strip_suffix('\r').unwrap_or(line);
        acc.push_str(line);
        acc.push('\n');
        if !line.is_empty() {
            on_line(line);
        }
    }
    acc
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ps_quote_matches_legacy() {
        assert_eq!(ps_quote("C:\\out dir"), "'C:\\out dir'");
        assert_eq!(ps_quote("it's"), "'it''s'");
        assert_eq!(ps_quote(""), "''");
        assert_eq!(ps_quote("中文"), "'中文'");
    }

    #[test]
    fn sh_quote_matches_legacy() {
        assert_eq!(sh_quote("/tmp/a b"), "'/tmp/a b'");
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
        assert_eq!(sh_quote(""), "''");
    }
}
