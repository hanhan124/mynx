import { Command as ShellCommand, type Child } from "@tauri-apps/plugin-shell";
import { tempDir, resourceDir } from "@tauri-apps/api/path";
import { readFile, writeFile, remove } from "@tauri-apps/plugin-fs";
import { findRscript } from "@/shared/platform/r-runtime";
import { isWindows, joinPath, psQuote, shQuote } from "@/shared/platform/files";

export type QpcrPlotKind = "bar" | "heatmap";

export interface QpcrPlotRunConfig {
  filePath: string;
  sheetName: string;
  outputDir: string;
  outputPrefix: string;
  kind: QpcrPlotKind;
  format: "png" | "svg" | "pdf";
  width: number;
  height: number;
  dpi: number;
  gene: string;
  barFill: string;
  barBorder: string;
  barBorderWidth: number;
  barWidth: number;
  errorWidth: number;
  errorCap: number;
  errorColor: string;
  showRawPoints: boolean;
  showXTick: boolean;
  xAngle: number;
  xHjust: number;
  xVjust: number;
  tickLength: number;
  axisWidth: number;
  titleSize: number;
  yLabelSize: number;
  yTickSize: number;
  xTickSize: number;
  titleVjust: number;
  baseSize: number;
  wrapPlus: boolean;
  scientificNotation: boolean;
  autoSize: boolean;
  batchMode: boolean;
  enableStats: boolean;
  showStats: boolean;
  sigMode: string;
  controlGroup: string;
  statTest: string;
  pAdjustMethod: string;
  labelStyle: string;
  showNs: boolean;
  sigFile: string;
  bracketWidth: number;
  bracketTextSize: number;
  bracketLabelGap: number;
  bracketStep: number;
  customPairs: Array<{ gene: string; control: string; treatment: string }>;
  heatmapScale: "row" | "column" | "none";
  exportPng: boolean;
  exportPdf: boolean;
  pngDpi: number;
  pdfWidth: number;
  pdfHeight: number;
  pngWidth: number;
  pngHeight: number;
  heatmapClusterRows: boolean;
  heatmapClusterCols: boolean;
  showCellValues: boolean;
  cellTextSize: number;
  zlim: number;
  useGeneClusters: boolean;
  geneClusters: Record<string, string[]>;
  installMissing: boolean;
}

export interface QpcrPlotRunResult {
  ok: boolean;
  outputDir?: string;
  files?: string[];
  statisticsFile?: string;
  error?: string;
}

let activeChild: Child | null = null;
let wasCancelled = false;

export async function cancelQpcrPlot(): Promise<boolean> {
  if (!activeChild) return false;
  wasCancelled = true;
  try {
    await activeChild.kill();
    return true;
  } catch {
    wasCancelled = false;
    return false;
  }
}

export async function runQpcrPlot(
  config: QpcrPlotRunConfig,
  onLog: (text: string) => void,
): Promise<QpcrPlotRunResult> {
  if (!config.filePath.trim()) return { ok: false, error: "请先选择 qPCR 数据文件。" };
  if (!config.outputDir.trim()) return { ok: false, error: "请先选择输出文件夹。" };
  const rscript = await findRscript();
  if (!rscript) return { ok: false, error: "尚未安装 R，请先安装 R 后再运行 qPCR 绘图。" };

  wasCancelled = false;
  const tmp = joinPath(await tempDir(), `mynx_qpcr_plot_${Date.now()}.json`);
  // R on some Windows installations still uses a non-UTF-8 native locale.
  // Copying the workbook to an ASCII-only temp path avoids failures for users
  // whose project folders contain Chinese or other non-ASCII characters.
  const inputCopy = joinPath(await tempDir(), `mynx_qpcr_input_${Date.now()}.xlsx`);
  const resources = await resourceDir();
  const runner = joinPath(resources, "r", "qpcr_plot_runner.R");
  const inputBytes = await readFile(config.filePath);
  await writeFile(inputCopy, inputBytes);
  await writeFile(tmp, new TextEncoder().encode(JSON.stringify({ ...config, filePath: inputCopy })));

  const win = await isWindows();
  const command = win
    ? ShellCommand.create("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `& ${psQuote(rscript)} ${psQuote(runner)} ${psQuote(tmp)}`,
      ])
    : ShellCommand.create("bash", ["-c", `${shQuote(rscript)} ${shQuote(runner)} ${shQuote(tmp)}`]);

  let logs = "";
  let stdoutBuffer = "";
  let stderrBuffer = "";
  const forward = (chunk: string, stream: "stdout" | "stderr") => {
    logs += chunk;
    const buffered = `${stream === "stdout" ? stdoutBuffer : stderrBuffer}${chunk}`;
    const lines = buffered.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    if (stream === "stdout") stdoutBuffer = remainder;
    else stderrBuffer = remainder;
    for (const line of lines) if (line.trim()) onLog(line);
  };
  const flush = () => {
    for (const line of [stdoutBuffer, stderrBuffer]) if (line.trim()) onLog(line);
  };
  command.stdout.on("data", (chunk: string) => forward(chunk, "stdout"));
  command.stderr.on("data", (chunk: string) => forward(chunk, "stderr"));

  let result: { code: number | null };
  try {
    result = await new Promise<{ code: number | null }>((resolve, reject) => {
      command.once("close", (payload) => resolve({ code: payload.code }));
      command.once("error", (error) => reject(new Error(error)));
      void command.spawn().then((child) => { activeChild = child; }).catch(reject);
    });
  } catch (error) {
    activeChild = null;
    flush();
    await remove(tmp).catch(() => undefined);
    await remove(inputCopy).catch(() => undefined);
    return { ok: false, error: logs.trim() || (error instanceof Error ? error.message : "R 进程启动失败") };
  }
  activeChild = null;
  flush();
  await remove(tmp).catch(() => undefined);
  await remove(inputCopy).catch(() => undefined);
  if (wasCancelled) {
    wasCancelled = false;
    return { ok: false, error: "QPCR_PLOT_CANCELLED" };
  }
  if (result.code !== 0) return { ok: false, error: logs.trim() || "R 未能生成 qPCR 图表" };

  const prefix = config.outputPrefix.trim() || `qpcr-${config.kind}`;
  const settingsPath = joinPath(config.outputDir, `${prefix}-settings.json`);
  await writeFile(settingsPath, new TextEncoder().encode(JSON.stringify(config, null, 2))).catch(() => undefined);
  const statPath = config.kind === "bar"
    ? joinPath(config.outputDir, config.sigFile.trim() || "statistical_analysis_summary.csv")
    : undefined;
  return { ok: true, outputDir: config.outputDir, statisticsFile: statPath };
}
