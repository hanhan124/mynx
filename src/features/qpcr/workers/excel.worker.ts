/// <reference lib="webworker" />
import ExcelJS from "exceljs";
import type { CellSnapshot } from "../../../lib/contracts/generated/qpcr/CellSnapshot.js";
import type { RowSnapshot } from "../../../lib/contracts/generated/qpcr/RowSnapshot.js";
import type { SheetSnapshot } from "../../../lib/contracts/generated/qpcr/SheetSnapshot.js";
import type { WorkbookPatch } from "../../../lib/contracts/generated/qpcr/WorkbookPatch.js";
import {
  applyStyleEnvelope,
  colLetter,
  expandRemoveSheets,
  sheetPatchColumnCount,
  writePatchCell,
} from "../patch-render.js";

/**
 * ExcelJS compatibility worker ("dumb renderer") that owns the open workbook.
 *
 * The qPCR pipeline never parses xlsx on the main thread. The page opens a
 * workbook once (its bytes are *transferred* here, not copied) and then
 * addresses it by handle: extracts reuse the parsed workbook instead of
 * re-parsing, and only rendered results travel back (transferred as well).
 * Rendering never touches the committed state; the page commits the rendered
 * bytes after they were saved to disk, so a failed save changes nothing.
 * No pipeline logic lives here.
 */

/** Solid ARGB fill the calculation pipeline treats as the imputation flag. */
const YELLOW_FILL_ARGB = "FFFFFF00";
const GROUP_MAPPING_SHEET = "Group Mapping";

export interface OpenPayload {
  handle: number;
  bytes: ArrayBuffer;
}
export interface HandlePayload {
  handle: number;
}
export interface LoadResult {
  sheetNames: string[];
}
export interface ExtractPayload {
  handle: number;
  sheetName: string;
}
export interface ExtractResult {
  snapshot: SheetSnapshot;
}
export interface ApplyPatchPayload {
  handle: number;
  patch: WorkbookPatch;
}
export interface ApplyPatchResult {
  bytes: ArrayBuffer;
  sheetNames: string[];
}
export interface GroupRenamePayload {
  handle: number;
  sheetName: string;
  renames: Record<string, string>;
}
export interface CommitPayload {
  handle: number;
  bytes: ArrayBuffer;
}
export interface TemplateResult {
  bytes: ArrayBuffer;
}

export type WorkerResult = LoadResult | ExtractResult | ApplyPatchResult | TemplateResult | null;

export type WorkerRequest =
  | { id: number; op: "open"; payload: OpenPayload }
  | { id: number; op: "extract"; payload: ExtractPayload }
  | { id: number; op: "applyPatch"; payload: ApplyPatchPayload }
  | { id: number; op: "renameGroups"; payload: GroupRenamePayload }
  | { id: number; op: "commit"; payload: CommitPayload }
  | { id: number; op: "close"; payload: HandlePayload }
  | { id: number; op: "createTemplate" };

export type WorkerResponse =
  | { id: number; ok: true; result: WorkerResult }
  | { id: number; ok: false; error: string };

/** Committed bytes (what is on disk) plus the lazily parsed workbook. */
interface Session {
  bytes: ArrayBuffer;
  parsed: Promise<ExcelJS.Workbook> | null;
}

const sessions = new Map<number, Session>();

function session(handle: number): Session {
  const found = sessions.get(handle);
  if (!found) throw new Error(`workbook is not open: ${handle}`);
  return found;
}

/** Parsed committed workbook, parsed at most once per committed state. */
function parsed(handle: number): Promise<ExcelJS.Workbook> {
  const current = session(handle);
  if (!current.parsed) {
    const loading = loadWorkbook(current.bytes);
    // A failed parse must not stick: the next call tries again.
    loading.catch(() => {
      if (current.parsed === loading) current.parsed = null;
    });
    current.parsed = loading;
  }
  return current.parsed;
}

/**
 * Workbook to render into: the parsed committed workbook, detached from the
 * session so the mutation never leaks into later extracts. The committed
 * bytes stay as they are until the page commits.
 */
async function takeForRender(handle: number): Promise<ExcelJS.Workbook> {
  const workbook = await parsed(handle);
  session(handle).parsed = null;
  return workbook;
}

function toBuffer(bytes: ArrayBuffer): ExcelJS.Buffer {
  return bytes as unknown as ExcelJS.Buffer;
}

