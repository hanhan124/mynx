import { convertFileSrc } from "@tauri-apps/api/core";
import { homeDir, join, resourceDir, tempDir } from "@tauri-apps/api/path";
import { readTextFile, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { JsonValue } from "../../lib/contracts/generated/serde_json/JsonValue.js";
import type { ChartImportedData } from "../../lib/contracts/generated/charts/ChartImportedData.js";
import type { ChartRunConfig } from "../../lib/contracts/generated/charts/ChartRunConfig.js";
import type { ChartRunEvent } from "../../lib/contracts/generated/charts/ChartRunEvent.js";
import type { ChartRunResult } from "../../lib/contracts/generated/charts/ChartRunResult.js";
import type { ChartTemplateManifest } from "../../lib/contracts/generated/charts/ChartTemplateManifest.js";
import type { ChartZipRequest } from "../../lib/contracts/generated/charts/ChartZipRequest.js";
import type { ChartPreset } from "../../lib/contracts/generated/settings/ChartPreset.js";
import type { SettingsDoc } from "../../lib/contracts/generated/settings/SettingsDoc.js";
import type { TaskRecord } from "../../lib/contracts/generated/task/TaskRecord.js";
import { SvelteSet } from "svelte/reactivity";
import { pushToast, app } from "../../app/state.svelte";
import {
  rInstallRuntime,
  rStatus,
  settingsLoad,
  settingsSave,
  tasksList,
} from "../../app/tauri.js";
import { samples } from "./samples.js";
import { t } from "../../app/i18n.svelte";
import {
  DEFAULT_TEMPLATE,
  ROLE_FIELD_MAP,
  legacyTemplateMigration,
  templateById,
  templateDefaults,
  type ChartTemplate,
  type MappedField,
} from "./catalog.js";
import {
  applyPublicationPresetValues,
  createInitialChartConfig,
  type ChartConfigDraft,
  type PublicationPreset,
} from "./inspector-fields.js";
import {
  cancelChartRun,
  exportChartZip,
  importChartData,
  installChartTemplatePackage,
  readChartManifest,
  runChart,
} from "./client.js";

/**
 * Chart-studio page state (runes).
 *
 * Ported from legacy `ChartStudioPage.tsx` + `useChartStudioState.ts`:
 * catalog browsing, data import with preview, manifest-driven field
 * mapping, inspector config, run with event log + cancel, R install entry,
 * presets (`chartStudioPresets` in settings) and figure-package export.
 */

/* ---------------------------------------------------------------------------
 * Run log (stage / tone).
 * ------------------------------------------------------------------------- */

export type RunTone = "info" | "success" | "error" | "cancelled";
export type RunPhase = "idle" | "running" | "success" | "error" | "cancelled";

export interface RunLogEntry {
  tsMs: number;
  stage: string;
  level: string;
  message: string;
  tone: RunTone;
  progress: number | null;
}

/** Maps a ChartRunEvent onto the log tone (legacy event-card semantics). */
export function toneOfEvent(event: ChartRunEvent): RunTone {
  if (event.stage === "cancel") return "cancelled";
  if (event.level === "error") return "error";
  if (event.stage === "save") return "success";
  return "info";
}

const EVENT_CODE_LABELS: Record<string, string> = {
  "environment.checking": "charts.evEnvironmentChecking",
  "data.reading": "charts.evDataReading",
  "render.running": "charts.evRenderRunning",
  "save.complete": "charts.evSaveComplete",
  "deps.install": "charts.evDepsInstall",
};

/** Localizes `code:value` chart event messages; unknown text passes through. */
export function localizeChartEventMessage(message: string): string {
  const [code, value] = message.split(":", 2);
  const key = code !== undefined ? EVENT_CODE_LABELS[code] : undefined;
  if (!key) return message;
  return value ? `${t(key)}: ${value}` : t(key);
}

/** Localizes the terminal run error (legacy sentinel strings kept). */
export function localizeChartError(message: string): string {
  if (message === "CHART_RUN_CANCELLED" || message === "R_INSTALL_CANCELLED") {
    return t("charts.errorCancelled");
  }
  if (message.startsWith("MISSING_PACKAGE:")) {
    return t("charts.errorMissingPackage", { pkg: message.slice("MISSING_PACKAGE:".length) });
  }
  if (message.startsWith("PACKAGE_INSTALL_FAILED:")) {
    return t("charts.errorPackageInstallFailed", {
      pkg: message.slice("PACKAGE_INSTALL_FAILED:".length),
    });
  }
  if (message.includes("TEMPLATE_RESOURCE_INCOMPLETE")) {
    return t("charts.errorTemplateIncomplete");
  }
  if (message.includes("OUTPUT_FILE_MISSING")) return t("charts.errorOutputMissing");
  return message;
}

/* ---------------------------------------------------------------------------
 * Config / mapping helpers (pure, unit-tested).
 * ------------------------------------------------------------------------- */

/** Injects the catalog-only run fields into the wire config. */
export function buildRunConfig(draft: ChartConfigDraft, template: ChartTemplate): ChartRunConfig {
  return {
    ...draft,
    kind: template.kind,
    galleryUrl: template.galleryUrl,
    sourceRepoPath: template.sourceRepoPath ?? null,
    verified: template.status === "verified",
  };
}

/** Inverts ROLE_FIELD_MAP into per-field default column names (or ""). */
export function templateFieldDefaults(templateId: string): Record<MappedField, string> {
  const roleMap = ROLE_FIELD_MAP[templateId] ?? {};
  const defaults = templateDefaults[templateId] ?? { x: "", y: "" };
  const out: Record<MappedField, string> = { x: "", y: "", group: "", size: "" };
  for (const [roleKey, field] of Object.entries(roleMap)) {
    if (!field || out[field]) continue;
    out[field] = (defaults as Record<string, string>)[field] ?? roleKey;
  }
  return out;
}

function columnIsNumeric(rows: JsonValue[][], index: number): boolean {
  return rows.some((row) => typeof row[index] === "number");
}

/**
 * Auto-maps imported columns onto the template's data roles: exact role-key
 * match first, then accepted-type based scan, then the template defaults.
 * Returns one column name (possibly "") per config field.
 */
export function autoAssignColumns(
  templateId: string,
  manifest: ChartTemplateManifest | null,
  columns: string[],
  rows: JsonValue[][],
): Record<MappedField, string> {
  const assignment: Record<MappedField, string> = { x: "", y: "", group: "", size: "" };
  const roleMap = ROLE_FIELD_MAP[templateId] ?? {};
  // Assignment bookkeeping inside a pure helper; SvelteSet satisfies the
  // reactivity lint without observable cost.
  const used = new SvelteSet<string>();
  const roles = manifest?.dataRoles ?? [];
  for (const role of roles) {
    const field = roleMap[role.key];
    if (!field) continue;
    const wantsNumber = role.acceptedTypes.includes("number");
    let pick = columns.find((column) => column === role.key && !used.has(column));
    if (!pick) {
      pick = columns.find((column, index) => {
        if (used.has(column)) return false;
        const numeric = columnIsNumeric(rows, index);
        return wantsNumber ? numeric : !numeric;
      });
    }
    if (!pick) {
      const fallback = templateDefaults[templateId]?.[field];
      if (fallback && columns.includes(fallback) && !used.has(fallback)) pick = fallback;
    }
    if (pick) {
      assignment[field] = pick;
      used.add(pick);
    }
  }
  return assignment;
}

export interface RunValidation {
  key: string;
  values?: Record<string, string | number>;
}

/** Validates the draft against the imported data + manifest roles. */
export function validateRunInputs(
  draft: ChartConfigDraft,
  manifest: ChartTemplateManifest | null,
  imported: ChartImportedData | null,
): RunValidation | null {
  if (!draft.filePath) return { key: "charts.errNeedData" };
  if (!draft.outputDir) return { key: "charts.errNeedOutput" };
  if (!imported) return { key: "charts.errNeedData" };
  const roleMap = ROLE_FIELD_MAP[draft.template] ?? {};
  for (const role of manifest?.dataRoles ?? []) {
    const field = roleMap[role.key];
    if (!field) continue;
    const column = draft[field];
    if (role.required && !column) {
      return { key: "charts.errFillRole", values: { role: role.label } };
    }
    if (column && !imported.columns.includes(column)) {
      return {
        key: "charts.errColumnMissing",
        values: { role: role.label, column },
      };
    }
  }
  return null;
}

/** Merges a saved preset config over the defaults (legacy loadPreset). */
export function applyPresetConfig(preset: ChartPreset): ChartConfigDraft | null {
  const saved = preset.config as Record<string, unknown> | null;
  if (!saved || typeof saved !== "object") return null;
  const savedId = String(saved.template ?? "");
  const migratedId = legacyTemplateMigration[savedId] ?? savedId;
  const template = templateById.get(migratedId);
  if (!template) return null;
  const merged: ChartConfigDraft = {
    ...createInitialChartConfig(),
    ...(saved as Partial<ChartConfigDraft>),
    template: template.id,
    // Never restore stale file paths from another machine.
    filePath: "",
  };
  return merged;
}

/** Preset import: keep valid entries (known template), merge by id. */
export function mergeImportedPresets(
  raw: unknown,
  existing: ChartPreset[],
): { presets: ChartPreset[]; imported: number } {
  if (!Array.isArray(raw)) throw new Error(t("charts.errPresetFormat"));
  const valid: ChartPreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.name !== "string") continue;
    if (!record.config || typeof record.config !== "object") continue;
    const config = record.config as Record<string, unknown>;
    const savedId = String(config.template ?? "");
    const migratedId = legacyTemplateMigration[savedId] ?? savedId;
    if (!templateById.has(migratedId)) continue;
    valid.push({
      id: record.id,
      name: record.name,
      config: record.config as JsonValue,
      updatedAt: Number(record.updatedAt) || Date.now(),
    });
  }
  const merged = [
    ...valid,
    ...existing.filter((old) => !valid.some((item) => item.id === old.id)),
  ];
  return { presets: merged, imported: valid.length };
}

