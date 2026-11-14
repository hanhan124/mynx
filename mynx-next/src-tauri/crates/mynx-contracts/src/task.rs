//! Task-center contracts: the lifecycle every long operation exposes to the
//! UI (idle → running → success | error | cancelled) plus global notification
//! payloads. These mirror `docs/TASK_PROTOCOL.md`.

use crate::WIRE_VERSION;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Terminal lifecycle state of a task. `Running` covers everything between
/// start and a terminal state; `Queued` exists for jobs accepted but not yet
/// started (image conversion keeps this transient).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, JsonSchema,
)]
#[ts(export, export_to = "task/")]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
}

impl TaskStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            TaskStatus::Succeeded | TaskStatus::Failed | TaskStatus::Cancelled
        )
    }
}

/// Stable identifiers for the task center; the UI maps these to icons and
/// i18n labels. Feature pages may also carry their own event streams.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, JsonSchema,
)]
#[ts(export, export_to = "task/")]
#[serde(rename_all = "camelCase")]
pub enum TaskKind {
    ImageConvert,
    QpcrPlot,
    QpcrExcel,
    RnaseqRun,
    ChartRun,
    RInstall,
    RDependencyCheck,
}

/// One task-center row. Progress is a 0..=1 fraction when known.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "task/")]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub v: u32,
    #[ts(type = "number")]
    pub id: u64,
    pub kind: TaskKind,
    pub label: String,
    pub status: TaskStatus,
    #[ts(type = "number")]
    pub created_at_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub started_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub finished_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
}

/// Log severity classification shared by the R runner and log drawers.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema,
)]
#[ts(export, export_to = "task/")]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Info,
    Warning,
    Error,
    Success,
}

/// One streamed log line (Channel payload for run logs).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "task/")]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub v: u32,
    #[ts(type = "number")]
    pub ts_ms: i64,
    pub level: LogLevel,
    pub message: String,
}

/// Global toast notification (Tauri event `mynx://toast`).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "task/")]
#[serde(rename_all = "camelCase")]
pub struct ToastPayload {
    pub v: u32,
    pub level: LogLevel,
    pub message: String,
}

/// Structured error returned by commands. Serialized as a tagged map so the
/// frontend can localize by `code` while still showing the raw message.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema, thiserror::Error)]
#[ts(export, export_to = "task/")]
#[serde(rename_all = "camelCase")]
pub struct MynxError {
    pub v: u32,
    pub code: ErrorCode,
    pub message: String,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema,
)]
#[ts(export, export_to = "task/")]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    Io,
    Validation,
    NotFound,
    Cancelled,
    Process,
    Internal,
}

impl MynxError {
    pub fn validation(message: impl Into<String>) -> Self {
        Self { v: WIRE_VERSION, code: ErrorCode::Validation, message: message.into() }
    }
    pub fn io(message: impl Into<String>) -> Self {
        Self { v: WIRE_VERSION, code: ErrorCode::Io, message: message.into() }
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self { v: WIRE_VERSION, code: ErrorCode::NotFound, message: message.into() }
    }
    pub fn cancelled() -> Self {
        Self { v: WIRE_VERSION, code: ErrorCode::Cancelled, message: "cancelled".into() }
    }
    pub fn process(message: impl Into<String>) -> Self {
        Self { v: WIRE_VERSION, code: ErrorCode::Process, message: message.into() }
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self { v: WIRE_VERSION, code: ErrorCode::Internal, message: message.into() }
    }
}

impl std::fmt::Display for MynxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            LogLevel::Info => "info",
            LogLevel::Warning => "warning",
            LogLevel::Error => "error",
            LogLevel::Success => "success",
        };
        f.write_str(s)
    }
}
