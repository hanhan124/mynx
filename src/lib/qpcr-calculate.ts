import ExcelJS from 'exceljs';

/**
 * qPCR 相对定量计算 — 完全参照 VBA 宏 (2.caculate.txt)
 */

const PROTECTED_SHEETS = new Set(['Transformed Data', 'Summary_All_Genes', 'Summary_Best_Replicates', 'Summary_Outlier_Removed', 'Charts_All_Genes', 'Sheet1']);
const BOLD_FONT: Partial<ExcelJS.Font> = { bold: true, name: 'Times New Roman' };

/**
 * qPCR 计算方法（原 "mode"）。
 *  - 'ref-normalized'     相对内参：每个样本 2^-(ΔCt) = 2^-(target - ref)。默认方法。
 *  - 'control-relative'   相对对照：在相对内参基础上，再除以对照组(control)的平均值，
 *                         使对照组归一化表达量约等于 1，其余组为相对倍数（标准 ΔΔCt）。
 */
export type CalcMethod = 'ref-normalized' | 'control-relative';

/** 计算方法的中文标签，用于界面显示。 */
export const CALC_METHOD_LABELS: Record<CalcMethod, string> = {
  'ref-normalized': '相对内参',
  'control-relative': '相对对照',
};

/** 计算方法的英文标签，用于写入 Excel 以标注结果来源（Excel 内容保持纯英文）。 */
export const CALC_METHOD_LABELS_EN: Record<CalcMethod, string> = {
  'ref-normalized': 'Reference-normalized',
  'control-relative': 'Control-relative (ΔΔCt)',
};

export interface CalcOptions {
  method?: CalcMethod;
  /** method 为 'control-relative' 时必填：作为对照的组名。 */
  controlGroup?: string;
  /** 择优重复数：0 关闭；≥2 时为每个样本组选出标准差最低的这 K 个重复，生成 Summary_Best_Replicates。 */
  selectNum?: number;
  /** 离群值剔除阈值（组内 SD 的倍数）：0 关闭；>0 时迭代剔除偏离组均值超过该倍数的重复，生成 Summary_Outlier_Removed。 */
  outlierSd?: number;
}

