import type { QpcrPlotRunConfig } from "../../lib/contracts/generated/qpcr/QpcrPlotRunConfig.js";

/**
 * Plot-run config assembly. The defaults mirror the Rust
 * `QpcrPlotRunConfig` Default (src-tauri/crates/mynx-contracts/src/qpcr.rs),
 * which itself mirrors the legacy QpcrPlotter initial bar/heatmap settings;
 * the UI edits drafts of this config and overrides only file/sheet/output
 * plumbing per run.
 */

/**
 * Mirror of the Rust `Default` impl — keep field-for-field identical.
 */
export const DEFAULT_PLOT_CONFIG: Readonly<QpcrPlotRunConfig> = {
  filePath: "",
  sheetName: "",
  outputDir: "",
  outputPrefix: "qpcr-barplot",
  kind: "bar",
  format: "png",
  width: 5,
  height: 4,
  dpi: 300,
  gene: "ALL",
  barFill: "#0000ff",
  barBorder: "black",
  barBorderWidth: 0.3,
  barWidth: 0,
  errorWidth: 0.5,
  errorCap: 0.15,
  errorColor: "#111827",
  showRawPoints: false,
  showXTick: false,
  xAngle: 45,
  xHjust: 1,
  xVjust: 1,
  tickLength: 3,
  axisWidth: 0.5,
  titleSize: 26,
  yLabelSize: 15,
  yTickSize: 13,
  xTickSize: 9,
  titleVjust: 1,
  baseSize: 11,
  xLabel: "",
  yLabel: "Relative expression",
  wrapPlus: false,
  scientificNotation: true,
  autoSize: false,
  batchMode: false,
  enableStats: true,
  showStats: true,
  sigMode: "vs_first",
  controlGroup: "",
  statTest: "auto",
  pAdjustMethod: "holm",
  labelStyle: "p.signif",
  showNs: true,
  sigFile: "statistical_analysis_summary.csv",
  bracketWidth: 0.35,
  bracketTextSize: 6,
  bracketLabelGap: 0.18,
  bracketStep: 0.12,
  customPairs: [],
  heatmapScale: "row",
  heatmapPalette: "blue-white-red",
  exportPng: true,
  exportPdf: false,
  pngDpi: 300,
  pdfWidth: 7,
  pdfHeight: 6,
  pngWidth: 4,
  pngHeight: 2,
  heatmapClusterRows: false,
  heatmapClusterCols: false,
  showCellValues: false,
  cellTextSize: 3.2,
  cellTextBold: true,
  zlim: 2,
  heatmapTitle: "",
  legendTitle: "Z-score",
  legendPosition: "right",
  showRowNames: true,
  showColNames: true,
  rowLabelItalic: true,
  axisTitleSize: 11,
  tileBorder: "#FFFFFF",
  tileBorderWidth: 0.25,
  useGeneClusters: false,
  geneClusters: {},
  installMissing: true,
};

/**
 * Heatmap-tab draft overrides: the shared Rust default carries bar values
 * for the fields the two tabs disagree on (legacy initialHeatmap).
 */
const HEATMAP_DRAFT_OVERRIDES = {
  kind: "heatmap",
  outputPrefix: "qpcr-heatmap",
  width: 7,
  height: 6,
  baseSize: 10,
} as const;

/** Fresh editable bar draft (barBorder normalized to hex for color inputs). */
export function makeBarDraft(): QpcrPlotRunConfig {
  return {
    ...DEFAULT_PLOT_CONFIG,
    // Same rendered color as the Rust "black" default, as `#RRGGBB` so the
    // native color input accepts it.
    barBorder: "#000000",
  };
}

/** Fresh editable heatmap draft. */
export function makeHeatmapDraft(): QpcrPlotRunConfig {
  return { ...DEFAULT_PLOT_CONFIG, ...HEATMAP_DRAFT_OVERRIDES, geneClusters: {} };
}

/** Per-gene functional cluster preset (legacy `CLUSTER_PRESET`), always sent. */
export const GENE_CLUSTER_PRESET: Readonly<Record<string, string[]>> = {
  RPE_Identity_Markers: ["MITF"],
  "ChP_Secretory_&_Transport": ["TTR", "PRLR"],
  "ChP_&_Dorsal_Progenitors": ["OTX2", "LMX1A", "MSX1"],
  "Forebrain_&_Cortex_Markers": ["EMX1", "FOXG1"],
  "Eye_&_Forebrain_Progenitors": ["PAX6", "RAX", "LHX2"],
  Stem_Cell_Pluripotency: ["NANOG"],
  Neural_Crest_Markers: ["SOX10"],
  "Early_Germ_Layer_&_Signal": ["TBXT"],
};

export interface PlotConfigInputs {
  draft: QpcrPlotRunConfig;
  filePath: string;
  sheetName: string;
  outputDir: string;
  installMissing: boolean;
  /** First group name, used when the draft leaves controlGroup blank. */
  fallbackControlGroup: string;
}

/** Injects per-run plumbing into a draft; everything else passes verbatim. */
export function buildPlotConfig(inputs: PlotConfigInputs): QpcrPlotRunConfig {
  return {
    ...inputs.draft,
    filePath: inputs.filePath,
    sheetName: inputs.sheetName,
    outputDir: inputs.outputDir,
    installMissing: inputs.installMissing,
    controlGroup: inputs.draft.controlGroup || inputs.fallbackControlGroup,
    geneClusters: { ...GENE_CLUSTER_PRESET },
  };
}

/** Legacy `parentFolder`: directory part of a Windows/POSIX path. */
export function parentFolder(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (separator < 0) return "";
  // Keep "C:/" drive roots intact.
  if (separator === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, separator);
}

/** Legacy `safeNumber`: NaN-safe numeric input fallback. */
export function safeNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}