/* ---------------------------------------------------------------------------
 * Reactive page state.
 * ------------------------------------------------------------------------- */

const EVENT_LOG_CAP = 100;
const LOG_TEXT_CAP = 20000;

export interface ChartState {
  /** Catalog filters. */
  family: string;
  search: string;
  selectedTemplateId: string;
  manifest: ChartTemplateManifest | null;
  /** Data import + role → column mapping. */
  imported: ChartImportedData | null;
  importing: boolean;
  cfg: ChartConfigDraft;
  /** Presets (settings `chartStudioPresets`). */
  presets: ChartPreset[];
  /** Run lifecycle. */
  runPhase: RunPhase;
  installingR: boolean;
  cancelling: boolean;
  /** Ask the page to show the "install R?" confirm dialog. */
  rInstallPrompt: boolean;
  events: RunLogEntry[];
  logText: string;
  lastResult: ChartRunResult | null;
  lastTemplateId: string;
  /** Reference image (asset-protocol URL) + load error flag. */
  referenceUrl: string;
  referenceError: boolean;
  /** R runtime availability (null = checking). */
  rFound: boolean | null;
}

export const chartState = $state<ChartState>({
  family: "全部",
  search: "",
  selectedTemplateId: DEFAULT_TEMPLATE.id,
  manifest: null,
  imported: null,
  importing: false,
  cfg: createInitialChartConfig(),
  presets: [],
  runPhase: "idle",
  installingR: false,
  cancelling: false,
  rInstallPrompt: false,
  events: [],
  logText: t("charts.logInitial"),
  lastResult: null,
  lastTemplateId: DEFAULT_TEMPLATE.id,
  referenceUrl: "",
  referenceError: false,
  rFound: null,
});

function detailOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function selectedTemplate(): ChartTemplate {
  return templateById.get(chartState.selectedTemplateId) ?? DEFAULT_TEMPLATE;
}

/* ---------------------------------------------------------------------------
 * Persistence (presets in `chartStudioPresets`).
 * ------------------------------------------------------------------------- */

let settingsLoadStarted = false;

/** Restores presets + default output dir once per session. */
export function loadChartStudioSettings(): void {
  if (settingsLoadStarted) return;
  settingsLoadStarted = true;
  void (async () => {
    try {
      const doc = await settingsLoad();
      chartState.presets = Array.isArray(doc.chartStudioPresets) ? [...doc.chartStudioPresets] : [];
    } catch {
      // Settings unavailable: keep an empty preset list.
    }
    try {
      const home = await homeDir();
      chartState.cfg.outputDir = await join(home, "Mynx", "charts");
    } catch {
      // Path API unavailable (tests / browser preview): keep the empty dir.
    }
  })();
}

async function persistPresets(next: ChartPreset[]): Promise<void> {
  const doc = await settingsLoad();
  const updated: SettingsDoc = { ...doc, chartStudioPresets: next };
  await settingsSave(updated);
  chartState.presets = next;
}

export async function savePreset(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const preset: ChartPreset = {
    id: crypto.randomUUID(),
    name: trimmed,
    config: JSON.parse(JSON.stringify(chartState.cfg)) as JsonValue,
    updatedAt: Date.now(),
  };
  try {
    await persistPresets([preset, ...chartState.presets]);
    pushToast("success", t("charts.presetSaved"));
  } catch (error) {
    pushToast("error", `${t("charts.presetSaveFailed")}: ${detailOf(error)}`);
  }
}