function sampleStdev(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** 校验择优重复数：0 关闭；否则必须是 ≥2 且 ≤ repeatCount 的整数（1 无意义，不允许）。 */
function validateSelectNum(selectNum: number, repeatCount: number): number {
  if (selectNum === 0) return selectNum;
  if (!Number.isInteger(selectNum) || selectNum < 2) {
    throw new Error('择优重复数必须是 0（关闭）或大于等于 2 的整数');
  }
  if (selectNum > repeatCount) {
    throw new Error(`择优重复数 ${selectNum} 不能大于重复次数 ${repeatCount}`);
  }
  return selectNum;
}

/** 校验离群值剔除阈值：0 关闭；否则必须是 >0 的有限数。 */
function validateOutlierSd(outlierSd: number): number {
  if (outlierSd === 0) return outlierSd;
  if (!Number.isFinite(outlierSd) || outlierSd <= 0) {
    throw new Error('离群值剔除阈值必须是大于 0 的数（或 0 关闭）');
  }
  return outlierSd;
}

/**
 * 从 values 中选出 k 个下标，使这 k 个值组成的样本标准差最小：穷举所有 C(n,k) 组合，
 * 平局取先枚举到的。n 上限 12（C(12,6)=924 个组合），每次计算微秒级，开销可忽略。
 */
function bestKCombination(values: number[], k: number): number[] {
  const n = values.length;
  let best: number[] = [];
  let bestStdev = Infinity;
  const combo: number[] = [];
  const search = (start: number) => {
    if (combo.length === k) {
      const stdev = sampleStdev(combo.map((i) => values[i]));
      if (stdev < bestStdev) {
        bestStdev = stdev;
        best = [...combo];
      }
      return;
    }
    for (let i = start; i < n; i++) {
      combo.push(i);
      search(i + 1);
      combo.pop();
    }
  };
  search(0);
  return best;
}

function parseNumber(val: unknown): number {
  if (val == null) return NaN;
  if (typeof val === 'number') return val;
  const parsed = parseFloat(String(val).trim());
  return isNaN(parsed) ? NaN : parsed;
}

function validateRepeatCount(repeatCount: number): number {
  if (!Number.isInteger(repeatCount) || repeatCount < 1) {
    throw new Error('重复次数必须是大于等于 1 的整数');
  }
  return repeatCount;
}

interface GroupRange {
  groupName: string;
  startRow: number;
  endRow: number;
}

function readGroupRanges(sheet: ExcelJS.Worksheet, repeatCount: number): GroupRange[] {
  let lastDataRow = 1;
  for (let r = sheet.rowCount; r >= 2; r--) {
    const groupName = String(sheet.getRow(r).getCell(2).value ?? '').trim();
    if (groupName) {
      lastDataRow = r;
      break;
    }
  }

  const ranges: GroupRange[] = [];
  let row = 2;
  while (row <= lastDataRow) {
    const groupName = String(sheet.getRow(row).getCell(2).value ?? '').trim();
    if (!groupName) {
      row++;
      continue;
    }

    const startRow = row;
    while (
      row <= lastDataRow &&
      String(sheet.getRow(row).getCell(2).value ?? '').trim() === groupName
    ) {
      row++;
    }

    const actualRepeatCount = row - startRow;
    if (actualRepeatCount !== repeatCount) {
      throw new Error(
        `分组 "${groupName}" 从第 ${startRow} 行开始有 ${actualRepeatCount} 个重复，` +
        `但当前设置为 ${repeatCount} 个。请检查重复次数或 Transformed Data 数据。`
      );
    }
    ranges.push({ groupName, startRow, endRow: row });
  }
  return ranges;
}

function findColumn(sheet: ExcelJS.Worksheet, name: string): number {
  const headerRow = sheet.getRow(1);
  for (let c = 1; c <= sheet.columnCount; c++) {
    if (String(headerRow.getCell(c).value ?? '').trim() === name) return c;
  }
  throw new Error('Column ' + name + ' not found');
}

// ── 原始 Ct 列复制（Summary_All_Genes 末尾追加内参/目标基因 Ct 列用） ──
// 与 qpcr-transform.ts 中的 YELLOW_FILL 保持一致：Transformed Data 里被标黄的
// 缺失填补格（用其他有效重复补数或填 50），复制到汇总表时要一并带上黄色标记。
const YELLOW_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFF00' },
};

// 标识列（基因/组名）数据格底色：比表头更浅的蓝，柔和不刺眼。
const IDENTITY_COLUMN_FILL = 'EAF3FA';

function isYellowFilled(cell: ExcelJS.Cell): boolean {
  const fill = cell.fill;
  return (
    fill !== undefined &&
    fill.type === 'pattern' &&
    fill.pattern === 'solid' &&
    (fill.fgColor?.argb ?? '').toUpperCase() === 'FFFFFF00'
  );
}

/** 按显示宽度计算字符串长度：CJK/全角字符按 2 个字符宽计算（Excel 列宽单位）。 */
function displayLength(text: string): number {
  let len = 0;
  for (const ch of text) {
    len += /[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F]/.test(ch) ? 2 : 1;
  }
  return len;
}

// 列分组配色（浅色底纹），让列多的时候能按区块一眼区分：
// 基因/组名=蓝、重复=深蓝、均值/标准差=绿、方法=橙、内参Ct=黄、目标Ct=紫。
const HEADER_COLORS = {
  identity: 'DDEBF7', // Gene / Group_Name
  repeats: 'BDD7EE',  // Repeat1..N
  stats: 'E2EFDA',    // Average / Stdev
  method: 'FCE4D6',   // Method
  refCt: 'FFF2CC',    // {refGene}_Ct_R*
  targetCt: 'E4DFEC', // Target_Ct_R*
};

/**
 * 写入汇总表（Summary_All_Genes / Summary_Best_Replicates）的表头行并冻结窗格
 * （首行 + 前两列），返回 Method 列的 1-based 列号（Ct 列从它后面排起）。
 */
