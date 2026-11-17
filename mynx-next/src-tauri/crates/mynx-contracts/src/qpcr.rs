//! qPCR contracts. The Rust side owns the entire transform/calculate/chart
//! pipeline; the ExcelJS compatibility worker is a dumb renderer that applies
//! [`WorkbookPatch`] instructions and round-trips the workbook bytes. All
//! arithmetic, imputation flags, sheet structure and styling decisions are
//! computed here so results stay numerically identical to the legacy VBA /
//! TS implementations.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── Workbook snapshots (worker → Rust) ──────────────────────────────────────

/// Flattened cell value. Rich ExcelJS values (formulas, rich text) are
/// resolved to their plain cached value by the worker before crossing IPC.
/// Adjacently tagged (`{"t":"num","v":1.5}`) — internally-tagged enums
/// cannot carry primitive newtype payloads across serde.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(tag = "t", content = "v", rename_all = "camelCase")]
pub enum CellValue {
    Empty,
    Num(f64),
    Text(String),
}

/// One cell as seen by the renderer, including the yellow imputation flag
/// that the calculation pipeline treats as data (filled replicates).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct CellSnapshot {
    pub col: u32,
    pub value: CellValue,
    pub yellow_fill: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct RowSnapshot {
    /// 1-based row index as in the workbook.
    pub row: u32,
    pub cells: Vec<CellSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct SheetSnapshot {
    pub name: String,
    pub column_count: u32,
    pub row_count: u32,
    pub rows: Vec<RowSnapshot>,
}

/// Workbook extraction request: the sheets the pipeline may consume.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct WorkbookSnapshot {
    pub v: u32,
    pub sheet_names: Vec<String>,
    pub sheets: Vec<SheetSnapshot>,
}

