import { describe, expect, it } from "vitest";
import type { PatchCell } from "../../lib/contracts/generated/qpcr/PatchCell.js";
import type { SheetPatch } from "../../lib/contracts/generated/qpcr/SheetPatch.js";
import {
  BOTTOM_BORDER_ARGB,
  IDENTITY_FILL_ARGB,
  NON_PROTECTED_SHEETS,
  PROTECTED_SHEETS,
  applyFontName,
  applyIdentityFill,
  applyLeftAlign,
  applyStyleEnvelope,
  colLetter,
  expandRemoveSheets,
  freezeTopLeftCell,
  patchValueToWritable,
  sheetPatchColumnCount,
  writePatchCell,
  type GridLike,
  type WritableCell,
} from "./patch-render.js";

function makeCell(overrides: Partial<PatchCell> = {}): PatchCell {
  return {
    value: { t: "empty" },
    bold: false,
    fill: null,
    bottomBorder: false,
    ...overrides,
  };
}

function makePatch(overrides: Partial<SheetPatch> = {}): SheetPatch {
  return {
    name: "Summary_All_Genes",
    rows: [],
    fontName: "",
    leftAlign: false,
    identityFillCols: [],
    freezeX: 0,
    freezeY: 0,
    colWidths: [],
    a1Note: null,
    ...overrides,
  };
}

describe("expandRemoveSheets", () => {
  it("expands __NON_PROTECTED__ to every non-protected sheet", () => {
    const existing = [
      "Transformed Data",
      "Summary_All_Genes",
      "Sheet1",
      "Gene_A",
      "Gene_B",
    ];
    expect(expandRemoveSheets([NON_PROTECTED_SHEETS], existing)).toEqual([
      "Gene_A",
      "Gene_B",
    ]);
  });

  it("passes explicit names through and keeps protected sheets intact", () => {
    const existing = ["Transformed Data", "Old_Sheet"];
    expect(expandRemoveSheets(["Old_Sheet", "Missing_Sheet"], existing)).toEqual([
      "Old_Sheet",
      "Missing_Sheet",
    ]);
  });

  it("keeps every PROTECTED_SHEETS entry from the wildcard", () => {
    const existing = [...PROTECTED_SHEETS, "Extra"];
    expect(expandRemoveSheets([NON_PROTECTED_SHEETS], existing)).toEqual([
      "Extra",
    ]);
  });

  it("deduplicates explicit + wildcard results", () => {
    const existing = ["Gene_A", "Gene_B"];
    expect(
      expandRemoveSheets(["Gene_A", NON_PROTECTED_SHEETS], existing),
    ).toEqual(["Gene_A", "Gene_B"]);
  });
});

describe("patchValueToWritable", () => {
  it("maps num / text / empty onto ExcelJS primitives", () => {
    expect(patchValueToWritable({ t: "num", v: 1.5 })).toBe(1.5);
    expect(patchValueToWritable({ t: "text", v: "Gene_A" })).toBe("Gene_A");
    expect(patchValueToWritable({ t: "empty" })).toBeNull();
  });
});

describe("writePatchCell", () => {
  it("writes value, bold, fill and bottom border", () => {
    const cell: WritableCell = {};
    writePatchCell(cell, {
      value: { t: "num", v: 3.14 },
      bold: true,
      fill: "FFFFFF00",
      bottomBorder: true,
    });
    expect(cell.value).toBe(3.14);
    expect(cell.font).toEqual({ bold: true });
    expect(cell.fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFF00" },
    });
    expect(cell.border).toEqual({
      bottom: { style: "medium", color: { argb: BOTTOM_BORDER_ARGB } },
    });
  });

  it("writes null for empty values and skips absent decorations", () => {
    const cell: WritableCell = {};
    writePatchCell(cell, makeCell());
    expect(cell.value).toBeNull();
    expect(cell.fill).toBeUndefined();
    expect(cell.border).toBeUndefined();
    expect(cell.font).toEqual({ bold: false });
  });

  it("merges decorations onto an existing font/border", () => {
    const cell: WritableCell = {
      font: { name: "Arial", bold: false },
      border: { top: { style: "thin" } },
    };
    writePatchCell(cell, makeCell({ bold: true, bottomBorder: true }));
    expect(cell.font).toEqual({ name: "Arial", bold: true });
    expect(cell.border).toEqual({
      top: { style: "thin" },
      bottom: { style: "medium", color: { argb: BOTTOM_BORDER_ARGB } },
    });
  });
});