function writeSummaryHeaders(sheet: ExcelJS.Worksheet, repCount: number, refGene: string): number {
  const summaryHeaders: string[] = [];
  const headerColors: string[] = [];
  const pushHeader = (h: string, color: string) => {
    summaryHeaders.push(h);
    headerColors.push(color);
  };
  pushHeader('Gene', HEADER_COLORS.identity);
  pushHeader('Group_Name', HEADER_COLORS.identity);
  for (let i = 1; i <= repCount; i++) pushHeader('Repeat' + i, HEADER_COLORS.repeats);
  pushHeader('Average', HEADER_COLORS.stats);
  pushHeader('Stdev', HEADER_COLORS.stats);
  pushHeader('Method', HEADER_COLORS.method);
  const methodColIndex = summaryHeaders.length; // 1-based index of the 'Method' column
  // 末尾追加原始 Ct 列：每个重复各一列，内参基因在前、目标基因在后。
  for (let i = 1; i <= repCount; i++) pushHeader(`${refGene}_Ct_R${i}`, HEADER_COLORS.refCt);
  for (let i = 1; i <= repCount; i++) pushHeader(`Target_Ct_R${i}`, HEADER_COLORS.targetCt);
  const headerRow = sheet.getRow(1);
  summaryHeaders.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = BOLD_FONT;
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: headerColors[i] },
    };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FFB0B0B0' } },
    };
  });
  // 冻结首行 + 前两列（Gene/Group_Name）：横向滚动时表头和基因/组名始终可见。
  sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2' }];
  return methodColIndex;
}

/** 汇总表统一字体与左对齐；基因/组名列（1、2 列）数据格整列加浅蓝底色，并自动调整列宽。 */
function applySummaryFormatting(sheet: ExcelJS.Worksheet): void {
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell, colNumber) => {
      cell.font = { ...(cell.font ?? {}), name: 'Times New Roman' };
      cell.alignment = { horizontal: 'left' };
      if (rowNumber > 1 && (colNumber === 1 || colNumber === 2)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IDENTITY_COLUMN_FILL } };
      }
    });
  });

  // 自动调整列宽：按显示宽度取能完整显示最宽内容（含首行表头）的最小宽度，
  // 中文/全角字符算 2 个字符宽，避免表头被截断，也不留空白。
  // 前两列（Gene/Group_Name 标识列）额外加宽，方便阅读。
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
}

/** 从 Summary_All_Genes 一行读取该基因×样本组的各重复表达量与原始 Ct 数据。 */
function readSummaryRowData(
  row: ExcelJS.Row,
  sumMethodCol: number,
  n: number
): {
  geneName: string;
  groupName: string;
  repeats: number[];
  refCts: number[];
  targetCts: number[];
  refFilled: boolean[];
  targetFilled: boolean[];
  methodNote: string;
  allValid: boolean;
} {
  const repeats: number[] = [];
  const refCts: number[] = [];
  const targetCts: number[] = [];
  const refFilled: boolean[] = [];
  const targetFilled: boolean[] = [];
  let allValid = true;
  for (let i = 0; i < n; i++) {
    const reVal = parseNumber(row.getCell(3 + i).value);
    const refCell = row.getCell(sumMethodCol + 1 + i);
    const targetCell = row.getCell(sumMethodCol + 1 + n + i);
    const refVal = parseNumber(refCell.value);
    const targetVal = parseNumber(targetCell.value);
    repeats.push(reVal);
    refCts.push(refVal);
    targetCts.push(targetVal);
    refFilled.push(isYellowFilled(refCell));
    targetFilled.push(isYellowFilled(targetCell));
    if (isNaN(reVal) || isNaN(refVal) || isNaN(targetVal)) allValid = false;
  }
  return {
    geneName: String(row.getCell(1).value ?? '').trim(),
    groupName: String(row.getCell(2).value ?? ''),
    repeats,
    refCts,
    targetCts,
    refFilled,
    targetFilled,
    methodNote: String(row.getCell(sumMethodCol).value ?? '').trim(),
    allValid,
  };
}

/**
 * 基于 Summary_All_Genes 生成 Summary_Best_Replicates：对每个基因×样本组，
 * 从 N 个重复中穷举选出标准差最低的 K 个（K=selectNum），连同原始内参/目标 Ct 一起写入新表，
 * 格式与 Summary_All_Genes 一致。selectNum 为 0 时删除旧表（功能关闭）。
 */
