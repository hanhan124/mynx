/**
 * RNA-seq 类型定义 — 与 r/rnaseq_engine.R 的 params.json 契约严格一致。
 * 契约即参考脚本 rnaseq_DE_heatmap.R 的 CONFIG 结构,字段名一一对应。
 */

// ── 输入计数文件(input)──
export interface InputOptions {
  count_file: string;
  /** 基因名列序号(GUI 导入后固定为 1) */
  gene_col: number;
  drop_empty_gene: boolean;
  /** 重名基因处理:sum(原始计数相加) | max_mean(留均值最大行) | make_unique(改名保留) */
  duplicate_genes: "sum" | "max_mean" | "make_unique";
  /** 计数取整: round(四舍五入) | floor | ceiling */
  rounding: "round" | "floor" | "ceiling";
}

// ── 差异分析全局参数(de)──
export interface DeFilter {
  method: "filterByExpr" | "min_count" | "none";
  min_count: number;
  min_total_count: number;
  min_samples: number;
}

export interface DeOptions {
  /** 有重复路径的方法:deseq2 | edger */
  method: "deseq2" | "edger";
  /** 显著性阈值(校正后 P / FDR) */
  padj: number;
  /** Up/Down 判定的 |log2FC| 阈值 */
  log2fc: number;
  /** 无重复路径的生物学变异系数:人 0.4 | 同基因型 0.1 | 技术重复 0.01 */
  bcv: number;
  /** DESeq2 log2FC 收缩:none | apeglm | ashr */
  shrink: "none" | "apeglm" | "ashr";
  /** 有 batch 时是否放进设计矩阵 */
  use_batch: boolean;
  filter: DeFilter;
}

// ── 差异比较(case 相对 control)──
export interface Comparison {
  name: string;
  case: string;
  control: string;
  mode?: "auto" | "replicate" | "noreplicate";
}

// ── 热图通用样式(heatmap;字段与参考脚本 heatmap list 一致)──
export interface HeatmapStyle {
  transform: "vst" | "logcpm";
  scale: "row" | "none";
  palette: string;
  reverse_palette: boolean;
  zlim: number;
  group_palette: string;
  gene_group_palette: string;
  cluster_rows: boolean;
  cluster_columns: boolean;
  row_distance: string;
  column_distance: string;
  cluster_method: string;
  column_names_rot: number;
  column_names_side: "top" | "bottom";
  group_bar_height: number;
  cluster_bar_width: number;
  cluster_bar_side: "left" | "right";
  row_title_rot: number;
  /** null = 自动(≤80 行显示基因名) */
  show_row_names: boolean | null;
  show_row_title: boolean;
  row_names_italic: boolean;
  show_column_names: boolean;
  show_annotation_name: boolean;
  /** "" = 图例只留色块与组名;null = ComplexHeatmap 默认「Group」 */
  group_legend_title: string | null;
  show_title: boolean;
  show_batch: boolean;
  font_size: number;
  marker_font_size: number;
  max_cluster_rows: number;
  use_raster: boolean | null;
  raster_quality: number;
  formats: string[];
  dpi: number;
}

// ── 整体热图(overall_heatmap)──
export interface OverallHeatmap {
  enabled: boolean;
  name: string;
  /** variable(按方差取基因) | deg(差异基因并集,需先跑 de) */
  gene_source: "variable" | "deg";
  /** 画多少个基因(按方差);字符串 "all" = 全部 */
  top_n: number | "all";
  expressed_only: boolean;
  /** deg 模式:用哪些比较的结果,null = 全部 */
  comparisons: string[] | null;
  /** deg 模式:最多画多少基因(按 padj 排序截取) */
  max_genes: number;
  /** 整体热图左侧标记基因(整体基因列表,平铺) */
  marker_genes: string[];
  marker_add_missing: boolean;
  /** 基因聚成几簇(色块 C1..Ck);null = 不分簇 */
  n_clusters: number | null;
  sample_correlation: boolean;
  correlation_palette: string;
  correlation_show_annotation_name: boolean;
}

