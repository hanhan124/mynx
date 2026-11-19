import { describe, expect, it } from "vitest";
import type { Comparison } from "../../lib/contracts/generated/rnaseq/Comparison.js";
import type { RnaSeqConfig } from "../../lib/contracts/generated/rnaseq/RnaSeqConfig.js";
import {
  ADDITIONAL_BOOLEAN_KEYS,
  ADDITIONAL_BOOLEAN_LABEL_KEYS,
  autoComparisonName,
  baseName,
  cleanGeneClusters,
  cleanGeneList,
  formatFileSize,
  joinPath,
  parentDir,
  parseGeneList,
  renameMapKey,
  RNA_SEQ_REQUIRED_PACKAGES,
  sanitizeComparisonName,
  validComparisonsOf,
} from "./model.js";

function configWith(
  groups: Record<string, string[]>,
  comparisons: Comparison[],
): RnaSeqConfig {
  return {
    data_file: "counts.csv",
    output_dir: "",
    run_name: "auto",
    sample_labels: {},
    batch: {},
    overall_genes: [],
    gene_clusters: {},
    input: {
      count_file: "counts.csv",
      gene_col: 1,
      drop_empty_gene: true,
      duplicate_genes: "sum",
      rounding: "round",
    },
    groups,
    de: {
      method: "deseq2",
      padj: 0.05,
      log2fc: 1,
      bcv: 0.4,
      shrink: "none",
      use_batch: true,
      filter: { method: "filterByExpr", min_count: 10, min_total_count: 15, min_samples: 2 },
    },
    comparisons,
    heatmap: {
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
    },
    overall_heatmap: {
      enabled: true,
      name: "overall",
      gene_source: "variable",
      top_n: "all",
      expressed_only: true,
      comparisons: null,
      max_genes: 2000,
      marker_genes: [],
      marker_add_missing: true,
      n_clusters: 3,
      sample_correlation: true,
      correlation_palette: "YlOrRd",
      correlation_show_annotation_name: false,
    },
    selected_heatmaps: [],
    plots: {
      formats: ["png"],
      dpi: 300,
      font_family: "Arial",
      base_size: 7,
      group_palette: "npg",
      plot_pad_mm: 2,
      label_halo: true,
      legend_gap_mm: 0.8,
      pca: [],
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
      additional: {
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
        genes: [],
        width_mm: 89,
        height_mm: 70,
      },
    },
    steps: null,
  };
}

describe("validComparisonsOf (legacy port)", () => {
  const groups = { A: ["s1", "s2"], B: ["s3"], C: [], D: ["s4", "s5"] };

  it("keeps comparisons with distinct non-empty configured groups", () => {
    const cfg = configWith(groups, [
      { name: "A_vs_B", case: "A", control: "B", mode: "auto" },
      { name: "A_vs_D", case: "A", control: "D", mode: "auto" },
    ]);
    expect(validComparisonsOf(cfg).map((c) => c.name)).toEqual(["A_vs_B", "A_vs_D"]);
  });

  it("drops case == control comparisons", () => {
    const cfg = configWith(groups, [
      { name: "A_vs_A", case: "A", control: "A", mode: "auto" },
      { name: "A_vs_B", case: "A", control: "B", mode: "auto" },
    ]);
    expect(validComparisonsOf(cfg).map((c) => c.name)).toEqual(["A_vs_B"]);
  });

  it("drops comparisons referencing empty or missing groups", () => {
    const cfg = configWith(groups, [
      { name: "A_vs_C", case: "A", control: "C", mode: "auto" },
      { name: "A_vs_Z", case: "A", control: "Z", mode: "auto" },
      { name: "empty_case", case: "", control: "B", mode: "auto" },
    ]);
    expect(validComparisonsOf(cfg)).toEqual([]);
  });

  it("returns an empty list when comparisons are missing entirely", () => {
    const cfg = configWith(groups, []);
    expect(validComparisonsOf(cfg)).toEqual([]);
  });
});