function generateBestReplicatesSheet(
  workbook: ExcelJS.Workbook,
  selectNum: number,
  repeatCount: number,
  refGene: string
): void {
  if (selectNum === 0) {
    const old = workbook.getWorksheet('Summary_Best_Replicates');
    if (old) workbook.removeWorksheet(old.id);
    return;
  }

  const summarySheet = workbook.getWorksheet('Summary_All_Genes');
  if (!summarySheet) return; // 前置步骤未执行，无从派生

  let bestSheet = workbook.getWorksheet('Summary_Best_Replicates');
  if (!bestSheet) { bestSheet = workbook.addWorksheet('Summary_Best_Replicates'); }
  else { for (let r = bestSheet.rowCount; r >= 1; r--) bestSheet.spliceRows(r, 1); }

  const bestMethodCol = writeSummaryHeaders(bestSheet, selectNum, refGene);
  // 标注该表性质：仅作内部 QC / 探索性参考（只保留标准差最低的 K 个重复会低估变异），
  // 正式报告应以 Summary_All_Genes（全部重复）为准。
  bestSheet.getCell('A1').note =
    'QC reference only: each row keeps the K replicates with the lowest standard deviation. ' +
    'This understates variability and is not a standard statistical result — ' +
    'use Summary_All_Genes (all replicates) for reporting.';
  // Summary_All_Genes 的 Method 列号：内参/目标 Ct 列从它后面排起，需单独定位（两表重复数不同）。
  const sumMethodCol = findColumn(summarySheet, 'Method');
  const n = repeatCount; // Summary_All_Genes 每个组的重复数

  let outRow = 2;
  for (let r = 2; r <= summarySheet.rowCount; r++) {
    const d = readSummaryRowData(summarySheet.getRow(r), sumMethodCol, n);
    if (!d.geneName) continue; // 跳过空行
    if (!d.allValid) continue; // 与 Summary_All_Genes 一致：不完整组不写行

    const bestIdx = bestKCombination(d.repeats, selectNum);
    if (bestIdx.length !== selectNum) continue;

    const out = bestSheet.getRow(outRow++);
    out.getCell(1).value = d.geneName;
    out.getCell(2).value = d.groupName;
    for (let i = 0; i < bestIdx.length; i++) out.getCell(3 + i).value = d.repeats[bestIdx[i]];
    const selectedRe = bestIdx.map((i) => d.repeats[i]);
    const avg = selectedRe.reduce((a, b) => a + b, 0) / selectedRe.length;
    const stdev = sampleStdev(selectedRe);
    out.getCell(3 + selectNum).value = avg;
    out.getCell(4 + selectNum).value = stdev;
    // Method 列在原方法名后追加标注，让每一行都能自证这是"最低标准差子集"的 QC 结果。
    out.getCell(bestMethodCol).value = d.methodNote ? `${d.methodNote} (Best-K subset)` : d.methodNote;
    // 末尾追加的 Ct 列：只取被选中的重复，保留黄色填补标记。
    for (let i = 0; i < bestIdx.length; i++) {
      const idx = bestIdx[i];
      const refCell = out.getCell(bestMethodCol + 1 + i);
      refCell.value = isNaN(d.refCts[idx]) ? 'N/A' : d.refCts[idx];
      if (d.refFilled[idx]) refCell.fill = YELLOW_FILL;
      const targetCell = out.getCell(bestMethodCol + 1 + selectNum + i);
      targetCell.value = isNaN(d.targetCts[idx]) ? 'N/A' : d.targetCts[idx];
      if (d.targetFilled[idx]) targetCell.fill = YELLOW_FILL;
    }
  }

  applySummaryFormatting(bestSheet);
}

/**
 * 迭代式离群值剔除：每次计算当前保留重复的均值与 SD，剔除偏离均值超过 outlierSd×SD
 * 且偏离最大的那个重复，重新计算后再重复，直到没有重复超标（未超阈值则不剔除）。
 * 结果写入 Summary_Outlier_Removed，格式同 Summary_All_Genes；被剔除的重复留空，
 * 末尾追加 Removed 列标注被剔除的重复编号（规则客观、可披露用于发表）。
 * outlierSd 为 0 时删除旧表（功能关闭）。
 */
