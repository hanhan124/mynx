import type { Comparison } from "../../lib/contracts/generated/rnaseq/Comparison.js";
import type { DeSummaryRow } from "../../lib/contracts/generated/rnaseq/DeSummaryRow.js";
import type { ImportData } from "../../lib/contracts/generated/rnaseq/ImportData.js";
import type { ImportRequest } from "../../lib/contracts/generated/rnaseq/ImportRequest.js";
import type { MatrixFormat } from "../../lib/contracts/generated/rnaseq/MatrixFormat.js";
import type { ResultFileItem } from "../../lib/contracts/generated/rnaseq/ResultFileItem.js";
import type { RunDirEntry } from "../../lib/contracts/generated/rnaseq/RunDirEntry.js";
import type { RunResult } from "../../lib/contracts/generated/rnaseq/RunResult.js";
import type { RnaSeqConfig } from "../../lib/contracts/generated/rnaseq/RnaSeqConfig.js";
import type { RDependencyStatus } from "../../lib/contracts/generated/r/RDependencyStatus.js";
import type { LogLine } from "../../lib/contracts/generated/task/LogLine.js";
import type { TaskRecord } from "../../lib/contracts/generated/task/TaskRecord.js";
import { SvelteSet } from "svelte/reactivity";
import { app, pushToast } from "../../app/state.svelte";
import { localizeErrorMessage, t } from "../../app/i18n.svelte";
import { rCheckDependencies, rInstallPackages, tasksList } from "../../app/tauri.js";
import {
  RNASEQ_WIRE_VERSION,
  defaultConfigSavePath,
  defaultOutputBase,
  onRInstallLog,
  pickOpenDir,
  pickOpenFile,
  pickSaveFile,
  readTextFileAt,
  rnaseqCancel,
  rnaseqDefaultConfig,
  rnaseqImportCounts,
  rnaseqListResultFiles,
  rnaseqListRuns,
  rnaseqLoadParams,
  rnaseqMergeConfig,
  rnaseqReadDeSummary,
  rnaseqRun,
  writeTextFileAt,
} from "./client.js";
import {
  RNA_SEQ_REQUIRED_PACKAGES,
  autoComparisonName,
  baseName,
  cleanGeneClusters,
  cleanGeneList,
  joinPath,
  parentDir,
  validComparisonsOf,
} from "./model.js";

/**
 * RNA-seq page state (runes). Ported from the legacy RnaSeqPage/store/
 * ImportStep/DesignStep/PlotsStep behavior: config collection against the
 * params.json contract, counts import, engine runs with channel logs and
 * cancellation, result gallery/history reload and config JSON IO.
 *
 * `config` starts as an inert placeholder and is replaced by the Rust
 * `rnaseq_default_config()` on init (defaults come from Rust); the page
 * gates rendering on `configReady`.
 */

export type PhaseState = "idle" | "running" | "success" | "error" | "cancelled";

export type StepId = "import" | "design" | "plots" | "results" | "history";

/** Run lifecycle mirror of the legacy state machine (RunStatus). */
export type RunPhase = "idle" | "running" | "done" | "failed" | "cancelled";

const LOG_CAP = 2000;

export interface RnaSeqState {
  /** Rust default config has been applied. */
  configReady: boolean;
  config: RnaSeqConfig;
  // Import
  importPhase: PhaseState;
  importMessage: string;
  importData: ImportData | null;
  importSourcePath: string;
  matrixFormat: MatrixFormat;
  // Run
  status: RunPhase;
  logs: LogLine[];
  jobId: number | null;
  // Results
  resultDir: string;
  hasResult: boolean;
  deSummary: DeSummaryRow[];
  resultFiles: ResultFileItem[];
  // History
  history: RunDirEntry[];
  historyPhase: PhaseState;
  // R packages
  rDeps: RDependencyStatus | null;
  installPhase: PhaseState;
  installLogs: LogLine[];
  installJobId: number | null;
  // UI
  step: StepId;
  tutorialOpen: boolean;
  /** Sample selected for the click-to-assign alternative. */
  selectedSample: string;
  dragOver: boolean;
}

