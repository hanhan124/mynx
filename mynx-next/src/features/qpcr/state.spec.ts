import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalcResult } from "../../lib/contracts/generated/qpcr/CalcResult.js";
import type { SheetSnapshot } from "../../lib/contracts/generated/qpcr/SheetSnapshot.js";
import type { TaskRecord } from "../../lib/contracts/generated/task/TaskRecord.js";
import type { LogLine } from "../../lib/contracts/generated/task/LogLine.js";
import { app, setLanguage } from "../../app/state.svelte";
import {
  DEFAULT_PLOT_CONFIG,
  GENE_CLUSTER_PRESET,
  buildPlotConfig,
  makeBarDraft,
  makeHeatmapDraft,
  parentFolder,
  safeNumber,
} from "./plot-config.js";
import {
  baseName,
  cancelPlot,
  clearWorkbook,
  joinPath,
  loadWorkbook,
  methodLabelKey,
  qpcr,
  runCalculate,
  runPlot,
  runTransform,
  validateCalcForm,
} from "./state.svelte";

const mocks = vi.hoisted(() => ({
  settingsLoad: vi.fn(),
  settingsSave: vi.fn(),
  tasksCancel: vi.fn(),
  tasksList: vi.fn(),
  listDir: vi.fn(),
  qpcrCalculate: vi.fn(),
  qpcrInjectCharts: vi.fn(),
  qpcrPlotRun: vi.fn(),
  qpcrTransform: vi.fn(),
  readFileBytes: vi.fn(),
  workerApplyPatch: vi.fn(),
  workerExtractSheet: vi.fn(),
  workerLoadWorkbook: vi.fn(),
  writeFileBytes: vi.fn(),
}));

vi.mock("../../app/tauri.js", () => ({
  call: vi.fn(),
  openPath: vi.fn(),
  settingsLoad: mocks.settingsLoad,
  settingsSave: mocks.settingsSave,
  tasksCancel: mocks.tasksCancel,
  tasksList: mocks.tasksList,
  settingsMigrateLegacy: vi.fn(),
}));

vi.mock("./client.js", () => ({
  QPCR_WIRE_VERSION: 1,
  listDir: mocks.listDir,
  qpcrCalculate: mocks.qpcrCalculate,
  qpcrInjectCharts: mocks.qpcrInjectCharts,
  qpcrPlotRun: mocks.qpcrPlotRun,
  qpcrTransform: mocks.qpcrTransform,
  readFileBytes: mocks.readFileBytes,
  workerApplyPatch: mocks.workerApplyPatch,
  workerExtractSheet: mocks.workerExtractSheet,
  workerLoadWorkbook: mocks.workerLoadWorkbook,
  writeFileBytes: mocks.writeFileBytes,
}));

function resetState(): void {
  qpcr.loadPhase = "idle";
  qpcr.loadMessage = "";
  qpcr.filePath = "";
  qpcr.fileName = "";
  qpcr.workbookBytes = null;
  qpcr.sheetNames = [];
  qpcr.selectedSheet = "";
  qpcr.transformPhase = "idle";
  qpcr.transformMessage = "";
  qpcr.geneNames = [];
  qpcr.groups = [];
  qpcr.repeatCount = 2;
  qpcr.refGene = "";
  qpcr.calcMethod = "ref-normalized";
  qpcr.controlGroup = "";
  qpcr.selectNum = 0;
  qpcr.outlierSd = 0;
  qpcr.calcPhase = "idle";
  qpcr.calcMessage = "";
  qpcr.geneSheetNames = [];
  qpcr.chartSeries = [];
  qpcr.chartInjectPhase = "idle";
  qpcr.chartInjectMessage = "";
  qpcr.chartColor = "#3C9FDF";
  qpcr.plotKind = "bar";
  qpcr.plotBarDraft = makeBarDraft();
  qpcr.plotHeatDraft = makeHeatmapDraft();
  qpcr.plotOutputDir = "";
  qpcr.plotSheetName = "";
  qpcr.installMissing = true;
  qpcr.plotPhase = "idle";
  qpcr.plotMessage = "";
  qpcr.plotLogs = [];
  qpcr.plotResult = null;
  qpcr.jobId = null;
  app.toasts.splice(0, app.toasts.length);
  for (const mock of Object.values(mocks)) mock.mockReset();
}

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function lastToast(): { level: string; message: string } | undefined {
  return app.toasts[app.toasts.length - 1];
}