// ── Workbook patches (Rust → worker renderer) ───────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(tag = "t", content = "v", rename_all = "camelCase")]
pub enum PatchValue {
    Empty,
    Num(f64),
    Text(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct PatchCell {
    pub value: PatchValue,
    #[serde(default)]
    pub bold: bool,
    /// Solid ARGB fill (e.g. "FFFFFF00" yellow imputation marker).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<String>,
    #[serde(default)]
    pub bottom_border: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct PatchRow {
    pub cells: Vec<PatchCell>,
}

/// A fully-specified sheet: the renderer deletes any existing sheet with the
/// same name, then writes rows sequentially and applies the style envelope.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct SheetPatch {
    pub name: String,
    pub rows: Vec<PatchRow>,
    /// Font applied to every cell (legacy: "Times New Roman").
    #[serde(default)]
    pub font_name: String,
    #[serde(default)]
    pub left_align: bool,
    /// Columns (1-based) whose data rows (row ≥ 2) get the light-blue
    /// identity fill — legacy `IDENTITY_COLUMN_FILL` EAF3FA.
    #[serde(default)]
    pub identity_fill_cols: Vec<u32>,
    /// Frozen panes (xSplit, ySplit); 0 = not frozen.
    #[serde(default)]
    pub freeze_x: u32,
    #[serde(default)]
    pub freeze_y: u32,
    /// Precomputed display widths, 1-based order.
    #[serde(default)]
    pub col_widths: Vec<f64>,
    /// Cell comment attached to A1 (QC notes on derived summary sheets).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub a1_note: Option<String>,
}

/// What the renderer must do to a workbook.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct WorkbookPatch {
    pub v: u32,
    pub remove_sheets: Vec<String>,
    pub upsert_sheets: Vec<SheetPatch>,
}

// ── Transform ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct TransformRequest {
    pub v: u32,
    /// Source sheet (raw Target/Gene + Sample/Group + Cq/Ct layout).
    pub source: SheetSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct TransformResult {
    pub v: u32,
    pub patch: WorkbookPatch,
    /// Gene columns written to the Transformed Data sheet (first-seen order).
    pub gene_names: Vec<String>,
    /// Distinct group names in first-seen row order.
    pub groups: Vec<String>,
}

/// Read-only input quality summary. This never changes the source worksheet.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct QpcrAuditRequest {
    pub v: u32,
    pub source: SheetSnapshot,
    pub transformed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct QpcrAuditResult {
    pub v: u32,
    pub sheet_name: String,
    pub data_rows: u32,
    pub accepted_rows: u32,
    pub skipped_rows: u32,
    pub missing_ct_rows: u32,
    pub invalid_ct_rows: u32,
    pub sample_count: u32,
    pub gene_count: u32,
    pub incomplete_cells: u32,
    pub imputed_cells: u32,
    pub issue_rows: Vec<u32>,
    pub target_header: Option<String>,
    pub sample_header: Option<String>,
    pub ct_header: Option<String>,
}

// ── Calculate ───────────────────────────────────────────────────────────────

/// Calculation method (legacy "mode").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "kebab-case")]
#[derive(Default)]
pub enum CalcMethod {
    /// Relative to the reference gene: 2^-(target − reference).
    #[default]
    RefNormalized,
    /// Standard ΔΔCt: divide by the control group's mean expression.
    ControlRelative,
}

impl Default for CalcOptions {
    fn default() -> Self {
        Self {
            method: CalcMethod::RefNormalized,
            control_group: String::new(),
            select_num: 0,
            outlier_sd: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct CalcOptions {
    #[serde(default)]
    pub method: CalcMethod,
    #[serde(default)]
    pub control_group: String,
    /// 0 = off; ≥2 generates Summary_Best_Replicates.
    #[serde(default)]
    pub select_num: u32,
    /// 0 = off; >0 generates Summary_Outlier_Removed (SD multiple).
    #[serde(default)]
    pub outlier_sd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct CalcRequest {
    pub v: u32,
    /// The Transformed Data sheet (values + yellow flags).
    pub source: SheetSnapshot,
    pub repeat_count: u32,
    pub ref_gene: String,
    #[serde(default)]
    pub options: CalcOptions,
    /// When true the result also carries the Charts_All_Genes sheet patch.
    #[serde(default)]
    pub with_charts_sheet: bool,
}

/// One per-gene chart payload (drives native Excel chart XML injection).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct QpcrChartSeries {
    pub gene_name: String,
    pub ref_gene: String,
    /// Group_Name / Average / Stdev rows in sheet order.
    pub points: Vec<QpcrChartPoint>,
    /// 1-based column of the Group_Name header inside the gene sheet.
    pub group_col: u32,
    pub data_start_row: u32,
    pub data_row_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct QpcrChartPoint {
    pub name: String,
    pub avg: f64,
    pub stdev: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct CalcResult {
    pub v: u32,
    pub patch: WorkbookPatch,
    /// Gene sheets in generation order (names as written to the workbook).
    pub gene_sheet_names: Vec<String>,
    pub method_note: String,
    pub chart_series: Vec<QpcrChartSeries>,
}

/// Native chart XML injection request (`qpcr_inject_charts`).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct ChartInjectionRequest {
    pub v: u32,
    /// Absolute path of the saved workbook (Rust rewrites it in place).
    pub file_path: String,
    pub series: Vec<QpcrChartSeries>,
    pub repeat_count: u32,
    /// "#RRGGBB" chart color from settings.
    pub color_hex: String,
    pub method: CalcMethod,
    pub control_group: String,
}

// ── R plot runner config (wire format for qpcr_plot_runner.R) ───────────────

/// Config passed verbatim to `qpcr_plot_runner.R` as one JSON argument.
/// Field names are the runner's contract; defaults mirror the legacy UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase", default)]
pub struct QpcrPlotRunConfig {
    pub file_path: String,
    pub sheet_name: String,
    pub output_dir: String,
    pub output_prefix: String,
    pub kind: String,
    pub format: String,
    pub width: f64,
    pub height: f64,
    pub dpi: u32,
    pub gene: String,
    pub bar_fill: String,
    pub bar_border: String,
    pub bar_border_width: f64,
    pub bar_width: f64,
    pub error_width: f64,
    pub error_cap: f64,
    pub error_color: String,
    pub show_raw_points: bool,
    pub show_x_tick: bool,
    pub x_angle: f64,
    pub x_hjust: f64,
    pub x_vjust: f64,
    pub tick_length: f64,
    pub axis_width: f64,
    pub title_size: f64,
    pub y_label_size: f64,
    pub y_tick_size: f64,
    pub x_tick_size: f64,
    pub title_vjust: f64,
    pub base_size: f64,
    pub x_label: String,
    pub y_label: String,
    pub wrap_plus: bool,
    pub scientific_notation: bool,
    pub auto_size: bool,
    pub batch_mode: bool,
    pub enable_stats: bool,
    pub show_stats: bool,
    pub sig_mode: String,
    pub control_group: String,
    pub stat_test: String,
    pub p_adjust_method: String,
    pub label_style: String,
    pub show_ns: bool,
    pub sig_file: String,
    pub bracket_width: f64,
    pub bracket_text_size: f64,
    pub bracket_label_gap: f64,
    pub bracket_step: f64,
    #[serde(default)]
    pub custom_pairs: Vec<CustomPair>,
    pub heatmap_scale: String,
    pub heatmap_palette: String,
    pub export_png: bool,
    pub export_pdf: bool,
    pub png_dpi: u32,
    pub pdf_width: f64,
    pub pdf_height: f64,
    pub png_width: f64,
    pub png_height: f64,
    pub heatmap_cluster_rows: bool,
    pub heatmap_cluster_cols: bool,
    pub show_cell_values: bool,
    pub cell_text_size: f64,
    pub cell_text_bold: bool,
    pub zlim: f64,
    pub heatmap_title: String,
    pub legend_title: String,
    pub legend_position: String,
    pub show_row_names: bool,
    pub show_col_names: bool,
    pub row_label_italic: bool,
    pub axis_title_size: f64,
    pub tile_border: String,
    pub tile_border_width: f64,
    pub use_gene_clusters: bool,
    #[ts(type = "Record<string, string[]>")]
    #[schemars(schema_with = "crate::json_any_schema")]
    pub gene_clusters: serde_json::Map<String, serde_json::Value>,
    pub install_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct CustomPair {
    pub gene: String,
    pub control: String,
    pub treatment: String,
}

/// Result payload of `qpcr_plot_run` (mirrors legacy QpcrPlotRunResult).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "qpcr/")]
#[serde(rename_all = "camelCase")]
pub struct QpcrPlotRunResult {
    pub v: u32,
    pub ok: bool,
    pub output_dir: Option<String>,
    pub files: Vec<String>,
    pub statistics_file: Option<String>,
    pub error: Option<String>,
    pub cancelled: bool,
}

impl Default for QpcrPlotRunConfig {
    fn default() -> Self {
        // Defaults mirror the legacy QpcrPlotter initial bar config. Plain
        // literal — NEVER deserialize inside Default: serde container
        // `default` calls Default::default() during from_value, which
        // would recurse infinitely.
        Self {
            file_path: String::new(),
            sheet_name: String::new(),
            output_dir: String::new(),
            output_prefix: "qpcr-barplot".into(),
            kind: "bar".into(),
            format: "png".into(),
            width: 5.0,
            height: 4.0,
            dpi: 300,
            gene: "ALL".into(),
            bar_fill: "#0000ff".into(),
            bar_border: "black".into(),
            bar_border_width: 0.3,
            bar_width: 0.0,
            error_width: 0.5,
            error_cap: 0.15,
            error_color: "#111827".into(),
            show_raw_points: false,
            show_x_tick: false,
            x_angle: 45.0,
            x_hjust: 1.0,
            x_vjust: 1.0,
            tick_length: 3.0,
            axis_width: 0.5,
            title_size: 26.0,
            y_label_size: 15.0,
            y_tick_size: 13.0,
            x_tick_size: 9.0,
            title_vjust: 1.0,
            base_size: 11.0,
            x_label: String::new(),
            y_label: "Relative expression".into(),
            wrap_plus: false,
            scientific_notation: true,
            auto_size: false,
            batch_mode: false,
            enable_stats: true,
            show_stats: true,
            sig_mode: "vs_first".into(),
            control_group: String::new(),
            stat_test: "auto".into(),
            p_adjust_method: "holm".into(),
            label_style: "p.signif".into(),
            show_ns: true,
            sig_file: "statistical_analysis_summary.csv".into(),
            bracket_width: 0.35,
            bracket_text_size: 6.0,
            bracket_label_gap: 0.18,
            bracket_step: 0.12,
            custom_pairs: Vec::new(),
            heatmap_scale: "row".into(),
            heatmap_palette: "blue-white-red".into(),
            export_png: true,
            export_pdf: false,
            png_dpi: 300,
            pdf_width: 7.0,
            pdf_height: 6.0,
            png_width: 4.0,
            png_height: 2.0,
            heatmap_cluster_rows: false,
            heatmap_cluster_cols: false,
            show_cell_values: false,
            cell_text_size: 3.2,
            cell_text_bold: true,
            zlim: 2.0,
            heatmap_title: String::new(),
            legend_title: "Z-score".into(),
            legend_position: "right".into(),
            show_row_names: true,
            show_col_names: true,
            row_label_italic: true,
            axis_title_size: 11.0,
            tile_border: "#FFFFFF".into(),
            tile_border_width: 0.25,
            use_gene_clusters: false,
            gene_clusters: serde_json::Map::new(),
            install_missing: true,
        }
    }
}
