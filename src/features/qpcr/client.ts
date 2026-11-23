import { Channel, invoke } from "@tauri-apps/api/core";
import { readDir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { call, toCommandError } from "../../app/tauri.js";
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
  GroupRenamePayload,
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
 *
 * The worker owns the open workbook. The page holds a numeric handle; bytes
 * cross the thread boundary only when a workbook is opened (transferred in)
 * and when a rendered workbook comes back for saving (transferred out).
 * ------------------------------------------------------------------------- */

const RPC_TIMEOUT_MS = 120_000;

let worker: Worker | null = null;
/** Bumped whenever the worker is replaced; open workbooks must be re-opened. */
let workerEpoch = 0;
let requestSeq = 0;
let handleSeq = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

interface WorkbookSession {
  path: string;
  epoch: number;
  reopening: Promise<void> | null;
}
const sessions = new Map<number, WorkbookSession>();

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
  next.onerror = (event) => resetWorker(new Error(event.message || "excel worker crashed"));
  worker = next;
  return next;
}

/** Stops the worker (crash or a stuck request) and fails everything in flight. */
function resetWorker(error: Error): void {
  worker?.terminate();
  worker = null;
  workerEpoch += 1;
  for (const entry of pending.values()) entry.reject(error);
  pending.clear();
}

function workerCall<R>(
  op: WorkerRequest["op"],
  payload: unknown,
  transfer: Transferable[] = [],
): Promise<R> {
  const target = ensureWorker();
  const id = ++requestSeq;
  return new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`excel worker timed out: ${op}`));
      // A stuck worker would keep the whole workbook in memory; start fresh.
      resetWorker(new Error(`excel worker restarted after a timeout: ${op}`));
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
    target.postMessage({ id, op, payload }, transfer);
  });
}

async function openInWorker(handle: number, path: string): Promise<LoadResult> {
  const bytes = await readFileBytes(path);
  return workerCall<LoadResult>("open", { handle, bytes }, [bytes]);
}

/**
 * Makes sure the worker still holds this workbook. After a worker restart the
 * committed state is re-read from disk (it is always what was last saved).
 */
async function ensureOpen(handle: number): Promise<void> {
  const session = sessions.get(handle);
  if (!session) throw new Error(`workbook is not open: ${handle}`);
  if (session.epoch === workerEpoch && worker) return;
  session.reopening ??= (async () => {
    try {
      const epoch = workerEpoch;
      await openInWorker(handle, session.path);
      session.epoch = epoch;
    } finally {
      session.reopening = null;
    }
  })();
  await session.reopening;
}

async function sessionCall<R>(
  handle: number,
  op: WorkerRequest["op"],
  payload: Record<string, unknown>,
  transfer: Transferable[] = [],
): Promise<R> {
  await ensureOpen(handle);
  const epoch = workerEpoch;
  try {
    return await workerCall<R>(op, { handle, ...payload }, transfer);
  } catch (err) {
    // The worker restarted between re-opening and this call: re-open once
    // and retry. Not for transferring calls (their buffer is already gone).
    if (epoch === workerEpoch || transfer.length > 0) throw err;
    await ensureOpen(handle);
    return workerCall<R>(op, { handle, ...payload });
  }
}

/** Opens a workbook from disk in the worker and returns its handle. */
export async function workerOpenWorkbook(path: string): Promise<{ handle: number } & LoadResult> {
  ensureWorker();
  const handle = ++handleSeq;
  const epoch = workerEpoch;
  const result = await openInWorker(handle, path);
  sessions.set(handle, { path, epoch, reopening: null });
  return { handle, ...result };
}

/** Re-reads the workbook from disk (after Rust rewrote the file in place). */
export async function workerReloadWorkbook(handle: number): Promise<LoadResult> {
  const session = sessions.get(handle);
  if (!session) throw new Error(`workbook is not open: ${handle}`);
  // Never race a crash-recovery re-open of the same workbook.
  if (session.reopening) await session.reopening.catch(() => {});
  ensureWorker();
  const epoch = workerEpoch;
  const result = await openInWorker(handle, session.path);
  session.epoch = epoch;
  return result;
}

/** Releases the worker's copy of the workbook. */
export function workerCloseWorkbook(handle: number): void {
  if (!sessions.delete(handle) || !worker) return;
  void workerCall("close", { handle }).catch(() => {});
}

/** Extracts a full-grid JSON snapshot of one sheet (no re-parse, no copy in). */
export function workerExtractSheet(handle: number, sheetName: string): Promise<ExtractResult> {
  return sessionCall<ExtractResult>(handle, "extract", { sheetName });
}

/**
 * Renders a workbook patch and returns the bytes to save. The worker keeps
 * its committed state until {@link workerCommitWorkbook}.
 */
export function workerApplyPatch(handle: number, patch: WorkbookPatch): Promise<ApplyPatchResult> {
  return sessionCall<ApplyPatchResult>(handle, "applyPatch", { patch });
}

/** Renders user-selected display labels into the transformed sheet. */
export function workerRenameGroups(
  handle: number,
  sheetName: string,
  renames: Record<string, string>,
): Promise<ApplyPatchResult> {
  const payload: Omit<GroupRenamePayload, "handle"> = { sheetName, renames };
  return sessionCall<ApplyPatchResult>(handle, "renameGroups", payload);
}

/**
 * Makes saved bytes the worker's committed state. The buffer is handed to
 * the worker and becomes unusable here.
 */
export function workerCommitWorkbook(handle: number, bytes: ArrayBuffer): Promise<void> {
  return sessionCall<void>(handle, "commit", { bytes }, [bytes]);
}

/** Creates a minimal example workbook in the Excel worker. */
export function workerCreateImportTemplate(): Promise<TemplateResult> {
  return workerCall<TemplateResult>("createTemplate", undefined);
}

/* ---------------------------------------------------------------------------
 * File bytes (plugin-fs; dialog-picked paths are auto-granted)
 * ------------------------------------------------------------------------- */

/** File bytes as a standalone ArrayBuffer (copied only when the read is a slice). */
export async function readFileBytes(path: string): Promise<ArrayBuffer> {
  const bytes = await readFile(path);
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}

export function writeFileBytes(path: string, bytes: ArrayBuffer): Promise<void> {
  return writeFile(path, new Uint8Array(bytes));
}

/**
 * Replaces an existing workbook crash-safely (Rust writes a temp file next to
 * it, then renames it over the original).
 */
export async function replaceFileBytes(path: string, bytes: ArrayBuffer): Promise<void> {
  try {
    await invoke("qpcr_save_workbook", new Uint8Array(bytes), {
      headers: { "x-mynx-path": encodeURIComponent(path) },
    });
  } catch (err) {
    throw toCommandError(err);
  }
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