export async function deletePreset(preset: ChartPreset): Promise<void> {
  try {
    await persistPresets(chartState.presets.filter((item) => item.id !== preset.id));
    pushToast("success", t("charts.presetDeleted"));
  } catch (error) {
    pushToast("error", `${t("charts.presetDeleteFailed")}: ${detailOf(error)}`);
  }
}

export async function loadPreset(preset: ChartPreset): Promise<void> {
  if (chartState.runPhase === "running" || chartState.installingR) return;
  const merged = applyPresetConfig(preset);
  if (!merged) {
    pushToast("error", t("charts.errPresetFormat"));
    return;
  }
  chartState.cfg = merged;
  resetRunStatus();
  pushToast("info", t("charts.presetLoaded", { name: preset.name }));
}

/* ---------------------------------------------------------------------------
 * Catalog + manifest.
 * ------------------------------------------------------------------------- */

export function resetRunStatus(): void {
  if (chartState.runPhase === "running" || chartState.installingR) return;
  chartState.runPhase = "idle";
  chartState.events = [];
  chartState.logText = t("charts.logInitial");
}

export async function selectTemplate(templateId: string): Promise<void> {
  if (chartState.runPhase === "running" || chartState.installingR) return;
  if (!templateById.has(templateId)) return;
  chartState.selectedTemplateId = templateId;
  chartState.manifest = null;
  chartState.referenceUrl = "";
  chartState.referenceError = false;
  resetRunStatus();
  // Per-template column defaults (config field ← template defaults).
  const defaults = templateFieldDefaults(templateId);
  chartState.cfg = {
    ...chartState.cfg,
    template: templateId,
    x: defaults.x,
    y: defaults.y,
    group: defaults.group,
    size: defaults.size,
  };
  // Re-map onto the imported data when one is loaded.
  if (chartState.imported) {
    applyAutoAssignment(chartState.imported);
  }
  try {
    chartState.manifest = await readChartManifest(templateId);
  } catch (error) {
    chartState.manifest = null;
    pushToast("error", `${t("charts.manifestFailed")}: ${detailOf(error)}`);
  }
}

/** Reference image asset URL under `<resource>/r/chart-templates/<id>/`. */
export async function resolveReferenceUrl(templateId: string): Promise<void> {
  chartState.referenceUrl = "";
  chartState.referenceError = false;
  try {
    const manifest = chartState.manifest;
    const referencePath = manifest?.referencePath ?? "reference.png";
    const dir = await resourceDir();
    const full = await join(dir, "r", "chart-templates", templateId, referencePath);
    chartState.referenceUrl = convertFileSrc(full);
  } catch {
    chartState.referenceUrl = "";
    chartState.referenceError = true;
  }
}

/* ---------------------------------------------------------------------------
 * Data import + mapping.
 * ------------------------------------------------------------------------- */

function applyAutoAssignment(data: ChartImportedData): void {
  const assignment = autoAssignColumns(
    chartState.cfg.template,
    chartState.manifest,
    data.columns,
    data.rows,
  );
  chartState.cfg = { ...chartState.cfg, ...assignment };
}