describe("comparison naming", () => {
  it("sanitizes whitespace into underscores", () => {
    expect(sanitizeComparisonName("  KO 24h vs WT  ")).toBe("KO_24h_vs_WT");
  });

  it("builds auto names from case/control", () => {
    expect(autoComparisonName({ case: "KO", control: "WT" })).toBe("KO_vs_WT");
    expect(autoComparisonName({ case: "", control: "WT" })).toBe("_vs_WT");
  });
});

describe("gene list cleaning (legacy defaults helpers)", () => {
  it("trims, strips wrapping quotes and de-duplicates", () => {
    expect(cleanGeneList(['"RPE65"', " MITF ", "RPE65", "", null, 42])).toEqual([
      "RPE65",
      "MITF",
    ]);
  });

  it("parses textarea input on newlines and commas", () => {
    expect(parseGeneList("RPE65, MITF\n\"BEST1\"\n\nTYR,TYR")).toEqual([
      "RPE65",
      "MITF",
      "BEST1",
      "TYR",
    ]);
  });

  it("drops empty clusters but keeps non-empty ones in order", () => {
    expect(
      cleanGeneClusters({
        A: ["MITF", "MITF", ""],
        "  ": ["TYR"],
        B: [],
        C: ['"OTX2"'],
      }),
    ).toEqual({ A: ["MITF"], C: ["OTX2"] });
  });

  it("rejects non-object input", () => {
    expect(cleanGeneClusters(null)).toEqual({});
    expect(cleanGeneClusters([["A"], ["B"]])).toEqual({});
  });
});

describe("record / path helpers", () => {
  it("renames keys preserving insertion order", () => {
    expect(renameMapKey({ a: 1, b: 2, c: 3 }, "b", "B")).toEqual({ a: 1, B: 2, c: 3 });
  });

  it("computes Windows and POSIX base names and parents", () => {
    expect(baseName("C:\\data\\runs\\run1")).toBe("run1");
    expect(baseName("/data/runs/run1/")).toBe("run1");
    expect(parentDir("C:\\data\\runs\\run1")).toBe("C:\\data\\runs");
    expect(parentDir("/data/runs/run1")).toBe("/data/runs");
  });

  it("joins paths with the detected separator", () => {
    expect(joinPath("C:\\data", "Mynx", "rnaseq_runs")).toBe("C:\\data\\Mynx\\rnaseq_runs");
    expect(joinPath("/data", "Mynx")).toBe("/data/Mynx");
    expect(joinPath("", "x")).toBe("x");
    expect(joinPath("C:\\data\\", "x")).toBe("C:\\data\\x");
  });

  it("formats file sizes for the gallery meta line", () => {
    expect(formatFileSize(0)).toBe("0 KB");
    expect(formatFileSize(512)).toBe("0.5 KB");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1024 * 1024 * 3)).toBe("3 MB");
  });
});

describe("catalogs", () => {
  it("keeps the legacy R package list", () => {
    expect(RNA_SEQ_REQUIRED_PACKAGES).toEqual([
      "jsonlite",
      "DESeq2",
      "edgeR",
      "SummarizedExperiment",
      "matrixStats",
      "ComplexHeatmap",
      "circlize",
      "RColorBrewer",
      "viridisLite",
      "ggplot2",
      "ggrepel",
      "ragg",
    ]);
  });

  it("exposes the additional-plot boolean keys with labels", () => {
    expect(ADDITIONAL_BOOLEAN_KEYS).toContain("library_size");
    expect(ADDITIONAL_BOOLEAN_KEYS).toContain("deg_matrix");
    for (const key of ADDITIONAL_BOOLEAN_KEYS) {
      expect(ADDITIONAL_BOOLEAN_LABEL_KEYS[key]).toMatch(/^rnaseq\./);
    }
  });
});