beforeEach(() => {
  resetState();
});

describe("validateCalcForm (legacy parity)", () => {
  const valid = {
    repeatCount: 3,
    refGene: "Gapdh",
    method: "ref-normalized",
    controlGroup: "",
    selectNum: 0,
    outlierSd: 0,
  } as const;

  it("accepts a valid form", () => {
    expect(validateCalcForm({ ...valid })).toBeNull();
  });

  it("rejects replicate counts below 1", () => {
    expect(validateCalcForm({ ...valid, repeatCount: 0 })?.key).toBe(
      "qpcr.errRepeatCount",
    );
    expect(validateCalcForm({ ...valid, repeatCount: 2.5 })?.key).toBe(
      "qpcr.errRepeatCount",
    );
  });

  it("requires a reference gene", () => {
    expect(validateCalcForm({ ...valid, refGene: " " })?.key).toBe("qpcr.errRefGene");
  });

  it("requires a control group for control-relative", () => {
    expect(
      validateCalcForm({ ...valid, method: "control-relative", controlGroup: "" })?.key,
    ).toBe("qpcr.errControlRequired");
    expect(
      validateCalcForm({
        ...valid,
        method: "control-relative",
        controlGroup: "Control",
      }),
    ).toBeNull();
  });

  it("enforces the best-replicate range (0 = off, ≥ 2)", () => {
    expect(validateCalcForm({ ...valid, selectNum: 1 })?.key).toBe(
      "qpcr.errSelectNumRange",
    );
    expect(validateCalcForm({ ...valid, selectNum: 2 })).toBeNull();
    expect(validateCalcForm({ ...valid, selectNum: 4 })?.key).toBe(
      "qpcr.errSelectNumTooLarge",
    );
    const tooLarge = validateCalcForm({ ...valid, selectNum: 4 });
    expect(tooLarge?.values).toEqual({ selectNum: 4, repeatCount: 3 });
  });

  it("enforces the outlier threshold range (0 = off, > 0)", () => {
    expect(validateCalcForm({ ...valid, outlierSd: -1 })?.key).toBe("qpcr.errOutlierSd");
    expect(validateCalcForm({ ...valid, outlierSd: 1.5 })).toBeNull();
  });

  it("blocks best-replicates and outlier removal together (mutual exclusion)", () => {
    const failure = validateCalcForm({ ...valid, selectNum: 2, outlierSd: 2 });
    expect(failure?.key).toBe("qpcr.errMutualExclusion");
  });
});

describe("plot config defaults (Rust QpcrPlotRunConfig Default mirror)", () => {
  it("mirrors the Rust Default field-for-field", () => {
    expect(DEFAULT_PLOT_CONFIG).toEqual({
      filePath: "",
      sheetName: "",
      outputDir: "",
      outputPrefix: "qpcr-barplot",
      kind: "bar",
      format: "png",
      width: 5,
      height: 4,
      dpi: 300,
      gene: "ALL",
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
      xLabel: "",
      yLabel: "Relative expression",
      wrapPlus: false,
      scientificNotation: true,
      autoSize: false,
      batchMode: false,
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
      customPairs: [],
      heatmapScale: "row",
      heatmapPalette: "blue-white-red",
      exportPng: true,
      exportPdf: false,
      pngDpi: 300,
      pdfWidth: 7,
      pdfHeight: 6,
      pngWidth: 4,
      pngHeight: 2,
      heatmapClusterRows: false,
      heatmapClusterCols: false,
      showCellValues: false,
      cellTextSize: 3.2,
      cellTextBold: true,
      zlim: 2,
      heatmapTitle: "",
      legendTitle: "Z-score",
      legendPosition: "right",
      showRowNames: true,
      showColNames: true,
      rowLabelItalic: true,
      axisTitleSize: 11,
      tileBorder: "#FFFFFF",
      tileBorderWidth: 0.25,
      useGeneClusters: false,
      geneClusters: {},
      installMissing: true,
    });
  });

  it("bar draft normalizes the border to hex and keeps defaults", () => {
    const draft = makeBarDraft();
    expect(draft.barBorder).toBe("#000000");
    expect(draft.outputPrefix).toBe("qpcr-barplot");
    expect(draft.kind).toBe("bar");
    expect(draft.width).toBe(5);
  });

  it("heatmap draft overrides the tab-specific values", () => {
    const draft = makeHeatmapDraft();
    expect(draft.kind).toBe("heatmap");
    expect(draft.outputPrefix).toBe("qpcr-heatmap");
    expect(draft.width).toBe(7);
    expect(draft.height).toBe(6);
    expect(draft.baseSize).toBe(10);
    expect(draft.heatmapScale).toBe("row");
    expect(draft.zlim).toBe(2);
    expect(draft.pngWidth).toBe(4);
    expect(draft.pngHeight).toBe(2);
  });

  it("buildPlotConfig injects plumbing without touching the draft", () => {
    const draft = makeBarDraft();
    const config = buildPlotConfig({
      draft,
      filePath: "D:/data/run.xlsx",
      sheetName: "Summary_All_Genes",
      outputDir: "D:/data/out",
      installMissing: false,
      fallbackControlGroup: "Control",
    });
    expect(config.filePath).toBe("D:/data/run.xlsx");
    expect(config.sheetName).toBe("Summary_All_Genes");
    expect(config.outputDir).toBe("D:/data/out");
    expect(config.installMissing).toBe(false);
    expect(config.controlGroup).toBe("Control");
    expect(config.geneClusters).toEqual(GENE_CLUSTER_PRESET);
    // The draft itself is untouched.
    expect(draft.filePath).toBe("");
    expect(draft.geneClusters).toEqual({});
  });

  it("keeps a draft-provided control group", () => {
    const draft = { ...makeBarDraft(), controlGroup: "Treatment" };
    const config = buildPlotConfig({
      draft,
      filePath: "f.xlsx",
      sheetName: "s",
      outputDir: "o",
      installMissing: true,
      fallbackControlGroup: "Control",
    });
    expect(config.controlGroup).toBe("Treatment");
  });
});