/** Placeholder config before the Rust default arrives (never rendered). */
function placeholderConfig(): RnaSeqConfig {
  return {
    data_file: "",
    output_dir: "",
    run_name: "auto",
    sample_labels: {},
    batch: {},
    overall_genes: [],
    gene_clusters: {},
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
      filter: { method: "filterByExpr", min_count: 10, min_total_count: 15, min_samples: 2 },
    },
    comparisons: [],
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

export const rnaseq = $state<RnaSeqState>({
  configReady: false,
  config: placeholderConfig(),
  importPhase: "idle",
  importMessage: "",
  importData: null,
  importSourcePath: "",
  matrixFormat: "counts_matrix",
  status: "idle",
  logs: [],
  jobId: null,
  resultDir: "",
  hasResult: false,
  deSummary: [],
  resultFiles: [],
  history: [],
  historyPhase: "idle",
  rDeps: null,
  installPhase: "idle",
  installLogs: [],
  installJobId: null,
  step: "import",
  tutorialOpen: false,
  selectedSample: "",
  dragOver: false,
});

/* ---------------------------------------------------------------------------
 * Derived helpers
 * ------------------------------------------------------------------------- */

function detailOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Rust validation messages arrive in zh; localize for the en UI. */
function localizedError(err: unknown): string {
  const message = detailOf(err);
  return localizeErrorMessage(message, app.language) || message;
}

/** Direct config mutation (proxy keeps nested reactivity). */
export function updateConfig(mutator: (draft: RnaSeqConfig) => void): void {
  mutator(rnaseq.config);
}

/** Rust default config snapshot, captured on init for restore fallbacks. */
let defaultConfigSnapshot: RnaSeqConfig | null = null;

let initialized = false;

/** Idempotent init: fetch the Rust default config and check R packages. */
export async function initRnaseq(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const config = await rnaseqDefaultConfig();
    defaultConfigSnapshot = $state.snapshot(config);
    rnaseq.config = config;
    rnaseq.configReady = true;
    void checkRDependencies();
  } catch (err) {
    initialized = false;
    pushToast("error", localizedError(err));
  }
}

/** True when a counts file has been imported successfully. */
export function importReady(): boolean {
  return (
    !!rnaseq.config.data_file &&
    rnaseq.config.data_file === rnaseq.config.input.count_file &&
    rnaseq.importData !== null
  );
}

/** Minimum group size across non-empty groups (Infinity when none). */
export function minGroupN(): number {
  const sizes = Object.values(rnaseq.config.groups)
    .filter((g) => g.length > 0)
    .map((g) => g.length);
  if (sizes.length === 0) return Infinity;
  return Math.min(...sizes);
}

/** Samples known to the page: import columns first, group members fallback. */
export function allSamples(): string[] {
  const cols = rnaseq.importData?.sampleCols;
  if (cols && cols.length > 0) return cols;
  return Object.values(rnaseq.config.groups).flat();
}

/** Samples not yet assigned to any group. */
export function poolSamples(): string[] {
  // SvelteSet keeps the reactivity lint happy; the set is inert bookkeeping.
  const assigned = new SvelteSet(Object.values(rnaseq.config.groups).flat());
  return allSamples().filter((s) => !assigned.has(s));
}

/* ---------------------------------------------------------------------------
 * Import (step 1)
 * ------------------------------------------------------------------------- */

/**
 * Imports a counts file via `rnaseq_import_counts` and points the config at
 * the normalized cache. Throws on failure so call sites decide the toast.
 */
