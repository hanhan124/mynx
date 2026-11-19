import type { PatchCell } from "../../lib/contracts/generated/qpcr/PatchCell.js";
import type { PatchValue } from "../../lib/contracts/generated/qpcr/PatchValue.js";
import type { SheetPatch } from "../../lib/contracts/generated/qpcr/SheetPatch.js";

/**
 * Pure patch-rendering logic for the ExcelJS compatibility worker.
 *
 * The worker owns every ExcelJS import (the main thread never parses xlsx);
 * this module keeps the wire-patch → cell mapping rules testable with tiny
 * fakes. Ordering mirrors the legacy renderer: values/bold/fill/border per
 * cell, then the font-name sweep, then left alignment, then the identity
 * fills (applied AFTER value writes), then freeze panes / widths / A1 note.
 */

/** Sheets the transform/calculate pipeline must never remove. */
export const PROTECTED_SHEETS: readonly string[] = [
  "Transformed Data",
  "Summary_All_Genes",
  "Summary_Best_Replicates",
  "Summary_Outlier_Removed",
  "Charts_All_Genes",
  "Sheet1",
] as const;

/** Wildcard in `WorkbookPatch.removeSheets` — every non-protected sheet. */
export const NON_PROTECTED_SHEETS = "__NON_PROTECTED__";

/** Legacy `IDENTITY_COLUMN_FILL` (light blue identity marker). */
export const IDENTITY_FILL_ARGB = "FFEAF3FA";

/** Legacy medium bottom-border color for header rows. */
export const BOTTOM_BORDER_ARGB = "FFB0B0B0";

/**
 * Expands the `__NON_PROTECTED__` wildcard against the workbook's real sheet
 * names; explicit names pass through (deduplicated). Removing a name that is
 * not in the workbook is a no-op for the caller.
 */
export function expandRemoveSheets(
  removeSheets: readonly string[],
  existingSheetNames: readonly string[],
): string[] {
  const expanded: string[] = [];
  const push = (name: string): void => {
    if (!expanded.includes(name)) expanded.push(name);
  };
  for (const name of removeSheets) {
    if (name === NON_PROTECTED_SHEETS) {
      for (const existing of existingSheetNames) {
        if (!PROTECTED_SHEETS.includes(existing)) push(existing);
      }
    } else {
      push(name);
    }
  }
  return expanded;
}

/** `{t:"num"|"text"|"empty"}` → the primitive ExcelJS `cell.value` accepts. */
export function patchValueToWritable(value: PatchValue): string | number | null {
  if (value.t === "num") return value.v;
  if (value.t === "text") return value.v;
  return null;
}

/** Minimal cell surface the pure helpers mutate (ExcelJS cells satisfy this). */
export interface WritableCell {
  value?: unknown;
  font?: object | null;
  fill?: object | null;
  border?: object | null;
  alignment?: object | null;
}

function mergeStyle(
  existing: object | null | undefined,
  patch: Record<string, unknown>,
): object {
  return { ...(existing ?? {}), ...patch };
}

/**
 * Writes one patch cell: value, bold flag, solid ARGB fill and the medium
 * bottom border (legacy header underline).
 */
export function writePatchCell(cell: WritableCell, patch: PatchCell): void {
  cell.value = patchValueToWritable(patch.value);
  cell.font = mergeStyle(cell.font, { bold: patch.bold });
  if (patch.fill) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: patch.fill },
    };
  }
  if (patch.bottomBorder) {
    cell.border = mergeStyle(cell.border, {
      bottom: { style: "medium", color: { argb: BOTTOM_BORDER_ARGB } },
    });
  }
}

/** Font-name sweep entry (legacy: every cell gets `font.name = fontName`). */
export function applyFontName(cell: WritableCell, fontName: string): void {
  cell.font = mergeStyle(cell.font, { name: fontName });
}

/** Left-alignment sweep entry (legacy: every cell `horizontal: "left"`). */
export function applyLeftAlign(cell: WritableCell): void {
  cell.alignment = mergeStyle(cell.alignment, { horizontal: "left" });
}

/** Identity fill entry (light blue, data rows only). */
export function applyIdentityFill(cell: WritableCell): void {
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: IDENTITY_FILL_ARGB },
  };
}

/** Minimal worksheet surface for the style sweeps (1-based coordinates). */
export interface GridLike {
  rowCount: number;
  columnCount: number;
  getCell(row: number, col: number): WritableCell;
}

/**
 * Applies the sheet's style envelope to the written extent, in legacy order:
 * font name sweep → left alignment sweep → identity fills (rows ≥ 2).
 * Callers must have written all cell values first.
 */
export function applyStyleEnvelope(sheet: GridLike, patch: SheetPatch): void {
  if (patch.fontName) {
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      for (let col = 1; col <= sheet.columnCount; col += 1) {
        applyFontName(sheet.getCell(row, col), patch.fontName);
      }
    }
  }
  if (patch.leftAlign) {
    for (let row = 1; row <= sheet.rowCount; row += 1) {
      for (let col = 1; col <= sheet.columnCount; col += 1) {
        applyLeftAlign(sheet.getCell(row, col));
      }
    }
  }
  if (patch.identityFillCols.length > 0) {
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      for (const col of patch.identityFillCols) {
        applyIdentityFill(sheet.getCell(row, col));
      }
    }
  }
}

/** 1-based column index → spreadsheet column letters (A, B, … AA). */
export function colLetter(index: number): string {
  let rest = index;
  let letters = "";
  while (rest > 0) {
    const rem = (rest - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/** `topLeftCell` of a frozen-pane view (first unfrozen cell). */
export function freezeTopLeftCell(xSplit: number, ySplit: number): string {
  return `${colLetter(xSplit + 1)}${ySplit + 1}`;
}

/** Widest patch row, for the style-sweep extent of a new sheet. */
export function sheetPatchColumnCount(patch: SheetPatch): number {
  return patch.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
}