function generateOutlierRemovedSheet(
  workbook: ExcelJS.Workbook,
  outlierSd: number,
  repeatCount: number,
  refGene: string
): void {
  if (outlierSd === 0) {
    const old = workbook.getWorksheet('Summary_Outlier_Removed');
    if (old) workbook.removeWorksheet(old.id);
    return;
  }

  const summarySheet = workbook.getWorksheet('Summary_All_Genes');
  if (!summarySheet) return; // 前置步骤未执行，无从派生

  let sheet = workbook.getWorksheet('Summary_Outlier_Removed');
  if (!sheet) { sheet = workbook.addWorksheet('Summary_Outlier_Removed'); }
  else { for (let r = sheet.rowCount; r >= 1; r--) sheet.spliceRows(r, 1); }

  const methodCol = writeSummaryHeaders(sheet, repeatCount, refGene);
  sheet.getCell('A1').note =
    `Outlier removal: replicates deviating from the group mean by more than ${outlierSd}×SD ` +
    '(mean/SD recomputed after each removal) are excluded; the remaining replicates are reported. ' +
    'Removed replicate numbers are listed in the Removed column.';
  // 末尾追加 Removed 列，标注被剔除的重复编号，便于方法学披露。
  const removedCol = methodCol + 1 + 2 * repeatCount;
  const hc = sheet.getCell(1, removedCol);
  hc.value = 'Removed';
  hc.font = BOLD_FONT;
  hc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F2F2' } };
  hc.border = { bottom: { style: 'medium', color: { argb: 'FFB0B0B0' } } };

  const sumMethodCol = findColumn(summarySheet, 'Method');
  const n = repeatCount; // Summary_All_Genes 每个组的重复数

  let outRow = 2;
  for (let r = 2; r <= summarySheet.rowCount; r++) {
    const d = readSummaryRowData(summarySheet.getRow(r), sumMethodCol, n);
    if (!d.geneName) continue; // 跳过空行
    if (!d.allValid) continue; // 与 Summary_All_Genes 一致：不完整组不写行

    // 迭代剔除：每次剔除偏离均值最大且超过阈值的重复，直到无超标。
    const keep: number[] = d.repeats.map((_, i) => i);
    const removed: number[] = [];
    while (keep.length > 1) {
      const keptVals = keep.map((i) => d.repeats[i]);
      const mean = keptVals.reduce((a, b) => a + b, 0) / keptVals.length;
      const sd = sampleStdev(keptVals);
      if (!(sd > 0)) break; // 全部相等，无离群可剔
      let worstPos = 0;
      let maxDev = 0;
      for (let j = 0; j < keep.length; j++) {
        const dev = Math.abs(d.repeats[keep[j]] - mean);
        if (dev > maxDev) { maxDev = dev; worstPos = j; }
      }
      if (maxDev > outlierSd * sd) {
        removed.push(keep[worstPos]);
        keep.splice(worstPos, 1);
      } else {
        break;
      }
    }
    removed.sort((a, b) => a - b);

    const out = sheet.getRow(outRow++);
    out.getCell(1).value = d.geneName;
    out.getCell(2).value = d.groupName;
    const keptSet = new Set(keep);
    for (let i = 0; i < n; i++) {
      if (keptSet.has(i)) out.getCell(3 + i).value = d.repeats[i]; // 被剔除的留空
    }
    const keptVals = keep.map((i) => d.repeats[i]);
    out.getCell(3 + n).value = keptVals.reduce((a, b) => a + b, 0) / keptVals.length;
    out.getCell(4 + n).value = sampleStdev(keptVals);
    // Method 列标注剔除规则，便于方法学披露。
    out.getCell(methodCol).value = d.methodNote
      ? `${d.methodNote} (Outlier-removed: |Δ|>${outlierSd}×SD)`
      : d.methodNote;
    for (let i = 0; i < n; i++) {
      if (!keptSet.has(i)) continue;
      const refCell = out.getCell(methodCol + 1 + i);
      refCell.value = isNaN(d.refCts[i]) ? 'N/A' : d.refCts[i];
      if (d.refFilled[i]) refCell.fill = YELLOW_FILL;
      const targetCell = out.getCell(methodCol + 1 + n + i);
      targetCell.value = isNaN(d.targetCts[i]) ? 'N/A' : d.targetCts[i];
      if (d.targetFilled[i]) targetCell.fill = YELLOW_FILL;
    }
    out.getCell(removedCol).value =
      removed.length > 0 ? 'R' + removed.map((i) => i + 1).join(', R') : '-';
  }

  applySummaryFormatting(sheet);
}

