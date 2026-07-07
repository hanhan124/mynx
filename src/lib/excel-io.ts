import ExcelJS from 'exceljs';

export interface ExcelFile {
  path: string;
  name: string;
  workbook: ExcelJS.Workbook;
}

export async function readExcelFile(path: string, name: string): Promise<ExcelFile> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const buffer = await readFile(path);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return { path, name, workbook };
}

export function getSheetNames(wb: ExcelJS.Workbook): string[] {
  return wb.worksheets.map(s => s.name);
}

export function getSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find(s => s.name === name);
}

export async function saveExcelFile(wb: ExcelJS.Workbook, path: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  await writeFile(path, new Uint8Array(buffer));
}
