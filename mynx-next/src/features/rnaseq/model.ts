import type { Comparison } from "../../lib/contracts/generated/rnaseq/Comparison.js";
import type { MatrixFormat } from "../../lib/contracts/generated/rnaseq/MatrixFormat.js";
import type { RnaSeqConfig } from "../../lib/contracts/generated/rnaseq/RnaSeqConfig.js";

/**
 * Pure model helpers for the RNA-seq page. Ported from the legacy
 * `features/rnaseq/model/validation.ts` and `lib/rnaseq/defaults.ts`
 * (config cleaning, comparison naming) plus the display-only catalogs
 * the legacy pages kept inline. No side effects — everything here is
 * unit-testable without Tauri.
 */

/** R packages the RNA-seq engine requires (legacy RNA_SEQ_REQUIRED_PACKAGES). */
export const RNA_SEQ_REQUIRED_PACKAGES: string[] = [
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
];

/** Continuous palettes (heatmap Z-scores / correlation). */
export const HEAT_PALETTES: string[] = [
  "RdBu",
  "RdYlBu",
  "PiYG",
  "PRGn",
  "BrBG",
  "PuOr",
  "RdGy",
  "Spectral",
  "viridis",
  "magma",
  "inferno",
  "plasma",
  "cividis",
  "rocket",
  "mako",
  "turbo",
];

/** Discrete palettes (group / gene-cluster annotation). */
export const DISCRETE_PALETTES: string[] = [
  "Set2",
  "Dark2",
  "Set1",
  "Set3",
  "Paired",
  "Pastel1",
  "npg",
];

/** Sample-chip colors per group index (legacy GROUP_COLORS). */
export const GROUP_COLORS: string[] = [
  "#0a84ff",
  "#af52de",
  "#ff375f",
  "#ff9f0a",
  "#30d158",
  "#64d2ff",
  "#bf5af2",
  "#ffd60a",
];

/** Export formats offered for the ggplot figures. */
export const EXPORT_FORMATS: string[] = ["png", "pdf"];

/** Boolean switches on `plots.additional` rendered as checkboxes. */
export const ADDITIONAL_BOOLEAN_KEYS = [
  "library_size",
  "expression_distribution",
  "sample_distance",
  "mds",
  "ma",
  "deg_summary",
  "deg_dotplot",
  "deg_matrix",
  "upset",
  "gene_expression",
] as const;

export type AdditionalBooleanKey = (typeof ADDITIONAL_BOOLEAN_KEYS)[number];

/** i18n keys for the additional-plot checkboxes (same order as the keys). */
export const ADDITIONAL_BOOLEAN_LABEL_KEYS: Record<AdditionalBooleanKey, string> = {
  library_size: "rnaseq.addLibSize",
  expression_distribution: "rnaseq.addExprDist",
  sample_distance: "rnaseq.addSampleDistance",
  mds: "rnaseq.addMds",
  ma: "rnaseq.addMa",
  deg_summary: "rnaseq.addDegSummary",
  deg_dotplot: "rnaseq.addDegDotplot",
  deg_matrix: "rnaseq.addDegMatrix",
  upset: "rnaseq.addUpset",
  gene_expression: "rnaseq.addGeneExpression",
};

/** Matrix-format presets (legacy FMT_CARDS). */
export const MATRIX_FORMATS: Array<{
  id: MatrixFormat;
  labelKey: string;
  subKey: string;
}> = [
  {
    id: "counts_matrix",
    labelKey: "rnaseq.fmtMatrix",
    subKey: "rnaseq.fmtMatrixSub",
  },
  {
    id: "featurecounts",
    labelKey: "rnaseq.fmtFeaturecounts",
    subKey: "rnaseq.fmtFeaturecountsSub",
  },
  { id: "htseq", labelKey: "rnaseq.fmtHtseq", subKey: "rnaseq.fmtHtseqSub" },
];

/** Currently runnable comparisons: distinct non-empty configured groups. */
export function validComparisonsOf(config: RnaSeqConfig): Comparison[] {
  return (config.comparisons || []).filter(
    (c) =>
      !!c.case &&
      !!c.control &&
      c.case !== c.control &&
      !!config.groups[c.case]?.length &&
      !!config.groups[c.control]?.length,
  );
}

/** Comparison name → file-safe name (the engine uses it as file stem). */
export function sanitizeComparisonName(name: string): string {
  return name.trim().replace(/\s+/g, "_");
}

/** Auto comparison name from case/control (`case_vs_control`). */
export function autoComparisonName(c: Pick<Comparison, "case" | "control">): string {
  return sanitizeComparisonName(`${c.case}_vs_${c.control}`);
}

/** Windows/POSIX base name of a path. */
export function baseName(path: string): string {
  const norm = path.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** Windows/POSIX parent directory of a path ("" when there is none). */
export function parentDir(path: string): string {
  const norm = path.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(0, idx) : "";
}

/** Windows/POSIX path join for output-dir + segment composition. */
export function joinPath(base: string, ...parts: string[]): string {
  let out = base;
  for (const part of parts) {
    if (!part) continue;
    if (!out) {
      out = part;
      continue;
    }
    const last = out.charAt(out.length - 1);
    if (last === "/" || last === "\\") out += part;
    else out += (out.includes("\\") ? "\\" : "/") + part;
  }
  return out;
}

/** Clean a gene-name list: trims, strips wrapping quotes, de-duplicates. */
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

/** Parse a textarea value into a gene list (newlines and commas). */
export function parseGeneList(text: string): string[] {
  return cleanGeneList(text.split(/[\n,]/));
}

/** Clean a name → gene-list map; empty names/lists are dropped. */
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

/** Rename a record key while preserving insertion order ("" keeps nothing). */
export function renameMapKey<V>(
  record: Record<string, V>,
  oldName: string,
  nextName: string,
): Record<string, V> {
  const next: Record<string, V> = {};
  for (const [key, value] of Object.entries(record)) {
    next[key === oldName ? nextName : key] = value;
  }
  return next;
}

/** Human-readable size for the result gallery meta line. */
export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 KB";
  const kb = size / 1024;
  const fmt = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));
  if (kb < 1024) return `${fmt(kb)} KB`;
  return `${fmt(kb / 1024)} MB`;
}
