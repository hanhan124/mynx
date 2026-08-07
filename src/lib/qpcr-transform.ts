import ExcelJS from 'exceljs';

const TARGET_HEADERS = ['Target', 'Gene', '基因'];
const SAMPLE_HEADERS = ['Sample', 'Group', '样本', '分组'];
const CT_HEADERS = ['Cq', 'Ct'];

const YELLOW_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFF00' },
};

const BOLD_FONT: Partial<ExcelJS.Font> = { bold: true, name: 'Times New Roman' };

// 表头配色，与 Summary_All_Genes 保持一致：Num/Group=蓝，基因列=深蓝。
const HEADER_COLORS = {
  identity: 'DDEBF7',
  repeats: 'BDD7EE',
};

// 标识列（样本/组名）数据格底色：比表头更浅的蓝，柔和不刺眼。
const IDENTITY_COLUMN_FILL = 'EAF3FA';

/** 按显示宽度计算字符串长度：CJK/全角字符按 2 个字符宽计算（Excel 列宽单位）。 */
function displayLength(text: string): number {
  let len = 0;
  for (const ch of text) {
    len += /[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F]/.test(ch) ? 2 : 1;
  }
  return len;
}

function detectColumn(headers: string[], keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]?.toString().trim().toLowerCase();
    if (h && keywords.some(k => k.toLowerCase() === h)) return i;
  }
  return -1;
}

interface TransformResult {
  geneNames: string[];
}

/**
 * Detects gene names from an existing "Transformed Data" sheet.
 * Returns empty array if the sheet doesn't exist (file not yet transformed).
 * Columns: 1=Num, 2=Group, 3+=gene names
 */
export function detectTransformedGenes(workbook: ExcelJS.Workbook): string[] {
  const sheet = workbook.getWorksheet('Transformed Data');
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const colCount = sheet.columnCount;
  const genes: string[] = [];
  for (let c = 3; c <= colCount; c++) {
    const name = String(headerRow.getCell(c).value ?? '').trim();
    if (name) genes.push(name);
  }
  return genes;
}

/**
 * Detects the distinct group names from an existing "Transformed Data" sheet,
 * preserving their first-seen order. Used to populate the control-group selector
 * for the "相对对照" (ΔΔCt) calculation method.
 * Column 2 (B) holds the group name for each row.
 */
export function detectTransformedGroups(workbook: ExcelJS.Workbook): string[] {
  const sheet = workbook.getWorksheet('Transformed Data');
  if (!sheet) return [];

  const groups: string[] = [];
  const seen = new Set<string>();
  for (let r = 2; r <= sheet.rowCount; r++) {
    const name = String(sheet.getRow(r).getCell(2).value ?? '').trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      groups.push(name);
    }
  }
  return groups;
}