export async function importCounts(path: string, fmt?: MatrixFormat): Promise<ImportData> {
  const useFmt: MatrixFormat = fmt ?? rnaseq.matrixFormat;
  rnaseq.matrixFormat = useFmt;
  rnaseq.importPhase = "running";
  rnaseq.importMessage = t("rnaseq.importing");
  try {
    const input = rnaseq.config.input;
    const request: ImportRequest = {
      v: RNASEQ_WIRE_VERSION,
      path,
      matrixFormat: useFmt,
      geneCol: input.gene_col > 0 ? input.gene_col : 1,
      dropEmptyGene: input.drop_empty_gene,
      duplicateGenes: input.duplicate_genes,
      rounding: input.rounding,
      writeNormalizedCsv: true,
    };
    const data = await rnaseqImportCounts(request);
    rnaseq.importData = data;
    const actual = data.dataFile || path;
    rnaseq.config.data_file = actual;
    rnaseq.config.input.count_file = actual;
    rnaseq.importSourcePath = data.sourceFile || path;
    if (data.matrixFormatApplied) rnaseq.matrixFormat = data.matrixFormatApplied;
    rnaseq.importPhase = "success";
    rnaseq.importMessage = "";
    return data;
  } catch (err) {
    rnaseq.importPhase = "error";
    rnaseq.importMessage = detailOf(err);
    throw err;
  }
}

/** Warnings from the latest import (display helper; empty when none). */
export function importWarnings(): string[] {
  return rnaseq.importData?.warnings ?? [];
}

/** Label for the applied matrix format chip. */
export function appliedFormatLabel(): string {
  const applied = rnaseq.importData?.matrixFormatApplied;
  if (applied === "featurecounts") return "featureCounts";
  if (applied === "htseq") return "HTSeq";
  return t("rnaseq.fmtMatrix");
}

/* ---------------------------------------------------------------------------
 * Groups editor (step 2)
 * ------------------------------------------------------------------------- */

/** Appends an empty group named Group<n> and returns its name. */
export function addGroup(): string {
  const groups = rnaseq.config.groups;
  let i = Object.keys(groups).length + 1;
  while (groups[`Group${i}`]) i += 1;
  const name = `Group${i}`;
  groups[name] = [];
  return name;
}

/** Renames a group in place (order preserved) and syncs comparisons. */
export function renameGroup(oldName: string, nextName: string): void {
  const name = nextName.trim();
  const cfg = rnaseq.config;
  if (!name || name === oldName) return;
  if (cfg.groups[name]) {
    pushToast("error", t("rnaseq.errGroupExists"));
    return;
  }
  const next: Record<string, string[]> = {};
  for (const [key, samples] of Object.entries(cfg.groups)) {
    next[key === oldName ? name : key] = samples;
  }
  cfg.groups = next;
  cfg.comparisons = cfg.comparisons.map((c) => ({
    ...c,
    case: c.case === oldName ? name : c.case,
    control: c.control === oldName ? name : c.control,
  }));
}

/** Removes a group plus every comparison referencing it. */
export function removeGroup(name: string): void {
  delete rnaseq.config.groups[name];
  rnaseq.config.comparisons = rnaseq.config.comparisons.filter(
    (c) => c.case !== name && c.control !== name,
  );
}

/** Number of comparisons referencing a group (delete confirmation copy). */
export function comparisonsUsingGroup(name: string): number {
  return rnaseq.config.comparisons.filter((c) => c.case === name || c.control === name)
    .length;
}

/**
 * Moves a sample into a group (removes it from every other group first, so
 * a sample lives in at most one group — the legacy pool UX invariant).
 */
export function assignSample(sample: string, target: string): void {
  const groups = rnaseq.config.groups;
  if (!target || !(target in groups)) return;
  for (const key of Object.keys(groups)) {
    groups[key] = groups[key].filter((s) => s !== sample);
  }
  groups[target] = [...(groups[target] ?? []), sample];
}

/** Removes a sample from every group (back to the pool). */
export function unassignSample(sample: string): void {
  const groups = rnaseq.config.groups;
  for (const key of Object.keys(groups)) {
    groups[key] = groups[key].filter((s) => s !== sample);
  }
}

/* ---------------------------------------------------------------------------
 * Batch covariate editor (step 2)
 * ------------------------------------------------------------------------- */

