import ExcelJS from 'exceljs';

const PROTECTED_SHEETS = new Set(['Transformed Data', 'Summary_All_Genes', 'Sheet1']);

const BOLD_FONT: Partial<ExcelJS.Font> = { bold: true };

export interface CalculateResult {
  geneSheets: string[];
  summarySheet: string;
}

export function calculateQpcr(
  workbook: ExcelJS.Workbook,
  repeatCount: number,
  refGene: string
): CalculateResult {
  const sourceSheet = workbook.getWorksheet('Transformed Data');
  if (!sourceSheet) throw new Error('Transformed Data 工作表未找到');

  const colCount = sourceSheet.columnCount;
  const headerRow = sourceSheet.getRow(1);

  const geneNames: string[] = [];
  for (let c = 3; c <= colCount; c++) {
    const name = String(headerRow.getCell(c).value ?? '').trim();
    if (name && name !== refGene) geneNames.push(name);
  }

  for (const ws of workbook.worksheets) {
    if (!PROTECTED_SHEETS.has(ws.name)) {
      workbook.removeWorksheet(ws.id);
    }
  }

  let summarySheet = workbook.getWorksheet('Summary_All_Genes');
  if (!summarySheet) {
    summarySheet = workbook.addWorksheet('Summary_All_Genes');
  } else {
    summarySheet.spliceRows(1, summarySheet.rowCount);
  }

  const summaryHeaders = ['Gene', 'Group_Name'];
  for (let i = 1; i <= repeatCount; i++) summaryHeaders.push(`Repeat${i}`);
  summaryHeaders.push('Average', 'Stdev');

  const summaryHeaderRow = summarySheet.getRow(1);
  for (let c = 0; c < summaryHeaders.length; c++) {
    const cell = summaryHeaderRow.getCell(c + 1);
    cell.value = summaryHeaders[c];
    cell.font = BOLD_FONT;
  }

  const geneSheets: string[] = [];
  let summaryRowNum = 1;

  const totalRows = sourceSheet.rowCount;

  for (const gene of geneNames) {
    const sheetName = gene.length > 31 ? gene.substring(0, 31) : gene;
    let geneSheet = workbook.getWorksheet(sheetName);
    if (!geneSheet) {
      geneSheet = workbook.addWorksheet(sheetName);
    } else {
      geneSheet.spliceRows(1, geneSheet.rowCount);
    }
    geneSheets.push(sheetName);

    const headers = ['TBP', 'Target', 'RE', 'Average', 'Stdev', 'Group_Name'];
    const headerRowOut = geneSheet.getRow(1);
    for (let c = 0; c < headers.length; c++) {
      const cell = headerRowOut.getCell(c + 1);
      cell.value = headers[c];
      cell.font = BOLD_FONT;
    }

    const geneCol = findColumn(sourceSheet, gene);
    const refCol = findColumn(sourceSheet, refGene);

    let geneRowNum = 1;

    for (let startRow = 2; startRow <= totalRows; startRow += repeatCount) {
      const groupName = String(sourceSheet.getRow(startRow).getCell(2).value ?? '').trim();

      const reValues: number[] = [];

      for (let r = startRow; r < startRow + repeatCount && r <= totalRows; r++) {
        const row = sourceSheet.getRow(r);
        const targetCt = row.getCell(geneCol).value;
        const refCt = row.getCell(refCol).value;

        const tVal = typeof targetCt === 'number' ? targetCt : parseFloat(String(targetCt));
        const rVal = typeof refCt === 'number' ? refCt : parseFloat(String(refCt));

        geneRowNum++;
        const outRow = geneSheet.getRow(geneRowNum);
        outRow.getCell(1).value = r - 1;
        outRow.getCell(2).value = tVal;
        outRow.getCell(6).value = groupName;

        if (!isNaN(tVal) && !isNaN(rVal)) {
          const re = Math.pow(2, -(tVal - rVal));
          outRow.getCell(3).value = re;
          reValues.push(re);
        } else {
          outRow.getCell(3).value = 'N/A';
        }
      }

      if (reValues.length === repeatCount) {
        const avg = reValues.reduce((a, b) => a + b, 0) / reValues.length;
        const variance = reValues.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / reValues.length;
        const stdev = Math.sqrt(variance);

        for (let i = 0; i < reValues.length; i++) {
          const outRow = geneSheet.getRow(2 + i + (startRow - 2));
          outRow.getCell(4).value = avg;
          outRow.getCell(5).value = stdev;
        }

        summaryRowNum++;
        const sRow = summarySheet.getRow(summaryRowNum);
        sRow.getCell(1).value = gene;
        sRow.getCell(2).value = groupName;
        for (let i = 0; i < reValues.length; i++) {
          sRow.getCell(3 + i).value = reValues[i];
        }
        sRow.getCell(3 + repeatCount).value = avg;
        sRow.getCell(4 + repeatCount).value = stdev;
      }
    }
  }

  return { geneSheets, summarySheet: 'Summary_All_Genes' };
}

function findColumn(sheet: ExcelJS.Worksheet, name: string): number {
  const headerRow = sheet.getRow(1);
  const colCount = sheet.columnCount;
  for (let c = 1; c <= colCount; c++) {
    if (String(headerRow.getCell(c).value ?? '').trim() === name) return c;
  }
  throw new Error(`列 "${name}" 未找到`);
}
