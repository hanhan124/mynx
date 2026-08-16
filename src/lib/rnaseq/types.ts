/**
 * RNA-seq 流水线类型定义 — 与 r/runner.R 的 params.json 契约严格一致。
 * 迁移自 publication_pipeline_wails（frontend/src/types/config.ts）。
 */

// ── 分析参数 ──
export interface AnalysisParams {
  bcv: number;
  log2fc_th: number;
  fdr_th: number;
  basemean_th: number;
  top_n_label: number;
  pvalue_cap: number;
  /** 引擎:auto(单重复→edgeR 固定 BCV;多重复→DESeq2)/ deseq2 / edger_qlf */
  engine?: "auto" | "deseq2" | "edger_qlf";
  /** 低表达过滤阈值(edgeR filterByExpr min.count / DESeq2 rowSums 下限) */
  filter_min_count?: number;
  filter_rowsum?: number;
}

// ── 通用作图选项(所有 ggplot 图共享) ──
export interface CommonPlotOptions {
  show_legend?: boolean;
  legend_position?: "right" | "left" | "top" | "bottom";
  legend_direction?: "vertical" | "horizontal";
  legend_title?: string;
  legend_title_size?: number;
  legend_text_size?: number;
  show_title?: boolean;
  title?: string;
  title_hjust?: number;
  title_color?: string;
  show_xlab?: boolean;
  xlab?: string;
  show_ylab?: boolean;
  ylab?: string;
  show_grid?: boolean;
  panel_border?: "auto" | "none" | "solid" | "dashed";
  panel_fill?: string;
  plot_background?: string;
  show_axis_ticks?: boolean;
  plot_margin?: number[];
  title_size?: number;
  axis_text_size?: number;
  axis_title_size?: number;
  axis_text_color?: string;
  axis_title_color?: string;
  width?: number;
  height?: number;
  up_color?: string;
  down_color?: string;
  ns_color?: string;
  color_palette?: string;
  point_size?: number;
  point_alpha?: number;
  point_shape?: number;
  bar_width?: number;
  x_text_angle?: number;
  show_subtitle?: boolean;
  // ggplot 主题(runner.R build_theme)
  gg_theme?: string;
  base_size?: number;
  show_threshold_line?: boolean;
  /** per-plot 子集(空数组=使用全局 selected_groups / comparisons) */
  groups?: string[];
  comparisons?: [string, string][];
  /** MA 图 LOESS 趋势线 */
  show_loess?: boolean;
}

export interface PcaOptions extends CommonPlotOptions {
  square?: boolean;
  show_crosshair?: boolean;
  label_repel?: boolean;
  label_text?: "group" | "sample" | "none";
  xlim?: number[];
  ylim?: number[];
  shape_by_group?: boolean;
  show_n?: boolean;
  scale_genes?: boolean;
}

export interface HeatmapOptions {
  k_clusters?: number;
  show_marker_labels?: boolean;
  show_legend?: boolean;
  legend_position?: string;
  show_column_names?: boolean;
  column_names_rot?: number;
  show_row_names?: boolean;
  use_all_genes?: boolean;
  width?: number;
  height?: number;
  groups?: string[];
  heatmap_palette?: string;
  zscore_min?: number;
  zscore_max?: number;
  cluster_palette?: string;
  show_cluster_annotation?: boolean;
  column_group_order?: string[];
}

export interface SelectHeatmapOptions {
  width?: number;
  height?: number;
  gene_label_rot?: number;
  show_legend?: boolean;
  legend_position?: string;
  show_gene_names?: boolean;
  show_group_names?: boolean;
  groups?: string[];
  heatmap_palette?: string;
  zscore_min?: number;
  zscore_max?: number;
  cluster_palette?: string;
  show_cluster_annotation?: boolean;
  column_group_order?: string[];
}

export interface VolcanoOptions extends CommonPlotOptions {
  square?: boolean;
  top_n?: number;
  label_size?: number;
  show_threshold_lines?: boolean;
  show_subtitle?: boolean;
  ylim?: number[];
  label_strategy?: "top_n" | "marker" | "both" | "none";
  label_up_only?: boolean;
  label_down_only?: boolean;
}

export interface VennOptions {
  by?: "sample" | "comparison";
  max_sets?: number;
  show_title?: boolean;
  title?: string;
  show_stats?: boolean;
  stroke_size?: number;
  width?: number;
  height?: number;
  groups?: string[];
  comparisons?: [string, string][];
}

