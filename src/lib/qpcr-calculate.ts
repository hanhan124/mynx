import ExcelJS from 'exceljs';

/**
 * qPCR 计算逻辑 — 参照 VBA 参考文件 (2.caculate.txt)
 *
 * 输入: "Transformed Data" 工作表
 *   Col A: Num, Col B: Group, Col C+: 基因(Ct 值)
 *
 * 输出:
 *   - 每个基因一个独立工作表: refGene | targetGene | RE | Avg | Stdev | Group
 *   - "Summary_All_Genes" 汇总表: Gene | Group | Repeat1..N | Average | Stdev
 */

const PROTECTED_SHEETS = new Set(['Transformed Data', 'Summary_All_Genes', 'Sheet1']);
const BOLD_FONT: Partial<ExcelJS.Font> = { bold: true };

export function calculateQpcr(
  workbook: ExcelJS.Workbook,
  repeatCount: number,
  refGene: string
): void {
  const sourceSheet = workbook.getWorksheet('Transformed Data');
  if (!sourceSheet) throw new Error('Transformed Data 工作表未找到');

  const colCount = sourceSheet.columnCount;
  const headerRow = sourceSheet.getRow(1);

  // 收集待计算基因（排除参考基因）
  const geneNames: string[] = [];
  for (let c = 3; c <= colCount; c++) {
    const name = String(headerRow.getCell(c).value ?? '').trim();
    if (name && name !== refGene) geneNames.push(name);
  }

  // 清理旧的基因工作表（保留保护表）
  const toRemove = workbook.worksheets.filter(ws => !PROTECTED_SHEETS.has(ws.name));
  for (const ws of toRemove) workbook.removeWorksheet(ws.id);

  // 创建 / 清空 Summary_All_Genes 汇总表
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
  summaryHeaders.forEach((h, i) => {
    const cell = summaryHeaderRow.getCell(i + 1);
    cell.value = h;
    cell.font = BOLD_FONT;
  });

  const totalRows = sourceSheet.rowCount;
  const refCol = findColumn(sourceSheet, refGene);
  let summaryRowNum = 1;

  for (const gene of geneNames) {
    // 创建基因工作表
    let sheetName = gene.length > 31 ? gene.substring(0, 31) : gene;
    if (PROTECTED_SHEETS.has(sheetName)) sheetName += '_gene';
    let geneSheet = workbook.getWorksheet(sheetName);
    if (!geneSheet) {
      geneSheet = workbook.addWorksheet(sheetName);
    } else {
      geneSheet.spliceRows(1, geneSheet.rowCount);
    }

    // 表头 (VBA 列序: TBP | targetGene | RE | Average | Stdev | Group_Name)
    const headers = [refGene, gene, 'Relative Expression', 'Average', 'Stdev', 'Group_Name'];
    const hRow = geneSheet.getRow(1);
    headers.forEach((h, i) => {
      const cell = hRow.getCell(i + 1);
      cell.value = h;
      cell.font = BOLD_FONT;
    });

    const geneCol = findColumn(sourceSheet, gene);
    let geneRowNum = 1;
    const groupData = new Map<string, { avg: number; stdev: number; repeats: number[] }>();

    // === 按 repeatCount 步长遍历 === (VBA: Step NUM_REPEATS)
    for (let startRow = 2; startRow <= totalRows; startRow += repeatCount) {
      const groupName = String(sourceSheet.getRow(startRow).getCell(2).value ?? '').trim();
      if (!groupName) break;

      const reValues: number[] = [];
      let allValid = true;

      for (let r = 0; r < repeatCount; r++) {
        const currentRow = startRow + r;
        if (currentRow > totalRows) break;

        const row = sourceSheet.getRow(currentRow);
        const targetCt = row.getCell(geneCol).value;
        const refCt = row.getCell(refCol).value;

        const tVal = typeof targetCt === 'number' ? targetCt : parseFloat(String(targetCt));
        const rVal = typeof refCt === 'number' ? refCt : parseFloat(String(refCt));

        geneRowNum++;
        const outRow = geneSheet.getRow(geneRowNum);
        outRow.getCell(1).value = rVal;   // TBP Ct
        outRow.getCell(2).value = tVal;   // Target Ct
        outRow.getCell(6).value = groupName;

        if (!isNaN(tVal) && !isNaN(rVal)) {
          // Relative Expression = 2^-(Target_Ct - Ref_Ct)  (VBA 一致)
          const re = Math.pow(2, -(tVal - rVal));
          outRow.getCell(3).value = re;
          reValues.push(re);
        } else {
          outRow.getCell(3).value = 'N/A';
          allValid = false;
        }
      }

      if (allValid && reValues.length === repeatCount) {
        // 统计: Average + Stdev (sample stdev, n-1)
        const avg = reValues.reduce((a, b) => a + b, 0) / reValues.length;
        const variance = reValues.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / (reValues.length - 1 || 1);
        const stdev = Math.sqrt(variance);

        // 平均值/标准差仅在第一行写入 (与 VBA 一致)
        const firstRow = geneSheet.getRow(geneRowNum - reValues.length + 1);
        firstRow.getCell(4).value = avg;
        firstRow.getCell(5).value = stdev;

        groupData.set(groupName, { avg, stdev, repeats: [...reValues] });

        // === 写入 Summary_All_Genes ===
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

    // === 基因表底部汇总区 (用于图表数据源) ===
    if (groupData.size > 0) {
      const summaryStart = geneRowNum + 3;
      const chartHeader = geneSheet.getRow(summaryStart);
      chartHeader.getCell(1).value = 'Group_Name';
      chartHeader.getCell(2).value = 'Average';
      chartHeader.getCell(3).value = 'Stdev';
      [1, 2, 3].forEach(c => { chartHeader.getCell(c).font = BOLD_FONT; });

      let row = summaryStart + 1;
      for (const [name, data] of groupData) {
        const r = geneSheet.getRow(row++);
        r.getCell(1).value = name;
        r.getCell(2).value = data.avg;
        r.getCell(3).value = data.stdev;
      }
    }
  }
}

function findColumn(sheet: ExcelJS.Worksheet, name: string): number {
  const headerRow = sheet.getRow(1);
  for (let c = 1; c <= sheet.columnCount; c++) {
    if (String(headerRow.getCell(c).value ?? '').trim() === name) return c;
  }
  throw new Error(`列 "${name}" 未找到`);
}