/** Imports a dataset and auto-maps columns (also used by the sample loader). */
export async function importDataFile(path: string): Promise<void> {
  if (chartState.runPhase === "running" || chartState.installingR) return;
  chartState.importing = true;
  try {
    const data = await importChartData(path, 50);
    chartState.imported = data;
    chartState.cfg = { ...chartState.cfg, filePath: path };
    applyAutoAssignment(data);
    resetRunStatus();
    for (const warning of data.warnings.slice(0, 3)) {
      pushToast("info", warning);
    }
  } catch (error) {
    chartState.imported = null;
    pushToast("error", `${t("charts.importFailed")}: ${detailOf(error)}`);
  } finally {
    chartState.importing = false;
  }
}

export function clearData(): void {
  if (chartState.runPhase === "running" || chartState.installingR) return;
  chartState.imported = null;
  chartState.cfg = { ...chartState.cfg, filePath: "" };
  resetRunStatus();
}

/** Writes the template sample CSV into temp and imports it. */
export async function useSampleData(): Promise<void> {
  if (chartState.runPhase === "running" || chartState.installingR) return;
  const templateId = chartState.cfg.template;
  const text = samples[templateId];
  if (!text) {
    pushToast("info", t("charts.noSample"));
    return;
  }
  try {
    const dir = await tempDir();
    const filePath = await join(dir, `mynx_${templateId}_sample.csv`);
    await writeFile(filePath, new TextEncoder().encode(text));
    await importDataFile(filePath);
    if (chartState.imported) pushToast("success", t("charts.sampleLoaded"));
  } catch (error) {
    pushToast("error", `${t("charts.sampleFailed")}: ${detailOf(error)}`);
  }
}

/** Updates one config field (blocked while running, resets run status). */
export function updateConfig(patch: Partial<ChartConfigDraft>): void {
  if (chartState.runPhase === "running" || chartState.installingR) return;
  chartState.cfg = { ...chartState.cfg, ...patch };
  resetRunStatus();
}

/** Sets the column for one mapped data role. */
export function setRoleColumn(field: MappedField, column: string): void {
  updateConfig({ [field]: column } as Partial<ChartConfigDraft>);
}

export function applyPublicationPreset(presetId: PublicationPreset): void {
  if (chartState.runPhase === "running" || chartState.installingR) return;
  chartState.cfg = applyPublicationPresetValues(chartState.cfg, presetId);
  resetRunStatus();
}

/* ---------------------------------------------------------------------------
 * Run + cancel + R install.
 * ------------------------------------------------------------------------- */

function appendLog(text: string): void {
  let next = `${chartState.logText}\n${text}`.trim();
  if (next.length > LOG_TEXT_CAP) next = next.slice(next.length - LOG_TEXT_CAP);
  chartState.logText = next;
}

function appendEvent(entry: RunLogEntry): void {
  const latest = chartState.events[chartState.events.length - 1];
  if (latest && latest.message === entry.message && latest.tone === entry.tone) return;
  chartState.events.push(entry);
  if (chartState.events.length > EVENT_LOG_CAP) {
    chartState.events.splice(0, chartState.events.length - EVENT_LOG_CAP);
  }
}

function handleRunEvent(event: ChartRunEvent): void {
  const message = localizeChartEventMessage(event.message);
  appendEvent({
    tsMs: event.tsMs,
    stage: event.stage,
    level: event.level,
    message,
    tone: toneOfEvent(event),
    progress: typeof event.progress === "number" ? event.progress : null,
  });
  appendLog(message);
}

/** Role-key → config field for one template (page mapping editor). */
export function roleFieldMapFor(
  templateId: string,
): Partial<Record<string, MappedField>> {
  return ROLE_FIELD_MAP[templateId] ?? {};
}

function newestRunningJobId(tasks: readonly TaskRecord[], kind: TaskRecord["kind"]): number | null {
  let best: number | null = null;
  for (const task of tasks) {
    if (task.kind !== kind) continue;
    if (task.status !== "running" && task.status !== "queued") continue;
    if (best === null || task.id > best) best = task.id;
  }
  return best;
}

async function resolveJobId(kind: TaskRecord["kind"]): Promise<number | null> {
  const reactive = newestRunningJobId(app.tasks, kind);
  if (reactive !== null) return reactive;
  try {
    return newestRunningJobId(await tasksList(), kind);
  } catch {
    return null;
  }
}

