import { Command as ShellCommand, type Child } from "@tauri-apps/plugin-shell";
import { tempDir } from "@tauri-apps/api/path";
import { resourceDir } from "@tauri-apps/api/path";
import { writeFile, remove } from "@tauri-apps/plugin-fs";
import { findRscript, resetRscriptCache } from "@/shared/platform/r-runtime";
import { isWindows, joinPath, psQuote, shQuote } from "@/shared/platform/files";

export interface ChartRunConfig {
  filePath: string;
  outputDir: string;
  template: string;
  kind: string;
  galleryUrl?: string;
  sourceRepoPath?: string;
  x: string;
  y: string;
  group?: string;
  size?: string;
  title: string;
  subtitle?: string;
  caption?: string;
  plotTag?: string;
  color: string;
  format: "png" | "svg" | "pdf" | "tiff" | "eps";
  width?: number;
  height?: number;
  dpi?: number;
  ggTheme?: string;
  baseSize?: number;
  fontFamily?: string;
  showLegend?: boolean;
  legendPosition?: string;
  showGrid?: boolean;
  showTitle?: boolean;
  titleSize?: number;
  titleHjust?: number;
  axisTextSize?: number;
  axisTitleSize?: number;
  publicationPreset?: string;
  palette?: string;
  paletteReverse?: boolean;
  pointSize?: number;
  lineWidth?: number;
  barWidth?: number;
  alpha?: number;
  axisLineWidth?: number;
  gridLineWidth?: number;
  panelBorder?: boolean;
  showRawPoints?: boolean;
  showStats?: boolean;
  statTest?: string;
  pAdjustMethod?: string;
  heatmapClusterRows?: boolean;
  heatmapClusterCols?: boolean;
  heatmapScale?: "none" | "row" | "column";
  installMissing: boolean;
  verified?: boolean;
}
let activeChartChild: Child | null = null;
let activeRInstallChild: Child | null = null;
let chartRunWasCancelled = false;
let rInstallWasCancelled = false;

export async function cancelChartRun(): Promise<boolean> {
  const activeChild = activeChartChild ?? activeRInstallChild;
  if (!activeChild) return false;
  if (activeChartChild) chartRunWasCancelled = true;
  else rInstallWasCancelled = true;
  try {
    await activeChild.kill();
    return true;
  } catch {
    chartRunWasCancelled = false;
    rInstallWasCancelled = false;
    return false;
  }
}