export function calculateQpcr(
  workbook: ExcelJS.Workbook,
  repeatCount: number,
  refGene: string,
  options: CalcOptions = {}
): void {
  repeatCount = validateRepeatCount(repeatCount);
  const method: CalcMethod = options.method ?? 'ref-normalized';
  const controlGroup = (options.controlGroup ?? '').trim();
  if (method === 'control-relative' && !controlGroup) {
    throw new Error('相对对照方法需要指定对照组');
  }
  // 在任何破坏性改动（删旧表）之前先校验，避免参数不合法留下半个清空的 workbook。
  const selectNum = validateSelectNum(options.selectNum ?? 0, repeatCount);
  const outlierSd = validateOutlierSd(options.outlierSd ?? 0);
  if (selectNum >= 2 && outlierSd > 0) {
    throw new Error('择优重复数与离群值剔除不能同时启用，请只选一种');
  }

  const sourceSheet = workbook.getWorksheet('Transformed Data');
  if (!sourceSheet) throw new Error('Transformed Data sheet not found');
  const colCount = sourceSheet.columnCount;
  const headerRow = sourceSheet.getRow(1);
  const refCol = findColumn(sourceSheet, refGene);
  // Validate all group boundaries before deleting any previous result sheets.
  // This keeps a bad repeat-count selection from leaving a half-cleared workbook.
  const groupRanges = readGroupRanges(sourceSheet, repeatCount);

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

  // Excel 内容保持纯英文，避免混入中文标签。
  const methodLabel = CALC_METHOD_LABELS_EN[method];
  const methodNote =
    method === 'control-relative'
      ? `${methodLabel} (control: ${controlGroup})`
      : methodLabel;
  // control-relative 下第 3 列存的是"归一化到对照组"的相对表达量。
  const reColHeader = method === 'control-relative' ? 'Normalized Expression' : 'Relative Expression';

  const methodColIndex = writeSummaryHeaders(summarySheet, repeatCount, refGene);

  let summaryDataRow = 2;

  // 记录生成的基因表，最后统一应用字体/对齐样式。
  const generatedGeneSheets: ExcelJS.Worksheet[] = [];

  for (const targetGene of geneNames) {
    const targetCol = findColumn(sourceSheet, targetGene);
    let sheetName = targetGene.length > 31 ? targetGene.substring(0, 31) : targetGene;
    if (PROTECTED_SHEETS.has(sheetName)) sheetName += '_gene';

    let geneSheet = workbook.getWorksheet(sheetName);
    if (!geneSheet) { geneSheet = workbook.addWorksheet(sheetName); }
    else { for (let r = geneSheet.rowCount; r >= 1; r--) geneSheet.spliceRows(r, 1); }
    generatedGeneSheets.push(geneSheet);

    const headers = [refGene, targetGene, reColHeader, 'Average', 'Stdev', 'Group_Name', 'Method'];
    const hRow = geneSheet.getRow(1);
    headers.forEach((h, i) => { const cell = hRow.getCell(i + 1); cell.value = h; cell.font = BOLD_FONT; });

    const groupMap = new Map();

    // Pass 1: read contiguous group blocks and compute the raw per-replicate
    // relative expression 2^-(target - ref). Do not derive block boundaries
    // from repeatCount: a workbook may contain a different number of rows for
    // one group, and fixed-size stepping shifts every following group.
    interface Block { groupName: string; startRow: number; refVals: number[]; targetVals: number[]; refFilled: boolean[]; targetFilled: boolean[]; rawRe: number[]; allValid: boolean; }
    const blocks: Block[] = [];
    for (const range of groupRanges) {
      const { groupName, startRow: groupStartRow, endRow } = range;
      const refVals: number[] = [];
      const targetVals: number[] = [];
      const refFilled: boolean[] = [];
      const targetFilled: boolean[] = [];
      const rawRe: number[] = [];
      let allValid = true;
      for (let r = 0; r < endRow - groupStartRow; r++) {
        const currRow = groupStartRow + r;
        const row = sourceSheet.getRow(currRow);
        const targetCell = row.getCell(targetCol);
        const refCell = row.getCell(refCol);
        const tVal = parseNumber(targetCell.value);
        const rVal = parseNumber(refCell.value);
        refVals.push(rVal);
        targetVals.push(tVal);
        refFilled.push(isYellowFilled(refCell));
        targetFilled.push(isYellowFilled(targetCell));
        if (!isNaN(tVal) && !isNaN(rVal)) {
          rawRe.push(Math.pow(2, -(tVal - rVal)));
        } else {
          allValid = false;
        }
      }
      blocks.push({ groupName, startRow: groupStartRow, refVals, targetVals, refFilled, targetFilled, rawRe, allValid });
    }

    // Divisor: 1 for ref-normalized; the control group's mean raw RE for
    // control-relative (so the control group averages ~1).
    let divisor = 1;
    if (method === 'control-relative') {
      const ctrl = blocks.find(b => b.groupName === controlGroup && b.allValid && b.rawRe.length === repeatCount);
      if (!ctrl) throw new Error(`未找到对照组 "${controlGroup}" 的有效数据（基因 ${targetGene}）`);
      const ctrlAvg = ctrl.rawRe.reduce((a, b) => a + b, 0) / ctrl.rawRe.length;
      if (!(ctrlAvg > 0)) throw new Error(`对照组 "${controlGroup}" 平均值无效（基因 ${targetGene}）`);
      divisor = ctrlAvg;
    }

    // Pass 2: write rows using the (possibly scaled) expression values.
    let outputRow = 2;
    for (const block of blocks) {
      const { groupName, refVals, targetVals, refFilled, targetFilled, rawRe, allValid } = block;
      const reValues: number[] = [];
      for (let r = 0; r < refVals.length; r++) {
        const outRow = geneSheet.getRow(outputRow + r);
        outRow.getCell(1).value = refVals[r];
        outRow.getCell(2).value = targetVals[r];
        outRow.getCell(6).value = groupName;
        outRow.getCell(7).value = methodNote;
        const rVal = refVals[r];
        const tVal = targetVals[r];
        if (!isNaN(tVal) && !isNaN(rVal)) {
          const re = Math.pow(2, -(tVal - rVal)) / divisor;
          outRow.getCell(3).value = re;
          reValues.push(re);
        } else {
          outRow.getCell(3).value = 'N/A';
        }
      }

      if (allValid && rawRe.length === repeatCount && reValues.length === repeatCount) {
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
        sRow.getCell(methodColIndex).value = methodNote;
        // 末尾追加的 Ct 列：直接从 Transformed Data 复制（含标黄的填补值）。
        for (let i = 0; i < repeatCount; i++) {
          const refCell = sRow.getCell(methodColIndex + 1 + i);
          refCell.value = isNaN(refVals[i]) ? 'N/A' : refVals[i];
          if (refFilled[i]) refCell.fill = YELLOW_FILL;
          const targetCell = sRow.getCell(methodColIndex + 1 + repeatCount + i);
          targetCell.value = isNaN(targetVals[i]) ? 'N/A' : targetVals[i];
          if (targetFilled[i]) targetCell.fill = YELLOW_FILL;
        }
      }
      outputRow += refVals.length;
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

  // 生成的基因表同样统一为 Times New Roman + 左对齐。
  for (const geneSheet of generatedGeneSheets) {
    geneSheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.font = { ...(cell.font ?? {}), name: 'Times New Roman' };
        cell.alignment = { horizontal: 'left' };
      });
    });
  }

  applySummaryFormatting(summarySheet);

  // 择优重复：基于 Summary_All_Genes 生成 Summary_Best_Replicates（selectNum 为 0 时清理旧表）。
  generateBestReplicatesSheet(workbook, selectNum, repeatCount, refGene);
  // 离群值剔除：基于 Summary_All_Genes 生成 Summary_Outlier_Removed（outlierSd 为 0 时清理旧表）。
  generateOutlierRemovedSheet(workbook, outlierSd, repeatCount, refGene);
}
