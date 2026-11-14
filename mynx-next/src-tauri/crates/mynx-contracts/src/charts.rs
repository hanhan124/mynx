//! Scientific chart studio contracts: run configuration for
//! `r/chart_runner.R`, template manifests, and streamed run events.

use crate::WIRE_VERSION;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Config passed to `chart_runner.R`. Optional fields keep the exact legacy
/// wire names (camelCase) so verified-template params stay reproducible.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "charts/")]
#[serde(rename_all = "camelCase", default)]
pub struct ChartRunConfig {
    pub file_path: String,
    pub output_dir: String,
    pub template: String,
    pub kind: String,
    pub gallery_url: Option<String>,
    pub source_repo_path: Option<String>,
    pub x: String,
    pub y: String,
    pub group: Option<String>,
    pub size: Option<String>,
    pub title: String,
    pub subtitle: Option<String>,
    pub caption: Option<String>,
    pub plot_tag: Option<String>,
    pub color: String,
    pub format: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub dpi: Option<u32>,
    pub gg_theme: Option<String>,
    pub base_size: Option<f64>,
    pub font_family: Option<String>,
    pub show_legend: Option<bool>,
    pub legend_position: Option<String>,
    pub show_grid: Option<bool>,
    pub show_title: Option<bool>,
    pub title_size: Option<f64>,
    pub title_hjust: Option<f64>,
    pub axis_text_size: Option<f64>,
    pub axis_title_size: Option<f64>,
    pub publication_preset: Option<String>,
    pub palette: Option<String>,
    pub palette_reverse: Option<bool>,
    pub point_size: Option<f64>,
    pub line_width: Option<f64>,
    pub bar_width: Option<f64>,
    pub alpha: Option<f64>,
    pub axis_line_width: Option<f64>,
    pub grid_line_width: Option<f64>,
    pub panel_border: Option<bool>,
    pub show_raw_points: Option<bool>,
    pub show_stats: Option<bool>,
    pub stat_test: Option<String>,
    pub p_adjust_method: Option<String>,
    pub heatmap_cluster_rows: Option<bool>,
    pub heatmap_cluster_cols: Option<bool>,
    pub heatmap_scale: Option<String>,
    pub install_missing: bool,
    pub verified: Option<bool>,
}

impl Default for ChartRunConfig {
    fn default() -> Self {
        serde_json::from_value(serde_json::json!({
            "filePath": "", "outputDir": "", "template": "", "kind": "",
            "x": "group", "y": "value", "title": "", "color": "#0A84FF",
            "format": "png", "installMissing": true
        }))
        .expect("default ChartRunConfig must deserialize")
    }
}

/// Parsed `chart_event` line from `chart_runtime.R` (one JSON object per
/// line on stdout): `{ timestamp, stage, level, message, progress, detail }`.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "charts/")]
#[serde(rename_all = "camelCase")]
pub struct ChartRunEvent {
    pub v: u32,
    #[ts(type = "number")]
    pub ts_ms: i64,
    pub stage: String,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Terminal result of `chart_run`.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "charts/")]
#[serde(rename_all = "camelCase")]
pub struct ChartRunResult {
    pub v: u32,
    pub ok: bool,
    pub output_path: Option<String>,
    pub output_dir: Option<String>,
    pub files: Vec<String>,
    pub error: Option<String>,
    pub cancelled: bool,
}

/// Template manifest (`manifest.json` inside each template resource dir).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "charts/")]
#[serde(rename_all = "camelCase", default)]
pub struct ChartTemplateManifest {
    pub id: String,
    pub name: String,
    pub family: String,
    pub status: String,
    pub source_url: Option<String>,
    pub source_repo_path: Option<String>,
    pub packages: Vec<String>,
    pub outputs: Vec<String>,
    pub data_roles: Vec<ChartDataRole>,
    pub reference_path: Option<String>,
    pub reference_image_url: Option<String>,
    /// Extra keys some manifests carry (description etc.).
    #[serde(flatten)]
    #[ts(skip)]
    #[schemars(schema_with = "crate::json_any_schema")]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for ChartTemplateManifest {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            family: String::new(),
            status: String::new(),
            source_url: None,
            source_repo_path: None,
            packages: Vec::new(),
            outputs: Vec::new(),
            data_roles: Vec::new(),
            reference_path: None,
            reference_image_url: None,
            extra: Default::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "charts/")]
#[serde(rename_all = "camelCase", default)]
pub struct ChartDataRole {
    pub key: String,
    pub label: String,
    pub accepted_types: Vec<String>,
    pub required: bool,
    pub description: Option<String>,
}

impl Default for ChartDataRole {
    fn default() -> Self {
        Self {
            key: String::new(),
            label: String::new(),
            accepted_types: Vec::new(),
            required: false,
            description: None,
        }
    }
}

/// Imported dataset for field mapping (from `charts_import_data`).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "charts/")]
#[serde(rename_all = "camelCase")]
pub struct ChartImportedData {
    pub v: u32,
    pub file_path: String,
    pub columns: Vec<String>,
    #[schemars(schema_with = "crate::json_any_schema")]
    pub rows: Vec<Vec<serde_json::Value>>,
    #[ts(type = "number")]
    pub total_rows: u64,
    pub warnings: Vec<String>,
}

/// ZIP figure-package export request (`charts_export_zip`).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "charts/")]
#[serde(rename_all = "camelCase")]
pub struct ChartZipRequest {
    pub v: u32,
    /// Destination path chosen by the user (save dialog).
    pub zip_path: String,
    /// Output file produced by the run, copied into the package.
    pub output_file: Option<String>,
    /// Template resources to include (manifest/render/README).
    pub template_id: Option<String>,
    /// Optional extra text entries (README.txt content).
    pub readme: Option<String>,
    #[schemars(schema_with = "crate::json_any_schema")]
    pub sidecar_json: Option<serde_json::Value>,
}
