/**
 * golden-gen.mjs — regenerate the mynx-qpcr golden fixtures.
 *
 * Replays the LEGACY TypeScript pipeline (src/lib/qpcr-transform.ts +
 * src/lib/qpcr-calculate.ts of the React app) on a synthetic workbook and
 * dumps:
 *   - input-transform.json      raw source sheet snapshot (transform input)
 *   - expected-transform.json   TransformResult minus `v`
 *   - input-calc.json           CalcRequest minus `v`-carrying defaults
 *   - expected-calc.json        CalcResult minus `v` (default options)
 *   - expected-calc-best.json   selectNum = 2
 *   - expected-calc-outlier.json outlierSd = 2.0
 *   - expected-calc-control.json control-relative with control group 对照组
 *   - expected-errors.json      legacy error strings for the three
 *                               validation-failure cases
 *
 * Run from the repo root (D:\vibe_coding\mynx) so the legacy sources and
 * exceljs resolve:
 *   node --experimental-strip-types \
 *     src-tauri/crates/mynx-qpcr/tests/fixtures/golden-gen.mjs
 *
 * Extraction contracts (mirroring the wire format in mynx-contracts):
 *   - SheetSnapshot rows 1..rowCount × cols 1..columnCount; a cell value is
 *     Num for typeof === 'number', Text for typeof === 'string', else Empty;
 *     yellow flag = solid pattern fill with argb FFFFFF00.
 *   - SheetPatch: per-cell bold / fill (solid ARGB as stored by ExcelJS,
 *     except the EAF3FA identity fill which is expressed via
 *     identityFillCols) / medium bottom border; sheet-level Times New Roman
 *     font + left alignment; frozen panes; legacy-computed column widths
 *     (empty list when the legacy code never sets widths); A1 note.
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = FIXTURE_DIR;

// Legacy TS sources live in the React app at the repo root. Resolution is
// cwd-based: the script must run from D:\vibe_coding\mynx.
const ROOT = process.cwd();
const importLegacy = async (rel) => {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    throw new Error(`legacy source not found: ${file} — run this script from the repo root`);
  }
  return import(pathToFileURL(file).href);
};

const { transformQpcrData, detectTransformedGroups } = await importLegacy('src/lib/qpcr-transform.ts');
const { calculateQpcr } = await importLegacy('src/lib/qpcr-calculate.ts');

// ── Synthetic workbook ──────────────────────────────────────────────────────

const REF_GENE = 'GAPDH';
const LONG_GENE = 'VeryLongGeneNameForCappingCheckAlpha'; // > 31 chars → sheet-name cap
const CONTROL_GROUP = '对照组';

// [sample, gene, cq] — cq: number | numeric string | null (missing cell)
const ROWS = [
  ['对照组', 'GAPDH', 20.1], ['对照组', 'GAPDH', 20.3], ['对照组', 'GAPDH', 20.2],
  ['对照组', 'TNF', 24.5], ['对照组', 'TNF', 24.7], ['对照组', 'TNF', 24.6],
  ['对照组', 'IL6', 30.2], ['对照组', 'IL6', null], ['对照组', 'IL6', 30.6],
  ['对照组', '干扰素γ', 26.4], ['对照组', '干扰素γ', 26.5], ['对照组', '干扰素γ', 26.3],
  ['对照组', LONG_GENE, '28.0'], ['对照组', LONG_GENE, 28.1], ['对照组', LONG_GENE, 28.2],
  ['低剂量', 'GAPDH', 20.4], ['低剂量', 'GAPDH', 20.2], ['低剂量', 'GAPDH', 20.5],
  ['低剂量', 'TNF', 23.8], ['低剂量', 'TNF', null], ['低剂量', 'TNF', 24.0],
  ['低剂量', 'IL6', 29.5], ['低剂量', 'IL6', 29.7], ['低剂量', 'IL6', 29.6],
  ['低剂量', '干扰素γ', null], ['低剂量', '干扰素γ', 25.9], ['低剂量', '干扰素γ', null],
  ['低剂量', LONG_GENE, 27.8], ['低剂量', LONG_GENE, 27.9], ['低剂量', LONG_GENE, 27.7],
  ['高剂量', 'GAPDH', 20.6], ['高剂量', 'GAPDH', 20.8], ['高剂量', 'GAPDH', 20.7],
  ['高剂量', 'TNF', 21.0], ['高剂量', 'TNF', 21.2], ['高剂量', 'TNF', 25.0],
  // No IL6 rows for 高剂量: the transform imputes 50s (yellow) for that
  // column, exercising the gene-absent-for-sample branch.
  ['高剂量', '干扰素γ', 24.1], ['高剂量', '干扰素γ', 24.3], ['高剂量', '干扰素γ', 24.2],
  ['高剂量', LONG_GENE, 27.5], ['高剂量', LONG_GENE, 27.4], ['高剂量', LONG_GENE, 27.6],
];

// Junk rows the transform must skip (empty sample / empty gene / blank
// sample), appended so first-seen orders stay intact.
const JUNK_ROWS = [
  ['', 'TNF', 21.0],
  ['对照组', '', 21.0],
  ['   ', 'TNF', 22.0],
];

const HEADERS = ['样本', 'Target', 'Cq']; // CJK + English keyword mix

function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  HEADERS.forEach((h, i) => {
    ws.getRow(1).getCell(i + 1).value = h;
  });
  let r = 2;
  for (const [sample, gene, cq] of [...ROWS, ...JUNK_ROWS]) {
    ws.getRow(r).getCell(1).value = sample;
    ws.getRow(r).getCell(2).value = gene;
    if (cq !== null) ws.getRow(r).getCell(3).value = cq;
    r++;
  }
  // Extra unprotected sheet: legacy calculate deletes it (not in
  // PROTECTED_SHEETS), which is exactly what the worker's
  // __NON_PROTECTED__ expansion models.
  wb.addWorksheet('UserSheet').getCell('A1').value = 'user data';
  return wb;
}

// ── Extraction (SheetSnapshot) ──────────────────────────────────────────────

function classifyValue(v) {
  if (typeof v === 'number') return { t: 'num', v };
  if (typeof v === 'string') return { t: 'text', v };
  return { t: 'empty' };
}

function isYellowFilled(cell) {
  const fill = cell.fill;
  return (
    fill !== undefined &&
    fill.type === 'pattern' &&
    fill.pattern === 'solid' &&
    (fill.fgColor?.argb ?? '').toUpperCase() === 'FFFFFF00'
  );
}

function extractSnapshot(wb, sheetName) {
  const ws = wb.getWorksheet(sheetName);
  // Capture dimensions before any getCell() allocation can inflate them.
  const rowCount = ws.rowCount;
  const columnCount = ws.columnCount;
  const rows = [];
  for (let r = 1; r <= rowCount; r++) {
    const cells = [];
    for (let c = 1; c <= columnCount; c++) {
      const cell = ws.getRow(r).getCell(c);
      cells.push({
        col: c,
        value: classifyValue(cell.value),
        yellowFill: isYellowFilled(cell),
      });
    }
    rows.push({ row: r, cells });
  }
  return { name: ws.name, columnCount, rowCount, rows };
}

// ── Extraction (SheetPatch) ─────────────────────────────────────────────────

const PROTECTED_SHEETS = new Set([
  'Transformed Data',
  'Summary_All_Genes',
  'Summary_Best_Replicates',
  'Summary_Outlier_Removed',
  'Charts_All_Genes',
  'Sheet1',
]);

function extractSheetPatch(ws) {
  const rowCount = ws.rowCount;
  const columnCount = ws.columnCount;
  const rows = [];
  const identityCols = new Set();
  for (let r = 1; r <= rowCount; r++) {
    const cells = [];
    for (let c = 1; c <= columnCount; c++) {
      const cell = ws.getRow(r).getCell(c);
      let fill = null;
      const f = cell.fill;
      if (f?.type === 'pattern' && f?.pattern === 'solid') {
        const argb = (f.fgColor?.argb ?? '').toUpperCase();
        if (argb && argb !== 'EAF3FA') fill = argb;
        if (argb === 'EAF3FA' && r > 1) identityCols.add(c);
      }
      cells.push({
        value: classifyValue(cell.value),
        bold: cell.font?.bold === true,
        fill,
        bottomBorder: cell.border?.bottom?.style === 'medium',
      });
    }
    rows.push({ cells });
  }
  const view = ws.views?.[0];
  const frozen = view?.state === 'frozen';
  const widths = [];
  let anyWidth = false;
  for (let c = 1; c <= columnCount; c++) {
    const w = ws.getColumn(c).width;
    if (typeof w === 'number') {
      widths.push(w);
      anyWidth = true;
    } else {
      widths.push(null);
    }
  }
  const note = ws.getCell(1, 1).note;
  return {
    name: ws.name,
    rows,
    fontName: 'Times New Roman',
    leftAlign: true,
    identityFillCols: [...identityCols].sort((a, b) => a - b),
    freezeX: frozen ? (view.xSplit ?? 0) : 0,
    freezeY: frozen ? (view.ySplit ?? 0) : 0,
    colWidths: anyWidth ? widths : [],
    a1Note: typeof note === 'string' ? note : note?.text ?? null,
  };
}

function extractCalcResult(wb) {
  const sheets = wb.worksheets;
  const geneSheets = sheets.filter((ws) => !PROTECTED_SHEETS.has(ws.name));
  const summary = wb.getWorksheet('Summary_All_Genes');

  const upsertSheets = [extractSheetPatch(summary)];
  for (const gs of geneSheets) upsertSheets.push(extractSheetPatch(gs));
  for (const name of ['Summary_Best_Replicates', 'Summary_Outlier_Removed']) {
    const ws = wb.getWorksheet(name);
    if (ws) upsertSheets.push(extractSheetPatch(ws));
  }

  const headerRow = summary.getRow(1);
  let methodCol = 0;
  for (let c = 1; c <= summary.columnCount; c++) {
    if (String(headerRow.getCell(c).value ?? '').trim() === 'Method') {
      methodCol = c;
      break;
    }
  }
  const methodNote = String(summary.getRow(2).getCell(methodCol).value ?? '').trim();

  const chartSeries = [];
  for (const ws of geneSheets) {
    let headerRowIdx = 0;
    for (let r = 1; r <= ws.rowCount; r++) {
      const val = String(ws.getRow(r).getCell(1).value ?? '').trim();
      if (val === 'Group_Name') {
        headerRowIdx = r;
        break;
      }
    }
    if (!headerRowIdx) continue;
    const points = [];
    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const name = String(ws.getRow(r).getCell(1).value ?? '').trim();
      const avg = parseFloat(String(ws.getRow(r).getCell(2).value ?? ''));
      if (!name || isNaN(avg)) break;
      const stdev = parseFloat(String(ws.getRow(r).getCell(3).value ?? ''));
      points.push({ name, avg, stdev: isNaN(stdev) ? 0 : stdev });
    }
    if (points.length === 0) continue;
    chartSeries.push({
      geneName: ws.name,
      refGene: String(ws.getRow(1).getCell(1).value ?? '').trim(),
      points,
      groupCol: 1,
      dataStartRow: headerRowIdx + 1,
      dataRowCount: points.length,
    });
  }

  return {
    patch: { removeSheets: ['__NON_PROTECTED__'], upsertSheets },
    geneSheetNames: geneSheets.map((ws) => ws.name),
    methodNote,
    chartSeries,
  };
}

// ── Runs ────────────────────────────────────────────────────────────────────

const REPEAT_COUNT = 3;

function writeJson(name, value) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
  console.log('wrote', file);
}

// Transform: one fresh workbook, snapshot taken before the transform pass.
{
  const wb = buildWorkbook();
  const input = { v: 1, source: extractSnapshot(wb, 'Data') };
  writeJson('input-transform.json', input);

  const { geneNames } = transformQpcrData(wb.getWorksheet('Data'), wb);
  const groups = detectTransformedGroups(wb);
  writeJson('expected-transform.json', {
    patch: {
      removeSheets: [],
      upsertSheets: [extractSheetPatch(wb.getWorksheet('Transformed Data'))],
    },
    geneNames,
    groups,
  });

  // Calculate input snapshot: the Transformed Data sheet WITH yellow flags.
  writeJson('input-calc.json', {
    v: 1,
    source: extractSnapshot(wb, 'Transformed Data'),
    repeatCount: REPEAT_COUNT,
    refGene: REF_GENE,
    options: { method: 'ref-normalized', controlGroup: '', selectNum: 0, outlierSd: 0 },
    withChartsSheet: false,
  });
}

// Calculate cases, each on a fresh workbook (transform → calculate).
const CALC_CASES = [
  ['expected-calc.json', {}],
  ['expected-calc-best.json', { selectNum: 2 }],
  ['expected-calc-outlier.json', { outlierSd: 2.0 }],
  ['expected-calc-control.json', { method: 'control-relative', controlGroup: CONTROL_GROUP }],
];
for (const [file, options] of CALC_CASES) {
  const wb = buildWorkbook();
  transformQpcrData(wb.getWorksheet('Data'), wb);
  calculateQpcr(wb, REPEAT_COUNT, REF_GENE, options);
  writeJson(file, extractCalcResult(wb));
}

// Error strings.
const errors = {};
{
  const wb = buildWorkbook();
  transformQpcrData(wb.getWorksheet('Data'), wb);
  try {
    calculateQpcr(wb, 4, REF_GENE, {});
    throw new Error('expected repeat-count mismatch to throw');
  } catch (e) {
    errors.repeatCountMismatch = e.message;
  }
}
{
  const wb = buildWorkbook();
  transformQpcrData(wb.getWorksheet('Data'), wb);
  try {
    calculateQpcr(wb, REPEAT_COUNT, REF_GENE, { selectNum: 2, outlierSd: 2.0 });
    throw new Error('expected mutual-exclusion violation to throw');
  } catch (e) {
    errors.mutuallyExclusive = e.message;
  }
}
{
  const wb = buildWorkbook();
  transformQpcrData(wb.getWorksheet('Data'), wb);
  try {
    calculateQpcr(wb, REPEAT_COUNT, REF_GENE, { method: 'control-relative' });
    throw new Error('expected missing control group to throw');
  } catch (e) {
    errors.missingControlGroup = e.message;
  }
}
writeJson('expected-errors.json', errors);

console.log('done');
