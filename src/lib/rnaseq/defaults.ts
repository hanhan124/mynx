/**
 * RNA-seq 默认配置 — 与参考脚本 rnaseq_DE_heatmap.R 的 CONFIG 默认值一一对应。
 * 字段名/默认值不得随意改动:R 端引擎按参考脚本原样消费这些值。
 */
import type {
  Comparison,
  HeatmapStyle,
  OverallHeatmap,
  PlotsConfig,
  RnaSeqConfig,
  SelectedHeatmapJob,
} from "./types.ts";

/** 整体热图标记基因(参考脚本 overall_genes) */
export const DEFAULT_MARKER_GENES: string[] = [
  "RPE65",
  "MITF",
  "BEST1",
  "NANOG",
  "SOX2",
  "POU5F1",
  "PAX6",
  "PMEL",
  "RAX",
  "TYR",
  "OTX2",
  "TYRP1",
  "MERTK",
  "LHX2",
  "VSX2",
  "DCT",
  "RLBP1",
];

/** 选定基因热图的基因簇(参考脚本 gene_clusters) */
export const DEFAULT_GENE_CLUSTERS: Record<string, string[]> = {
  Transcription: ["MITF", "OTX2", "PAX6", "RAX"],
  Melanogenesis: ["TYR", "TYRP1", "PMEL", "MLANA"],
  Visual_Cycle: ["RPE65", "RDH5", "RLBP1"],
  Phagocytosis: ["MERTK", "ITGAV"],
  Ion_Transport: ["BEST1", "ATP1A1"],
  Tight_Junctions: ["TJP1", "AQP1"],
  Cytoskeleton: ["EZR"],
  Secreted: ["SERPINF1", "VEGFA"],
};

/** 热图通用样式(参考脚本 CONFIG$heatmap) */
export function defaultHeatmapStyle(): HeatmapStyle {
  return {
    transform: "vst",
    scale: "row",
    palette: "RdBu",
    reverse_palette: true,
    zlim: 2,
    group_palette: "Set2",
    gene_group_palette: "Dark2",
    cluster_rows: true,
    cluster_columns: false,
    row_distance: "pearson",
    column_distance: "euclidean",
    cluster_method: "ward.D2",
    column_names_rot: 0,
    column_names_side: "top",
    group_bar_height: 1,
    cluster_bar_width: 5,
    cluster_bar_side: "left",
    row_title_rot: 0,
    show_row_names: null,
    show_row_title: true,
    row_names_italic: true,
    show_column_names: true,
    show_annotation_name: false,
    group_legend_title: "",
    show_title: false,
    show_batch: true,
    font_size: 9,
    marker_font_size: 8,
    max_cluster_rows: 5000,
    use_raster: null,
    raster_quality: 1,
    formats: ["png"],
    dpi: 600,
  };
}

/** 整体热图(参考脚本 CONFIG$overall_heatmap) */
export function defaultOverallHeatmap(): OverallHeatmap {
  return {
    enabled: true,
    name: "overall",
    gene_source: "variable",
    top_n: "all",
    expressed_only: true,
    comparisons: null,
    max_genes: 2000,
    marker_genes: [...DEFAULT_MARKER_GENES],
    marker_add_missing: true,
    n_clusters: 3,
    sample_correlation: true,
    correlation_palette: "YlOrRd",
    correlation_show_annotation_name: false,
  };
}

/** 选定基因热图(参考脚本 CONFIG$selected_heatmaps) */
export function defaultSelectedHeatmaps(): SelectedHeatmapJob[] {
  return [
    {
      name: "gene_clusters",
      title: "RPE gene clusters",
      gene_groups: null, // 运行时由全局 gene_clusters 填充
      samples: null,
      n_clusters: null,
      options: {
        cluster_rows: false,
        cluster_columns: false,
        show_row_dend: true,
        show_column_dend: true,
        border: false,
        show_row_title: false,
        width: 4.5,
      },
    },
  ];
}

/** PCA 与火山图(参考脚本 CONFIG$plots) */
export function defaultPlots(): PlotsConfig {
  return {
    formats: ["png"],
    dpi: 300,
    font_family: "Arial",
    base_size: 7,
    group_palette: "npg",
    plot_pad_mm: 2,
    label_halo: true,
    legend_gap_mm: 0.8,
    pca: [
      {
        name: "PCA_selected",
        samples: null,
        ntop: 500,
        pcs: [1, 2],
        label_samples: true,
        ellipse: false,
        legend_pos: "right",
        square_panel: true,
        width_mm: 76,
        height_mm: 62,
      },
    ],
    volcano: {
      enabled: true,
      comparisons: null,
      label_top: 10,
      label_genes: null,
      point_size: 0.5,
      width_mm: 78,
      height_mm: 70,
      legend_pos: "right",
      show_subtitle: false,
    },
  };
}

export function defaultComparisons(): Comparison[] {
  return [];
}

export function defaultConfig(): RnaSeqConfig {
  return {
    data_file: "",
    output_dir: "",
    run_name: "auto",
    sample_labels: {},
    overall_genes: [...DEFAULT_MARKER_GENES],
    gene_clusters: Object.fromEntries(
      Object.entries(DEFAULT_GENE_CLUSTERS).map(([k, v]) => [k, [...v]]),
    ),
    input: {
      count_file: "",
      gene_col: 1,
      drop_empty_gene: true,
      duplicate_genes: "sum",
      rounding: "round",
    },
    groups: {},
    de: {
      method: "deseq2",
      padj: 0.05,
      log2fc: 1,
      bcv: 0.4,
      shrink: "none",
      use_batch: true,
      filter: {
        method: "filterByExpr",
        min_count: 10,
        min_total_count: 15,
        min_samples: 2,
      },
    },
    comparisons: defaultComparisons(),
    heatmap: defaultHeatmapStyle(),
    overall_heatmap: defaultOverallHeatmap(),
    selected_heatmaps: defaultSelectedHeatmaps(),
    plots: defaultPlots(),
  };
}

// ── 深合并(加载历史配置时,防止旧/残缺 JSON 缺字段)──
export function deepMerge<T>(base: T, patch: unknown): T {
  if (Array.isArray(base)) {
    return (Array.isArray(patch) ? patch : base) as T;
  }
  if (base !== null && typeof base === "object") {
    if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
      return base;
    }
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out as T;
  }
  return (patch === undefined ? base : (patch as T)) ?? base;
}

// ── 基因名清洗:去引号/空白(历史配置可能出现 '"RPE65"' 字面量)──
export function cleanGeneList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of input) {
    if (typeof v !== "string") continue;
    const g = v
      .trim()
      .replace(/^["']*/, "")
      .replace(/["']*$/, "")
      .trim();
    if (!g || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
  }
  return out;
}

export function cleanGeneClusters(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string[]> = {};
  for (const [name, genes] of Object.entries(input as Record<string, unknown>)) {
    const key = name.trim();
    const list = cleanGeneList(genes);
    if (key && list.length) out[key] = list;
  }
  return out;
}

/** 比较名 -> 文件安全名(与参考脚本「name 用作输出文件名」的建议一致) */
export function sanitizeComparisonName(name: string): string {
  return name.trim().replace(/\s+/g, "_");
}
