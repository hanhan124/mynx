import type { CalcMethod } from "../../lib/contracts/generated/qpcr/CalcMethod.js";
import type { CalcRequest } from "../../lib/contracts/generated/qpcr/CalcRequest.js";
import type { CalcResult } from "../../lib/contracts/generated/qpcr/CalcResult.js";
import type { QpcrChartSeries } from "../../lib/contracts/generated/qpcr/QpcrChartSeries.js";
import type { QpcrPlotRunConfig } from "../../lib/contracts/generated/qpcr/QpcrPlotRunConfig.js";
import type { QpcrPlotRunResult } from "../../lib/contracts/generated/qpcr/QpcrPlotRunResult.js";
import type { LogLine } from "../../lib/contracts/generated/task/LogLine.js";
import type { TaskRecord } from "../../lib/contracts/generated/task/TaskRecord.js";
import { SvelteSet } from "svelte/reactivity";
import { app, pushToast } from "../../app/state.svelte";
import { localizeErrorMessage, t } from "../../app/i18n.svelte";
import { tasksCancel, tasksList, settingsLoad } from "../../app/tauri.js";
import {
  listDir,
  qpcrCalculate,
  qpcrInjectCharts,
  qpcrPlotRun,
  qpcrTransform,
  replaceFileBytes,
  workerApplyPatch,
  workerCloseWorkbook,
  workerCommitWorkbook,
  workerExtractSheet,
  workerOpenWorkbook,
  workerReloadWorkbook,
  workerRenameGroups,
} from "./client.js";
import {
  buildPlotConfig,
  makeBarDraft,
  makeHeatmapDraft,
  parentFolder,
} from "./plot-config.js";
import {
  TRANSFORMED_SHEET,
  detectTransformedGenes,
  detectTransformedGroups,
  renamedGroupNames,
} from "./snapshot.js";

/**
 * qPCR page state (runes). Ported from the legacy QpcrPage/FileSelect/
 * Transform/Calculate/QpcrPlotter behavior: 3-step workbook pipeline
 * (file → transform → calculate) plus the R plot runner, with all xlsx
 * parsing delegated to the ExcelJS worker and all math to Rust.
 */

export type PhaseState = "idle" | "running" | "success" | "error" | "cancelled";

const TRANSFORMED_SHEET_NAME = TRANSFORMED_SHEET;
const LOG_CAP = 200;

export function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

/** Windows/POSIX path join for output-dir + file-name composition. */
export function joinPath(base: string, name: string): string {
  if (!base) return name;
  const last = base.charAt(base.length - 1);
  if (last === "/" || last === "\\") return base + name;
  return base + (base.includes("\\") ? "\\" : "/") + name;
}

function detailOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Rust validation messages arrive in zh; localize for the en UI. */
function localizedError(err: unknown): string {
  const message = detailOf(err);
  return localizeErrorMessage(message, app.language) || message;
}

/* ---------------------------------------------------------------------------
 * Calc form validation (mirrors legacy qpcr-calculate error ordering).
 * ------------------------------------------------------------------------- */

export interface CalcFormInput {
  repeatCount: number;
  refGene: string;
  method: CalcMethod;
  controlGroup: string;
  /** 0 = off. */
  selectNum: number;
  /** 0 = off. */
  outlierSd: number;
}

export interface ValidationFailure {
  key: string;
  values?: Record<string, string | number>;
}

