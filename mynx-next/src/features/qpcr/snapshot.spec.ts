import { describe, expect, it } from "vitest";
import type { CellSnapshot } from "../../lib/contracts/generated/qpcr/CellSnapshot.js";
import type { RowSnapshot } from "../../lib/contracts/generated/qpcr/RowSnapshot.js";
import type { SheetSnapshot } from "../../lib/contracts/generated/qpcr/SheetSnapshot.js";
import {
  TRANSFORMED_SHEET,
  cellAt,
  detectTransformedGenes,
  detectTransformedGroups,
} from "./snapshot.js";

function cell(col: number, value: CellSnapshot["value"], yellowFill = false): CellSnapshot {
  return { col, value, yellowFill };
}

function row(index: number, cells: CellSnapshot[]): RowSnapshot {
  return { row: index, cells };
}

function makeSnapshot(rows: RowSnapshot[]): SheetSnapshot {
  return {
    name: TRANSFORMED_SHEET,
    columnCount: rows.reduce((max, r) => Math.max(max, r.cells.length), 0),
    rowCount: rows.length,
    rows,
  };
}

describe("detectTransformedGenes", () => {
  it("reads header row 1 from column 3 onward", () => {
    const snapshot = makeSnapshot([
      row(1, [
        cell(1, { t: "text", v: "Sample" }),
        cell(2, { t: "text", v: "Group_Name" }),
        cell(3, { t: "text", v: "Gapdh" }),
        cell(4, { t: "text", v: "c-Myc" }),
      ]),
    ]);
    expect(detectTransformedGenes(snapshot)).toEqual(["Gapdh", "c-Myc"]);
  });

  it("ignores blank headers and covers numeric cells", () => {
    const snapshot = makeSnapshot([
      row(1, [cell(3, { t: "text", v: "  " }), cell(4, { t: "num", v: 7 })]),
    ]);
    expect(detectTransformedGenes(snapshot)).toEqual(["7"]);
  });

  it("returns empty for a snapshot without a header row", () => {
    expect(detectTransformedGenes(makeSnapshot([row(2, [cell(3, { t: "text", v: "A" })])]))).toEqual(
      [],
    );
  });
});

describe("detectTransformedGroups", () => {
  it("collects distinct groups from column B in first-seen order", () => {
    const snapshot = makeSnapshot([
      row(1, [cell(2, { t: "text", v: "Group_Name" })]),
      row(2, [cell(2, { t: "text", v: "Control" })]),
      row(3, [cell(2, { t: "text", v: "  Control " })]),
      row(4, [cell(2, { t: "text", v: "Treatment" })]),
      row(5, [cell(2, { t: "empty" })]),
    ]);
    expect(detectTransformedGroups(snapshot)).toEqual(["Control", "Treatment"]);
  });

  it("returns empty when only the header exists", () => {
    const snapshot = makeSnapshot([row(1, [cell(2, { t: "text", v: "Group_Name" })])]);
    expect(detectTransformedGroups(snapshot)).toEqual([]);
  });
});

describe("cellAt", () => {
  it("reads a 1-based cell and defaults to empty", () => {
    const snapshot = makeSnapshot([row(1, [cell(2, { t: "num", v: 5 })])]);
    expect(cellAt(snapshot, 1, 2)).toEqual({ t: "num", v: 5 });
    expect(cellAt(snapshot, 3, 2)).toEqual({ t: "empty" });
  });
});
