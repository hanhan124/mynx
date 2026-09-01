import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import {
  IconAdjustmentsHorizontal,
  IconChartBar,
  IconChartDots3,
  IconChevronRight,
  IconDownload,
  IconFileSpreadsheet,
  IconFolderOpen,
  IconGrid4x4,
  IconInfoCircle,
  IconPlayerPlayFilled,
  IconRefresh,
  IconSettings,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import type ExcelJS from "exceljs";
import { getSheetNames, readExcelFile, type ExcelFile } from "@/lib/excel-io";
import { cancelQpcrPlot, runQpcrPlot, type QpcrPlotRunConfig } from "@/lib/qpcr-plot-runner";
import { installR } from "@/lib/charts/runner";
import { checkRscript, resetRscriptCache } from "@/shared/platform/r-runtime";
import { joinPath, openInShell, readDirAny } from "@/shared/platform/files";
import { showToast } from "@/components/Toast";
import { useDropZone } from "@/hooks/useDropZone";
import { useLanguage } from "@/lib/i18n";

type PlotKind = "bar" | "heatmap";
type PlotFormat = "png" | "svg" | "pdf";
type RecordRow = { gene: string; group: string; average: number; stdev: number; repeats: number[] };
type Pair = { gene: string; control: string; treatment: string };

const CLUSTER_PRESET: Record<string, string[]> = {
  RPE_Identity_Markers: ["MITF"],
  "ChP_Secretory_&_Transport": ["TTR", "PRLR"],
  "ChP_&_Dorsal_Progenitors": ["OTX2", "LMX1A", "MSX1"],
  "Forebrain_&_Cortex_Markers": ["EMX1", "FOXG1"],
  "Eye_&_Forebrain_Progenitors": ["PAX6", "RAX", "LHX2"],
  Stem_Cell_Pluripotency: ["NANOG"],
  Neural_Crest_Markers: ["SOX10"],
  "Early_Germ_Layer_&_Signal": ["TBXT"],
};

const initialBar = {
  outputPrefix: "qpcr-barplot",
  gene: "ALL",
  format: "png" as PlotFormat,
  dpi: 300,
  width: 5,
  height: 4,
  autoSize: false,
  batchMode: false,
  barFill: "#0000ff",
  barBorder: "black",
  barBorderWidth: 0.3,
  barWidth: 0,
  errorWidth: 0.5,
  errorCap: 0.15,
  errorColor: "#111827",
  showRawPoints: false,
  showXTick: false,
  xAngle: 45,
  xHjust: 1,
  xVjust: 1,
  tickLength: 3,
  axisWidth: 0.5,
  titleSize: 26,
  yLabelSize: 15,
  yTickSize: 13,
  xTickSize: 9,
  titleVjust: 1,
  baseSize: 11,
  wrapPlus: false,
  scientificNotation: true,
  enableStats: true,
  showStats: true,
  sigMode: "vs_first",
  controlGroup: "",
  statTest: "auto",
  pAdjustMethod: "holm",
  labelStyle: "p.signif",
  showNs: true,
  sigFile: "statistical_analysis_summary.csv",
  bracketWidth: 0.35,
  bracketTextSize: 6,
  bracketLabelGap: 0.18,
  bracketStep: 0.12,
  customPairs: [] as Pair[],
};

const initialHeatmap = {
  outputPrefix: "qpcr-heatmap",
  format: "png" as PlotFormat,
  exportPng: true,
  exportPdf: false,
  pngDpi: 300,
  pdfWidth: 7,
  pdfHeight: 6,
  pngWidth: 4,
  pngHeight: 2,
  dpi: 300,
  width: 7,
  height: 6,
  wrapPlus: false,
  heatmapScale: "row" as "row" | "column" | "none",
  heatmapClusterRows: false,
  heatmapClusterCols: false,
  showCellValues: false,
  cellTextSize: 3.2,
  zlim: 2,
  baseSize: 10,
  useGeneClusters: false,
};

type BarSettings = typeof initialBar;
type HeatmapSettings = typeof initialHeatmap;

function parentFolder(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separator < 0) return "";
  if (separator === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, separator);
}

function safeNumber(value: unknown, fallback: number) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function workbookRows(workbook: ExcelJS.Workbook | null, sheetName: string): RecordRow[] {
  if (!workbook || !sheetName) return [];
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) return [];
  const headers: string[] = [];
  for (let c = 1; c <= sheet.columnCount; c += 1) headers.push(String(sheet.getRow(1).getCell(c).value ?? "").trim());
  const find = (names: string[]) => names.map((name: string) => headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase())).find((i: number) => i >= 0) ?? -1;
  const geneCol = find(["Gene", "gene", "基因"]);
  const groupCol = find(["Group_Name", "Group", "group", "分组"]);
  const avgCol = find(["Average", "average", "Mean", "均值"]);
  const sdCol = find(["Stdev", "SD", "sd", "标准差"]);
  const repeatCols = headers.map((name: string, index: number) => /^Repeat/i.test(name) ? index : -1).filter((index: number) => index >= 0);
  if (geneCol < 0 || groupCol < 0 || avgCol < 0) return [];
  const rows: RecordRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r += 1) {
    const values: unknown[] = [];
    for (let c = 1; c <= sheet.columnCount; c += 1) values.push(sheet.getRow(r).getCell(c).value);
    const gene = String(values[geneCol] ?? "").trim();
    const group = String(values[groupCol] ?? "").trim();
    const average = Number(values[avgCol]);
    if (!gene || !group || !Number.isFinite(average)) continue;
    rows.push({
      gene,
      group,
      average,
      stdev: sdCol >= 0 && Number.isFinite(Number(values[sdCol])) ? Number(values[sdCol]) : 0,
      repeats: repeatCols.map((index) => Number(values[index])).filter(Number.isFinite),
    });
  }
  return rows;
}

function colorFor(value: number, min: number, max: number) {
  const t = Math.max(0, Math.min(1, (value - min) / Math.max(max - min, 1e-9)));
  const r = Math.round(33 + t * 145);
  const g = Math.round(102 - t * 75);
  const b = Math.round(172 - t * 92);
  return `rgb(${r}, ${g}, ${b})`;
}