/** ExcelJS output as a standalone ArrayBuffer (no copy when it already is one). */
function toArrayBuffer(data: ExcelJS.Buffer | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const raw: unknown = data;
  const view = ArrayBuffer.isView(raw)
    ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
    : new Uint8Array(raw as ArrayBufferLike);
  if (view.buffer instanceof ArrayBuffer && view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view.buffer;
  }
  return view.slice().buffer;
}

async function loadWorkbook(bytes: ArrayBuffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(toBuffer(bytes));
  return workbook;
}

function sheetNamesOf(workbook: ExcelJS.Workbook): string[] {
  return workbook.worksheets.map((sheet) => sheet.name);
}

function isYellowFill(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill as Partial<ExcelJS.FillPattern> | undefined;
  if (!fill || fill.type !== "pattern" || fill.pattern !== "solid") return false;
  const fg = fill.fgColor as Partial<ExcelJS.Color> | undefined;
  const argb = (fg?.argb ?? "") as string;
  return argb.toUpperCase() === YELLOW_FILL_ARGB;
}

function toCellValue(value: ExcelJS.CellValue): CellSnapshot["value"] {
  if (typeof value === "number") return { t: "num", v: value };
  if (typeof value === "string") return { t: "text", v: value };
  return { t: "empty" };
}

/** Full-grid snapshot: rows 1..rowCount × cols 1..columnCount. */
function snapshotSheet(sheet: ExcelJS.Worksheet, name: string): SheetSnapshot {
  const rowCount = sheet.rowCount;
  const columnCount = sheet.columnCount;
  const rows: RowSnapshot[] = [];
  for (let r = 1; r <= rowCount; r += 1) {
    const row = sheet.getRow(r);
    const cells: CellSnapshot[] = [];
    for (let c = 1; c <= columnCount; c += 1) {
      const cell = row.getCell(c);
      cells.push({
        col: c,
        value: toCellValue(cell.value),
        yellowFill: isYellowFill(cell),
      });
    }
    rows.push({ row: r, cells });
  }
  return { name, columnCount, rowCount, rows };
}

/** Applies the patch: remove sheets, then upsert each fully-specified sheet. */
function applyPatch(workbook: ExcelJS.Workbook, patch: WorkbookPatch): void {
  const existingNames = sheetNamesOf(workbook);
  for (const name of expandRemoveSheets(patch.removeSheets, existingNames)) {
    const existing = workbook.worksheets.find((sheet) => sheet.name === name);
    if (existing) workbook.removeWorksheet(existing.id);
  }
  for (const sheetPatch of patch.upsertSheets) {
    const existing = workbook.worksheets.find(
      (sheet) => sheet.name === sheetPatch.name,
    );
    if (existing) workbook.removeWorksheet(existing.id);
    const sheet = workbook.addWorksheet(sheetPatch.name);

    for (let r = 0; r < sheetPatch.rows.length; r += 1) {
      const row = sheetPatch.rows[r];
      for (let c = 0; c < row.cells.length; c += 1) {
        writePatchCell(sheet.getRow(r + 1).getCell(c + 1), row.cells[c]);
      }
    }

    applyStyleEnvelope(
      {
        rowCount: sheetPatch.rows.length,
        columnCount: sheetPatchColumnCount(sheetPatch),
        getCell: (row, col) => sheet.getCell(row, col),
      },
      sheetPatch,
    );

    if (sheetPatch.freezeX > 0 || sheetPatch.freezeY > 0) {
      sheet.views = [
        {
          state: "frozen",
          xSplit: sheetPatch.freezeX,
          ySplit: sheetPatch.freezeY,
          topLeftCell: `${colLetter(sheetPatch.freezeX + 1)}${sheetPatch.freezeY + 1}`,
        },
      ];
    }
    sheetPatch.colWidths.forEach((width: number, index: number) => {
      sheet.getColumn(index + 1).width = width;
    });
    if (sheetPatch.a1Note) {
      sheet.getCell("A1").note = sheetPatch.a1Note;
    }
  }
}