/** 用户明确确认后才调用系统包管理器下载 R。 */
export async function installR(
  onLog: (text: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  if (!(await isWindows()))
    return {
      ok: false,
      error: "请从 https://cloud.r-project.org 安装 R，完成后回到这里重试。",
    };
  rInstallWasCancelled = false;
  onLog("正在通过 Windows 包管理器安装 R…");
  try {
    const command = ShellCommand.create("winget", [
      "install",
      "--id",
      "RProject.R",
      "--exact",
      "--accept-package-agreements",
      "--accept-source-agreements",
    ]);
    command.stdout.on("data", (line: string) => onLog(line));
    command.stderr.on("data", (line: string) => onLog(line));
    const result = await new Promise<{ code: number | null }>((resolve, reject) => {
      command.once("close", (payload) => resolve({ code: payload.code }));
      command.once("error", (error) => reject(new Error(error)));
      void command.spawn().then((child) => { activeRInstallChild = child; }).catch(reject);
    });
    activeRInstallChild = null;
    if (rInstallWasCancelled) {
      rInstallWasCancelled = false;
      resetRscriptCache();
      return { ok: false, error: "R_INSTALL_CANCELLED" };
    }
    resetRscriptCache();
    return result.code === 0
      ? { ok: true }
      : { ok: false, error: "R 安装未完成，请检查 Windows 包管理器后重试。" };
  } catch {
    activeRInstallChild = null;
    if (rInstallWasCancelled) {
      rInstallWasCancelled = false;
      resetRscriptCache();
      return { ok: false, error: "R_INSTALL_CANCELLED" };
    }
    return {
      ok: false,
      error: "无法启动 Windows 包管理器，请从 cloud.r-project.org 安装 R。",
    };
  }
}

export async function runChart(
  config: ChartRunConfig,
  onLog: (text: string) => void,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  if (!config.filePath.trim()) return { ok: false, error: "请先选择数据文件。" };
  if (!config.outputDir.trim()) return { ok: false, error: "请先选择输出文件夹。" };
  chartRunWasCancelled = false;
  const rscript = await findRscript();
  if (!rscript) return { ok: false, error: "尚未安装 R。请先安装 R 后再生成图表。" };
  const tmp = joinPath(await tempDir(), `mynx_chart_${Date.now()}.json`);
  const resources = await resourceDir();
  const runner = joinPath(resources, "r", "chart_runner.R");
  const outputPath = joinPath(
    config.outputDir,
    `mynx-${config.template}.${config.format}`,
  );
  const payload = config.verified
    ? {
        ...config,
        outputPath,
        templateDir: joinPath(resources, "r", "chart-templates", config.template),
      }
    : config;
  await writeFile(tmp, new TextEncoder().encode(JSON.stringify(payload)));
  const win = await isWindows();
  const command = win
    ? ShellCommand.create("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `& ${psQuote(rscript)} ${psQuote(runner)} ${psQuote(tmp)}`,
      ])
    : ShellCommand.create("bash", [
        "-c",
        `${shQuote(rscript)} ${shQuote(runner)} ${shQuote(tmp)}`,
      ]);
  let logs = "";
  let stdoutBuffer = "";
  let stderrBuffer = "";
  const forwardLines = (chunk: string, stream: "stdout" | "stderr") => {
    logs += chunk;
    const buffered = `${stream === "stdout" ? stdoutBuffer : stderrBuffer}${chunk}`;
    const lines = buffered.split(/\r?\n/);
    const remainder = lines.pop() ?? "";
    if (stream === "stdout") stdoutBuffer = remainder;
    else stderrBuffer = remainder;
    for (const line of lines) if (line.trim()) onLog(line);
  };
  const flushBufferedLines = () => {
    for (const line of [stdoutBuffer, stderrBuffer]) if (line.trim()) onLog(line);
    stdoutBuffer = "";
    stderrBuffer = "";
  };
  command.stdout.on("data", (chunk: string) => forwardLines(chunk, "stdout"));
  command.stderr.on("data", (chunk: string) => forwardLines(chunk, "stderr"));
  let result: { code: number | null };
  try {
    result = await new Promise<{ code: number | null }>((resolve, reject) => {
      command.once("close", (payload) => resolve({ code: payload.code }));
      command.once("error", (error) => reject(new Error(error)));
      void command.spawn().then((child) => { activeChartChild = child; }).catch(reject);
    });
  } catch (error) {
    activeChartChild = null;
    flushBufferedLines();
    await remove(tmp).catch(() => {});
    return {
      ok: false,
      error: logs.trim() || (error instanceof Error ? error.message : "R 进程启动失败"),
    };
  }
  activeChartChild = null;
  flushBufferedLines();
  await remove(tmp).catch(() => {});
  if (chartRunWasCancelled) {
    chartRunWasCancelled = false;
    return { ok: false, error: "CHART_RUN_CANCELLED" };
  }
  if (result.code !== 0) return { ok: false, error: logs.trim() || "R 未能生成图表" };
  const ext = config.format;
  const sidecar = joinPath(
    config.outputDir,
    `mynx-${config.template}.${ext}.json`,
  );
  await writeFile(
    sidecar,
    new TextEncoder().encode(
      JSON.stringify(
        {
          version: 1,
          createdAt: new Date().toISOString(),
          outputPath: joinPath(config.outputDir, `mynx-${config.template}.${ext}`),
          template: {
            id: config.template,
            kind: config.kind,
            sourceUrl: config.galleryUrl ?? null,
            sourceRepoPath: config.sourceRepoPath ?? null,
          },
          output: {
            format: ext,
            width: config.width ?? null,
            height: config.height ?? null,
            dpi: config.dpi ?? null,
          },
          config,
        },
        null,
        2,
      ),
    ),
  ).catch(() => {});
  return {
    ok: true,
    output: joinPath(config.outputDir, `mynx-${config.template}.${ext}`),
  };
}