function BarPreview({ rows, settings }: { rows: RecordRow[]; settings: BarSettings }) {
  const gene = settings.gene === "ALL" ? rows[0]?.gene : settings.gene;
  const data = rows.filter((row) => row.gene === gene).slice(0, 10);
  if (!data.length) return <EmptyPreview label="导入含 Gene / Group_Name / Average 的结果表后预览" />;
  const max = Math.max(...data.map((row) => row.average + row.stdev), 1e-9);
  const baseY = 238;
  const chartTop = 26;
  const usable = baseY - chartTop;
  const slot = 270 / data.length;
  return (
    <svg className="qpcr-plot-svg" viewBox="0 0 320 280" role="img" aria-label="柱状图预览">
      <line x1="38" y1={baseY} x2="302" y2={baseY} className="qpcr-svg-axis" />
      <line x1="38" y1={chartTop} x2="38" y2={baseY} className="qpcr-svg-axis" />
      <text x="170" y="17" textAnchor="middle" className="qpcr-svg-title">{gene}</text>
      {data.map((row, index) => {
        const x = 52 + index * slot;
        const h = Math.max(2, (row.average / max) * usable);
        const y = baseY - h;
        const err = (row.stdev / max) * usable;
        return (
          <g key={`${row.group}-${index}`}>
            <rect x={x} y={y} width={Math.max(15, slot - 12)} height={h} rx="2" fill={settings.barFill} opacity=".9" />
            <line x1={x + (slot - 12) / 2} y1={Math.max(chartTop, y - err)} x2={x + (slot - 12) / 2} y2={y} className="qpcr-svg-error" />
            <line x1={x + (slot - 12) / 2 - 5} y1={Math.max(chartTop, y - err)} x2={x + (slot - 12) / 2 + 5} y2={Math.max(chartTop, y - err)} className="qpcr-svg-error" />
            {settings.showRawPoints && row.repeats.slice(0, 4).map((value, pIndex) => <circle key={pIndex} cx={x + 8 + pIndex * 4} cy={baseY - (value / max) * usable} r="2" fill="#fff" stroke="#111827" strokeWidth="1" />)}
            {settings.showXTick && <text x={x + (slot - 12) / 2} y="254" textAnchor="middle" transform={`rotate(${-settings.xAngle} ${x + (slot - 12) / 2} 254)`} className="qpcr-svg-label">{row.group}</text>}
          </g>
        );
      })}
      <text x="13" y="36" className="qpcr-svg-note">Y</text>
      <text x="170" y="274" textAnchor="middle" className="qpcr-svg-axis-label">{settings.scientificNotation ? "Relative expression · scientific rule" : "Relative expression"}</text>
    </svg>
  );
}

function HeatmapPreview({ rows, settings }: { rows: RecordRow[]; settings: HeatmapSettings }) {
  const genes = Array.from(new Set(rows.map((row) => row.gene))).slice(0, 12);
  const groups = Array.from(new Set(rows.map((row) => row.group))).slice(0, 8);
  if (!genes.length || !groups.length) return <EmptyPreview label="导入含 Gene / Group_Name / Average 的结果表后预览" />;
  const values = genes.flatMap((gene) => groups.map((group) => rows.find((row) => row.gene === gene && row.group === group)?.average ?? 0));
  const min = settings.heatmapScale === "none" ? Math.min(...values) : -settings.zlim;
  const max = settings.heatmapScale === "none" ? Math.max(...values) : settings.zlim;
  const cellW = Math.min(32, 220 / groups.length);
  const cellH = Math.min(22, 170 / genes.length);
  const left = 92;
  return (
    <svg className="qpcr-plot-svg" viewBox="0 0 320 280" role="img" aria-label="热图预览">
      <text x="188" y="18" textAnchor="middle" className="qpcr-svg-title">Z-score heatmap</text>
      {groups.map((group, c) => <text key={group} x={left + c * cellW + cellW / 2} y="38" textAnchor="middle" className="qpcr-svg-label" transform={`rotate(-35 ${left + c * cellW + cellW / 2} 38)`}>{settings.wrapPlus ? group.replace(/\+/g, "+\n") : group}</text>)}
      {genes.map((gene, r) => (
        <g key={gene}>
          <text x={left - 7} y={54 + r * cellH + cellH / 2 + 3} textAnchor="end" className="qpcr-svg-label">{gene}</text>
          {groups.map((group, c) => {
            const raw = rows.find((row) => row.gene === gene && row.group === group)?.average ?? 0;
            const rowValues = groups.map((item) => rows.find((row) => row.gene === gene && row.group === item)?.average ?? 0);
            const mean = rowValues.reduce((sum, value) => sum + value, 0) / rowValues.length;
            const sd = Math.sqrt(rowValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(rowValues.length - 1, 1));
            const scaled = settings.heatmapScale === "row" ? (sd ? (raw - mean) / sd : 0) : raw;
            return <g key={group}><rect x={left + c * cellW} y={48 + r * cellH} width={cellW - 1} height={cellH - 1} rx="1" fill={colorFor(scaled, min, max)} />{settings.showCellValues && <text x={left + c * cellW + cellW / 2} y={48 + r * cellH + cellH / 2 + 3} textAnchor="middle" className="qpcr-svg-cell-text">{raw.toFixed(1)}</text>}</g>;
          })}
        </g>
      ))}
      <text x="188" y="266" textAnchor="middle" className="qpcr-svg-axis-label">{settings.heatmapScale === "row" ? "row Z-score · ±" + settings.zlim : "Average expression"}</text>
    </svg>
  );
}

function EmptyPreview({ label }: { label: string }) {
  return <div className="qpcr-preview-empty"><IconChartDots3 size={24} stroke={1.5} /><span>{label}</span></div>;
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return <button type="button" className={`qpcr-toggle${checked ? " on" : ""}`} aria-pressed={checked} onClick={() => onChange(!checked)}><span className="qpcr-toggle-dot" />{label}</button>;
}