describe("path helpers", () => {
  it("parentFolder mirrors the legacy behavior", () => {
    expect(parentFolder("D:/a/b/run.xlsx")).toBe("D:/a/b");
    expect(parentFolder("D:\\a\\b\\run.xlsx")).toBe("D:\\a\\b");
    expect(parentFolder("C:/run.xlsx")).toBe("C:/");
    expect(parentFolder("run.xlsx")).toBe("");
  });

  it("joinPath keeps the platform separator", () => {
    expect(joinPath("D:/a/b", "run.xlsx")).toBe("D:/a/b/run.xlsx");
    expect(joinPath("D:\\a\\b", "run.xlsx")).toBe("D:\\a\\b\\run.xlsx");
    expect(joinPath("D:/a/b/", "run.xlsx")).toBe("D:/a/b/run.xlsx");
  });

  it("safeNumber falls back on junk", () => {
    expect(safeNumber("4.5", 1)).toBe(4.5);
    expect(safeNumber("junk", 1)).toBe(1);
    expect(safeNumber(NaN, 2)).toBe(2);
  });

  it("baseName strips directories", () => {
    expect(baseName("D:/a/b/run file.xlsx")).toBe("run file.xlsx");
    expect(baseName("D:\\a\\b\\run.xlsx")).toBe("run.xlsx");
  });
});

describe("loadWorkbook", () => {
  it("reads bytes, lists sheets and pre-detects Transformed Data", async () => {
    const bytes = new ArrayBuffer(8);
    mocks.readFileBytes.mockResolvedValue(bytes);
    mocks.workerLoadWorkbook.mockResolvedValue({
      sheetNames: ["Sheet1", "Transformed Data"],
    });
    const snapshot: SheetSnapshot = {
      name: "Transformed Data",
      columnCount: 3,
      rowCount: 2,
      rows: [
        {
          row: 1,
          cells: [
            { col: 1, value: { t: "text", v: "Sample" }, yellowFill: false },
            { col: 2, value: { t: "text", v: "Group_Name" }, yellowFill: false },
            { col: 3, value: { t: "text", v: "Gapdh" }, yellowFill: false },
          ],
        },
        {
          row: 2,
          cells: [
            { col: 1, value: { t: "text", v: "S1" }, yellowFill: false },
            { col: 2, value: { t: "text", v: "Control" }, yellowFill: false },
            { col: 3, value: { t: "num", v: 1 }, yellowFill: false },
          ],
        },
      ],
    };
    mocks.workerExtractSheet.mockResolvedValue({ snapshot });

    await loadWorkbook("D:/data/run file.xlsx");
    await flush();

    expect(qpcr.loadPhase).toBe("success");
    expect(qpcr.filePath).toBe("D:/data/run file.xlsx");
    expect(qpcr.fileName).toBe("run file.xlsx");
    expect(qpcr.workbookBytes).toBe(bytes);
    expect(qpcr.selectedSheet).toBe("Sheet1");
    expect(qpcr.geneNames).toEqual(["Gapdh"]);
    expect(qpcr.groups).toEqual(["Control"]);
    expect(qpcr.plotOutputDir).toBe("D:/data");
    // No Summary_All_Genes yet: falls back to the first sheet.
    expect(qpcr.plotSheetName).toBe("Sheet1");
  });

  it("clearWorkbook resets the page state", () => {
    qpcr.filePath = "f.xlsx";
    qpcr.workbookBytes = new ArrayBuffer(4);
    qpcr.sheetNames = ["Sheet1"];
    clearWorkbook();
    expect(qpcr.workbookBytes).toBeNull();
    expect(qpcr.sheetNames).toEqual([]);
    expect(qpcr.loadPhase).toBe("idle");
  });
});