export interface BoxplotOptions extends CommonPlotOptions {
  outlier_size?: number;
  box_line_width?: number;
  box_alpha?: number;
}

export interface DegBarOptions extends CommonPlotOptions {
  bar_position?: "stack" | "dodge";
  show_values?: boolean;
}

export interface TopGenesOptions extends CommonPlotOptions {
  n?: number;
  gene_italic?: boolean;
  show_threshold_line?: boolean;
}

export interface DendrogramOptions {
  method?: string;
  color_palette?: string;
  label_cex?: number;
  hang?: number;
  cex_axis?: number;
  show_title?: boolean;
  title?: string;
  show_xlab?: boolean;
  xlab?: string;
  show_ylab?: boolean;
  ylab?: string;
  width?: number;
  height?: number;
  groups?: string[];
}

export interface EnrichOptions extends CommonPlotOptions {
  organism?: string;
  databases?: string[];
  ontologies?: string[];
  pvalue_cutoff?: number;
  qvalue_cutoff?: number;
  top_n?: number;
  bar_color_by?: "database" | "ontology" | "neg_log10p";
  bar_x?: "count" | "neg_log10p";
}

export interface GseaOptions extends CommonPlotOptions {
  organism?: string;
  databases?: string[];
  pvalue_cutoff?: number;
  top_n?: number;
  point_size_min?: number;
  point_size_max?: number;
  color_by?: "direction" | "nes";
  n_running_plots?: number;
}

export interface ViolinOptions extends CommonPlotOptions {
  genes?: string[];
  violin_alpha?: number;
  ncol?: number;
}

export interface DensityOptions extends CommonPlotOptions {
  by?: "sample" | "group";
  alpha?: number;
}

export interface PlotOptions {
  pca?: PcaOptions;
  heatmap?: HeatmapOptions;
  select_heatmap?: SelectHeatmapOptions;
  volcano?: VolcanoOptions;
  venn?: VennOptions;
  ma?: CommonPlotOptions;
  boxplot?: BoxplotOptions;
  deg_bar?: DegBarOptions;
  top_genes?: TopGenesOptions;
  dendrogram?: DendrogramOptions;
  enrich?: EnrichOptions;
  gsea?: GseaOptions;
  violin?: ViolinOptions;
  density?: DensityOptions;
}

// ── 完整配置(params.json 契约) ──
export interface Config {
  data_file: string;
  output_dir: string;
  run_name: string;
  groups: Record<string, string[]>;
  group_display: Record<string, string>;
  group_order: string[];
  selected_groups: string[];
  comparisons: [string, string][];
  /** 批次分配:批次名 → 样本列表;非空时采用 ~ batch + condition 设计(默认 {}) */
  batches: Record<string, string[]>;
  params: AnalysisParams;
  marker_genes: string[];
  gene_clusters: Record<string, string[]>;
  excluded_genes: string[];
  steps: string[];
  plot_formats: string[];
  size_mode: "auto" | "manual";
  plot_options: PlotOptions;
  /** 发表字体(sans/Arial/Helvetica/Times) */
  font_family: string;
  /** 快速预览模式(低分辨率 PNG,R 端读取) */
  preview_mode?: boolean;
  preview_dpi?: number;
}

export type MatrixFormat = "counts_matrix" | "featurecounts" | "htseq";

// ── 导入数据 ──
export interface ImportData {
  gene_col: string;
  sample_cols: string[];
  nonzero_counts: Record<string, number>;
  total_genes: number;
  preview: Record<string, unknown>[];
  preview_columns?: string[];
  source_file?: string;
  data_file?: string;
  converted?: boolean;
  format?: string;
  matrix_format?: MatrixFormat | string;
  matrix_format_applied?: MatrixFormat | string;
  warnings?: string[];
}

export interface PageData {
  columns: string[];
  data: Record<string, unknown>[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

// ── 绘图结果文件 ──
export interface PlotFileItem {
  name: string;
  size: number;
  mtime: string;
}

export interface PlotFileContent {
  kind?: "svg" | "png" | "pdf";
  content?: string;
  data_base64?: string;
  unsupported?: boolean;
  name?: string;
  error?: string;
}

export interface LogEntry {
  ts: number;
  msg: string;
  level: string;
}

export interface StepDef {
  id: string;
  name: string;
}

// ── 运行记录 ──
export interface RunItem {
  name: string;
  base_dir: string;
  has_excel: boolean;
  n_plots: number;
  mtime: string;
}

export type RunStatus = "idle" | "running" | "done" | "failed" | "cancelled";
