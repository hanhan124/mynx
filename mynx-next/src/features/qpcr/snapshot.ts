import type { CellValue } from "../../lib/contracts/generated/qpcr/CellValue.js";
import type { SheetSnapshot } from "../../lib/contracts/generated/qpcr/SheetSnapshot.js";

/**
 * Pure readers over worker-produced sheet snapshots. Ports of the legacy
 * `detectTransformedGenes` / `detectTransformedGroups` (qpcr-transform.ts),
 * operating on the JSON snapshot instead of a live ExcelJS workbook so the
 * main thread never parses xlsx.
 */

export const TRANSFORMED_SHEET = "Transformed Data";

/** Flattens a snapshot cell to its display string (legacy `String(v ?? "")`). */
export function cellText(value: CellValue): string {
  if (value.t === "text") return value.v;
  if (value.t === "num") return String(value.v);
  return "";
}

/** Reads one 1-based cell from a snapshot (""). */
export function cellAt(snapshot: SheetSnapshot, row: number, col: number): CellValue {
  const rowSnapshot = snapshot.rows.find((entry) => entry.row === row);
  const cell = rowSnapshot?.cells.find((entry) => entry.col === col);
  return cell?.value ?? { t: "empty" };
}

/**
 * Detects gene names from an existing "Transformed Data" snapshot:
 * header row 1, columns 3..columnCount (legacy parity).
 */
export function detectTransformedGenes(snapshot: SheetSnapshot): string[] {
  const header = snapshot.rows.find((entry) => entry.row === 1);
  if (!header) return [];
  const genes: string[] = [];
  for (const cell of header.cells) {
    if (cell.col < 3) continue;
    const name = cellText(cell.value).trim();
    if (name) genes.push(name);
  }
  return genes;
}

/**
 * Detects distinct group names from column B (col 2), preserving first-seen
 * row order (legacy parity).
 */
export function detectTransformedGroups(snapshot: SheetSnapshot): string[] {
  const seen = new Set<string>();
  const groups: string[] = [];
  for (const row of snapshot.rows) {
    if (row.row < 2) continue;
    const name = cellAt(snapshot, row.row, 2);
    const text =
      name.t === "text" ? name.v : name.t === "num" ? String(name.v) : "";
    const trimmed = text.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      groups.push(trimmed);
    }
  }
  return groups;
}