function SettingSection({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return <section className="qpcr-setting-section"><div className="qpcr-setting-title"><span className="qpcr-setting-rule" aria-hidden="true" /><span>{title}</span>{note && <span className="qpcr-setting-note">{note}</span>}</div>{children}</section>;
}

export default function QpcrPlotter() {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const [file, setFile] = useState<ExcelFile | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [kind, setKind] = useState<PlotKind>("bar");
  const [bar, setBar] = useState<BarSettings>(initialBar);
  const [heatmap, setHeatmap] = useState<HeatmapSettings>(initialHeatmap);
  const [allowInstall, setAllowInstall] = useState(false);
  const [rscriptFound, setRscriptFound] = useState<boolean | null>(null);
  const [installingR, setInstallingR] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState("");

  const sheets = file ? getSheetNames(file.workbook) : [];
  const rows = useMemo(() => workbookRows(file?.workbook ?? null, sheetName), [file, sheetName]);
  const genes = useMemo(() => Array.from(new Set(rows.map((row) => row.gene))), [rows]);
  const groups = useMemo(() => Array.from(new Set(rows.map((row) => row.group))), [rows]);
  useEffect(() => {
    let active = true;
    checkRscript().then((result) => { if (active) setRscriptFound(result.found); }).catch(() => { if (active) setRscriptFound(false); });
    return () => { active = false; };
  }, []);
  const { dropRef, isDragOver } = useDropZone(async (paths) => {
    const path = paths.find((item) => /\.(xlsx|xls)$/i.test(item));
    if (path) await loadFile(path);
  });

  async function loadFile(path: string) {
    try {
      const name = path.split(/[\\/]/).pop() ?? path;
      const next = await readExcelFile(path, name);
      const nextSheets = getSheetNames(next.workbook);
      setFile(next);
      setSheetName(nextSheets[0] ?? "");
      setOutputDir(parentFolder(path));
      setResult("");
    } catch (error) {
      showToast(l("文件导入失败：", "File import failed: ") + String(error), "error");
    }
  }

  async function chooseFile() {
    const selected = await open({ multiple: false, filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }] });
    if (selected && !Array.isArray(selected)) await loadFile(selected);
  }

  async function chooseOutput() {
    const defaultPath = outputDir || parentFolder(file?.path ?? "") || undefined;
    const selected = await open({ directory: true, multiple: false, defaultPath });
    if (selected && !Array.isArray(selected)) setOutputDir(selected);
  }

  async function recheckRscript() {
    resetRscriptCache(); setRscriptFound(null);
    try {
      const result = await checkRscript();
      setRscriptFound(result.found);
      showToast(result.found ? l("已检测到 Rscript", "Rscript detected") : l("仍未找到 Rscript，请安装 R 后重试。", "Rscript was not found. Install R and retry."), result.found ? "success" : "error");
    } catch { setRscriptFound(false); showToast(l("Rscript 检测失败", "Rscript check failed"), "error"); }
  }

  async function installRscript() {
    setInstallingR(true);
    const installed = await installR((line) => setLogs((prev) => [...prev.slice(-19), line]));
    setInstallingR(false);
    if (installed.ok) await recheckRscript();
    else showToast(installed.error ?? l("R 安装未完成", "R installation did not finish"), "error");
  }

  function updateBar<K extends keyof BarSettings>(key: K, value: BarSettings[K]) { setBar((prev) => ({ ...prev, [key]: value })); }
  function updateHeat<K extends keyof HeatmapSettings>(key: K, value: HeatmapSettings[K]) { setHeatmap((prev) => ({ ...prev, [key]: value })); }

  function makeConfig(filePath = file?.path ?? "", destination = outputDir): QpcrPlotRunConfig {
    const settings = kind === "bar" ? bar : heatmap;
    return {
      filePath, sheetName, outputDir: destination,
      outputPrefix: settings.outputPrefix, kind, format: settings.format, width: settings.width, height: settings.height, dpi: settings.dpi,
      gene: kind === "bar" ? bar.gene : "ALL", barFill: bar.barFill, barBorder: bar.barBorder, barBorderWidth: bar.barBorderWidth, barWidth: bar.barWidth, errorWidth: bar.errorWidth, errorCap: bar.errorCap, errorColor: bar.errorColor,
      showRawPoints: bar.showRawPoints, showXTick: bar.showXTick, xAngle: bar.xAngle, xHjust: bar.xHjust, xVjust: bar.xVjust, tickLength: bar.tickLength, axisWidth: bar.axisWidth, titleSize: bar.titleSize, yLabelSize: bar.yLabelSize, yTickSize: bar.yTickSize, xTickSize: bar.xTickSize, titleVjust: bar.titleVjust, baseSize: settings.baseSize, wrapPlus: kind === "bar" ? bar.wrapPlus : heatmap.wrapPlus, scientificNotation: bar.scientificNotation, autoSize: bar.autoSize,
      enableStats: bar.enableStats, showStats: bar.showStats, sigMode: bar.sigMode, controlGroup: bar.controlGroup || groups[0] || "", statTest: bar.statTest, pAdjustMethod: bar.pAdjustMethod, labelStyle: bar.labelStyle, showNs: bar.showNs, sigFile: bar.sigFile, bracketWidth: bar.bracketWidth, bracketTextSize: bar.bracketTextSize, bracketLabelGap: bar.bracketLabelGap, bracketStep: bar.bracketStep, customPairs: bar.customPairs,
      heatmapScale: heatmap.heatmapScale, heatmapClusterRows: heatmap.heatmapClusterRows, heatmapClusterCols: heatmap.heatmapClusterCols, showCellValues: heatmap.showCellValues, cellTextSize: heatmap.cellTextSize, zlim: heatmap.zlim,
      exportPng: heatmap.exportPng, exportPdf: heatmap.exportPdf, pngDpi: heatmap.pngDpi, pdfWidth: heatmap.pdfWidth, pdfHeight: heatmap.pdfHeight, pngWidth: heatmap.pngWidth, pngHeight: heatmap.pngHeight,
      useGeneClusters: heatmap.useGeneClusters, geneClusters: CLUSTER_PRESET, installMissing: allowInstall,
      batchMode: bar.batchMode,
    };
  }

  async function handleRun() {
    if (!file || !outputDir || !rows.length || running) return;
    setRunning(true); setResult(""); setLogs([l("正在准备 qPCR 绘图…", "Preparing qPCR plot…")]);
    try {
      const targets: Array<{ path: string; output: string }> = [{ path: file.path, output: outputDir }];
      if (kind === "bar" && bar.batchMode) {
        const entries = await readDirAny(outputDir);
        const batchFiles: Array<{ path: string; output: string }> = [];
        for (const entry of entries.filter((item) => item.isDir)) {
          const folder = joinPath(outputDir, entry.name);
          const children = await readDirAny(folder);
          if (children.some((child) => !child.isDir && child.name === file.name)) batchFiles.push({ path: joinPath(folder, file.name), output: folder });
        }
        targets.splice(0, targets.length, ...batchFiles);
        if (!targets.length) throw new Error(l("当前目录的子文件夹中没有找到同名 Excel 文件。", "No same-named Excel files were found in the current folder's subfolders."));
        setLogs((prev) => [...prev, l(`批量模式：找到 ${targets.length} 个子文件夹任务。`, `Batch mode: found ${targets.length} subfolder jobs.`)]);
      }
      let completed = 0;
      for (const target of targets) {
        const run = await runQpcrPlot(makeConfig(target.path, target.output), (line) => setLogs((prev) => [...prev.slice(-19), line]));
        if (!run.ok) {
          if (run.error === "QPCR_PLOT_CANCELLED") return;
          throw new Error(run.error ?? l("运行失败", "Run failed"));
        }
        completed += 1;
      }
      setResult(bar.batchMode ? l(`批量绘图完成：${completed} 个文件`, `Batch plotting complete: ${completed} files`) : l(`已生成图表，结果位于：${outputDir}`, `Charts generated in: ${outputDir}`)); showToast(l("qPCR 图表生成完成", "qPCR plots generated"), "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setResult(message); showToast(message, "error");
    } finally {
      setRunning(false);
    }
  }

  async function exportSettings() {
    const target = await save({ defaultPath: `${kind === "bar" ? bar.outputPrefix : heatmap.outputPrefix}-settings.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!target) return;
    await writeFile(target, new TextEncoder().encode(JSON.stringify({ kind, bar, heatmap, allowInstall }, null, 2)));
    showToast(l("绘图设置已导出", "Plot settings exported"), "success");
  }

  async function importSettings() {
    const selected = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!selected || Array.isArray(selected)) return;
    try {
      const raw = JSON.parse(new TextDecoder().decode(await readFile(selected))) as { kind?: PlotKind; bar?: Partial<BarSettings>; heatmap?: Partial<HeatmapSettings>; allowInstall?: boolean };
      if (raw.kind === "bar" || raw.kind === "heatmap") setKind(raw.kind);
      const importedBar = raw.bar;
      const importedHeatmap = raw.heatmap;
      if (importedBar) setBar((prev) => ({ ...prev, ...importedBar, dpi: safeNumber(importedBar.dpi, prev.dpi), width: safeNumber(importedBar.width, prev.width), height: safeNumber(importedBar.height, prev.height) }));
      if (importedHeatmap) setHeatmap((prev) => ({ ...prev, ...importedHeatmap, dpi: safeNumber(importedHeatmap.dpi, prev.dpi), width: safeNumber(importedHeatmap.width, prev.width), height: safeNumber(importedHeatmap.height, prev.height) }));
      if (typeof raw.allowInstall === "boolean") setAllowInstall(raw.allowInstall);
      showToast(l("绘图设置已导入", "Plot settings imported"), "success");
    } catch (error) { showToast(l("设置文件无效：", "Invalid settings file: ") + String(error), "error"); }
  }

  function reset() { setBar(initialBar); setHeatmap(initialHeatmap); setAllowInstall(false); setResult(""); }
  function addPair() { if (groups.length >= 2) updateBar("customPairs", [...bar.customPairs, { gene: "ALL", control: groups[0], treatment: groups[1] }]); }

  return (
    <div className="card qpcr-plotter">
      <div className="qpcr-plotter-head">
        <div className="qpcr-plotter-head-main">
          <span className="qpcr-step-index">03</span>
          <span className="qpcr-step-heading"><strong>{l("绘图与导出", "Plot & export")}</strong></span>
        </div>
        <div className="qpcr-rscript-status" onClick={() => void recheckRscript()} title={rscriptFound === null ? l("Rscript 检测中，点击重试", "Checking Rscript, click to retry") : rscriptFound ? l("Rscript 就绪，点击重新检测", "Rscript ready, click to re-check") : l("Rscript 未找到，点击安装或重新检测", "Rscript not found, click to install or re-check")}>
          <span className={`qpcr-rscript-dot${rscriptFound === true ? " ready" : rscriptFound === false ? " missing" : " checking"}`} />
          <span className="qpcr-rscript-text">
            {rscriptFound === null ? l("Rscript 检测中…", "Checking Rscript…") : rscriptFound ? l("Rscript 就绪", "Rscript ready") : l("Rscript 未找到", "Rscript not found")}
          </span>
        </div>
      </div>
      <div className="card-body">
        {rscriptFound === false && <div className="qpcr-rscript-notice"><IconInfoCircle size={15} /><span>{l("需要 Rscript。请安装 R 或重新检测。", "Rscript required. Install R or check again.")}</span><button type="button" className="btn btn-primary" onClick={() => void installRscript()} disabled={installingR}>{installingR ? l("安装中…", "Installing…") : l("安装 R", "Install R")}</button><button type="button" className="btn" onClick={() => void recheckRscript()}>{l("重新检测", "Check again")}</button></div>}
        {rscriptFound === null && <div className="qpcr-rscript-notice qpcr-rscript-notice--checking"><IconInfoCircle size={15} /><span>{l("正在检测 Rscript。", "Checking Rscript.")}</span></div>}
        <div className="qpcr-plot-io" ref={dropRef}>
          <div className="qpcr-io-input-group">
            <div className="qpcr-io-label"><span className="qpcr-io-step">01</span><span>{l("数据文件", "Data file")}</span><span className={`rx-tag${file ? " rx-tag--ok" : ""}`}>{file ? l("已载入", "Loaded") : l("待选择", "Waiting")}</span></div>
            <button type="button" className={`qpcr-file-chip${isDragOver ? " drag" : ""}${file ? " loaded" : ""}`} onClick={() => void chooseFile()} title={l("点击选择 Excel，或拖入文件", "Choose or drop an Excel file")}>
              <span className="qpcr-io-icon qpcr-io-icon--green"><IconFileSpreadsheet size={16} /></span><span className="qpcr-io-copy"><strong>{file?.name ?? l("选择 qPCR 结果 Excel", "Choose qPCR result Excel")}</strong><small>{file ? sheetName : "xlsx / xls · Gene · Group_Name · Average"}</small></span><IconChevronRight size={14} />
            </button>
          </div>
          <div className="qpcr-io-meta-group">
            <div className="qpcr-io-label"><span className="qpcr-io-step">02</span><span>{l("输出位置", "Output")}</span><span className={`rx-tag${outputDir ? " rx-tag--ok" : ""}`}>{outputDir ? l("已设置", "Ready") : l("待设置", "Not set")}</span></div>
            <div className="qpcr-io-select"><label>{l("工作表", "Sheet")}</label><select aria-label={l("工作表", "Sheet")} value={sheetName} onChange={(e) => setSheetName(e.target.value)} disabled={!file}>{sheets.map((name) => <option key={name}>{name}</option>)}</select></div>
            <button type="button" className="btn qpcr-io-folder" onClick={() => void chooseOutput()}><IconFolderOpen size={14} />{outputDir ? l("更换输出目录", "Change output") : l("选择输出目录", "Output folder")}</button>
            <div className="qpcr-io-output" title={outputDir}>{outputDir || l("未设置输出目录", "No output folder")}</div>
          </div>
          <div className="qpcr-io-action-group">
            <div className="qpcr-io-label"><span className="qpcr-io-step">03</span><span>{l("执行绘图", "Run plot")}</span><span className={`rx-tag${running ? " rx-tag--run" : ""}`}>{running ? l("处理中", "Running") : l("准备就绪", "Ready")}</span></div>
            <div className="qpcr-io-settings-actions"><button type="button" className="btn" onClick={() => void importSettings()}><IconUpload size={13} />{l("导入设置", "Import")}</button><button type="button" className="btn" onClick={() => void exportSettings()}><IconDownload size={13} />{l("导出设置", "Export")}</button></div>
            <button type="button" className="btn btn-primary qpcr-run-btn" onClick={() => void handleRun()} disabled={!file || !outputDir || !rows.length || running || rscriptFound !== true}><IconPlayerPlayFilled size={12} />{running ? l("运行中…", "Running…") : l("运行", "Run")}</button>
          </div>
        </div>
        <div className="qpcr-plot-layout">
          <aside className="qpcr-template-rail">
            <div className="qpcr-rail-heading"><span>{l("绘图类型", "Plot type")}</span></div>
            <button type="button" className={`qpcr-template-card${kind === "bar" ? " selected" : ""}`} onClick={() => setKind("bar")}><span className="qpcr-template-thumb qpcr-template-thumb--bar"><IconChartBar size={24} /></span><span><strong>{l("qPCR 柱状图", "qPCR bar plot")}</strong></span>{kind === "bar" && <IconChevronRight size={15} />}</button>
            <button type="button" className={`qpcr-template-card${kind === "heatmap" ? " selected" : ""}`} onClick={() => setKind("heatmap")}><span className="qpcr-template-thumb qpcr-template-thumb--heat"><IconGrid4x4 size={24} /></span><span><strong>{l("表达量热图", "Expression heatmap")}</strong></span>{kind === "heatmap" && <IconChevronRight size={15} />}</button>
            <div className="qpcr-template-hint"><IconInfoCircle size={14} /><span>{l("绘图数据列：Gene · Group_Name · Average", "Plot columns: Gene · Group_Name · Average")}</span></div>
            <div className="qpcr-quick-presets"><div className="qpcr-rail-heading"><span>{l("快速预设", "Quick presets")}</span></div><button type="button" onClick={() => { setKind("bar"); setBar((prev) => ({ ...prev, dpi: 600, width: 3.5, height: 2.65, showXTick: true, scientificNotation: true })); }}>{l("Nature 单栏", "Nature single")}</button><button type="button" onClick={() => { setKind("heatmap"); setHeatmap((prev) => ({ ...prev, dpi: 600, width: 7, height: 5, heatmapScale: "row", heatmapClusterRows: true })); }}>{l("热图 · 聚类", "Heatmap · clustered")}</button></div>
          </aside>
          <section className="qpcr-plot-workspace">
            <div className="qpcr-preview-card"><div className="qpcr-preview-head"><div><strong>{kind === "bar" ? l("柱状图预览", "Bar plot preview") : l("热图预览", "Heatmap preview")}</strong><small>{rows.length ? `${rows.length} ${l("条记录", "records")} · ${genes.length} ${l("个基因", "genes")} · ${groups.length} ${l("个分组", "groups")}` : l("等待数据", "Waiting for data")}</small></div><button type="button" className="btn" onClick={reset}><IconRefresh size={13} />{l("恢复默认", "Reset")}</button></div><div className="qpcr-preview-stage">{kind === "bar" ? <BarPreview rows={rows} settings={bar} /> : <HeatmapPreview rows={rows} settings={heatmap} />}</div></div>
            <div className="qpcr-params-card"><div className="qpcr-params-head"><div className="qpcr-params-head-main"><span className="qpcr-params-head-icon"><IconAdjustmentsHorizontal size={17} /></span><span><strong>{l("参数调整", "Parameters")}</strong></span></div><span className="qpcr-param-badge">{kind === "bar" ? "BAR / STATS" : "HEATMAP / Z-SCORE"}</span></div>
              {kind === "bar" ? <BarSettingsPanel bar={bar} groups={groups} genes={genes} update={updateBar} addPair={addPair} l={l} /> : <HeatmapSettingsPanel settings={heatmap} update={updateHeat} l={l} />}
              <div className="qpcr-advanced-row"><Toggle checked={allowInstall} label={l("允许按需安装 R 包", "Allow R package install")} onChange={setAllowInstall} /><button type="button" className="qpcr-inline-reset" onClick={reset}><IconSettings size={13} />{l("全部恢复默认", "Reset all")}</button></div>
            </div>
            {(logs.length > 0 || result) && <div className="qpcr-run-feedback"><div className="qpcr-run-feedback-head"><strong>{l("运行日志", "Run log")}</strong>{running && <span className="qpcr-live-dot" />}</div>{result && <p>{result}</p>}<pre>{logs.join("\n")}</pre>{result && outputDir && <button type="button" className="btn" onClick={() => void openInShell(outputDir)}><IconFolderOpen size={13} />{l("打开结果目录", "Open output folder")}</button>}{running && <button type="button" className="btn" onClick={() => void cancelQpcrPlot()}>{l("取消运行", "Cancel")}</button>}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}

function BarSettingsPanel({ bar, groups, genes, update, addPair, l }: { bar: BarSettings; groups: string[]; genes: string[]; update: <K extends keyof BarSettings>(key: K, value: BarSettings[K]) => void; addPair: () => void; l: (zh: string, en: string) => string }) {
  return <>
    <SettingSection title={l("文件与版式", "File & layout")}><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("输出前缀", "Output prefix")}><input value={bar.outputPrefix} onChange={(e) => update("outputPrefix", e.target.value)} /></Field><Field label={l("选择基因", "Gene")}><select value={bar.gene} onChange={(e) => update("gene", e.target.value)}><option value="ALL">{l("全部基因（逐图）", "All genes (one plot each)")}</option>{genes.map((gene) => <option key={gene}>{gene}</option>)}</select></Field><Field label={l("格式", "Format")}><select value={bar.format} onChange={(e) => update("format", e.target.value as PlotFormat)}><option value="png">PNG</option><option value="svg">SVG</option><option value="pdf">PDF</option></select></Field><Field label="DPI"><select value={bar.dpi} onChange={(e) => update("dpi", Number(e.target.value))}><option value="300">300 · 通用</option><option value="600">600 · 投稿</option><option value="150">150 · 预览</option></select></Field></div><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("宽度（英寸）", "Width (in)")}><input type="number" min="2" max="12" step="0.5" value={bar.width} onChange={(e) => update("width", safeNumber(e.target.value, bar.width))} /></Field><Field label={l("高度（英寸）", "Height (in)")}><input type="number" min="2" max="12" step="0.5" value={bar.height} onChange={(e) => update("height", safeNumber(e.target.value, bar.height))} /></Field><Field label={l("柱体颜色", "Bar fill")}><ColorField value={bar.barFill} onChange={(value) => update("barFill", value)} /></Field><Field label={l("误差棒颜色", "Error color")}><ColorField value={bar.errorColor} onChange={(value) => update("errorColor", value)} /></Field></div><div className="qpcr-button-row"><Toggle checked={bar.autoSize} label={l("按组数自动尺寸", "Auto size by groups")} onChange={(value) => update("autoSize", value)} /><Toggle checked={bar.batchMode} label={l("批量处理子文件夹", "Batch subfolders")} onChange={(value) => update("batchMode", value)} /></div></SettingSection>
    <SettingSection title={l("柱体与坐标轴", "Bars & axes")}><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("边框颜色", "Border")}><ColorField value={bar.barBorder} onChange={(value) => update("barBorder", value)} /></Field><Field label={l("边框粗细", "Border width")}><input type="number" min="0" max="3" step="0.1" value={bar.barBorderWidth} onChange={(e) => update("barBorderWidth", safeNumber(e.target.value, bar.barBorderWidth))} /></Field><Field label={l("柱体宽度", "Bar width")}><input type="number" min="0.1" max="1" step="0.05" value={bar.barWidth} onChange={(e) => update("barWidth", safeNumber(e.target.value, bar.barWidth))} /></Field><Field label={l("横帽宽度", "Cap width")}><input type="number" min="0" max="0.5" step="0.05" value={bar.errorCap} onChange={(e) => update("errorCap", safeNumber(e.target.value, bar.errorCap))} /></Field></div><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("轴线粗细", "Axis width")}><input type="number" min="0" max="3" step="0.1" value={bar.axisWidth} onChange={(e) => update("axisWidth", safeNumber(e.target.value, bar.axisWidth))} /></Field><Field label={l("刻度线长度", "Tick length")}><input type="number" min="0" max="12" step="0.5" value={bar.tickLength} onChange={(e) => update("tickLength", safeNumber(e.target.value, bar.tickLength))} /></Field><Field label={l("X 标签对齐", "X hjust")}><select value={bar.xHjust} onChange={(e) => update("xHjust", Number(e.target.value))}><option value="0">左</option><option value="0.5">中</option><option value="1">右</option></select></Field><Field label={l("X 标签垂直对齐", "X vjust")}><select value={bar.xVjust} onChange={(e) => update("xVjust", Number(e.target.value))}><option value="0">上</option><option value="0.5">中</option><option value="1">下</option></select></Field></div><div className="qpcr-button-row"><Toggle checked={bar.showRawPoints} label={l("叠加重复值散点", "Show replicate points")} onChange={(value) => update("showRawPoints", value)} /><Toggle checked={bar.showXTick} label={l("显示 X 轴标签", "Show X labels")} onChange={(value) => update("showXTick", value)} /><Toggle checked={bar.wrapPlus} label={l("+ 号后换行", "Wrap after +")} onChange={(value) => update("wrapPlus", value)} /><span className="qpcr-angle-control"><label>{l("标签角度", "Label angle")}</label><select value={bar.xAngle} onChange={(e) => update("xAngle", Number(e.target.value))}><option value="0">0°</option><option value="30">30°</option><option value="45">45°</option><option value="90">90°</option></select></span></div></SettingSection>
    <SettingSection title={l("字体与间距", "Typography & spacing")}><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("标题字号", "Title size")}><input type="number" min="6" max="32" step="1" value={bar.titleSize} onChange={(e) => update("titleSize", safeNumber(e.target.value, bar.titleSize))} /></Field><Field label={l("Y 轴标题字号", "Y title size")}><input type="number" min="6" max="24" step="1" value={bar.yLabelSize} onChange={(e) => update("yLabelSize", safeNumber(e.target.value, bar.yLabelSize))} /></Field><Field label={l("Y 刻度字号", "Y tick size")}><input type="number" min="6" max="24" step="1" value={bar.yTickSize} onChange={(e) => update("yTickSize", safeNumber(e.target.value, bar.yTickSize))} /></Field><Field label={l("X 刻度字号", "X tick size")}><input type="number" min="6" max="24" step="1" value={bar.xTickSize} onChange={(e) => update("xTickSize", safeNumber(e.target.value, bar.xTickSize))} /></Field></div><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("标题垂直偏移", "Title vjust")}><input type="number" min="-2" max="2" step="0.1" value={bar.titleVjust} onChange={(e) => update("titleVjust", safeNumber(e.target.value, bar.titleVjust))} /></Field><Field label={l("统计 CSV 文件名", "Statistics CSV filename")}><input value={bar.sigFile} onChange={(e) => update("sigFile", e.target.value)} /></Field><Field label={l("基础字号", "Base font size")}><input type="number" min="6" max="20" step="0.5" value={bar.baseSize} onChange={(e) => update("baseSize", safeNumber(e.target.value, bar.baseSize))} /></Field><Field label={l("误差棒粗细", "Error width")}><input type="number" min="0.1" max="3" step="0.1" value={bar.errorWidth} onChange={(e) => update("errorWidth", safeNumber(e.target.value, bar.errorWidth))} /></Field></div></SettingSection>
    <SettingSection title={l("科学计数法", "Scientific notation")}><div className="qpcr-science-callout"><span className="qpcr-science-mark">10<sup>e</sup></span><span>{l("自动按数量级缩放 Y 轴。", "Scale the Y axis automatically.")}</span><Toggle checked={bar.scientificNotation} label={l("启用", "On") } onChange={(value) => update("scientificNotation", value)} /></div></SettingSection>
    <SettingSection title={l("显著性统计", "Significance statistics")}><div className="qpcr-button-row"><Toggle checked={bar.enableStats} label={l("进行统计检验", "Enable tests")} onChange={(value) => update("enableStats", value)} /><Toggle checked={bar.showStats} label={l("显示括号标注", "Show brackets")} onChange={(value) => update("showStats", value)} /><Toggle checked={bar.showNs} label={l("显示 ns", "Show ns")} onChange={(value) => update("showNs", value)} /></div><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("比较模式", "Comparison mode")}><select value={bar.sigMode} onChange={(e) => update("sigMode", e.target.value)}><option value="vs_first">vs first · 第一组</option><option value="vs_last">vs last · 最后一组</option><option value="vs_control">vs control · 指定对照</option><option value="custom">custom · 自定义比较</option><option value="all_pairwise">all pairwise · 两两</option><option value="adjacent">adjacent · 相邻</option></select></Field><Field label={l("对照组", "Control group")}><select value={bar.controlGroup} onChange={(e) => update("controlGroup", e.target.value)}><option value="">{l("自动使用第一组", "Use first group")}</option>{groups.map((group) => <option key={group}>{group}</option>)}</select></Field><Field label={l("统计检验", "Statistical test")}><select value={bar.statTest} onChange={(e) => update("statTest", e.target.value)}><option value="auto">auto · 自动</option><option value="t.test">Welch t-test</option><option value="wilcox.test">Wilcoxon</option><option value="anova">ANOVA + Tukey</option><option value="kruskal.test">Kruskal-Wallis</option></select></Field><Field label={l("P 值校正", "P adjustment")}><select value={bar.pAdjustMethod} onChange={(e) => update("pAdjustMethod", e.target.value)}><option value="holm">Holm · 推荐</option><option value="bonferroni">Bonferroni</option><option value="BH">BH / FDR</option><option value="none">none · 不校正</option></select></Field></div><div className="qpcr-setting-grid qpcr-setting-grid--two"><Field label={l("标注样式", "Label style")}><select value={bar.labelStyle} onChange={(e) => update("labelStyle", e.target.value)}><option value="p.signif">星号 / ns</option><option value="p">具体 P 值</option><option value="both">星号 + P 值</option></select></Field><div className="qpcr-custom-pairs"><div className="qpcr-pair-head"><span>{l("自定义比较对", "Custom pairs")}</span><button type="button" className="qpcr-add-pair" onClick={addPair}>+ {l("添加", "Add")}</button></div>{bar.customPairs.length ? bar.customPairs.map((pair, index) => <div className="qpcr-pair-row" key={`${pair.gene}-${pair.control}-${pair.treatment}-${index}`}><select aria-label={l("比较基因", "Comparison gene")} value={pair.gene} onChange={(e) => update("customPairs", bar.customPairs.map((item, i) => i === index ? { ...item, gene: e.target.value } : item))}><option value="ALL">ALL</option>{genes.map((gene) => <option key={gene}>{gene}</option>)}</select><select aria-label={l("对照组", "Control group")} value={pair.control} onChange={(e) => update("customPairs", bar.customPairs.map((item, i) => i === index ? { ...item, control: e.target.value } : item))}>{groups.map((group) => <option key={group}>{group}</option>)}</select><span>vs</span><select aria-label={l("处理组", "Treatment group")} value={pair.treatment} onChange={(e) => update("customPairs", bar.customPairs.map((item, i) => i === index ? { ...item, treatment: e.target.value } : item))}>{groups.map((group) => <option key={group}>{group}</option>)}</select><button type="button" aria-label={l("移除比较", "Remove pair")} onClick={() => update("customPairs", bar.customPairs.filter((_, i) => i !== index))}><IconX size={12} /></button></div>) : <small>{l("自定义模式下添加比较对", "Add pairs in custom mode")}</small>}</div></div><div className="qpcr-setting-grid qpcr-setting-grid--four qpcr-bracket-grid"><Field label={l("括号线宽", "Bracket width")}><input type="number" min="0.1" max="3" step="0.05" value={bar.bracketWidth} onChange={(e) => update("bracketWidth", safeNumber(e.target.value, bar.bracketWidth))} /></Field><Field label={l("标注字号", "Bracket text size")}><input type="number" min="1" max="12" step="0.5" value={bar.bracketTextSize} onChange={(e) => update("bracketTextSize", safeNumber(e.target.value, bar.bracketTextSize))} /></Field><Field label={l("标签间距", "Label gap")}><input type="number" min="0" max="1" step="0.01" value={bar.bracketLabelGap} onChange={(e) => update("bracketLabelGap", safeNumber(e.target.value, bar.bracketLabelGap))} /></Field><Field label={l("括号层间距", "Bracket step")}><input type="number" min="0.01" max="0.5" step="0.01" value={bar.bracketStep} onChange={(e) => update("bracketStep", safeNumber(e.target.value, bar.bracketStep))} /></Field></div></SettingSection>
  </>;
}

function HeatmapSettingsPanel({ settings, update, l }: { settings: HeatmapSettings; update: <K extends keyof HeatmapSettings>(key: K, value: HeatmapSettings[K]) => void; l: (zh: string, en: string) => string }) {
  return <>
    <SettingSection title={l("文件与版式", "File & layout")}><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("输出前缀", "Output prefix")}><input value={settings.outputPrefix} onChange={(e) => update("outputPrefix", e.target.value)} /></Field><Field label={l("兼容格式", "Compatibility format")}><select value={settings.format} onChange={(e) => update("format", e.target.value as PlotFormat)}><option value="png">PNG</option><option value="svg">SVG</option><option value="pdf">PDF</option></select></Field><Field label={l("颜色范围", "Color range")}><select value={settings.zlim} onChange={(e) => update("zlim", Number(e.target.value))}><option value="1">±1</option><option value="2">±2</option><option value="3">±3</option><option value="4">±4</option></select></Field><Field label={l("基础字号", "Base font size")}><input type="number" min="6" max="20" step="0.5" value={settings.baseSize} onChange={(e) => update("baseSize", safeNumber(e.target.value, settings.baseSize))} /></Field></div><div className="qpcr-button-row"><Toggle checked={settings.exportPng} label={l("导出 PNG", "Export PNG")} onChange={(value) => update("exportPng", value)} /><Toggle checked={settings.exportPdf} label={l("导出 PDF", "Export PDF")} onChange={(value) => update("exportPdf", value)} /></div><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("PNG DPI", "PNG DPI")}><select value={settings.pngDpi} onChange={(e) => update("pngDpi", Number(e.target.value))}><option value="300">300</option><option value="600">600</option><option value="150">150</option></select></Field><Field label={l("PNG 宽度（英寸）", "PNG width (in)")}><input type="number" min="2" max="14" step="0.5" value={settings.pngWidth} onChange={(e) => update("pngWidth", safeNumber(e.target.value, settings.pngWidth))} /></Field><Field label={l("PNG 高度（英寸）", "PNG height (in)")}><input type="number" min="1" max="14" step="0.5" value={settings.pngHeight} onChange={(e) => update("pngHeight", safeNumber(e.target.value, settings.pngHeight))} /></Field><div className="qpcr-palette-preview"><span className="qpcr-gradient" /><small>blue · white · red</small></div></div><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("PDF 宽度（英寸）", "PDF width (in)")}><input type="number" min="2" max="14" step="0.5" value={settings.pdfWidth} onChange={(e) => update("pdfWidth", safeNumber(e.target.value, settings.pdfWidth))} /></Field><Field label={l("PDF 高度（英寸）", "PDF height (in)")}><input type="number" min="1" max="14" step="0.5" value={settings.pdfHeight} onChange={(e) => update("pdfHeight", safeNumber(e.target.value, settings.pdfHeight))} /></Field><div /><div /></div></SettingSection>
    <SettingSection title={l("Z-score 与聚类", "Z-score & clustering")}><div className="qpcr-setting-grid qpcr-setting-grid--four"><Field label={l("标准化方式", "Scale")}><select value={settings.heatmapScale} onChange={(e) => update("heatmapScale", e.target.value as HeatmapSettings["heatmapScale"])}><option value="row">row · 基因</option><option value="column">column · 分组</option><option value="none">none · 原始均值</option></select></Field><Field label={l("格内字号", "Cell text size")}><input type="number" min="1" max="8" step="0.5" value={settings.cellTextSize} onChange={(e) => update("cellTextSize", safeNumber(e.target.value, settings.cellTextSize))} /></Field><div className="qpcr-setting-span-two"><Toggle checked={settings.heatmapClusterRows} label={l("聚类行（基因）", "Cluster rows (genes)")} onChange={(value) => update("heatmapClusterRows", value)} /><Toggle checked={settings.heatmapClusterCols} label={l("聚类列（分组）", "Cluster columns (groups)")} onChange={(value) => update("heatmapClusterCols", value)} /></div></div><div className="qpcr-button-row"><Toggle checked={settings.showCellValues} label={l("显示原始均值", "Show raw averages")} onChange={(value) => update("showCellValues", value)} /><Toggle checked={settings.wrapPlus} label={l("+ 号后换行", "Wrap after +")} onChange={(value) => update("wrapPlus", value)} /><Toggle checked={settings.useGeneClusters} label={l("按功能聚类预设排序", "Use functional cluster preset")} onChange={(value) => update("useGeneClusters", value)} /></div></SettingSection>
    <div className="qpcr-cluster-note"><IconInfoCircle size={13} /><span>{l("启用后按功能簇排序。", "Sort by functional clusters.")}</span></div>
  </>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="qpcr-field"><label>{label}</label>{children}</div>; }
function ColorField({ value, onChange }: { value: string; onChange: (value: string) => void }) { return <div className="qpcr-color-field"><input type="color" value={value} onChange={(e) => onChange(e.target.value)} /><span>{value.toUpperCase()}</span></div>; }