export function addBatch(): void {
  const batch = rnaseq.config.batch;
  let i = Object.keys(batch).length + 1;
  while (batch[`Batch${i}`]) i += 1;
  batch[`Batch${i}`] = [];
}

export function renameBatch(oldName: string, nextName: string): void {
  const name = nextName.trim();
  const batch = rnaseq.config.batch;
  if (!name || name === oldName || batch[name]) return;
  const next: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(batch)) {
    next[key === oldName ? name : key] = value;
  }
  rnaseq.config.batch = next;
}

export function removeBatch(name: string): void {
  const next: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rnaseq.config.batch)) {
    if (key !== name) next[key] = value;
  }
  rnaseq.config.batch = next;
}

/** Exclusive sample membership: toggling a batch pulls the sample from others. */
export function toggleBatchSample(batch: string, sample: string): void {
  const next: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rnaseq.config.batch)) {
    next[key] = value.filter((s) => s !== sample);
  }
  const members = next[batch] ?? [];
  if (!members.includes(sample)) members.push(sample);
  next[batch] = members;
  rnaseq.config.batch = next;
}

/** Grouped samples that have no batch yet ("" when batches unset). */
export function missingBatchSamples(): string[] {
  const cfg = rnaseq.config;
  const batch = cfg.batch ?? {};
  if (Object.keys(batch).length === 0) return [];
  const grouped = new SvelteSet(Object.values(cfg.groups).flat());
  const assigned = new SvelteSet(Object.values(batch).flat());
  return [...grouped].filter((s) => !assigned.has(s));
}

/* ---------------------------------------------------------------------------
 * Comparisons editor (step 2)
 * ------------------------------------------------------------------------- */

export function addComparison(): void {
  rnaseq.config.comparisons.push({ name: "", case: "", control: "", mode: "auto" });
}

/** Applies a patch; regenerates the auto name when case/control changed. */
export function updateComparison(index: number, patch: Partial<Comparison>): void {
  const c = rnaseq.config.comparisons[index];
  if (!c) return;
  const prev = { ...c };
  Object.assign(c, patch);
  if (patch.case !== undefined || patch.control !== undefined) {
    if (!c.name || c.name === autoComparisonName(prev)) {
      c.name = autoComparisonName(c);
    }
  }
}

export function removeComparison(index: number): void {
  rnaseq.config.comparisons.splice(index, 1);
}

/* ---------------------------------------------------------------------------
 * Run machine
 * ------------------------------------------------------------------------- */

/** Legacy pre-run validation order; returns the i18n key of the first failure. */
export function runValidationFailure(steps: string[]): string | null {
  const cfg = rnaseq.config;
  if (!cfg.data_file) return "rnaseq.errDataRequired";
  if (steps.includes("de")) {
    if (validComparisonsOf(cfg).length === 0) return "rnaseq.errComparisonsRequired";
    if (missingBatchSamples().length > 0) return "rnaseq.errBatchIncomplete";
  }
  return null;
}

function appendLog(line: LogLine): void {
  rnaseq.logs.push(line);
  if (rnaseq.logs.length > LOG_CAP) {
    rnaseq.logs.splice(0, rnaseq.logs.length - LOG_CAP);
  }
}

/** Whether the run name asks for a fresh timestamped folder per run. */
function isAutoRunName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed === "" || trimmed.toLowerCase() === "auto";
}

