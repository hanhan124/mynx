/**
 * chart-gen.ts — Generate native Excel charts (one per gene sheet) by
 * injecting chart XML directly into the xlsx file via JSZip.
 *
 * This completely replaces the old VBScript + Excel COM approach.
 * No Excel, no cscript, no temporary files needed.
 */
import ExcelJS from 'exceljs';
import { injectChartsIntoWorkbook, type ChartSheetData } from './chart-xml';
import { saveExcelFile } from './excel-io';

export interface ChartGenResult {
  success: boolean;
  chartsCreated?: number;
  reason?: string;
}

/** Default chart fill color (matching the legacy hardcoded blue #3C9FDF). */
export const DEFAULT_CHART_COLOR = '#3C9FDF';

/** Sheets to skip when looking for gene data */
const PROTECTED_SHEETS = new Set([
  'Transformed Data',
  'Summary_All_Genes',
  'Sheet1',
]);

/**
 * Hex color to decimal RGB (matching the Excel COM ForeColor.RGB format:
 * R*65536 + G*256 + B). Kept for backward compatibility.
 */
export function hexToRgb(hex: string): number {
  if (typeof hex !== 'string') return 0x3c9fdf;
  const match = hex.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (!match) return 0x3c9fdf;
  const rgbHex = match[1].slice(0, 6);
  const num = parseInt(rgbHex, 16);
  return Number.isFinite(num) ? num : 0x3c9fdf;
}

/**
 * Extract chart data from the workbook by scanning each gene sheet
 * for the "Group_Name" summary table.
 */
export function extractChartData(
  workbook: ExcelJS.Workbook,
  repeatCount: number
): ChartSheetData[] {
  const sheets: ChartSheetData[] = [];
  let sheetIndex = 0;

  for (const ws of workbook.worksheets) {
    if (PROTECTED_SHEETS.has(ws.name)) continue;
    sheetIndex++;
    const geneName = ws.name;

    // Find the "Group_Name" header row in the summary table
    let groupHeaderRow = 0;
    const rowCount = ws.rowCount;
    for (let r = 1; r <= rowCount; r++) {
      const cell = ws.getRow(r).getCell(1);
      const val = String(cell.value ?? '').trim();
      if (val === 'Group_Name') {
        groupHeaderRow = r;
        break;
      }
    }
    if (groupHeaderRow === 0) continue;

    // Read data below Group_Name header
    const dataPoints: Array<{ name: string; avg: number; stdev: number }> = [];
    for (let r = groupHeaderRow + 1; r <= rowCount; r++) {
      const name = String(ws.getRow(r).getCell(1).value ?? '').trim();
      const avgVal = parseFloat(String(ws.getRow(r).getCell(2).value ?? ''));
      if (!name || isNaN(avgVal)) break;
      const stdevVal =
        repeatCount > 1
          ? parseFloat(String(ws.getRow(r).getCell(3).value ?? ''))
          : 0;
      dataPoints.push({
        name,
        avg: avgVal,
        stdev: isNaN(stdevVal) ? 0 : stdevVal,
      });
    }

    if (dataPoints.length === 0) continue;

    // Get reference gene name from cell A1
    const refGene = String(ws.getRow(1).getCell(1).value ?? 'Ref Gene').trim();

    sheets.push({
      sheetIndex,
      geneName,
      refGene,
      dataPoints,
      groupHeaderRow,
    });
  }

  return sheets;
}

/**
 * Generate native Excel charts (one per gene sheet) by injecting chart XML
 * directly into the xlsx file using JSZip. No Excel COM / VBScript needed.
 *
 * @param workbook - The in-memory exceljs workbook
 * @param excelPath - Path to save the file
 * @param repeatCount - Number of repeats (affects error bars)
 * @param colorHex - Hex color string like "#3C9FDF"
 * @param onProgress - Optional progress callback
 */
export async function generateCharts(
  workbook: ExcelJS.Workbook,
  excelPath: string,
  repeatCount: number,
  colorHex: string = DEFAULT_CHART_COLOR,
  onProgress?: (current: number, total: number) => void
): Promise<ChartGenResult> {
  try {
    // Step 1: Extract chart data from the workbook
    const sheets = extractChartData(workbook, repeatCount);
    if (sheets.length === 0) {
      return {
        success: false,
        reason: '未找到可生成图表的基因数据（没有找到 Group_Name 汇总表）',
      };
    }

    // Step 2: First save the workbook data normally via exceljs
    onProgress?.(0, sheets.length);
    await saveExcelFile(workbook, excelPath);

    // Step 3: Read the saved file back, inject chart XML, re-save
    const { readFile, writeFile } = await import('@tauri-apps/plugin-fs');
    const buffer = await readFile(excelPath);

    const colorRGB = hexToRgb(colorHex);
    const newBuffer = await injectChartsIntoWorkbook(buffer, {
      sheets,
      repeatCount,
      colorRGB,
    });

    // Step 4: Write the modified buffer back
    await writeFile(excelPath, newBuffer);
    onProgress?.(sheets.length, sheets.length);

    return {
      success: true,
      chartsCreated: sheets.length,
    };
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Legacy wrapper — same signature as the old generateVbsCharts for compatibility.
 * Automatically reads the xlsx from disk, injects charts via pure JS.
 *
 * @deprecated Use generateCharts() instead.
 */
export async function generateVbsCharts(
  excelPath: string,
  repeatCount: number,
  colorHex: string = DEFAULT_CHART_COLOR,
  onProgress?: (current: number, total: number) => void
): Promise<ChartGenResult> {
  try {
    // Read the workbook from disk
    const { readFile } = await import('@tauri-apps/plugin-fs');
    const buffer = await readFile(excelPath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

    return await generateCharts(
      workbook,
      excelPath,
      repeatCount,
      colorHex,
      onProgress
    );
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
