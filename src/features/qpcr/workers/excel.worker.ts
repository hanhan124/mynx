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
 * ExcelJS compatibility worker ("dumb renderer").
 *
 * The qPCR pipeline never parses xlsx on the main thread: workbook bytes come
 * in as an ArrayBuffer, this worker loads them with ExcelJS and either
 * extracts a JSON SheetSnapshot for Rust or applies a WorkbookPatch produced
 * by Rust and returns the saved bytes. No pipeline logic lives here.
 */

/** Solid ARGB fill the calculation pipeline treats as the imputation flag. */
const YELLOW_FILL_ARGB = "FFFFFF00";

export interface LoadPayload {
  bytes: ArrayBuffer;
}
export interface LoadResult {
  sheetNames: string[];
}
export interface ExtractPayload {
  bytes: ArrayBuffer;
  sheetName: string;
}
export interface ExtractResult {
  snapshot: SheetSnapshot;
}
export interface ApplyPatchPayload {
  bytes: ArrayBuffer;
  patch: WorkbookPatch;
}
export interface ApplyPatchResult {
  bytes: ArrayBuffer;
  sheetNames: string[];
}
export interface GroupRenamePayload {
  bytes: ArrayBuffer;
  sheetName: string;
  renames: Record<string, string>;
}
export interface TemplateResult {
  bytes: ArrayBuffer;
}

export type WorkerRequest =
  | { id: number; op: "load"; payload: LoadPayload }
  | { id: number; op: "extract"; payload: ExtractPayload }
  | { id: number; op: "applyPatch"; payload: ApplyPatchPayload }
  | { id: number; op: "renameGroups"; payload: GroupRenamePayload }
  | { id: number; op: "createTemplate" };

export type WorkerResponse =
  | { id: number; ok: true; result: LoadResult | ExtractResult | ApplyPatchResult | TemplateResult }
  | { id: number; ok: false; error: string };

function toBuffer(bytes: ArrayBuffer): ExcelJS.Buffer {
  return bytes as unknown as ExcelJS.Buffer;
}

function toArrayBuffer(data: ExcelJS.Buffer | ArrayBuffer): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  const view = new Uint8Array(data as unknown as ArrayBufferLike);
  const out = new ArrayBuffer(view.byteLength);
  new Uint8Array(out).set(view);
  return out;
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

async function handle(
  request: WorkerRequest,
): Promise<LoadResult | ExtractResult | ApplyPatchResult | TemplateResult> {
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
  if (request.op === "load") {
    const workbook = await loadWorkbook(request.payload.bytes);
    return { sheetNames: sheetNamesOf(workbook) };
  }
  if (request.op === "extract") {
    const workbook = await loadWorkbook(request.payload.bytes);
    const sheet = workbook.getWorksheet(request.payload.sheetName);
    if (!sheet) throw new Error(`worksheet not found: ${request.payload.sheetName}`);
    return { snapshot: snapshotSheet(sheet, sheet.name) };
  }
  if (request.op === "renameGroups") {
    const workbook = await loadWorkbook(request.payload.bytes);
    const sheet = workbook.getWorksheet(request.payload.sheetName);
    if (!sheet) throw new Error(`worksheet not found: ${request.payload.sheetName}`);
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      const cell = sheet.getRow(row).getCell(2);
      if (typeof cell.value !== "string" && typeof cell.value !== "number") continue;
      const renamed = request.payload.renames[String(cell.value).trim()];
      if (renamed !== undefined) cell.value = renamed;
    }
    const written = await workbook.xlsx.writeBuffer();
    return { bytes: toArrayBuffer(written), sheetNames: sheetNamesOf(workbook) };
  }
  const workbook = await loadWorkbook(request.payload.bytes);
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
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: WorkerResponse = {
      id: request.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
