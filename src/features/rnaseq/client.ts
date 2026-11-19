import { Channel, convertFileSrc } from "@tauri-apps/api/core";
import { ask as askDialog, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { call } from "../../app/tauri.js";
import type { DeSummaryRow } from "../../lib/contracts/generated/rnaseq/DeSummaryRow.js";
import type { ImportData } from "../../lib/contracts/generated/rnaseq/ImportData.js";
import type { ImportRequest } from "../../lib/contracts/generated/rnaseq/ImportRequest.js";
import type { ResultFileItem } from "../../lib/contracts/generated/rnaseq/ResultFileItem.js";
import type { RunDirEntry } from "../../lib/contracts/generated/rnaseq/RunDirEntry.js";
import type { RunResult } from "../../lib/contracts/generated/rnaseq/RunResult.js";
import type { RnaSeqConfig } from "../../lib/contracts/generated/rnaseq/RnaSeqConfig.js";
import type { LogLine } from "../../lib/contracts/generated/task/LogLine.js";
import { joinPath } from "./model.js";

/**
 * RNA-seq client surface: typed wrappers for the Rust rnaseq commands plus
 * dialog/fs seams the page uses. Keeping the plugin calls here gives the
 * vitest suites a single place to mock.
 */

/** ts-rs wire version carried by request payloads (`v`). */
export const RNASEQ_WIRE_VERSION = 1;

/* ---------------------------------------------------------------------------
 * Rust rnaseq commands
 * ------------------------------------------------------------------------- */

/** Full default RnaSeqConfig (Rust is the single source of truth). */
export function rnaseqDefaultConfig(): Promise<RnaSeqConfig> {
  return call("rnaseq_default_config");
}

/** Deep-merge a params patch over the default config (Rust side). */
export function rnaseqMergeConfig(patch: unknown): Promise<RnaSeqConfig> {
  return call("rnaseq_merge_config", { patch });
}

/** Import + normalize a counts matrix (csv/tsv/xlsx). */
export function rnaseqImportCounts(request: ImportRequest): Promise<ImportData> {
  return call("rnaseq_import_counts", { request });
}

/**
 * Runs rnaseq_engine.R. Log lines stream through the channel (attached
 * synchronously so no early line is missed); the invoke promise resolves
 * with the terminal RunResult. Cancel via `rnaseqCancel(taskId)`.
 */
export function rnaseqRun(
  config: RnaSeqConfig,
  steps: string[],
  onLog: (line: LogLine) => void,
): Promise<RunResult> {
  const channel = new Channel<LogLine>();
  channel.onmessage = onLog;
  return call("rnaseq_run", { config, steps, onLog: channel });
}

/** Cancel a running analysis by task-center job id. */
export function rnaseqCancel(taskId: number): Promise<boolean> {
  return call("rnaseq_cancel", { taskId });
}

/** Run directories under the output base (newest first). */
export function rnaseqListRuns(outputBase: string): Promise<RunDirEntry[]> {
  return call("rnaseq_list_runs", { outputBase });
}

/** prepared/params.json of a run directory, restored onto the defaults. */
export function rnaseqLoadParams(runDir: string): Promise<RnaSeqConfig> {
  return call("rnaseq_load_params", { runDir });
}

/** DE/DE_summary.csv rows of a run directory. */
export function rnaseqReadDeSummary(runDir: string): Promise<DeSummaryRow[]> {
  return call("rnaseq_read_de_summary", { runDir });
}

/** Result images/files (png/svg/pdf) grouped by subdir. */
export function rnaseqListResultFiles(runDir: string): Promise<ResultFileItem[]> {
  return call("rnaseq_list_result_files", { runDir });
}

/** Asset URL for a result image (webview-safe custom protocol). */
export function resultFileUrl(runDir: string, subdir: string, name: string): string {
  return convertFileSrc(joinPath(runDir, subdir, name));
}

/* ---------------------------------------------------------------------------
 * Dialog / fs seams (mockable in tests)
 * ------------------------------------------------------------------------- */

export interface FileFilter {
  name: string;
  extensions: string[];
}

/** Open a single existing file. */
export async function pickOpenFile(options?: {
  title?: string;
  filters?: FileFilter[];
  defaultPath?: string;
}): Promise<string | null> {
  const picked = await openDialog({ multiple: false, ...options });
  return typeof picked === "string" && picked ? picked : null;
}

/** Open a single directory. */
export async function pickOpenDir(options?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  const picked = await openDialog({ directory: true, multiple: false, ...options });
  return typeof picked === "string" && picked ? picked : null;
}

/** Save-as dialog for one file. */
export async function pickSaveFile(options: {
  defaultPath?: string;
  filters?: FileFilter[];
}): Promise<string | null> {
  const picked = await saveDialog(options);
  return typeof picked === "string" && picked ? picked : null;
}

export function readTextFileAt(path: string): Promise<string> {
  return readTextFile(path);
}

export function writeTextFileAt(path: string, text: string): Promise<void> {
  return writeTextFile(path, text);
}

/** Native confirm dialog (legacy plugin-dialog `ask`). */
export async function confirmDialog(options: {
  title: string;
  message: string;
  kind?: "info" | "warning";
}): Promise<boolean> {
  return askDialog(options.message, {
    title: options.title,
    kind: options.kind ?? "info",
  });
}

/** Install-task progress logs (`mynx://r-install-log`). */
export function onRInstallLog(handler: (line: LogLine) => void): Promise<UnlistenFn> {
  return listen<LogLine>("mynx://r-install-log", (event) => handler(event.payload));
}

/* ---------------------------------------------------------------------------
 * Path defaults
 * ------------------------------------------------------------------------- */

/** `<homeDir>/Mynx/rnaseq_runs` (legacy defaultOutputBase). */
export async function defaultOutputBase(): Promise<string> {
  const { homeDir } = await import("@tauri-apps/api/path");
  return joinPath(await homeDir(), "Mynx", "rnaseq_runs");
}

/** `<homeDir>/rnaseq_config.json` (legacy save-config default). */
export async function defaultConfigSavePath(): Promise<string> {
  const { homeDir } = await import("@tauri-apps/api/path");
  return joinPath(await homeDir(), "rnaseq_config.json");
}