async function handle(request: WorkerRequest): Promise<WorkerResult> {
  if (request.op === "createTemplate") {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Mynx";
    workbook.subject = "qPCR raw input template";
    const sheet = workbook.addWorksheet("Raw Data", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.addRow(["Target", "Sample", "Cq"]);
    sheet.addRows([
      ["ReferenceGene", "Control", 20.3],
      ["ReferenceGene", "Control", 20.5],
      ["TargetGene", "Control", 25.1],
      ["TargetGene", "Control", 25.3],
      ["ReferenceGene", "Treatment", 20.1],
      ["ReferenceGene", "Treatment", 20.2],
      ["TargetGene", "Treatment", 22.4],
      ["TargetGene", "Treatment", 22.6],
    ]);
    sheet.columns = [{ width: 24 }, { width: 20 }, { width: 14 }];
    sheet.getRow(1).font = { bold: true };
    sheet.autoFilter = { from: "A1", to: "C9" };
    const written = await workbook.xlsx.writeBuffer();
    return { bytes: toArrayBuffer(written) };
  }
  if (request.op === "open") {
    // Re-opening a handle (reload after an external rewrite) replaces it.
    const { handle: id, bytes } = request.payload;
    sessions.set(id, { bytes, parsed: null });
    try {
      return { sheetNames: sheetNamesOf(await parsed(id)) };
    } catch (err) {
      sessions.delete(id);
      throw err;
    }
  }
  if (request.op === "close") {
    sessions.delete(request.payload.handle);
    return null;
  }
  if (request.op === "commit") {
    // The rendered bytes are now on disk: they become the committed state.
    const current = session(request.payload.handle);
    current.bytes = request.payload.bytes;
    current.parsed = null;
    return null;
  }
  if (request.op === "extract") {
    const workbook = await parsed(request.payload.handle);
    const sheet = workbook.getWorksheet(request.payload.sheetName);
    if (!sheet) throw new Error(`worksheet not found: ${request.payload.sheetName}`);
    return { snapshot: snapshotSheet(sheet, sheet.name) };
  }
  if (request.op === "renameGroups") {
    const workbook = await takeForRender(request.payload.handle);
    const sheet = workbook.getWorksheet(request.payload.sheetName);
    if (!sheet) throw new Error(`worksheet not found: ${request.payload.sheetName}`);
    const mapping = workbook.getWorksheet(GROUP_MAPPING_SHEET)
      ?? workbook.addWorksheet(GROUP_MAPPING_SHEET);
    if (mapping.rowCount === 0) {
      mapping.addRow(["Original group", "Current custom name"]);
      mapping.getRow(1).font = { bold: true };
      mapping.columns = [{ width: 28 }, { width: 32 }];
      mapping.views = [{ state: "frozen", ySplit: 1 }];
      mapping.autoFilter = { from: "A1", to: "B1" };
    }

    const mappedCurrentNames = new Set<string>();
    for (let row = 2; row <= mapping.rowCount; row += 1) {
      const original = mapping.getCell(row, 1).value;
      const current = mapping.getCell(row, 2).value;
      if (typeof original !== "string" || typeof current !== "string") continue;
      const next = request.payload.renames[current.trim()];
      if (next !== undefined) mapping.getCell(row, 2).value = next;
      mappedCurrentNames.add(current.trim());
    }
    for (const [current, next] of Object.entries(request.payload.renames)) {
      if (!mappedCurrentNames.has(current)) mapping.addRow([current, next]);
    }
    mapping.autoFilter = { from: "A1", to: `B${mapping.rowCount}` };

    for (let row = 2; row <= sheet.rowCount; row += 1) {
      const cell = sheet.getRow(row).getCell(2);
      if (typeof cell.value !== "string" && typeof cell.value !== "number") continue;
      const renamed = request.payload.renames[String(cell.value).trim()];
      if (renamed !== undefined) cell.value = renamed;
    }
    const written = await workbook.xlsx.writeBuffer();
    return { bytes: toArrayBuffer(written), sheetNames: sheetNamesOf(workbook) };
  }
  const workbook = await takeForRender(request.payload.handle);
  applyPatch(workbook, request.payload.patch);
  const written = await workbook.xlsx.writeBuffer();
  return {
    bytes: toArrayBuffer(written),
    sheetNames: sheetNamesOf(workbook),
  };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    const result = await handle(request);
    const response: WorkerResponse = { id: request.id, ok: true, result };
    // Rendered bytes are handed over, not copied.
    const transfer = result && "bytes" in result ? [result.bytes] : [];
    (self as unknown as Worker).postMessage(response, transfer);
  } catch (err) {
    const response: WorkerResponse = {
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