/** `run_YYYYMMDD_HHMMSS` in local time (one folder per run). */
// A one-off timestamp read, never rendered or mutated: no SvelteDate needed.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
export function autoRunName(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `run_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/**
 * Loads the folder this run actually wrote (as reported by the runner, never
 * "the newest folder", which could belong to another run). An `auto` name
 * stays `auto` so the next run gets its own folder again.
 */
async function finishSuccessfulRun(result: RunResult, outputBase: string, keepAuto: boolean): Promise<void> {
  rnaseq.config.output_dir = outputBase;
  if (!keepAuto && result.runName) rnaseq.config.run_name = result.runName;
  await readResultData(result.outputDir);
}

/**
 * Runs the engine with the selected steps. The config snapshot carries the
 * `steps` field exactly like the legacy runner did.
 */
export async function startRun(steps: string[]): Promise<void> {
  if (rnaseq.status === "running") return;
  const failure = runValidationFailure(steps);
  if (failure) {
    pushToast("error", t(failure));
    return;
  }
  rnaseq.logs = [];
  rnaseq.status = "running";
  rnaseq.jobId = null;
  const auto = isAutoRunName(rnaseq.config.run_name);
  const runCfg: RnaSeqConfig = {
    ...$state.snapshot(rnaseq.config),
    run_name: auto ? autoRunName() : rnaseq.config.run_name.trim(),
    steps,
  };
  try {
    const result = await rnaseqRun(runCfg, steps, appendLog);
    rnaseq.status =
      result.status === "done" ? "done" : result.status === "cancelled" ? "cancelled" : "failed";
    if (result.status === "done") {
      const outputBase = runCfg.output_dir.trim() || (await defaultOutputBase());
      await finishSuccessfulRun(result, outputBase, auto);
      pushToast("success", t("rnaseq.runDoneToast"));
    } else if (result.status === "cancelled") {
      pushToast("info", t("rnaseq.runCancelledToast"));
    } else {
      pushToast("error", t("rnaseq.runFailedToast", { code: result.exitCode }));
    }
  } catch (err) {
    appendLog({
      v: RNASEQ_WIRE_VERSION,
      tsMs: Date.now(),
      level: "error",
      message: detailOf(err),
    });
    rnaseq.status = "failed";
    pushToast("error", localizedError(err));
  }
}

function newestRunningRunJob(tasks: readonly TaskRecord[]): number | null {
  let best: TaskRecord | null = null;
  for (const task of tasks) {
    if (task.kind !== "rnaseqRun") continue;
    if (task.status !== "running" && task.status !== "queued") continue;
    if (!best || task.id > best.id) best = task;
  }
  return best ? best.id : null;
}

/** Resolves the running run job id (task center first, list fallback). */
export async function resolveRunJobId(): Promise<number | null> {
  const reactive = newestRunningRunJob(app.tasks);
  if (reactive !== null) return reactive;
  try {
    return newestRunningRunJob(await tasksList());
  } catch {
    return null;
  }
}

export async function cancelRun(): Promise<void> {
  const jobId = await resolveRunJobId();
  if (jobId === null) return;
  rnaseq.jobId = jobId;
  try {
    await rnaseqCancel(jobId);
  } catch {
    // The run may already be finished; the terminal result decides the UI.
  }
}

/** Toggles the click-to-assign sample selection (keyboard-friendly path). */
export function selectSample(sample: string): void {
  rnaseq.selectedSample = rnaseq.selectedSample === sample ? "" : sample;
}

/**
 * Legacy step gating: everything except import/history needs a data file,
 * plots additionally need a loaded DE result.
 */
export function goStep(step: StepId): boolean {
  if (step !== "import" && step !== "history" && !rnaseq.config.data_file) {
    pushToast("info", t("rnaseq.goImportFirst"));
    return false;
  }
  if (step === "plots" && !rnaseq.hasResult) {
    pushToast("info", t("rnaseq.plotsNeedResult"));
    return false;
  }
  rnaseq.step = step;
  rnaseq.selectedSample = "";
  if (step === "history") void loadHistory();
  if (step === "results") void refreshResult();
  return true;
}

/* ---------------------------------------------------------------------------
 * Results
 * ------------------------------------------------------------------------- */

/**
 * Reads DE summary + result files for a run directory. A directory counts
 * as a run result when it yields any image or a DE_summary table.
 */
async function readResultData(dir: string): Promise<boolean> {
  rnaseq.resultDir = dir;
  let files: ResultFileItem[];
  let summary: DeSummaryRow[] | null;
  try {
    files = await rnaseqListResultFiles(dir);
  } catch {
    files = [];
  }
  try {
    summary = await rnaseqReadDeSummary(dir);
  } catch {
    summary = null;
  }
  rnaseq.resultFiles = files;
  rnaseq.deSummary = summary ?? [];
  rnaseq.hasResult = files.length > 0 || summary !== null;
  return rnaseq.hasResult;
}

/** Current run dir: explicit dir first, then output_dir + run_name. */
export function currentRunDirCandidate(): string {
  if (rnaseq.resultDir) return rnaseq.resultDir;
  const cfg = rnaseq.config;
  if (cfg.output_dir && cfg.run_name && cfg.run_name !== "auto") {
    return joinPath(cfg.output_dir, cfg.run_name);
  }
  return "";
}

/** Re-reads the current run directory (no validation toast). */
export async function refreshResult(): Promise<boolean> {
  const dir = currentRunDirCandidate();
  if (!dir) {
    rnaseq.hasResult = false;
    rnaseq.deSummary = [];
    rnaseq.resultFiles = [];
    return false;
  }
  return readResultData(dir);
}

/**
 * Loads an engine run directory: reads the results, forces
 * `output_dir`/`run_name` from the picked path and restores the config from
 * prepared/params.json via the Rust merge (legacy loadResultDir).
 */
export async function loadResultDir(path: string): Promise<boolean> {
  const p = (path || "").trim();
  if (!p) return false;
  const ok = await readResultData(p);
  if (!ok) {
    rnaseq.resultDir = "";
    pushToast("error", t("rnaseq.errNotRunDir"));
    return false;
  }
  const norm = p.replace(/[\\/]+$/, "");
  const runName = baseName(norm);
  const baseDir = parentDir(norm);
  let paramsLoaded = false;
  try {
    const params = await rnaseqLoadParams(p);
    const snapshot = $state.snapshot(params) as RnaSeqConfig & { steps?: string[] | null };
    // Runtime steps are never restored (legacy mergeRunParams).
    const { steps: _steps, ...rest } = snapshot;
    void _steps;
    rnaseq.config = await rnaseqMergeConfig({ ...rest, output_dir: baseDir, run_name: runName });
    cleanLoadedConfig();
    paramsLoaded = true;
  } catch {
    // No params.json: keep the current config (legacy info toast).
  }
  rnaseq.config.output_dir = baseDir;
  rnaseq.config.run_name = runName;
  pushToast(
    paramsLoaded ? "success" : "info",
    t(paramsLoaded ? "rnaseq.resultLoaded" : "rnaseq.resultLoadedNoParams"),
  );
  return true;
}

/* ---------------------------------------------------------------------------
 * History
 * ------------------------------------------------------------------------- */

/** Lists run directories under the current output base (newest first). */
export async function loadHistory(): Promise<void> {
  if (rnaseq.historyPhase === "running") return;
  rnaseq.historyPhase = "running";
  try {
    const base = rnaseq.config.output_dir.trim() || (await defaultOutputBase());
    rnaseq.history = await rnaseqListRuns(base);
    rnaseq.historyPhase = "success";
  } catch (err) {
    rnaseq.history = [];
    rnaseq.historyPhase = "error";
    pushToast("error", localizedError(err));
  }
}

/**
 * Legacy mergeConfig cleanup: cleaned gene lists plus the Rust-default
 * fallbacks for empty marker genes / gene clusters.
 */
function cleanLoadedConfig(): void {
  const cfg = rnaseq.config;
  cfg.overall_genes = cleanGeneList(cfg.overall_genes);
  cfg.overall_heatmap.marker_genes = cleanGeneList(cfg.overall_heatmap.marker_genes);
  cfg.gene_clusters = cleanGeneClusters(cfg.gene_clusters);
  const defaults = defaultConfigSnapshot;
  if (defaults) {
    if (cfg.overall_heatmap.marker_genes.length === 0) {
      cfg.overall_heatmap.marker_genes = [...defaults.overall_heatmap.marker_genes];
    }
    if (Object.keys(cfg.gene_clusters).length === 0) {
      cfg.gene_clusters = { ...defaults.gene_clusters };
    }
  }
}

/* ---------------------------------------------------------------------------
 * Config IO (save/load JSON)
 * ------------------------------------------------------------------------- */

/** Saves the config JSON (runtime `steps` stripped, legacy parity). */
export async function saveConfigToDialog(): Promise<void> {
  const target = await pickSaveFile({
    defaultPath: await defaultConfigSavePath(),
    filters: [{ name: t("rnaseq.jsonFilter"), extensions: ["json"] }],
  });
  if (!target) return;
  try {
    const snapshot = $state.snapshot(rnaseq.config) as RnaSeqConfig & {
      steps?: string[] | null;
    };
    const { steps: _steps, ...serializable } = snapshot;
    void _steps;
    await writeTextFileAt(target, JSON.stringify(serializable, null, 2));
    pushToast("success", t("rnaseq.configSaved", { path: target }));
  } catch (err) {
    pushToast("error", detailOf(err));
  }
}

/** Loads a config JSON: merge over defaults, then re-import the data file. */
export async function loadConfigFromDialog(): Promise<void> {
  const picked = await pickOpenFile({
    filters: [{ name: t("rnaseq.jsonFilter"), extensions: ["json"] }],
  });
  if (!picked) return;
  try {
    const text = await readTextFileAt(picked);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    rnaseq.config = await rnaseqMergeConfig(parsed);
    cleanLoadedConfig();
    const input = parsed.input as Record<string, unknown> | undefined;
    const df = typeof parsed.data_file === "string" ? parsed.data_file : "";
    const cf =
      input && typeof input.count_file === "string" ? (input.count_file as string) : "";
    if (df || cf) {
      try {
        await importCounts(df || cf);
      } catch {
        pushToast("info", t("rnaseq.configImportFailed"));
      }
    }
    pushToast("success", t("rnaseq.configLoaded"));
  } catch (err) {
    pushToast("error", detailOf(err));
  }
}

/* ---------------------------------------------------------------------------
 * Output dir picker
 * ------------------------------------------------------------------------- */

export async function pickOutputDir(): Promise<void> {
  const picked = await pickOpenDir({
    defaultPath: rnaseq.config.output_dir || undefined,
  });
  if (picked) rnaseq.config.output_dir = picked;
}

/* ---------------------------------------------------------------------------
 * R dependencies
 * ------------------------------------------------------------------------- */

export async function checkRDependencies(): Promise<void> {
  try {
    rnaseq.rDeps = await rCheckDependencies(RNA_SEQ_REQUIRED_PACKAGES);
  } catch {
    rnaseq.rDeps = null;
  }
}

function appendInstallLog(line: LogLine): void {
  rnaseq.installLogs.push(line);
  if (rnaseq.installLogs.length > LOG_CAP) {
    rnaseq.installLogs.splice(0, rnaseq.installLogs.length - LOG_CAP);
  }
}

/** Installs the missing engine packages; logs stream on mynx://r-install-log. */
export async function installMissingPackages(): Promise<void> {
  if (rnaseq.installPhase === "running") return;
  rnaseq.installPhase = "running";
  rnaseq.installLogs = [];
  rnaseq.installJobId = null;
  const unlisten = await onRInstallLog(appendInstallLog).catch(() => null);
  try {
    const taskId = await rInstallPackages(RNA_SEQ_REQUIRED_PACKAGES);
    rnaseq.installJobId = taskId;
    rnaseq.installPhase = "success";
    pushToast("success", t("rnaseq.rInstallDone"));
  } catch (err) {
    rnaseq.installPhase = "error";
    pushToast("error", t("rnaseq.rInstallFailed", { detail: localizedError(err) }));
  } finally {
    unlisten?.();
    void checkRDependencies();
  }
}