describe("runTransform", () => {
  it("extracts → transforms → applies the patch → saves → re-reads", async () => {
    qpcr.filePath = "D:/data/run.xlsx";
    const original = new ArrayBuffer(8);
    const patched = new ArrayBuffer(16);
    const saved = new ArrayBuffer(24);
    qpcr.workbookBytes = original;
    qpcr.selectedSheet = "Sheet1";
    qpcr.sheetNames = ["Sheet1"];
    mocks.workerExtractSheet.mockResolvedValue({ snapshot: { name: "Sheet1" } });
    mocks.qpcrTransform.mockResolvedValue({
      v: 1,
      patch: { v: 1, removeSheets: [], upsertSheets: [] },
      geneNames: ["Gapdh"],
      groups: ["Control"],
    });
    mocks.workerApplyPatch.mockResolvedValue({
      bytes: patched,
      sheetNames: ["Sheet1", "Transformed Data"],
    });
    mocks.readFileBytes.mockResolvedValue(saved);

    await runTransform();
    await flush();

    expect(mocks.writeFileBytes).toHaveBeenCalledWith("D:/data/run.xlsx", patched);
    expect(qpcr.workbookBytes).toBe(saved);
    expect(qpcr.sheetNames).toEqual(["Sheet1", "Transformed Data"]);
    expect(qpcr.geneNames).toEqual(["Gapdh"]);
    expect(qpcr.groups).toEqual(["Control"]);
    expect(qpcr.transformPhase).toBe("success");
    expect(qpcr.plotSheetName).toBe("Sheet1");
  });

  it("reports Rust validation errors in the step banner", async () => {
    setLanguage("en");
    qpcr.filePath = "f.xlsx";
    qpcr.workbookBytes = new ArrayBuffer(4);
    qpcr.selectedSheet = "Sheet1";
    mocks.workerExtractSheet.mockResolvedValue({ snapshot: {} });
    mocks.qpcrTransform.mockRejectedValue(
      new Error("未找到 Cq/Ct 列"),
    );

    await runTransform();
    await flush();

    expect(qpcr.transformPhase).toBe("error");
    expect(qpcr.transformMessage).toBe("Cq/Ct column was not found");
    expect(lastToast()?.level).toBe("error");
    setLanguage("zh");
  });
});