export function transformQpcrData(sourceSheet: ExcelJS.Worksheet, targetWorkbook: ExcelJS.Workbook): TransformResult {
  const headerRow = sourceSheet.getRow(1);
  const colCount = sourceSheet.columnCount;

  const headers: string[] = [];
  for (let c = 1; c <= colCount; c++) {
    headers.push(String(headerRow.getCell(c).value ?? ''));
  }

  let targetCol = detectColumn(headers, TARGET_HEADERS);
  let sampleCol = detectColumn(headers, SAMPLE_HEADERS);
  let ctCol = detectColumn(headers, CT_HEADERS);

  if (targetCol === -1 && headers.length >= 6) {
    const fallbackTarget = headers[2]?.toLowerCase() ?? '';
    if (
      fallbackTarget.includes('target') ||
      fallbackTarget.includes('gene') ||
      fallbackTarget.includes('基因')
    ) {
      targetCol = 2;
      sampleCol = 4;
      ctCol = 5;
    }
  }

  if (targetCol === -1) throw new Error('未找到 Target/Gene/基因 列');
  if (sampleCol === -1) throw new Error('未找到 Sample/Group/样本/分组 列');
  if (ctCol === -1) throw new Error('未找到 Cq/Ct 列');

  // 转换为 ExcelJS 的列号（1 基）
  const targetColIndex = targetCol + 1;
  const sampleColIndex = sampleCol + 1;
  const ctColIndex = ctCol + 1;

  // 创建数据结构：sample -> gene -> Cq 值数组
  const sampleMap = new Map<string, Map<string, Array<{ value: number | null; missing: boolean }>>>();
  const geneSet = new Set<string>();

  const rowCount = sourceSheet.rowCount;
  for (let r = 2; r <= rowCount; r++) {
    const row = sourceSheet.getRow(r);
    const gene = String(row.getCell(targetColIndex).value ?? '').trim();
    const sample = String(row.getCell(sampleColIndex).value ?? '').trim();
    const ctVal = row.getCell(ctColIndex).value;

    if (!gene || !sample) continue;

    let ct: number | null = null;
    let missing = false;
    if (typeof ctVal === 'number') {
      ct = ctVal;
    } else {
      const parsed = parseFloat(String(ctVal));
      if (isNaN(parsed) || ctVal === '' || ctVal === null) {
        missing = true;
      } else {
        ct = parsed;
      }
    }

    geneSet.add(gene);
    if (!sampleMap.has(sample)) sampleMap.set(sample, new Map());
    const geneMap = sampleMap.get(sample)!;
    if (!geneMap.has(gene)) geneMap.set(gene, []);
    geneMap.get(gene)!.push({ value: ct, missing });
  }

  const geneNames = Array.from(geneSet);

  // 删除已存在的转换表
  const existing = targetWorkbook.getWorksheet('Transformed Data');
  if (existing) targetWorkbook.removeWorksheet(existing.id);

  // 创建新的转换表
  const sheet = targetWorkbook.addWorksheet('Transformed Data');

  // 写入表头
  const headerCells = ['Num', 'Group'];
  for (const g of geneNames) headerCells.push(g);

  const headerRowOut = sheet.getRow(1);
  for (let c = 0; c < headerCells.length; c++) {
    const cell = headerRowOut.getCell(c + 1);
    cell.value = headerCells[c];
    cell.font = BOLD_FONT;
    // 与 Summary_All_Genes 一致的配色：前两列（Num/Group）蓝，基因列深蓝。
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: c < 2 ? HEADER_COLORS.identity : HEADER_COLORS.repeats },
    };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FFB0B0B0' } },
    };
  }

  // 写入数据
  const samples = Array.from(sampleMap.keys());
  let rowNum = 1;

  for (const sample of samples) {
    const geneMap = sampleMap.get(sample)!;

    const sampleMaxReps = Math.max(...Array.from(geneMap.values()).map(vals => vals.length));

    for (let rep = 0; rep < sampleMaxReps; rep++) {
      rowNum++;
      const rowOut = sheet.getRow(rowNum);

      rowOut.getCell(1).value = rowNum - 1;
      rowOut.getCell(2).value = sample;

      for (let g = 0; g < geneNames.length; g++) {
        const cell = rowOut.getCell(g + 3);
        const vals = geneMap.get(geneNames[g]);

        if (!vals || vals.length === 0) {
          cell.value = 50;
          cell.fill = YELLOW_FILL;
          continue;
        }

        const valid = vals.find(v => !v.missing && v.value !== null);
        const item = vals[rep];
        if (item && !item.missing && item.value !== null) {
          cell.value = item.value;
        } else if (valid) {
          cell.value = valid.value;
          cell.fill = YELLOW_FILL;
        } else {
          cell.value = 50;
          cell.fill = YELLOW_FILL;
        }
      }
    }
  }

  // 冻结首行 + 前两列（Num/Group）：横向滚动时表头和编号/组名始终可见。
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2' }];

  // 统一字体与左对齐：Times New Roman 全表生效（含表头），数值单元格默认右对齐也改成左对齐。
  // 样本/组名列（第 2 列）数据格整列加浅蓝底色，突出标识列。
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, colNumber) => {
      cell.font = { ...(cell.font ?? {}), name: 'Times New Roman' };
      cell.alignment = { horizontal: 'left' };
      if (rowNumber > 1 && colNumber === 2) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IDENTITY_COLUMN_FILL } };
      }
    });
  });

  // 自动调整列宽：按显示宽度取能完整显示最宽内容（含首行表头）的最小宽度，
  // 中文/全角字符算 2 个字符宽，避免表头被截断，也不留空白。
  // 前两列（Num/Group 标识列）额外加宽，方便阅读。
  sheet.columns.forEach((column, index) => {
    let maxLength = 0;
    if (column.eachCell) {
      column.eachCell((cell) => {
        const length = cell.value ? displayLength(String(cell.value)) : 10;
        if (length > maxLength) maxLength = length;
      });
    }
    column.width = maxLength + (index < 2 ? 6 : 0);
  });

  return { geneNames };
}
