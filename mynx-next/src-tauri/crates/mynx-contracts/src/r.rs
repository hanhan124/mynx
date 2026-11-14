//! External R runtime contracts: Rscript discovery, dependency status and
//! install progress.

use crate::WIRE_VERSION;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "r/")]
#[serde(rename_all = "camelCase")]
pub struct RScriptStatus {
    pub v: u32,
    pub rscript: String,
    pub found: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "r/")]
#[serde(rename_all = "camelCase")]
pub struct RDependencyStatus {
    pub v: u32,
    pub rscript_found: bool,
    pub missing: Vec<String>,
    pub error: Option<String>,
}

/// Progress payload while installing R packages (Channel stream).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "r/")]
#[serde(rename_all = "camelCase")]
pub struct RInstallEvent {
    pub v: u32,
    pub level: crate::task::LogLevel,
    pub message: String,
}

/// Terminal payload for an install task.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "r/")]
#[serde(rename_all = "camelCase")]
pub struct RInstallResult {
    pub v: u32,
    pub ok: bool,
    pub error: Option<String>,
    pub cancelled: bool,
}