describe("runCalculate", () => {
  function makeCalcResult(): CalcResult {
    return {
      v: 1,
      patch: { v: 1, removeSheets: ["__NON_PROTECTED__"], upsertSheets: [] },
      geneSheetNames: ["Summary_All_Genes", "Gapdh"],
      methodNote: "Reference-normalized",
      chartSeries: [
        {
          geneName: "Gapdh",
          refGene: "Gapdh",
          points: [
            { name: "Control", avg: 1, stdev: 0.1 },
            { name: "Treatment", avg: 2, stdev: 0.2 },
          ],
          groupCol: 1,
          dataStartRow: 2,
          dataRowCount: 2,
        },
      ],
    };
  }

  function primeTransformed(): void {
    qpcr.filePath = "D:/data/run.xlsx";
    qpcr.workbookBytes = new ArrayBuffer(8);
    qpcr.sheetNames = ["Sheet1", "Transformed Data"];
    qpcr.geneNames = ["Gapdh"];
    qpcr.groups = ["Control", "Treatment"];
    qpcr.refGene = "Gapdh";
  }

  it("blocks the run with the mutual-exclusion message", async () => {
    primeTransformed();
    qpcr.selectNum = 2;
    qpcr.outlierSd = 2;

    await runCalculate();
    await flush();

    expect(qpcr.calcPhase).toBe("error");
    expect(qpcr.calcMessage).toBe(
      "择优重复数与离群值剔除不能同时启用，请只选一种",
    );
    expect(mocks.qpcrCalculate).not.toHaveBeenCalled();
  });

  it("requires a control group for control-relative", async () => {
    primeTransformed();
    qpcr.calcMethod = "control-relative";
    qpcr.controlGroup = "";

    await runCalculate();
    await flush();

    expect(qpcr.calcPhase).toBe("error");
    expect(mocks.qpcrCalculate).not.toHaveBeenCalled();
  });

  it("runs → applies → saves → injects charts with the settings color", async () => {
    primeTransformed();
    const patched = new ArrayBuffer(16);
    const saved = new ArrayBuffer(24);
    mocks.workerExtractSheet.mockResolvedValue({ snapshot: { name: "Transformed Data" } });
    mocks.qpcrCalculate.mockResolvedValue(makeCalcResult());
    mocks.workerApplyPatch.mockResolvedValue({
      bytes: patched,
      sheetNames: ["Transformed Data", "Summary_All_Genes", "Gapdh"],
    });
    mocks.readFileBytes.mockResolvedValue(saved);
    mocks.qpcrInjectCharts.mockResolvedValue(true);
    qpcr.chartColor = "#2F6FED";

    await runCalculate();
    await flush();

    expect(mocks.qpcrCalculate).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 1,
        repeatCount: 2,
        refGene: "Gapdh",
        options: {
          method: "ref-normalized",
          controlGroup: "",
          selectNum: 0,
          outlierSd: 0,
        },
        withChartsSheet: true,
      }),
    );
    expect(mocks.writeFileBytes).toHaveBeenCalledWith("D:/data/run.xlsx", patched);
    expect(qpcr.workbookBytes).toBe(saved);
    expect(qpcr.calcPhase).toBe("success");
    expect(qpcr.geneSheetNames).toEqual(["Summary_All_Genes", "Gapdh"]);
    expect(qpcr.chartInjectPhase).toBe("success");
    expect(mocks.qpcrInjectCharts).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 1,
        filePath: "D:/data/run.xlsx",
        repeatCount: 2,
        colorHex: "#2F6FED",
        method: "ref-normalized",
      }),
    );
    // Prefer the summary sheet for plotting.
    expect(qpcr.plotSheetName).toBe("Summary_All_Genes");
  });

  it("passes selectNum / outlierSd / control group through", async () => {
    primeTransformed();
    qpcr.calcMethod = "control-relative";
    qpcr.controlGroup = "Treatment";
    qpcr.selectNum = 2;
    qpcr.outlierSd = 0;
    const result = makeCalcResult();
    result.chartSeries = [];
    mocks.workerExtractSheet.mockResolvedValue({ snapshot: {} });
    mocks.qpcrCalculate.mockResolvedValue(result);
    mocks.workerApplyPatch.mockResolvedValue({
      bytes: new ArrayBuffer(4),
      sheetNames: qpcr.sheetNames,
    });
    mocks.readFileBytes.mockResolvedValue(new ArrayBuffer(4));

    await runCalculate();
    await flush();

    expect(mocks.qpcrCalculate).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          method: "control-relative",
          controlGroup: "Treatment",
          selectNum: 2,
          outlierSd: 0,
        },
      }),
    );
    // No series → no chart injection.
    expect(mocks.qpcrInjectCharts).not.toHaveBeenCalled();
    expect(qpcr.chartInjectPhase).toBe("idle");
  });

  it("reports a missing Transformed Data sheet", async () => {
    qpcr.filePath = "f.xlsx";
    qpcr.workbookBytes = new ArrayBuffer(4);
    qpcr.sheetNames = ["Sheet1"];
    qpcr.geneNames = ["Gapdh"];
    qpcr.refGene = "Gapdh";

    await runCalculate();
    await flush();

    expect(qpcr.calcPhase).toBe("error");
    expect(qpcr.calcMessage).toBe("请先转换数据");
  });
});