/** First validation failure, or null when the form is runnable. */
export function validateCalcForm(form: CalcFormInput): ValidationFailure | null {
  if (!Number.isInteger(form.repeatCount) || form.repeatCount < 1) {
    return { key: "qpcr.errRepeatCount" };
  }
  if (!form.refGene.trim()) return { key: "qpcr.errRefGene" };
  if (form.method === "control-relative" && !form.controlGroup.trim()) {
    return { key: "qpcr.errControlRequired" };
  }
  if (
    form.selectNum !== 0 &&
    (!Number.isInteger(form.selectNum) || form.selectNum < 2)
  ) {
    return { key: "qpcr.errSelectNumRange" };
  }
  if (form.selectNum >= 2 && form.selectNum > form.repeatCount) {
    return {
      key: "qpcr.errSelectNumTooLarge",
      values: { selectNum: form.selectNum, repeatCount: form.repeatCount },
    };
  }
  if (form.outlierSd !== 0 && (!Number.isFinite(form.outlierSd) || form.outlierSd <= 0)) {
    return { key: "qpcr.errOutlierSd" };
  }
  if (form.selectNum >= 2 && form.outlierSd > 0) {
    return { key: "qpcr.errMutualExclusion" };
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Reactive state
 * ------------------------------------------------------------------------- */

export interface QpcrState {
  // Step 1: file
  loadPhase: PhaseState;
  loadMessage: string;
  filePath: string;
  fileName: string;
  /** Handle of the workbook held by the Excel worker (null = none open). */
  workbookHandle: number | null;
  /** Bumped whenever the workbook content changes (previews re-read it). */
  workbookRevision: number;
  sheetNames: string[];
  selectedSheet: string;
  // Step 2: transform
  transformPhase: PhaseState;
  transformMessage: string;
  geneNames: string[];
  groups: string[];
  groupRenames: Record<string, string>;
  groupRenamePhase: PhaseState;
  groupRenameMessage: string;
  // Step 3: calculate
  repeatCount: number;
  refGene: string;
  calcMethod: CalcMethod;
  controlGroup: string;
  selectNum: number;
  outlierSd: number;
  calcPhase: PhaseState;
  calcMessage: string;
  geneSheetNames: string[];
  chartSeries: QpcrChartSeries[];
  chartInjectPhase: PhaseState;
  chartInjectMessage: string;
  chartColor: string;
  // Step 4: plot
  plotKind: "bar" | "heatmap";
  plotBarDraft: QpcrPlotRunConfig;
  plotHeatDraft: QpcrPlotRunConfig;
  plotOutputDir: string;
  plotSheetName: string;
  installMissing: boolean;
  plotPhase: PhaseState;
  plotMessage: string;
  plotLogs: LogLine[];
  plotResult: QpcrPlotRunResult | null;
  jobId: number | null;
}

export const qpcr = $state<QpcrState>({
  loadPhase: "idle",
  loadMessage: "",
  filePath: "",
  fileName: "",
  workbookHandle: null,
  workbookRevision: 0,
  sheetNames: [],
  selectedSheet: "",
  transformPhase: "idle",
  transformMessage: "",
  geneNames: [],
  groups: [],
  groupRenames: {},
  groupRenamePhase: "idle",
  groupRenameMessage: "",
  repeatCount: 2,
  refGene: "",
  calcMethod: "ref-normalized",
  controlGroup: "",
  selectNum: 0,
  outlierSd: 0,
  calcPhase: "idle",
  calcMessage: "",
  geneSheetNames: [],
  chartSeries: [],
  chartInjectPhase: "idle",
  chartInjectMessage: "",
  chartColor: "#3C9FDF",
  plotKind: "bar",
  plotBarDraft: makeBarDraft(),
  plotHeatDraft: makeHeatmapDraft(),
  plotOutputDir: "",
  plotSheetName: "",
  installMissing: true,
  plotPhase: "idle",
  plotMessage: "",
  plotLogs: [],
  plotResult: null,
  jobId: null,
});

/* ---------------------------------------------------------------------------
 * Derived helpers
 * ------------------------------------------------------------------------- */

/** True when the loaded workbook already contains a Transformed Data sheet. */
export function hasTransformedData(): boolean {
  return qpcr.sheetNames.includes(TRANSFORMED_SHEET_NAME);
}

/** Reference gene as used by the run (falls back to the first gene). */
export function selectedRefGene(): string {
  return qpcr.refGene || qpcr.geneNames[0] || "";
}

/** Control group as used by the run (falls back to the first group). */
export function selectedControlGroup(): string {
  const available = effectiveGroupNames();
  if (available.includes(qpcr.controlGroup)) return qpcr.controlGroup;
  const original = qpcr.controlGroup;
  return (original && (qpcr.groupRenames[original]?.trim() || original)) || available[0] || "";
}

export function effectiveGroupNames(): string[] {
  return renamedGroupNames(qpcr.groups, qpcr.groupRenames);
}

export function pendingGroupRenameMap(): Record<string, string> {
  return Object.fromEntries(
    qpcr.groups
      .map((group) => [group, qpcr.groupRenames[group]?.trim() ?? ""] as const)
      .filter((entry): entry is readonly [string, string] => entry[1].length > 0 && entry[1] !== entry[0]),
  );
}

export function hasPendingGroupRenames(): boolean {
  return Object.keys(pendingGroupRenameMap()).length > 0;
}

export function setGroupRename(group: string, value: string): void {
  qpcr.groupRenames = { ...qpcr.groupRenames, [group]: value };
  qpcr.groupRenamePhase = "idle";
  qpcr.groupRenameMessage = "";
  qpcr.calcPhase = "idle";
  qpcr.calcMessage = "";
}

export function applyGroupRenameToSelected(groups: string[], value: string): void {
  if (!groups.length) return;
  const next = { ...qpcr.groupRenames };
  for (const group of groups) next[group] = value;
  qpcr.groupRenames = next;
  qpcr.groupRenamePhase = "idle";
  qpcr.groupRenameMessage = "";
  qpcr.calcPhase = "idle";
  qpcr.calcMessage = "";
}

/** Gene options for the plot tab: chart series first, transformed genes fallback. */
export function plotGeneOptions(): string[] {
  // SvelteSet keeps the reactivity lint happy; the set is inert local bookkeeping.
  const names = new SvelteSet<string>();
  for (const series of qpcr.chartSeries) names.add(series.geneName);
  if (names.size === 0) {
    for (const name of qpcr.geneNames) names.add(name);
  }
  return [...names];
}

/** Group options for the plot stats control-group select. */
export function plotGroupOptions(): string[] {
  const names = new SvelteSet<string>();
  for (const series of qpcr.chartSeries) {
    for (const point of series.points) names.add(point.name);
  }
  if (names.size === 0) {
    for (const name of qpcr.groups) names.add(name);
  }
  return [...names];
}

/** Keeps the plot sheet valid, preferring Summary_All_Genes (plot source). */
export function ensurePlotSheet(): void {
  const names = qpcr.sheetNames;
  if (names.length === 0) {
    qpcr.plotSheetName = "";
    return;
  }
  if (qpcr.plotSheetName && names.includes(qpcr.plotSheetName)) return;
  qpcr.plotSheetName = names.includes("Summary_All_Genes")
    ? "Summary_All_Genes"
    : names[0];
}

export function updatePlotBar(patch: Partial<QpcrPlotRunConfig>): void {
  qpcr.plotBarDraft = { ...qpcr.plotBarDraft, ...patch };
}

/** Selects the source sheet and clears step feedback (results stay on disk). */
export function selectSheet(name: string): void {
  qpcr.selectedSheet = name;
  qpcr.transformPhase = "idle";
  qpcr.transformMessage = "";
  qpcr.calcPhase = "idle";
  qpcr.calcMessage = "";
}

export function updatePlotHeat(patch: Partial<QpcrPlotRunConfig>): void {
  qpcr.plotHeatDraft = { ...qpcr.plotHeatDraft, ...patch };
}

export function activePlotDraft(): QpcrPlotRunConfig {
  return qpcr.plotKind === "bar" ? qpcr.plotBarDraft : qpcr.plotHeatDraft;
}

export function updatePlotDraft(patch: Partial<QpcrPlotRunConfig>): void {
  if (qpcr.plotKind === "bar") updatePlotBar(patch);
  else updatePlotHeat(patch);
}

export function resetPlotDrafts(): void {
  qpcr.plotBarDraft = makeBarDraft();
  qpcr.plotHeatDraft = makeHeatmapDraft();
}

/* ---------------------------------------------------------------------------
 * Settings (chart color) + toasts
 * ------------------------------------------------------------------------- */

let chartColorLoaded = false;

/** Restores the chart color from the settings doc once per session. */
export function loadChartColor(): void {
  if (chartColorLoaded) return;
  chartColorLoaded = true;
  void (async () => {
    try {
      const doc = await settingsLoad();
      if (doc.chartColor) qpcr.chartColor = doc.chartColor;
    } catch {
      // Settings unavailable: keep the legacy default color.
    }
  })();
}

/* ---------------------------------------------------------------------------
 * File loading (step 1)
 * ------------------------------------------------------------------------- */

function resetPipelineResults(): void {
  qpcr.transformPhase = "idle";
  qpcr.transformMessage = "";
  qpcr.groupRenamePhase = "idle";
  qpcr.groupRenameMessage = "";
  qpcr.calcPhase = "idle";
  qpcr.calcMessage = "";
  qpcr.geneSheetNames = [];
  qpcr.chartSeries = [];
  qpcr.chartInjectPhase = "idle";
  qpcr.chartInjectMessage = "";
  qpcr.plotPhase = "idle";
  qpcr.plotMessage = "";
  qpcr.plotLogs = [];
  qpcr.plotResult = null;
  qpcr.jobId = null;
}

/**
 * Loads a workbook from disk (dialog-picked or dropped path): reads the
 * bytes, lists sheets via the worker and pre-detects an existing
 * Transformed Data sheet so the page can offer direct calculation.
 */
/** Bumped by every load/clear so a slow, superseded load cannot write back. */
let workbookGeneration = 0;

export async function loadWorkbook(path: string): Promise<void> {
  if (qpcr.loadPhase === "running") return;
  const generation = ++workbookGeneration;
  const current = () => generation === workbookGeneration;
  qpcr.loadPhase = "running";
  qpcr.loadMessage = t("qpcr.loadingFile");
  let handle: number | null = null;
  try {
    const opened = await workerOpenWorkbook(path);
    handle = opened.handle;
    if (!current()) {
      workerCloseWorkbook(handle);
      return;
    }
    const { sheetNames } = opened;
    let snapshot: Awaited<ReturnType<typeof workerExtractSheet>>["snapshot"] | null = null;
    if (sheetNames.includes(TRANSFORMED_SHEET_NAME)) {
      snapshot = (await workerExtractSheet(handle, TRANSFORMED_SHEET_NAME)).snapshot;
      if (!current()) {
        workerCloseWorkbook(handle);
        return;
      }
    }
    if (qpcr.workbookHandle !== null) workerCloseWorkbook(qpcr.workbookHandle);
    qpcr.filePath = path;
    qpcr.fileName = baseName(path);
    qpcr.workbookHandle = handle;
    qpcr.workbookRevision += 1;
    qpcr.sheetNames = sheetNames;
    qpcr.selectedSheet = sheetNames[0] ?? "";
    if (snapshot) {
      qpcr.geneNames = detectTransformedGenes(snapshot);
      qpcr.groups = detectTransformedGroups(snapshot);
    } else {
      qpcr.geneNames = [];
      qpcr.groups = [];
    }
    qpcr.groupRenames = {};
    qpcr.plotOutputDir = parentFolder(path);
    ensurePlotSheet();
    resetPipelineResults();
    qpcr.loadPhase = "success";
    qpcr.loadMessage = "";
  } catch (err) {
    if (handle !== null && qpcr.workbookHandle !== handle) workerCloseWorkbook(handle);
    if (!current()) return;
    qpcr.loadPhase = "error";
    qpcr.loadMessage = localizedError(err);
    pushToast("error", t("qpcr.importFailed", { detail: detailOf(err) }));
  }
}

export function clearWorkbook(): void {
  workbookGeneration += 1;
  qpcr.loadPhase = "idle";
  qpcr.loadMessage = "";
  qpcr.filePath = "";
  qpcr.fileName = "";
  if (qpcr.workbookHandle !== null) workerCloseWorkbook(qpcr.workbookHandle);
  qpcr.workbookHandle = null;
  qpcr.workbookRevision += 1;
  qpcr.sheetNames = [];
  qpcr.selectedSheet = "";
  qpcr.geneNames = [];
  qpcr.groups = [];
  qpcr.groupRenames = {};
  qpcr.groupRenamePhase = "idle";
  qpcr.groupRenameMessage = "";
  qpcr.plotOutputDir = "";
  qpcr.plotSheetName = "";
  resetPipelineResults();
}

/* ---------------------------------------------------------------------------
 * Workbook saving (shared by transform/calculate)
 * ------------------------------------------------------------------------- */

/**
 * Writes the rendered bytes back to the original path (crash-safe replace),
 * then makes them the worker's committed workbook. If the save fails the
 * worker keeps the previous state, matching what is on disk.
 */
async function saveWorkbookToSource(handle: number, bytes: ArrayBuffer): Promise<void> {
  // Another workbook was opened (or this one closed) while rendering: never
  // write these bytes over a different file.
  if (qpcr.workbookHandle !== handle) throw new Error(t("qpcr.workbookChanged"));
  await replaceFileBytes(qpcr.filePath, bytes);
  await workerCommitWorkbook(handle, bytes);
  qpcr.workbookRevision += 1;
}

/* ---------------------------------------------------------------------------
 * Step 2: transform
 * ------------------------------------------------------------------------- */

export async function runTransform(): Promise<void> {
  if (qpcr.transformPhase === "running" || qpcr.groupRenamePhase === "running") return;
  const handle = qpcr.workbookHandle;
  if (handle === null) return;
  if (!qpcr.selectedSheet) {
    qpcr.transformPhase = "error";
    qpcr.transformMessage = t("qpcr.errSheetRequired");
    return;
  }
  qpcr.transformPhase = "running";
  qpcr.transformMessage = t("qpcr.transforming");
  try {
    const { snapshot } = await workerExtractSheet(handle, qpcr.selectedSheet);
    const result = await qpcrTransform(snapshot);
    const applied = await workerApplyPatch(handle, result.patch);
    const sheetNames = applied.sheetNames;
    await saveWorkbookToSource(handle, applied.bytes);
    qpcr.sheetNames = sheetNames;
    qpcr.sheetNames = applied.sheetNames;
    qpcr.geneNames = result.geneNames;
    qpcr.groups = result.groups;
    qpcr.groupRenames = {};
    qpcr.groupRenamePhase = "idle";
    qpcr.groupRenameMessage = "";
    ensurePlotSheet();
    qpcr.transformPhase = "success";
    qpcr.transformMessage = `${t("qpcr.done")}，${result.geneNames.length} ${t("qpcr.genes")}`;
  } catch (err) {
    qpcr.transformPhase = "error";
    qpcr.transformMessage = localizedError(err);
    pushToast("error", t("qpcr.transformFailed", { detail: detailOf(err) }));
  }
}

/** Persists drafted group labels into the workbook's Transformed Data sheet. */
export async function applyGroupRenamesToWorkbook(): Promise<void> {
  if (
    qpcr.groupRenamePhase === "running" ||
    qpcr.transformPhase === "running" ||
    qpcr.calcPhase === "running"
  ) return;
  const handle = qpcr.workbookHandle;
  if (handle === null || !qpcr.filePath || !hasTransformedData()) return;
  const renames = pendingGroupRenameMap();
  if (Object.keys(renames).length === 0) return;

  const previousControlGroup = selectedControlGroup();
  qpcr.groupRenamePhase = "running";
  qpcr.groupRenameMessage = t("qpcr.applyingGroupNames");
  try {
    const updated = await workerRenameGroups(handle, TRANSFORMED_SHEET_NAME, renames);
    const sheetNames = updated.sheetNames;
    await saveWorkbookToSource(handle, updated.bytes);
    qpcr.sheetNames = sheetNames;
    qpcr.groups = renamedGroupNames(qpcr.groups, renames);
    qpcr.groupRenames = {};
    qpcr.controlGroup = renames[previousControlGroup] ?? previousControlGroup;
    if (!qpcr.groups.includes(qpcr.controlGroup)) qpcr.controlGroup = qpcr.groups[0] ?? "";
    qpcr.calcPhase = "idle";
    qpcr.calcMessage = "";
    qpcr.geneSheetNames = [];
    qpcr.chartSeries = [];
    qpcr.chartInjectPhase = "idle";
    qpcr.chartInjectMessage = "";
    qpcr.groupRenamePhase = "success";
    qpcr.groupRenameMessage = t("qpcr.groupNamesApplied", { count: Object.keys(renames).length });
  } catch (err) {
    qpcr.groupRenamePhase = "error";
    qpcr.groupRenameMessage = localizedError(err);
  }
}

/* ---------------------------------------------------------------------------
 * Step 3: calculate (+ native chart injection)
 * ------------------------------------------------------------------------- */

export function calcValidationFailure(): ValidationFailure | null {
  return validateCalcForm({
    repeatCount: qpcr.repeatCount,
    refGene: selectedRefGene(),
    method: qpcr.calcMethod,
    controlGroup: qpcr.calcMethod === "control-relative" ? selectedControlGroup() : "",
    selectNum: qpcr.selectNum,
    outlierSd: qpcr.outlierSd,
  });
}

async function injectNativeCharts(result: CalcResult): Promise<void> {
  if (result.chartSeries.length === 0) {
    qpcr.chartInjectPhase = "idle";
    return;
  }
  qpcr.chartInjectPhase = "running";
  try {
    await qpcrInjectCharts({
      v: 1,
      filePath: qpcr.filePath,
      series: result.chartSeries,
      repeatCount: qpcr.repeatCount,
      colorHex: qpcr.chartColor,
      method: qpcr.calcMethod,
      controlGroup:
        qpcr.calcMethod === "control-relative" ? selectedControlGroup() : "",
    });
    qpcr.chartInjectPhase = "success";
    qpcr.chartInjectMessage = "";
    pushToast(
      "success",
      t("qpcr.chartComplete", { count: result.chartSeries.length, detail: "" }),
    );
    const handle = qpcr.workbookHandle;
    if (handle !== null) {
      // The Rust command rewrites the file in place (chart XML only).
      await workerReloadWorkbook(handle);
      qpcr.workbookRevision += 1;
    }
  } catch (err) {
    qpcr.chartInjectPhase = "error";
    qpcr.chartInjectMessage = t("qpcr.chartFailed", {
      detail: localizedError(err),
    });
    pushToast("error", qpcr.chartInjectMessage);
  }
}

export async function runCalculate(): Promise<void> {
  if (qpcr.calcPhase === "running" || qpcr.groupRenamePhase === "running") return;
  if (hasPendingGroupRenames()) {
    qpcr.calcPhase = "error";
    qpcr.calcMessage = t("qpcr.applyRenameBeforeCalc");
    return;
  }
  const failure = calcValidationFailure();
  if (failure) {
    qpcr.calcPhase = "error";
    qpcr.calcMessage = t(failure.key, failure.values);
    return;
  }
  const handle = qpcr.workbookHandle;
  if (handle === null) return;
  if (!hasTransformedData()) {
    qpcr.calcPhase = "error";
    qpcr.calcMessage = t("qpcr.transformFirst");
    return;
  }
  qpcr.calcPhase = "running";
  qpcr.calcMessage = t("qpcr.calculating");
  try {
    const { snapshot } = await workerExtractSheet(handle, TRANSFORMED_SHEET_NAME);
    const request: CalcRequest = {
      v: 1,
      source: snapshot,
      repeatCount: qpcr.repeatCount,
      refGene: selectedRefGene(),
      options: {
        method: qpcr.calcMethod,
        controlGroup:
          qpcr.calcMethod === "control-relative" ? selectedControlGroup() : "",
        selectNum: qpcr.selectNum,
        outlierSd: qpcr.outlierSd,
      },
      withChartsSheet: true,
    };
    const result = await qpcrCalculate(request);
    const applied = await workerApplyPatch(handle, result.patch);
    const sheetNames = applied.sheetNames;
    await saveWorkbookToSource(handle, applied.bytes);
    qpcr.sheetNames = sheetNames;
    qpcr.geneSheetNames = result.geneSheetNames;
    qpcr.chartSeries = result.chartSeries;
    ensurePlotSheet();
    qpcr.calcPhase = "success";
    qpcr.calcMessage = `${t("qpcr.calculated")}（${t(methodLabelKey(qpcr.calcMethod))}），${result.geneSheetNames.length} ${t("qpcr.genes")}`;
    await injectNativeCharts(result);
  } catch (err) {
    qpcr.calcPhase = "error";
    qpcr.calcMessage = localizedError(err);
  }
}

export function methodLabelKey(method: CalcMethod): string {
  return method === "control-relative"
    ? "qpcr.methodControlRelative"
    : "qpcr.methodRefNormalized";
}

/* ---------------------------------------------------------------------------
 * Step 4: plot runner
 * ------------------------------------------------------------------------- */

function appendPlotLog(line: LogLine): void {
  qpcr.plotLogs.push(line);
  if (qpcr.plotLogs.length > LOG_CAP) {
    qpcr.plotLogs.splice(0, qpcr.plotLogs.length - LOG_CAP);
  }
}

async function expandBatchTargets(): Promise<Array<{ path: string; output: string }>> {
  const entries = await listDir(qpcr.plotOutputDir);
  const targets: Array<{ path: string; output: string }> = [];
  for (const entry of entries) {
    if (!entry.isDir) continue;
    const folder = joinPath(qpcr.plotOutputDir, entry.name);
    const children = await listDir(folder);
    if (children.some((child) => !child.isDir && child.name === qpcr.fileName)) {
      targets.push({ path: joinPath(folder, qpcr.fileName), output: folder });
    }
  }
  return targets;
}

export async function runPlot(): Promise<void> {
  if (qpcr.plotPhase === "running") return;
  if (!qpcr.filePath || qpcr.workbookHandle === null) return;
  if (!qpcr.plotOutputDir) {
    qpcr.plotPhase = "error";
    qpcr.plotMessage = t("qpcr.errOutputRequired");
    return;
  }
  qpcr.plotPhase = "running";
  qpcr.plotMessage = "";
  qpcr.plotResult = null;
  qpcr.plotLogs = [];
  appendPlotLog({
    v: 1,
    tsMs: Date.now(),
    level: "info",
    message: t("qpcr.plotPreparing"),
  });
  const draft = activePlotDraft();
  try {
    const batch =
      draft.kind === "bar" && draft.batchMode
        ? await expandBatchTargets()
        : [];
    if (draft.kind === "bar" && draft.batchMode && batch.length === 0) {
      throw new Error(t("qpcr.plotBatchNone"));
    }
    if (batch.length > 0) {
      appendPlotLog({
        v: 1,
        tsMs: Date.now(),
        level: "info",
        message: t("qpcr.plotBatchFound", { count: batch.length }),
      });
    }
    const targets =
      batch.length > 0
        ? batch
        : [{ path: qpcr.filePath, output: qpcr.plotOutputDir }];
    let completed = 0;
    let cancelled = false;
    for (const target of targets) {
      const config = buildPlotConfig({
        draft,
        filePath: target.path,
        sheetName: qpcr.plotSheetName,
        outputDir: target.output,
        installMissing: qpcr.installMissing,
        fallbackControlGroup: plotGroupOptions()[0] ?? "",
      });
      const result = await qpcrPlotRun(config, appendPlotLog);
      qpcr.plotResult = result;
      if (!result.ok) {
        if (result.cancelled || result.error === "QPCR_PLOT_CANCELLED") {
          cancelled = true;
          break;
        }
        throw new Error(result.error || t("qpcr.plotFailed"));
      }
      completed += 1;
    }
    if (cancelled) {
      qpcr.plotPhase = "cancelled";
      qpcr.plotMessage = t("status.cancelled");
      return;
    }
    qpcr.plotPhase = "success";
    qpcr.plotMessage =
      batch.length > 0
        ? t("qpcr.plotBatchDone", { count: completed })
        : t("qpcr.plotDone", { dir: qpcr.plotOutputDir });
    pushToast("success", t("qpcr.plotCompleteToast"));
  } catch (err) {
    qpcr.plotPhase = "error";
    qpcr.plotMessage = localizedError(err);
    pushToast("error", localizedError(err));
  }
}

function newestRunningPlotJob(tasks: readonly TaskRecord[]): number | null {
  let best: TaskRecord | null = null;
  for (const task of tasks) {
    if (task.kind !== "qpcrPlot") continue;
    if (task.status !== "running" && task.status !== "queued") continue;
    if (!best || task.id > best.id) best = task;
  }
  return best ? best.id : null;
}

/** Resolves the running plot job id (task center first, list fallback). */
export async function resolvePlotJobId(): Promise<number | null> {
  const reactive = newestRunningPlotJob(app.tasks);
  if (reactive !== null) return reactive;
  try {
    return newestRunningPlotJob(await tasksList());
  } catch {
    return null;
  }
}

export async function cancelPlot(): Promise<void> {
  const jobId = await resolvePlotJobId();
  if (jobId === null) return;
  qpcr.jobId = jobId;
  try {
    await tasksCancel(jobId);
  } catch {
    // The run may already have finished; the result payload decides the UI.
  }
}
