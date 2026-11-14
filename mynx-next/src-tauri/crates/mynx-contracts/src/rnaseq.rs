//! RNA-seq contracts. `RnaSeqConfig` is the params.json contract consumed by
//! `r/rnaseq_engine.R`; field names and defaults must stay in lockstep with
//! the reference engine. Legacy params.json files (written by the previous
//! frontend) deserialize via serde defaults.

use crate::WIRE_VERSION;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ── Config tree (params.json) ───────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum MatrixFormat {
    CountsMatrix,
    Featurecounts,
    Htseq,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum DeMethod {
    Deseq2,
    Edger,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum ShrinkMethod {
    None,
    Apeglm,
    Ashr,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum FilterMethod {
    #[serde(rename = "filterByExpr")]
    FilterByExpr,
    MinCount,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum DuplicateGenes {
    Sum,
    MaxMean,
    MakeUnique,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum CountRounding {
    Round,
    Floor,
    Ceiling,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum HeatmapTransform {
    Vst,
    Logcpm,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum HeatmapScale {
    Row,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Top,
    Bottom,
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum LegendPos {
    Right,
    Bottom,
    Top,
    Left,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum GeneSource {
    Variable,
    Deg,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case")]
pub enum ComparisonMode {
    Auto,
    Replicate,
    Noreplicate,
}

/// `top_n` accepts a number or the literal "all".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(untagged)]
pub enum TopN {
    Count(u32),
    All(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct InputOptions {
    pub count_file: String,
    pub gene_col: u32,
    pub drop_empty_gene: bool,
    pub duplicate_genes: DuplicateGenes,
    pub rounding: CountRounding,
}

impl Default for InputOptions {
    fn default() -> Self {
        Self {
            count_file: String::new(),
            gene_col: 1,
            drop_empty_gene: true,
            duplicate_genes: DuplicateGenes::Sum,
            rounding: CountRounding::Round,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct DeFilter {
    pub method: FilterMethod,
    pub min_count: f64,
    pub min_total_count: f64,
    pub min_samples: u32,
}

impl Default for DeFilter {
    fn default() -> Self {
        Self {
            method: FilterMethod::FilterByExpr,
            min_count: 10.0,
            min_total_count: 15.0,
            min_samples: 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct DeOptions {
    pub method: DeMethod,
    pub padj: f64,
    pub log2fc: f64,
    pub bcv: f64,
    pub shrink: ShrinkMethod,
    pub use_batch: bool,
    pub filter: DeFilter,
}

impl Default for DeOptions {
    fn default() -> Self {
        Self {
            method: DeMethod::Deseq2,
            padj: 0.05,
            log2fc: 1.0,
            bcv: 0.4,
            shrink: ShrinkMethod::None,
            use_batch: true,
            filter: DeFilter::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct Comparison {
    pub name: String,
    pub case: String,
    pub control: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<ComparisonMode>,
}

impl Default for Comparison {
    fn default() -> Self {
        Self { name: String::new(), case: String::new(), control: String::new(), mode: None }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct HeatmapStyle {
    pub transform: HeatmapTransform,
    pub scale: HeatmapScale,
    pub palette: String,
    pub reverse_palette: bool,
    pub zlim: f64,
    pub group_palette: String,
    pub gene_group_palette: String,
    pub cluster_rows: bool,
    pub cluster_columns: bool,
    pub row_distance: String,
    pub column_distance: String,
    pub cluster_method: String,
    pub column_names_rot: f64,
    pub column_names_side: Side,
    pub group_bar_height: f64,
    pub cluster_bar_width: f64,
    pub cluster_bar_side: Side,
    pub row_title_rot: f64,
    /// `null` lets the engine decide based on row count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_row_names: Option<bool>,
    pub show_row_title: bool,
    pub row_names_italic: bool,
    pub show_column_names: bool,
    pub show_annotation_name: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_legend_title: Option<String>,
    pub show_title: bool,
    pub show_batch: bool,
    pub font_size: f64,
    pub marker_font_size: f64,
    pub max_cluster_rows: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub use_raster: Option<bool>,
    pub raster_quality: u32,
    pub formats: Vec<String>,
    pub dpi: u32,
}

impl Default for HeatmapStyle {
    fn default() -> Self {
        Self {
            transform: HeatmapTransform::Vst,
            scale: HeatmapScale::Row,
            palette: "RdBu".into(),
            reverse_palette: true,
            zlim: 2.0,
            group_palette: "Set2".into(),
            gene_group_palette: "Dark2".into(),
            cluster_rows: true,
            cluster_columns: false,
            row_distance: "pearson".into(),
            column_distance: "euclidean".into(),
            cluster_method: "ward.D2".into(),
            column_names_rot: 0.0,
            column_names_side: Side::Top,
            group_bar_height: 1.0,
            cluster_bar_width: 5.0,
            cluster_bar_side: Side::Left,
            row_title_rot: 0.0,
            show_row_names: None,
            show_row_title: true,
            row_names_italic: true,
            show_column_names: true,
            show_annotation_name: false,
            group_legend_title: Some(String::new()),
            show_title: false,
            show_batch: true,
            font_size: 9.0,
            marker_font_size: 8.0,
            max_cluster_rows: 5000,
            use_raster: None,
            raster_quality: 1,
            formats: vec!["png".into()],
            dpi: 600,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct OverallHeatmap {
    pub enabled: bool,
    pub name: String,
    pub gene_source: GeneSource,
    pub top_n: TopN,
    pub expressed_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparisons: Option<Vec<String>>,
    pub max_genes: u32,
    pub marker_genes: Vec<String>,
    pub marker_add_missing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n_clusters: Option<u32>,
    pub sample_correlation: bool,
    pub correlation_palette: String,
    pub correlation_show_annotation_name: bool,
}

impl Default for OverallHeatmap {
    fn default() -> Self {
        Self {
            enabled: true,
            name: "overall".into(),
            gene_source: GeneSource::Variable,
            top_n: TopN::All("all".into()),
            expressed_only: true,
            comparisons: None,
            max_genes: 2000,
            marker_genes: default_marker_genes(),
            marker_add_missing: true,
            n_clusters: Some(3),
            sample_correlation: true,
            correlation_palette: "YlOrRd".into(),
            correlation_show_annotation_name: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct SelectedHeatmapOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cluster_rows: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_columns: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_row_dend: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_column_dend: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_row_title: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
}

impl Default for SelectedHeatmapOptions {
    fn default() -> Self {
        Self {
            cluster_rows: None,
            cluster_columns: None,
            show_row_dend: None,
            show_column_dend: None,
            border: None,
            show_row_title: None,
            width: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct SelectedHeatmapJob {
    pub name: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "Record<string, string[]> | null")]
    #[schemars(schema_with = "crate::json_any_schema")]
    pub gene_groups: Option<serde_json::Map<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub n_clusters: Option<u32>,
    #[serde(default)]
    pub options: SelectedHeatmapOptions,
}

impl Default for SelectedHeatmapJob {
    fn default() -> Self {
        Self {
            name: String::new(),
            title: String::new(),
            enabled: None,
            samples: None,
            gene_groups: None,
            n_clusters: None,
            options: SelectedHeatmapOptions::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct PcaJob {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub samples: Option<Vec<String>>,
    pub ntop: u32,
    pub pcs: [u32; 2],
    pub label_samples: bool,
    pub ellipse: bool,
    pub legend_pos: LegendPos,
    pub square_panel: bool,
    pub width_mm: f64,
    pub height_mm: f64,
}

impl Default for PcaJob {
    fn default() -> Self {
        Self {
            name: "PCA_selected".into(),
            title: None,
            enabled: None,
            samples: None,
            ntop: 500,
            pcs: [1, 2],
            label_samples: true,
            ellipse: false,
            legend_pos: LegendPos::Right,
            square_panel: true,
            width_mm: 76.0,
            height_mm: 62.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct VolcanoOptions {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparisons: Option<Vec<String>>,
    pub label_top: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label_genes: Option<Vec<String>>,
    pub point_size: f64,
    pub width_mm: f64,
    pub height_mm: f64,
    pub legend_pos: LegendPos,
    pub show_subtitle: bool,
}

impl Default for VolcanoOptions {
    fn default() -> Self {
        Self {
            enabled: true,
            comparisons: None,
            label_top: 10,
            label_genes: None,
            point_size: 0.5,
            width_mm: 78.0,
            height_mm: 70.0,
            legend_pos: LegendPos::Right,
            show_subtitle: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct AdditionalPlotsOptions {
    pub enabled: bool,
    pub ma: bool,
    pub sample_distance: bool,
    pub mds: bool,
    pub library_size: bool,
    pub expression_distribution: bool,
    pub deg_summary: bool,
    pub deg_dotplot: bool,
    pub gene_expression: bool,
    pub upset: bool,
    pub deg_matrix: bool,
    pub inferential_annotations: bool,
    pub top_n: u32,
    pub label_top: u32,
    pub genes: Vec<String>,
    pub width_mm: f64,
    pub height_mm: f64,
}

impl Default for AdditionalPlotsOptions {
    fn default() -> Self {
        Self {
            enabled: true,
            ma: true,
            sample_distance: true,
            mds: true,
            library_size: true,
            expression_distribution: true,
            deg_summary: true,
            deg_dotplot: true,
            gene_expression: true,
            upset: true,
            deg_matrix: true,
            inferential_annotations: false,
            top_n: 15,
            label_top: 10,
            genes: default_marker_genes(),
            width_mm: 89.0,
            height_mm: 70.0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct PlotsConfig {
    pub formats: Vec<String>,
    pub dpi: u32,
    pub font_family: String,
    pub base_size: f64,
    pub group_palette: String,
    pub plot_pad_mm: f64,
    pub label_halo: bool,
    pub legend_gap_mm: f64,
    pub pca: Vec<PcaJob>,
    pub volcano: VolcanoOptions,
    pub additional: AdditionalPlotsOptions,
}

impl Default for PlotsConfig {
    fn default() -> Self {
        Self {
            formats: vec!["png".into()],
            dpi: 300,
            font_family: "Arial".into(),
            base_size: 7.0,
            group_palette: "npg".into(),
            plot_pad_mm: 2.0,
            label_halo: true,
            legend_gap_mm: 0.8,
            pca: vec![PcaJob::default()],
            volcano: VolcanoOptions::default(),
            additional: AdditionalPlotsOptions::default(),
        }
    }
}

/// Full analysis configuration — the params.json contract.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "snake_case", default)]
pub struct RnaSeqConfig {
    pub data_file: String,
    pub output_dir: String,
    pub run_name: String,
    /// Insertion order matters (sample display order); preserved via
    /// serde_json's `preserve_order` feature.
    #[ts(type = "Record<string, string>")]
    #[schemars(schema_with = "crate::json_any_schema")]
    pub sample_labels: serde_json::Map<String, serde_json::Value>,
    /// batch covariate: `{"b1": ["s1","s2"], ...}` (order preserved)
    #[ts(type = "Record<string, string[]>")]
    #[schemars(schema_with = "crate::json_any_schema")]
    pub batch: serde_json::Map<String, serde_json::Value>,
    pub overall_genes: Vec<String>,
    #[ts(type = "Record<string, string[]>")]
    #[schemars(schema_with = "crate::json_any_schema")]
    pub gene_clusters: serde_json::Map<String, serde_json::Value>,
    pub input: InputOptions,
    #[ts(type = "Record<string, string[]>")]
    #[schemars(schema_with = "crate::json_any_schema")]
    pub groups: serde_json::Map<String, serde_json::Value>,
    pub de: DeOptions,
    pub comparisons: Vec<Comparison>,
    pub heatmap: HeatmapStyle,
    pub overall_heatmap: OverallHeatmap,
    pub selected_heatmaps: Vec<SelectedHeatmapJob>,
    pub plots: PlotsConfig,
    /// Runtime-injected by the runner; not part of user-editable config.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<String>>,
}

impl Default for RnaSeqConfig {
    fn default() -> Self {
        Self {
            data_file: String::new(),
            output_dir: String::new(),
            run_name: "auto".into(),
            sample_labels: serde_json::Map::new(),
            batch: serde_json::Map::new(),
            overall_genes: default_marker_genes(),
            gene_clusters: default_gene_clusters(),
            input: InputOptions::default(),
            groups: serde_json::Map::new(),
            de: DeOptions::default(),
            comparisons: Vec::new(),
            heatmap: HeatmapStyle::default(),
            overall_heatmap: OverallHeatmap::default(),
            selected_heatmaps: vec![SelectedHeatmapJob {
                name: "gene_clusters".into(),
                title: "RPE gene clusters".into(),
                enabled: None,
                samples: None,
                gene_groups: None,
                n_clusters: None,
                options: SelectedHeatmapOptions {
                    cluster_rows: Some(false),
                    cluster_columns: Some(false),
                    show_row_dend: Some(true),
                    show_column_dend: Some(true),
                    border: Some(false),
                    show_row_title: Some(false),
                    width: Some(4.5),
                },
            }],
            plots: PlotsConfig::default(),
            steps: None,
        }
    }
}

/// Overall-heatmap marker genes (reference-script overall_genes).
pub fn default_marker_genes() -> Vec<String> {
    [
        "RPE65", "MITF", "BEST1", "NANOG", "SOX2", "POU5F1", "PAX6", "PMEL", "RAX", "TYR",
        "OTX2", "TYRP1", "MERTK", "LHX2", "VSX2", "DCT", "RLBP1",
    ]
    .iter()
    .map(|s: &&str| String::from(*s))
    .collect()
}

/// Selected-heatmap gene clusters (reference-script gene_clusters).
pub fn default_gene_clusters() -> serde_json::Map<String, serde_json::Value> {
    let mut map = serde_json::Map::new();
    for (k, v) in [
        ("Transcription", vec!["MITF", "OTX2", "PAX6", "RAX"]),
        ("Melanogenesis", vec!["TYR", "TYRP1", "PMEL", "MLANA"]),
        ("Visual_Cycle", vec!["RPE65", "RDH5", "RLBP1"]),
        ("Phagocytosis", vec!["MERTK", "ITGAV"]),
        ("Ion_Transport", vec!["BEST1", "ATP1A1"]),
        ("Tight_Junctions", vec!["TJP1", "AQP1"]),
        ("Cytoskeleton", vec!["EZR"]),
        ("Secreted", vec!["SERPINF1", "VEGFA"]),
    ] {
        map.insert(
            k.to_string(),
            serde_json::Value::Array(
                v.into_iter().map(|s| serde_json::Value::String(s.to_string())).collect(),
            ),
        );
    }
    map
}

// ── Import / results types ──────────────────────────────────────────────────

/// Import summary returned by `rnaseq_import_counts`.
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "camelCase")]
pub struct ImportData {
    pub v: u32,
    pub gene_col: String,
    pub sample_cols: Vec<String>,
    #[ts(type = "Record<string, number>")]
    #[schemars(schema_with = "crate::json_any_schema")]
    pub nonzero_counts: serde_json::Map<String, serde_json::Value>,
    #[ts(type = "number")]
    pub total_genes: u64,
    /// First rows of the normalized matrix for preview (column order kept).
    #[ts(type = "Record<string, unknown>[]")]
    #[schemars(schema_with = "crate::json_any_schema")]
    pub preview: Vec<serde_json::Map<String, serde_json::Value>>,
    pub preview_columns: Vec<String>,
    pub source_file: String,
    /// Absolute path of the normalized matrix (cached CSV) if written.
    pub data_file: Option<String>,
    pub converted: bool,
    pub format: Option<String>,
    pub matrix_format: Option<MatrixFormat>,
    pub matrix_format_applied: Option<MatrixFormat>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub v: u32,
    pub path: String,
    /// Explicit format hint from the UI; auto-detected when absent.
    pub matrix_format: Option<MatrixFormat>,
    pub gene_col: u32,
    pub drop_empty_gene: bool,
    pub duplicate_genes: DuplicateGenes,
    pub rounding: CountRounding,
    /// When true, write the normalized matrix CSV cache and return its path.
    pub write_normalized_csv: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "camelCase")]
pub struct ResultFileItem {
    pub v: u32,
    pub name: String,
    pub subdir: String,
    #[ts(type = "number")]
    pub size: u64,
    #[ts(type = "number")]
    pub mtime_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "camelCase")]
pub struct DeSummaryRow {
    pub v: u32,
    pub comparison: String,
    pub case: String,
    pub control: String,
    pub n_case: u32,
    pub n_control: u32,
    pub path: String,
    pub method: String,
    pub genes_tested: u32,
    pub padj_cutoff: f64,
    pub log2fc_cutoff: f64,
    pub up: u32,
    pub down: u32,
}

/// A run directory under the output base (newest first in listings).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "camelCase")]
pub struct RunDirEntry {
    pub v: u32,
    pub path: String,
    pub name: String,
    #[ts(type = "number")]
    pub mtime_ms: i64,
    pub has_de: bool,
    pub has_params: bool,
}

/// Status mirror of the legacy run state machine (UI-side labels).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema,
)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Idle,
    Running,
    Done,
    Failed,
    Cancelled,
}

/// Result of `rnaseq_run` (final terminal payload on the run channel).
#[derive(Debug, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[ts(export, export_to = "rnaseq/")]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub v: u32,
    #[ts(type = "number")]
    pub task_id: u64,
    pub status: RunStatus,
    pub exit_code: i32,
    pub output_dir: String,
    pub run_name: String,
}