describe("runPlot + cancelPlot", () => {
  function primeFile(): void {
    qpcr.filePath = "D:/data/run.xlsx";
    qpcr.fileName = "run.xlsx";
    qpcr.workbookBytes = new ArrayBuffer(8);
    qpcr.sheetNames = ["Summary_All_Genes"];
    qpcr.plotSheetName = "Summary_All_Genes";
    qpcr.plotOutputDir = "D:/data";
  }

  it("runs the plot with the active draft and reports success", async () => {
    primeFile();
    mocks.qpcrPlotRun.mockImplementation(
      (_config: unknown, onLog: (line: LogLine) => void) => {
        onLog({ v: 1, tsMs: 1, level: "info", message: "plotting" });
        return Promise.resolve({
          v: 1,
          ok: true,
          outputDir: "D:/data",
          files: ["out.png"],
          statisticsFile: "D:/data/statistical_analysis_summary.csv",
          error: null,
          cancelled: false,
        });
      },
    );

    await runPlot();
    await flush();

    expect(qpcr.plotPhase).toBe("success");
    expect(qpcr.plotLogs.length).toBe(2); // preparing + R log line
    expect(qpcr.plotResult?.statisticsFile).toBe(
      "D:/data/statistical_analysis_summary.csv",
    );
    const config = mocks.qpcrPlotRun.mock.calls[0][0];
    expect(config).toEqual(
      expect.objectContaining({
        filePath: "D:/data/run.xlsx",
        sheetName: "Summary_All_Genes",
        outputDir: "D:/data",
        kind: "bar",
        installMissing: true,
        outputPrefix: "qpcr-barplot",
      }),
    );
  });

  it("marks cancelled when the runner reports QPCR_PLOT_CANCELLED", async () => {
    primeFile();
    mocks.qpcrPlotRun.mockResolvedValue({
      v: 1,
      ok: false,
      outputDir: null,
      files: [],
      statisticsFile: null,
      error: "QPCR_PLOT_CANCELLED",
      cancelled: true,
    });

    await runPlot();
    await flush();

    expect(qpcr.plotPhase).toBe("cancelled");
    expect(qpcr.plotMessage).toBe("已取消");
  });

  it("expands batch subfolders (legacy behavior)", async () => {
    primeFile();
    qpcr.plotBarDraft = { ...makeBarDraft(), batchMode: true };
    mocks.listDir.mockImplementation((path: string) => {
      if (path === "D:/data") {
        return Promise.resolve([
          { name: "batch-1", isDir: true },
          { name: "loose.xlsx", isDir: false },
        ]);
      }
      if (path === "D:/data/batch-1") {
        return Promise.resolve([{ name: "run.xlsx", isDir: false }]);
      }
      return Promise.resolve([]);
    });
    mocks.qpcrPlotRun.mockResolvedValue({
      v: 1,
      ok: true,
      outputDir: "D:/data/batch-1",
      files: [],
      statisticsFile: null,
      error: null,
      cancelled: false,
    });

    await runPlot();
    await flush();

    expect(mocks.qpcrPlotRun).toHaveBeenCalledTimes(1);
    const config = mocks.qpcrPlotRun.mock.calls[0][0];
    expect(config.filePath).toBe("D:/data/batch-1/run.xlsx");
    expect(config.outputDir).toBe("D:/data/batch-1");
    expect(qpcr.plotPhase).toBe("success");
  });

  it("errors when batch mode finds no same-named files", async () => {
    primeFile();
    qpcr.plotBarDraft = { ...makeBarDraft(), batchMode: true };
    mocks.listDir.mockResolvedValue([{ name: "empty", isDir: true }]);

    await runPlot();
    await flush();

    expect(qpcr.plotPhase).toBe("error");
    expect(mocks.qpcrPlotRun).not.toHaveBeenCalled();
    expect(lastToast()?.level).toBe("error");
  });

  it("cancels through the task center job id", async () => {
    primeFile();
    const task: TaskRecord = {
      v: 1,
      id: 42,
      kind: "qpcrPlot",
      label: "qPCR 绘图",
      status: "running",
      createdAtMs: 1,
      startedAtMs: null,
      finishedAtMs: null,
      progress: null,
      detail: null,
      error: null,
      outputDir: null,
    };
    mocks.tasksList.mockResolvedValue([task]);
    mocks.tasksCancel.mockResolvedValue(true);

    await cancelPlot();
    await flush();

    expect(mocks.tasksCancel).toHaveBeenCalledWith(42);
    expect(qpcr.jobId).toBe(42);
  });
});

describe("methodLabelKey", () => {
  it("maps both methods", () => {
    expect(methodLabelKey("ref-normalized")).toBe("qpcr.methodRefNormalized");
    expect(methodLabelKey("control-relative")).toBe("qpcr.methodControlRelative");
  });
});