describe("style sweeps", () => {
  it("applies the font name without dropping other font props", () => {
    const cell: WritableCell = { font: { bold: true } };
    applyFontName(cell, "Times New Roman");
    expect(cell.font).toEqual({ bold: true, name: "Times New Roman" });
  });

  it("applies left alignment", () => {
    const cell: WritableCell = {};
    applyLeftAlign(cell);
    expect(cell.alignment).toEqual({ horizontal: "left" });
  });

  it("applies the identity fill", () => {
    const cell: WritableCell = {};
    applyIdentityFill(cell);
    expect(cell.fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: IDENTITY_FILL_ARGB },
    });
  });
});

describe("applyStyleEnvelope", () => {
  function makeGrid(rows: number, cols: number): GridLike & {
    cells: WritableCell[];
  } {
    const cells: WritableCell[] = [];
    for (let r = 1; r <= rows; r += 1) {
      for (let c = 1; c <= cols; c += 1) {
        cells.push({ value: r * 100 + c });
      }
    }
    return {
      rowCount: rows,
      columnCount: cols,
      getCell: (row, col) => cells[(row - 1) * cols + (col - 1)],
      cells,
    };
  }

  it("sweeps font name and alignment over the whole extent", () => {
    const grid = makeGrid(2, 3);
    applyStyleEnvelope(grid, makePatch({ fontName: "Times New Roman", leftAlign: true }));
    for (const cell of grid.cells) {
      expect(cell.font).toEqual({ name: "Times New Roman" });
      expect(cell.alignment).toEqual({ horizontal: "left" });
    }
  });

  it("fills identity columns for data rows only (row ≥ 2)", () => {
    const grid = makeGrid(3, 2);
    applyStyleEnvelope(grid, makePatch({ identityFillCols: [2] }));
    expect(grid.cells[0].fill).toBeUndefined(); // row 1 col 1
    expect(grid.cells[1].fill).toBeUndefined(); // row 1 col 2 (header)
    expect(grid.cells[2].fill).toBeUndefined(); // row 2 col 1
    expect(grid.cells[3].fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: IDENTITY_FILL_ARGB },
    }); // row 2 col 2
    expect(grid.cells[5].fill).toEqual({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: IDENTITY_FILL_ARGB },
    }); // row 3 col 2
  });

  it("skips sweeps when flags are empty", () => {
    const grid = makeGrid(1, 1);
    applyStyleEnvelope(grid, makePatch());
    expect(grid.cells[0].font).toBeUndefined();
    expect(grid.cells[0].alignment).toBeUndefined();
    expect(grid.cells[0].fill).toBeUndefined();
  });
});

describe("column letters and freeze panes", () => {
  it("maps 1-based columns to letters", () => {
    expect(colLetter(1)).toBe("A");
    expect(colLetter(3)).toBe("C");
    expect(colLetter(26)).toBe("Z");
    expect(colLetter(27)).toBe("AA");
    expect(colLetter(52)).toBe("AZ");
  });

  it("builds the topLeftCell of a frozen view", () => {
    expect(freezeTopLeftCell(2, 1)).toBe("C2");
    expect(freezeTopLeftCell(0, 3)).toBe("A4");
  });
});

describe("sheetPatchColumnCount", () => {
  it("uses the widest row", () => {
    const patch = makePatch({
      rows: [{ cells: [makeCell(), makeCell()] }, { cells: [makeCell()] }],
    });
    expect(sheetPatchColumnCount(patch)).toBe(2);
    expect(sheetPatchColumnCount(makePatch())).toBe(0);
  });
});
