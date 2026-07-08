import ExcelJS from 'exceljs';

/**
 * qPCR 相对定量计算 — 完全参照 VBA 宏 (2.caculate.txt)
 */

const PROTECTED_SHEETS = new Set(['Transformed Data', 'Summary_All_Genes', 'Sheet1']);
const BOLD_FONT: Partial<ExcelJS.Font> = { bold: true };

function sampleStdev(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function parseNumber(val: unknown): number {
  if (val == null) return NaN;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).trim());
  return isNaN(parsed) ? NaN : parsed;
}

function findColumn(sheet: ExcelJS.Worksheet, name: string): number {
  const headerRow = sheet.getRow(1);
  for (let c = 1; c <= sheet.columnCount; c++) {
    if (String(headerRow.getCell(c).value ?? '').trim() === name) return c;
  }
  throw new Error('Column ' + name + ' not found');
}

export function calculateQpcr(workbook: ExcelJS.Workbook, repeatCount: number, refGene: string): void {
  const sourceSheet = workbook.getWorksheet('Transformed Data');
  if (!sourceSheet) throw new Error('Transformed Data sheet not found');
  const colCount = sourceSheet.columnCount;
  const headerRow = sourceSheet.getRow(1);

  // Collect all gene columns starting from c=3 (column C). Columns A=Num, B=Group are skipped.
  // Must match detectTransformedGenes() in qpcr-transform.ts which also starts from c=3.
  // (Previously started from c=4, which silently dropped any gene written to column C — e.g.
  //  TBP, when the source data had it as an extra reference gene.)
  const geneNames = [];
  for (let c = 3; c <= colCount; c++) {
    const name = String(headerRow.getCell(c).value ?? '').trim();
    if (name && name !== refGene) geneNames.push(name);
  }

  // Clean old gene sheets
  const toRemove = workbook.worksheets.filter((ws: ExcelJS.Worksheet) => !PROTECTED_SHEETS.has(ws.name));
  for (const ws of toRemove) workbook.removeWorksheet(ws.id);

  // Create/clear Summary_All_Genes
  let summarySheet = workbook.getWorksheet('Summary_All_Genes');
  if (!summarySheet) { summarySheet = workbook.addWorksheet('Summary_All_Genes'); }
  else { for (let r = summarySheet.rowCount; r >= 1; r--) summarySheet.spliceRows(r, 1); }

  const summaryHeaders = ['Gene', 'Group_Name'];
  for (let i = 1; i <= repeatCount; i++) summaryHeaders.push('Repeat' + i);
  summaryHeaders.push('Average', 'Stdev');
  const shRow = summarySheet.getRow(1);
  summaryHeaders.forEach((h, i) => { const cell = shRow.getCell(i + 1); cell.value = h; cell.font = BOLD_FONT; });

  const refCol = findColumn(sourceSheet, refGene);
  let summaryDataRow = 2;

  for (const targetGene of geneNames) {
    const targetCol = findColumn(sourceSheet, targetGene);
    let sheetName = targetGene.length > 31 ? targetGene.substring(0, 31) : targetGene;
    if (PROTECTED_SHEETS.has(sheetName)) sheetName += '_gene';

    let geneSheet = workbook.getWorksheet(sheetName);
    if (!geneSheet) { geneSheet = workbook.addWorksheet(sheetName); }
    else { for (let r = geneSheet.rowCount; r >= 1; r--) geneSheet.spliceRows(r, 1); }

    const headers = [refGene, targetGene, 'Relative Expression', 'Average', 'Stdev', 'Group_Name'];
    const hRow = geneSheet.getRow(1);
    headers.forEach((h, i) => { const cell = hRow.getCell(i + 1); cell.value = h; cell.font = BOLD_FONT; });

    let outputRow = 2;
    const groupMap = new Map();

    let lastDataRow = 1;
    for (let r = sourceSheet.rowCount; r >= 2; r--) {
      const g = String(sourceSheet.getRow(r).getCell(2).value ?? '').trim();
      if (g) { lastDataRow = r; break; }
    }

    for (let startRow = 2; startRow <= lastDataRow; startRow += repeatCount) {
      const groupName = String(sourceSheet.getRow(startRow).getCell(2).value ?? '').trim();
      if (!groupName) break;
      const reValues = [];
      let allValid = true;

      for (let r = 0; r < repeatCount; r++) {
        const currRow = startRow + r;
        if (currRow > lastDataRow) { allValid = false; break; }
        const row = sourceSheet.getRow(currRow);
        const tVal = parseNumber(row.getCell(targetCol).value);
        const rVal = parseNumber(row.getCell(refCol).value);

        const outRow = geneSheet.getRow(outputRow + r);
        outRow.getCell(1).value = rVal;
        outRow.getCell(2).value = tVal;
        outRow.getCell(6).value = groupName;

        if (!isNaN(tVal) && !isNaN(rVal)) {
          const re = Math.pow(2, -(tVal - rVal));
          outRow.getCell(3).value = re;
          reValues.push(re);
        } else {
          outRow.getCell(3).value = 'N/A';
          allValid = false;
        }
      }

      if (allValid && reValues.length === repeatCount) {
        const avg = reValues.reduce((a, b) => a + b, 0) / reValues.length;
        const stdev = sampleStdev(reValues);
        geneSheet.getRow(outputRow).getCell(4).value = avg;
        geneSheet.getRow(outputRow).getCell(5).value = stdev;
        groupMap.set(groupName, { repeats: [...reValues], avg, stdev });

        const sRow = summarySheet.getRow(summaryDataRow++);
        sRow.getCell(1).value = targetGene;
        sRow.getCell(2).value = groupName;
        for (let i = 0; i < reValues.length; i++) sRow.getCell(3 + i).value = reValues[i];
        sRow.getCell(3 + repeatCount).value = avg;
        sRow.getCell(4 + repeatCount).value = stdev;
      }
      outputRow += repeatCount;
    }

    if (groupMap.size > 0) {
      const summaryTableStart = outputRow + 2;
      const chartHeader = geneSheet.getRow(summaryTableStart);
      chartHeader.getCell(1).value = 'Group_Name';
      chartHeader.getCell(2).value = 'Average';
      chartHeader.getCell(3).value = 'Stdev';
      [1, 2, 3].forEach(c => chartHeader.getCell(c).font = BOLD_FONT);
      let row = summaryTableStart + 1;
      for (const [name, data] of groupMap) {
        const r = geneSheet.getRow(row++);
        r.getCell(1).value = name;
        r.getCell(2).value = data.avg;
        r.getCell(3).value = data.stdev;
      }
    }
  }
}
