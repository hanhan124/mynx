import { Channel } from "@tauri-apps/api/core";
import { readDir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { call } from "../../app/tauri.js";
import type { CalcRequest } from "../../lib/contracts/generated/qpcr/CalcRequest.js";
import type { CalcResult } from "../../lib/contracts/generated/qpcr/CalcResult.js";
import type { ChartInjectionRequest } from "../../lib/contracts/generated/qpcr/ChartInjectionRequest.js";
import type { QpcrPlotRunConfig } from "../../lib/contracts/generated/qpcr/QpcrPlotRunConfig.js";
import type { QpcrPlotRunResult } from "../../lib/contracts/generated/qpcr/QpcrPlotRunResult.js";
import type { QpcrAuditResult } from "../../lib/contracts/generated/qpcr/QpcrAuditResult.js";
import type { SheetSnapshot } from "../../lib/contracts/generated/qpcr/SheetSnapshot.js";
import type { TransformResult } from "../../lib/contracts/generated/qpcr/TransformResult.js";
import type { WorkbookPatch } from "../../lib/contracts/generated/qpcr/WorkbookPatch.js";
import type { LogLine } from "../../lib/contracts/generated/task/LogLine.js";
import type {
  ApplyPatchResult,
  ExtractResult,
  LoadResult,
  TemplateResult,
  WorkerRequest,
  WorkerResponse,
} from "./workers/excel.worker.js";

/**
 * qPCR client surface: worker RPC for ExcelJS rendering (never on the main
 * thread) plus typed wrappers for the Rust qPCR commands. All failures
 * reject with an `Error` (worker) or `CommandError` (invoke).
 */

/** ts-rs wire version carried by every request payload (`v`). */
export const QPCR_WIRE_VERSION = 1;

/* ---------------------------------------------------------------------------
 * Worker RPC
 * ------------------------------------------------------------------------- */

const RPC_TIMEOUT_MS = 120_000;

let worker: Worker | null = null;
let requestSeq = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function ensureWorker(): Worker {
  if (worker) return worker;
  const next = new Worker(
    new URL("./workers/excel.worker.ts", import.meta.url),
    { type: "module" },
  );
  next.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.ok) entry.resolve(event.data.result);
    else entry.reject(new Error(event.data.error));
  };
  next.onerror = (event) => {
    const error = new Error(event.message || "excel worker crashed");
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker = null;
  };
  worker = next;
  return next;
}

function workerCall<R>(
  op: WorkerRequest["op"],
  payload: unknown,
): Promise<R> {
  const target = ensureWorker();
  const id = ++requestSeq;
  return new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`excel worker timed out: ${op}`));
    }, RPC_TIMEOUT_MS);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value as R);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    target.postMessage({ id, op, payload });
  });
}

/** Loads a workbook and lists its sheets (worker; bytes are cloned). */
export function workerLoadWorkbook(bytes: ArrayBuffer): Promise<LoadResult> {
  return workerCall<LoadResult>("load", { bytes });
}

/** Extracts a full-grid JSON snapshot of one sheet (worker). */
export function workerExtractSheet(
  bytes: ArrayBuffer,
  sheetName: string,
): Promise<ExtractResult> {
  return workerCall<ExtractResult>("extract", { bytes, sheetName });
}

/** Applies a workbook patch and returns the saved bytes (worker). */
export function workerApplyPatch(
  bytes: ArrayBuffer,
  patch: WorkbookPatch,
): Promise<ApplyPatchResult> {
  return workerCall<ApplyPatchResult>("applyPatch", { bytes, patch });
}

/** Creates a minimal example workbook in the Excel worker. */
export function workerCreateImportTemplate(): Promise<TemplateResult> {
  return workerCall<TemplateResult>("createTemplate", undefined);
}

/* ---------------------------------------------------------------------------
 * File bytes (plugin-fs; dialog-picked paths are auto-granted)
 * ------------------------------------------------------------------------- */

export async function readFileBytes(path: string): Promise<ArrayBuffer> {
  const bytes = await readFile(path);
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

export function writeFileBytes(path: string, bytes: ArrayBuffer): Promise<void> {
  return writeFile(path, new Uint8Array(bytes));
}

export interface DirItem {
  name: string;
  isDir: boolean;
}

export async function listDir(path: string): Promise<DirItem[]> {
  const entries = await readDir(path);
  return entries.map((entry) => ({
    name: entry.name,
    isDir: entry.isDirectory,
  }));
}

/* ---------------------------------------------------------------------------
 * Rust qPCR commands
 * ------------------------------------------------------------------------- */

export function qpcrTransform(source: SheetSnapshot): Promise<TransformResult> {
  return call("qpcr_transform", { request: { v: QPCR_WIRE_VERSION, source } });
}

export function qpcrAudit(source: SheetSnapshot, transformed = false): Promise<QpcrAuditResult> {
  return call("qpcr_audit", { request: { v: QPCR_WIRE_VERSION, source, transformed } });
}

export function qpcrCalculate(request: CalcRequest): Promise<CalcResult> {
  return call("qpcr_calculate", { request });
}

export function qpcrInjectCharts(request: ChartInjectionRequest): Promise<boolean> {
  return call("qpcr_inject_charts", { request });
}

/**
 * Runs qpcr_plot_runner.R. Log lines stream through the channel (attached
 * synchronously so no early line is missed); cancellation goes through
 * `tasks_cancel` with the task-center job id.
 */
export function qpcrPlotRun(
  config: QpcrPlotRunConfig,
  onLog: (line: LogLine) => void,
): Promise<QpcrPlotRunResult> {
  const channel = new Channel<LogLine>();
  channel.onmessage = onLog;
  return call("qpcr_plot_run", { config, onLog: channel });
}