/** Runs chart_runner.R with the current draft; returns the terminal result. */
async function executeRun(): Promise<ChartRunResult | null> {
  const template = selectedTemplate();
  const config = buildRunConfig(chartState.cfg, template);
  try {
    return await runChart(config, handleRunEvent);
  } catch (error) {
    const message = detailOf(error);
    // Legacy flow: offer the R runtime install when discovery fails.
    if (message.includes("尚未安装 R")) {
      chartState.runPhase = "idle";
      chartState.rInstallPrompt = true;
      return null;
    }
    chartState.runPhase = "error";
    const localized = localizeChartError(message);
    appendEvent({
      tsMs: Date.now(),
      stage: "error",
      level: "error",
      message: localized,
      tone: "error",
      progress: null,
    });
    appendLog(localized);
    pushToast("error", localized);
    return null;
  }
}

function startRun(): void {
  chartState.runPhase = "running";
  chartState.cancelling = false;
  chartState.rInstallPrompt = false;
  chartState.events = [];
  chartState.logText = t("charts.evEnvironmentChecking");
  appendEvent({
    tsMs: Date.now(),
    stage: "environment",
    level: "info",
    message: t("charts.evEnvironmentChecking"),
    tone: "info",
    progress: null,
  });
}

export async function runGeneration(): Promise<void> {
  if (chartState.runPhase === "running" || chartState.installingR) return;
  const template = selectedTemplate();
  if (template.status !== "verified") {
    pushToast("info", t("charts.errTemplateUnavailable"));
    return;
  }
  const invalid = validateRunInputs(chartState.cfg, chartState.manifest, chartState.imported);
  if (invalid) {
    pushToast("info", t(invalid.key, invalid.values));
    return;
  }
  startRun();
  const result = await executeRun();
  if (result === null) return; // prompt state or error already surfaced
  chartState.cancelling = false;
  if (result.ok && result.outputPath) {
    chartState.lastResult = result;
    chartState.lastTemplateId = template.id;
    chartState.runPhase = "success";
    const done = t("charts.evDone");
    appendEvent({
      tsMs: Date.now(),
      stage: "save",
      level: "info",
      message: done,
      tone: "success",
      progress: null,
    });
    appendLog(done);
    pushToast("success", t("charts.runSuccess"));
  } else {
    const wasCancelled = result.cancelled || result.error === "CHART_RUN_CANCELLED";
    const message = localizeChartError(result.error ?? t("charts.runFailed"));
    chartState.runPhase = wasCancelled ? "cancelled" : "error";
    appendEvent({
      tsMs: Date.now(),
      stage: wasCancelled ? "cancel" : "error",
      level: wasCancelled ? "info" : "error",
      message,
      tone: wasCancelled ? "cancelled" : "error",
      progress: null,
    });
    pushToast(wasCancelled ? "info" : "error", message);
  }
}

/** Sends the cancel request for the running chart job. */
export async function requestCancel(): Promise<void> {
  if (chartState.cancelling) return;
  chartState.cancelling = true;
  const jobId = await resolveJobId("chartRun");
  if (jobId === null) {
    chartState.cancelling = false;
    pushToast("info", t("charts.cancelTooLate"));
    return;
  }
  const cancelling = t("charts.cancelling");
  appendLog(cancelling);
  appendEvent({
    tsMs: Date.now(),
    stage: "cancel",
    level: "info",
    message: cancelling,
    tone: "info",
    progress: null,
  });
  try {
    await cancelChartRun(jobId);
  } catch {
    chartState.cancelling = false;
    pushToast("error", t("charts.cancelFailed"));
  }
}

/** Confirms the R install prompt, installs, then retries the run. */
export async function confirmInstallR(): Promise<void> {
  chartState.rInstallPrompt = false;
  if (chartState.installingR) return;
  chartState.installingR = true;
  chartState.events = [];
  const label = t("charts.installingR");
  appendEvent({
    tsMs: Date.now(),
    stage: "dependencies",
    level: "info",
    message: label,
    tone: "info",
    progress: null,
  });
  appendLog(label);
  try {
    await rInstallRuntime();
    const status = await rStatus();
    chartState.rFound = status.found;
    chartState.installingR = false;
    if (status.found) {
      pushToast("success", t("charts.rInstallDone"));
      await runGeneration();
    } else {
      pushToast("error", t("charts.rInstallMissing"));
      chartState.runPhase = "error";
    }
  } catch (error) {
    chartState.installingR = false;
    chartState.runPhase = "error";
    pushToast("error", `${t("charts.rInstallFailed")}: ${detailOf(error)}`);
  }
}

