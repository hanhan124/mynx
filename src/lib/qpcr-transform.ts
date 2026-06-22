import ExcelJS from 'exceljs';

const TARGET_HEADERS = ['Target', 'Gene', '基因'];
const SAMPLE_HEADERS = ['Sample', 'Group', '样本', '分组'];
const CT_HEADERS = ['Cq', 'Ct'];

const YELLOW_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFF00' },
};

const BOLD_FONT: Partial<ExcelJS.Font> = { bold: true };

function detectColumn(headers: string[], keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]?.toString().trim().toLowerCase();
    if (h && keywords.some(k => k.toLowerCase() === h)) return i;
  }
  return -1;
}

export interface TransformResult {
  sheet: ExcelJS.Worksheet;
  geneNames: string[];
}

export function transformQpcrData(sourceSheet: ExcelJS.Worksheet): TransformResult {
  const headerRow = sourceSheet.getRow(1);
  const colCount = sourceSheet.columnCount;

  const headers: string[] = [];
  for (let c = 1; c <= colCount; c++) {
    headers.push(String(headerRow.getCell(c).value ?? ''));
  }

  let targetCol = detectColumn(headers, TARGET_HEADERS);
  let sampleCol = detectColumn(headers, SAMPLE_HEADERS);
  let ctCol = detectColumn(headers, CT_HEADERS);

  if (targetCol === -1) targetCol = 1;
  if (sampleCol === -1) sampleCol = 3;
  if (ctCol === -1) ctCol = 4;

  const sampleMap = new Map<string, Map<string, number[]>>();
  const geneSet = new Set<string>();

  const rowCount = sourceSheet.rowCount;
  for (let r = 2; r <= rowCount; r++) {
    const row = sourceSheet.getRow(r);
    const gene = String(row.getCell(targetCol + 1).value ?? '').trim();
    const sample = String(row.getCell(sampleCol + 1).value ?? '').trim();
    const ctVal = row.getCell(ctCol + 1).value;

    if (!gene || !sample) continue;

    const ct = typeof ctVal === 'number' ? ctVal : parseFloat(String(ctVal));
    if (isNaN(ct)) continue;

    geneSet.add(gene);
    if (!sampleMap.has(sample)) sampleMap.set(sample, new Map());
    const geneMap = sampleMap.get(sample)!;
    if (!geneMap.has(gene)) geneMap.set(gene, []);
    geneMap.get(gene)!.push(ct);
  }

  const geneNames = Array.from(geneSet);

  const maxReps = Math.max(
    1,
    ...Array.from(sampleMap.values()).flatMap(gm =>
      Array.from(gm.values()).map(v => v.length)
    )
  );

  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Transformed Data');

  const headerCells = ['Num', 'Group'];
  for (const g of geneNames) headerCells.push(g);

  const headerRowOut = sheet.getRow(1);
  for (let c = 0; c < headerCells.length; c++) {
    const cell = headerRowOut.getCell(c + 1);
    cell.value = headerCells[c];
    cell.font = BOLD_FONT;
  }

  const samples = Array.from(sampleMap.keys()).sort();
  let rowNum = 1;

  for (const sample of samples) {
    const geneMap = sampleMap.get(sample)!;

    for (let rep = 0; rep < maxReps; rep++) {
      rowNum++;
      const rowOut = sheet.getRow(rowNum);
      rowOut.getCell(1).value = rowNum - 1;
      rowOut.getCell(2).value = sample;

      for (let g = 0; g < geneNames.length; g++) {
        const cell = rowOut.getCell(g + 3);
        const vals = geneMap.get(geneNames[g]);

        if (vals && vals.length > rep) {
          cell.value = vals[rep];
        } else if (vals && vals.length > 0) {
          cell.value = vals[0];
          cell.fill = YELLOW_FILL;
        } else {
          cell.value = 50;
          cell.fill = YELLOW_FILL;
        }
      }
    }
  }

  return { sheet, geneNames };
}