// ── 选定基因热图(selected_heatmaps 的单个任务)──
export interface SelectedHeatmapJob {
  name: string;
  title: string;
  enabled?: boolean;
  /** 组名或样本名,顺序即图中顺序;null = 全部 */
  samples: string[] | null;
  /** 基因簇:{簇名 = 基因数组};由全局 gene_clusters 填充 */
  gene_groups: Record<string, string[]> | null;
  n_clusters: number | null;
  options: SelectedHeatmapOptions;
}

/** 选定基因热图 per-figure 覆盖项(merge 进全局 heatmap 样式) */
export interface SelectedHeatmapOptions {
  cluster_rows?: boolean;
  cluster_columns?: boolean;
  show_row_dend?: boolean;
  show_column_dend?: boolean;
  border?: boolean;
  show_row_title?: boolean;
  width?: number | null;
}

// ── PCA 任务 ──
export interface PcaJob {
  name: string;
  title?: string;
  enabled?: boolean;
  /** 组名或样本名;null = 全部 */
  samples: string[] | null;
  /** 取方差最大的前 ntop 个基因 */
  ntop: number;
  pcs: [number, number];
  label_samples: boolean;
  /** 组内 ≥4 样本时画 95% 置信椭圆 */
  ellipse: boolean;
  legend_pos: "right" | "bottom" | "top" | "none";
  square_panel: boolean;
  width_mm: number;
  height_mm: number;
}

// ── 火山图(volcano)──
export interface VolcanoOptions {
  enabled: boolean;
  /** 画哪些比较,null = 全部 */
  comparisons: string[] | null;
  /** 标注最显著的 N 个基因;0 = 不标 */
  label_top: number;
  label_genes: string[] | null;
  point_size: number;
  width_mm: number;
  height_mm: number;
  legend_pos: "right" | "top" | "bottom" | "none";
  show_subtitle: boolean;
}

// ── ggplot 图全局(plots)──
export interface PlotsConfig {
  formats: string[];
  dpi: number;
  font_family: string;
  base_size: number;
  group_palette: string;
  plot_pad_mm: number;
  label_halo: boolean;
  legend_gap_mm: number;
  pca: PcaJob[];
  volcano: VolcanoOptions;
}

// ── 完整配置(params.json 契约)──
export interface RnaSeqConfig {
  /** 计数文件(导入规范化后的 csv 缓存) */
  data_file: string;
  /** 输出根目录(运行目录 = output_dir/run_name) */
  output_dir: string;
  run_name: string;
  /** 样本显示名:原始列名 = 显示名 */
  sample_labels: Record<string, string>;
  /** 整体热图标记基因(平铺) */
  overall_genes: string[];
  /** 选定基因热图的基因簇:簇名 = 基因数组 */
  gene_clusters: Record<string, string[]>;
  input: InputOptions;
  groups: Record<string, string[]>;
  de: DeOptions;
  comparisons: Comparison[];
  heatmap: HeatmapStyle;
  overall_heatmap: OverallHeatmap;
  selected_heatmaps: SelectedHeatmapJob[];
  plots: PlotsConfig;
  /** 运行步骤(运行时注入):de | heatmap | plots */
  steps?: string[];
}

// ── 运行步骤 ──
export type RunStep = "de" | "heatmap" | "plots";

// ── 导入数据 ──
export type MatrixFormat = "counts_matrix" | "featurecounts" | "htseq";

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

// ── 运行状态 ──
export type RunStatus = "idle" | "running" | "done" | "failed" | "cancelled";

export interface LogEntry {
  ts: number;
  msg: string;
  level: string;
}

// ── 结果文件 ──
export interface ResultFileItem {
  name: string;
  /** 相对运行目录的子目录:"heatmap" | "plots" */
  subdir: string;
  size: number;
  mtimeMs: number;
}

/** DE_summary.csv 的行 */
export interface DeSummaryRow {
  comparison: string;
  case: string;
  control: string;
  n_case: number;
  n_control: number;
  path: string;
  method: string;
  genes_tested: number;
  padj_cutoff: number;
  log2fc_cutoff: number;
  Up: number;
  Down: number;
}