export function dismissInstallRPrompt(): void {
  chartState.rInstallPrompt = false;
}

/** Refreshes the R runtime availability flag (and the UI tag). */
export async function refreshRStatus(): Promise<void> {
  try {
    const status = await rStatus();
    chartState.rFound = status.found;
  } catch {
    chartState.rFound = false;
  }
}

/* ---------------------------------------------------------------------------
 * Result actions (open / preview / SVG copy / ZIP package).
 * ------------------------------------------------------------------------- */

export async function copySvgSource(): Promise<void> {
  const result = chartState.lastResult;
  if (!result?.outputPath || !result.outputPath.toLowerCase().endsWith(".svg")) return;
  try {
    const svg = await readTextFile(result.outputPath);
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(svg);
    pushToast("success", t("charts.svgCopied"));
  } catch {
    pushToast("error", t("charts.svgCopyFailed"));
  }
}

/** Exports the figure package ZIP (output file + template resources). */
export async function exportResultPackage(zipPath: string): Promise<void> {
  const result = chartState.lastResult;
  if (!result) return;
  try {
    const request: ChartZipRequest = {
      v: 1,
      zipPath,
      outputFile: result.outputPath,
      templateId: chartState.lastTemplateId || chartState.cfg.template,
      readme: "Mynx 科研绘图结果包\n包含图表文件和模板说明。\n",
      sidecarJson: null,
    };
    await exportChartZip(request);
    pushToast("success", t("charts.zipExported"));
  } catch (error) {
    pushToast("error", `${t("charts.zipExportFailed")}: ${detailOf(error)}`);
  }
}

/* ---------------------------------------------------------------------------
 * Template package import (app-data install dir).
 * ------------------------------------------------------------------------- */

export async function importTemplatePackage(zipPath: string): Promise<void> {
  try {
    const manifest = await installChartTemplatePackage(zipPath);
    pushToast("success", t("charts.templateInstalled", { id: manifest.id }));
  } catch (error) {
    pushToast("error", `${t("charts.templateInstallFailed")}: ${detailOf(error)}`);
  }
}

/* ---------------------------------------------------------------------------
 * Template ZIP export (manifest + render + README + sample, client-side).
 * ------------------------------------------------------------------------- */

export async function exportTemplatePackage(template: ChartTemplate, zipPath: string): Promise<void> {
  try {
    const { default: JSZip } = await import("jszip");
    const dir = await resourceDir();
    const base = await join(dir, "r", "chart-templates", template.id);
    const zip = new JSZip();
    for (const file of ["manifest.json", "sample.csv", "render.R", "README.zh-CN.md"]) {
      try {
        zip.file(file, await readTextFile(await join(base, file)));
      } catch {
        // optional template metadata
      }
    }
    const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    await writeFile(zipPath, archive);
    pushToast("success", t("charts.templateExported"));
  } catch (error) {
    pushToast("error", `${t("charts.templateExportFailed")}: ${detailOf(error)}`);
  }
}

/* Preset import/export file helpers (dialog paths resolved by the page). */

export async function exportPresetsFile(path: string): Promise<void> {
  try {
    await writeTextFile(path, JSON.stringify(chartState.presets, null, 2));
    pushToast("success", t("charts.presetsExported"));
  } catch (error) {
    pushToast("error", `${t("charts.presetsExportFailed")}: ${detailOf(error)}`);
  }
}

export async function importPresetsFile(path: string): Promise<void> {
  try {
    const raw: unknown = JSON.parse(await readTextFile(path));
    const { presets, imported } = mergeImportedPresets(raw, chartState.presets);
    await persistPresets(presets);
    pushToast("success", t("charts.presetsImported", { count: imported }));
  } catch (error) {
    pushToast("error", `${t("charts.presetsImportFailed")}: ${detailOf(error)}`);
  }
}
