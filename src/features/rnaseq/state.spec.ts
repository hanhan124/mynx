import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeSummaryRow } from "../../lib/contracts/generated/rnaseq/DeSummaryRow.js";
import type { ImportData } from "../../lib/contracts/generated/rnaseq/ImportData.js";
import type { ResultFileItem } from "../../lib/contracts/generated/rnaseq/ResultFileItem.js";
import type { RunDirEntry } from "../../lib/contracts/generated/rnaseq/RunDirEntry.js";
import type { RunResult } from "../../lib/contracts/generated/rnaseq/RunResult.js";
import type { RnaSeqConfig } from "../../lib/contracts/generated/rnaseq/RnaSeqConfig.js";
import type { LogLine } from "../../lib/contracts/generated/task/LogLine.js";
import type { TaskRecord } from "../../lib/contracts/generated/task/TaskRecord.js";
import { app } from "../../app/state.svelte";
import {
  addBatch,
  addComparison,
  addGroup,
  assignSample,
  cancelRun,
  goStep,
  importCounts,
  initRnaseq,
  installMissingPackages,
  loadConfigFromDialog,
  loadResultDir,
  missingBatchSamples,
  poolSamples,
  removeBatch,
  removeComparison,
  removeGroup,
  renameBatch,
  renameGroup,
  rnaseq,
  saveConfigToDialog,
  startRun,
  toggleBatchSample,
  unassignSample,
  updateComparison,
} from "./state.svelte";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  openPath: vi.fn(),
  rCheckDependencies: vi.fn(),
  rInstallPackages: vi.fn(),
  tasksCancel: vi.fn(),
  tasksList: vi.fn(),
  confirmDialog: vi.fn(),
  defaultConfigSavePath: vi.fn(),
  defaultOutputBase: vi.fn(),
  onRInstallLog: vi.fn(),
  pickOpenDir: vi.fn(),
  pickOpenFile: vi.fn(),
  pickSaveFile: vi.fn(),
  readTextFileAt: vi.fn(),
  rnaseqCancel: vi.fn(),
  rnaseqDefaultConfig: vi.fn(),
  rnaseqImportCounts: vi.fn(),
  rnaseqListResultFiles: vi.fn(),
  rnaseqListRuns: vi.fn(),
  rnaseqLoadParams: vi.fn(),
  rnaseqMergeConfig: vi.fn(),
  rnaseqReadDeSummary: vi.fn(),
  rnaseqRun: vi.fn(),
  writeTextFileAt: vi.fn(),
}));

vi.mock("../../app/tauri.js", () => ({
  call: mocks.call,
  openPath: mocks.openPath,
  setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  rCheckDependencies: mocks.rCheckDependencies,
  rInstallPackages: mocks.rInstallPackages,
  settingsLoad: vi.fn(),
  settingsSave: vi.fn(),
  settingsMigrateLegacy: vi.fn(),
  tasksCancel: mocks.tasksCancel,
  tasksList: mocks.tasksList,
}));

vi.mock("./client.js", () => ({
  RNASEQ_WIRE_VERSION: 1,
  confirmDialog: mocks.confirmDialog,
  defaultConfigSavePath: mocks.defaultConfigSavePath,
  defaultOutputBase: mocks.defaultOutputBase,
  onRInstallLog: mocks.onRInstallLog,
  pickOpenDir: mocks.pickOpenDir,
  pickOpenFile: mocks.pickOpenFile,
  pickSaveFile: mocks.pickSaveFile,
  readTextFileAt: mocks.readTextFileAt,
  resultFileUrl: vi.fn(() => "asset://x"),
  rnaseqCancel: mocks.rnaseqCancel,
  rnaseqDefaultConfig: mocks.rnaseqDefaultConfig,
  rnaseqImportCounts: mocks.rnaseqImportCounts,
  rnaseqListResultFiles: mocks.rnaseqListResultFiles,
  rnaseqListRuns: mocks.rnaseqListRuns,
  rnaseqLoadParams: mocks.rnaseqLoadParams,
  rnaseqMergeConfig: mocks.rnaseqMergeConfig,
  rnaseqReadDeSummary: mocks.rnaseqReadDeSummary,
  rnaseqRun: mocks.rnaseqRun,
  writeTextFileAt: mocks.writeTextFileAt,
}));

/** Full default-shaped config mirroring the Rust defaults. */
function makeConfig(): RnaSeqConfig {
  return {
    data_file: "",
    output_dir: "",
    run_name: "auto",
    sample_labels: {},
    batch: {},
    overall_genes: [],
    gene_clusters: {},
    input: {
      count_file: "",
      gene_col: 1,
      drop_empty_gene: true,
      duplicate_genes: "sum",
      rounding: "round",
    },
    groups: {},
    de: {
      method: "deseq2",
      padj: 0.05,
      log2fc: 1,
      bcv: 0.4,
      shrink: "none",
      use_batch: true,
      filter: { method: "filterByExpr", min_count: 10, min_total_count: 15, min_samples: 2 },
    },
    comparisons: [],
    heatmap: {
      transform: "vst",
      scale: "row",
      palette: "RdBu",
      reverse_palette: true,
      zlim: 2,
      group_palette: "Set2",
      gene_group_palette: "Dark2",
      cluster_rows: true,
      cluster_columns: false,
      row_distance: "pearson",
      column_distance: "euclidean",
      cluster_method: "ward.D2",
      column_names_rot: 0,
      column_names_side: "top",
      group_bar_height: 1,
      cluster_bar_width: 5,
      cluster_bar_side: "left",
      row_title_rot: 0,
      show_row_names: null,
      show_row_title: true,
      row_names_italic: true,
      show_column_names: true,
      show_annotation_name: false,
      group_legend_title: "",
      show_title: false,
      show_batch: true,
      font_size: 9,
      marker_font_size: 8,
      max_cluster_rows: 5000,
      use_raster: null,
      raster_quality: 1,
      formats: ["png"],
      dpi: 600,
    },
    overall_heatmap: {
      enabled: true,
      name: "overall",
      gene_source: "variable",
      top_n: "all",
      expressed_only: true,
      comparisons: null,
      max_genes: 2000,
      marker_genes: [],
      marker_add_missing: true,
      n_clusters: 3,
      sample_correlation: true,
      correlation_palette: "YlOrRd",
      correlation_show_annotation_name: false,
    },
    selected_heatmaps: [],
    plots: {
      formats: ["png"],
      dpi: 300,
      font_family: "Arial",
      base_size: 7,
      group_palette: "npg",
      plot_pad_mm: 2,
      label_halo: true,
      legend_gap_mm: 0.8,
      pca: [],
      volcano: {
        enabled: true,
        comparisons: null,
        label_top: 10,
        label_genes: null,
        point_size: 0.5,
        width_mm: 78,
        height_mm: 70,
        legend_pos: "right",
        show_subtitle: false,
      },
      additional: {
        enabled: true,
        ma: true,
        sample_distance: true,
        mds: true,
        library_size: true,
        expression_distribution: true,
        deg_summary: true,
        deg_dotplot: true,
        gene_expression: true,
        upset: true,
        deg_matrix: true,
        inferential_annotations: false,
        top_n: 15,
        label_top: 10,
        genes: [],
        width_mm: 89,
        height_mm: 70,
      },
    },
    steps: null,
  };
}

function makeImportData(overrides?: Partial<ImportData>): ImportData {
  return {
    v: 1,
    geneCol: "gene",
    sampleCols: ["s1", "s2"],
    nonzeroCounts: { s1: 5, s2: 3 },
    totalGenes: 100,
    preview: [{ gene: "MITF", s1: 4, s2: 1 }],
    previewColumns: ["gene", "s1", "s2"],
    sourceFile: "C:\\data\\raw.csv",
    dataFile: "C:\\data\\norm.csv",
    converted: true,
    format: "csv",
    matrixFormat: "counts_matrix",
    matrixFormatApplied: "counts_matrix",
    warnings: [],
    ...overrides,
  };
}

function makeResult(): RunResult {
  return {
    v: 1,
    taskId: 7,
    status: "done",
    exitCode: 0,
    outputDir: "C:\\out\\run1",
    runName: "run1",
  };
}

function makeTask(id: number, status: TaskRecord["status"]): TaskRecord {
  return {
    v: 1,
    id,
    kind: "rnaseqRun",
    label: "RNA-seq run",
    status,
    createdAtMs: 0,
    startedAtMs: null,
    finishedAtMs: null,
    progress: null,
    detail: null,
    error: null,
    outputDir: null,
  };
}

async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function lastToast(): { level: string; message: string } | undefined {
  return app.toasts[app.toasts.length - 1];
}

/** Populates a ready-to-run state: imported data + two groups + comparison. */
function seedReadyState(): void {
  rnaseq.config = makeConfig();
  rnaseq.importData = makeImportData();
  rnaseq.config.data_file = "C:\\data\\norm.csv";
  rnaseq.config.input.count_file = "C:\\data\\norm.csv";
  rnaseq.config.groups = { G1: ["s1", "s2"], G2: ["s3", "s4"] };
  rnaseq.config.comparisons = [{ name: "G1_vs_G2", case: "G1", control: "G2", mode: "auto" }];
  rnaseq.status = "idle";
  rnaseq.logs = [];
  rnaseq.hasResult = false;
  rnaseq.resultDir = "";
}

beforeEach(() => {
  rnaseq.config = makeConfig();
  rnaseq.configReady = false;
  rnaseq.importPhase = "idle";
  rnaseq.importMessage = "";
  rnaseq.importData = null;
  rnaseq.importSourcePath = "";
  rnaseq.matrixFormat = "counts_matrix";
  rnaseq.status = "idle";
  rnaseq.logs = [];
  rnaseq.jobId = null;
  rnaseq.resultDir = "";
  rnaseq.hasResult = false;
  rnaseq.deSummary = [];
  rnaseq.resultFiles = [];
  rnaseq.history = [];
  rnaseq.historyPhase = "idle";
  rnaseq.rDeps = null;
  rnaseq.installPhase = "idle";
  rnaseq.installLogs = [];
  rnaseq.installJobId = null;
  rnaseq.step = "import";
  rnaseq.tutorialOpen = false;
  rnaseq.selectedSample = "";
  rnaseq.dragOver = false;
  app.toasts.splice(0, app.toasts.length);
  app.tasks.splice(0, app.tasks.length);
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.onRInstallLog.mockResolvedValue(() => undefined);
  mocks.defaultOutputBase.mockResolvedValue("C:\\Users\\u\\Mynx\\rnaseq_runs");
  mocks.defaultConfigSavePath.mockResolvedValue("C:\\Users\\u\\rnaseq_config.json");
});

describe("initRnaseq", () => {
  it("applies the Rust default config once", async () => {
    mocks.rnaseqDefaultConfig.mockResolvedValue(makeConfig());
    mocks.rCheckDependencies.mockResolvedValue({
      v: 1,
      rscriptFound: true,
      missing: [],
      error: null,
    });
    await initRnaseq();
    expect(rnaseq.configReady).toBe(true);
    expect(rnaseq.config.run_name).toBe("auto");
    expect(mocks.rnaseqDefaultConfig).toHaveBeenCalledTimes(1);
  });
});

describe("import", () => {
  it("builds the ImportRequest from the input config and updates the state", async () => {
    const data = makeImportData({ matrixFormatApplied: "featurecounts" });
    mocks.rnaseqImportCounts.mockResolvedValue(data);
    const result = await importCounts("C:\\data\\raw.csv", "featurecounts");
    expect(result).toBe(data);
    expect(mocks.rnaseqImportCounts).toHaveBeenCalledWith({
      v: 1,
      path: "C:\\data\\raw.csv",
      matrixFormat: "featurecounts",
      geneCol: 1,
      dropEmptyGene: true,
      duplicateGenes: "sum",
      rounding: "round",
      writeNormalizedCsv: true,
    });
    expect(rnaseq.config.data_file).toBe("C:\\data\\norm.csv");
    expect(rnaseq.config.input.count_file).toBe("C:\\data\\norm.csv");
    expect(rnaseq.importSourcePath).toBe("C:\\data\\raw.csv");
    expect(rnaseq.matrixFormat).toBe("featurecounts");
    expect(rnaseq.importPhase).toBe("success");
  });

  it("exposes import warnings (display logic)", async () => {
    const data = makeImportData({ warnings: ["duplicate genes summed"] });
    mocks.rnaseqImportCounts.mockResolvedValue(data);
    await importCounts("C:\\data\\raw.csv");
    const { importWarnings } = await import("./state.svelte");
    expect(importWarnings()).toEqual(["duplicate genes summed"]);
  });

  it("fails with an error phase and keeps the previous import", async () => {
    mocks.rnaseqImportCounts.mockRejectedValue(new Error("bad file"));
    await expect(importCounts("C:\\data\\bad.csv")).rejects.toThrow("bad file");
    expect(rnaseq.importPhase).toBe("error");
    expect(rnaseq.importMessage).toBe("bad file");
    expect(rnaseq.importData).toBeNull();
    expect(rnaseq.config.data_file).toBe("");
  });
});

describe("groups editor transitions", () => {
  it("adds groups with non-colliding names", () => {
    const name = addGroup();
    expect(name).toBe("Group1");
    expect(rnaseq.config.groups.Group1).toEqual([]);
    rnaseq.config.groups = { Group2: ["s1"] };
    expect(addGroup()).toBe("Group3");
  });

  it("renames groups in order and syncs comparisons", () => {
    rnaseq.config.groups = { G1: ["s1"], G2: ["s2"] };
    rnaseq.config.comparisons = [{ name: "c", case: "G1", control: "G2", mode: "auto" }];
    renameGroup("G1", "  KO ");
    expect(Object.keys(rnaseq.config.groups)).toEqual(["KO", "G2"]);
    expect(rnaseq.config.comparisons[0]).toMatchObject({ case: "KO", control: "G2" });
  });

  it("rejects duplicate group names with a toast", () => {
    rnaseq.config.groups = { G1: ["s1"], G2: ["s2"] };
    renameGroup("G1", "G2");
    expect(rnaseq.config.groups.G1).toEqual(["s1"]);
    expect(lastToast()?.level).toBe("error");
  });

  it("removes a group and its comparisons", () => {
    rnaseq.config.groups = { G1: ["s1"], G2: ["s2"] };
    rnaseq.config.comparisons = [
      { name: "a", case: "G1", control: "G2", mode: "auto" },
      { name: "b", case: "G2", control: "G2", mode: "auto" },
    ];
    removeGroup("G1");
    expect(Object.keys(rnaseq.config.groups)).toEqual(["G2"]);
    expect(rnaseq.config.comparisons).toEqual([
      { name: "b", case: "G2", control: "G2", mode: "auto" },
    ]);
  });

  it("moves a sample between groups keeping single membership", () => {
    rnaseq.importData = makeImportData();
    rnaseq.config.groups = { G1: ["s1", "s2"], G2: [] };
    assignSample("s1", "G2");
    expect(rnaseq.config.groups.G1).toEqual(["s2"]);
    expect(rnaseq.config.groups.G2).toEqual(["s1"]);
    unassignSample("s1");
    expect(rnaseq.config.groups.G2).toEqual([]);
    expect(poolSamples()).toEqual(["s1"]);
  });

  it("ignores assignment to unknown groups", () => {
    rnaseq.config.groups = { G1: [] };
    assignSample("s1", "missing");
    expect(rnaseq.config.groups.G1).toEqual([]);
  });
});

describe("comparisons editor", () => {
  it("adds, auto-names and removes comparisons", () => {
    addComparison();
    expect(rnaseq.config.comparisons).toHaveLength(1);
    updateComparison(0, { case: "A" });
    updateComparison(0, { control: "B" });
    expect(rnaseq.config.comparisons[0]).toMatchObject({ name: "A_vs_B", case: "A", control: "B" });
    updateComparison(0, { name: "custom" });
    updateComparison(0, { control: "C" });
    expect(rnaseq.config.comparisons[0].name).toBe("custom");
    removeComparison(0);
    expect(rnaseq.config.comparisons).toHaveLength(0);
  });
});

describe("batch editor", () => {
  it("adds, renames and removes batches", () => {
    addBatch();
    addBatch();
    expect(Object.keys(rnaseq.config.batch)).toEqual(["Batch1", "Batch2"]);
    renameBatch("Batch1", "Day1");
    expect(Object.keys(rnaseq.config.batch)).toEqual(["Day1", "Batch2"]);
    removeBatch("Day1");
    expect(Object.keys(rnaseq.config.batch)).toEqual(["Batch2"]);
  });

  it("toggles exclusive sample membership and reports missing samples", () => {
    rnaseq.importData = makeImportData();
    rnaseq.importData.sampleCols = ["s1", "s2", "s3"];
    rnaseq.config.groups = { G1: ["s1", "s2", "s3"] };
    addBatch();
    toggleBatchSample("Batch1", "s1");
    toggleBatchSample("Batch1", "s2");
    expect(rnaseq.config.batch.Batch1).toEqual(["s1", "s2"]);
    addBatch();
    toggleBatchSample("Batch2", "s2");
    expect(rnaseq.config.batch.Batch1).toEqual(["s1"]);
    expect(rnaseq.config.batch.Batch2).toEqual(["s2"]);
    expect(missingBatchSamples()).toEqual(["s3"]);
    removeBatch("Batch1");
    removeBatch("Batch2");
    expect(missingBatchSamples()).toEqual([]);
  });
});

describe("run validation", () => {
  it("requires data, comparisons and complete batches (legacy order)", async () => {
    const { runValidationFailure } = await import("./state.svelte");
    expect(runValidationFailure(["de"])).toBe("rnaseq.errDataRequired");
    rnaseq.config.data_file = "C:\\data\\norm.csv";
    expect(runValidationFailure(["de"])).toBe("rnaseq.errComparisonsRequired");
    rnaseq.config.groups = { G1: ["s1"], G2: ["s2"] };
    rnaseq.config.comparisons = [{ name: "c", case: "G1", control: "G2", mode: "auto" }];
    expect(runValidationFailure(["de"])).toBeNull();
    rnaseq.config.batch = { B1: ["s1"] };
    expect(runValidationFailure(["de"])).toBe("rnaseq.errBatchIncomplete");
    expect(runValidationFailure(["heatmap"])).toBeNull();
  });

  it("blocks startRun with a toast when validation fails", async () => {
    await startRun(["de"]);
    expect(rnaseq.status).toBe("idle");
    expect(mocks.rnaseqRun).not.toHaveBeenCalled();
    expect(lastToast()?.level).toBe("error");
  });
});

describe("run state machine", () => {
  it("reaches done, loads results and updates output naming", async () => {
    seedReadyState();
    rnaseq.config.output_dir = "C:\\out";
    const logs: LogLine[] = [];
    mocks.rnaseqRun.mockImplementation(
      async (_cfg: unknown, _steps: unknown, onLog: (line: LogLine) => void) => {
        onLog({ v: 1, tsMs: 1, level: "info", message: "engine started" });
        logs.push({ v: 1, tsMs: 1, level: "info", message: "engine started" });
        return makeResult();
      },
    );
    const runs: RunDirEntry[] = [
      { v: 1, path: "C:\\out\\run1", name: "run1", mtimeMs: 5, hasDe: true, hasParams: true },
    ];
    mocks.rnaseqListRuns.mockResolvedValue(runs);
    const files: ResultFileItem[] = [
      { v: 1, name: "volcano_G1_vs_G2.png", subdir: "plots", size: 10, mtimeMs: 1 },
    ];
    mocks.rnaseqListResultFiles.mockResolvedValue(files);
    const summary: DeSummaryRow[] = [
      {
        v: 1,
        comparison: "G1_vs_G2",
        case: "G1",
        control: "G2",
        nCase: 2,
        nControl: 2,
        path: "replicate",
        method: "DESeq2",
        genesTested: 100,
        padjCutoff: 0.05,
        log2fcCutoff: 1,
        up: 10,
        down: 5,
      },
    ];
    mocks.rnaseqReadDeSummary.mockResolvedValue(summary);

    await startRun(["de"]);
    await flush();
    expect(rnaseq.status).toBe("done");
    expect(rnaseq.logs).toHaveLength(1);
    expect(rnaseq.logs[0].message).toBe("engine started");
    expect(rnaseq.config.output_dir).toBe("C:\\out");
    expect(rnaseq.config.run_name).toBe("run1");
    expect(rnaseq.resultDir).toBe("C:\\out\\run1");
    expect(rnaseq.resultFiles).toEqual(files);
    expect(rnaseq.deSummary).toEqual(summary);
    expect(rnaseq.hasResult).toBe(true);
    expect(lastToast()?.level).toBe("success");
  });

  it("marks failed when the engine errors", async () => {
    seedReadyState();
    mocks.rnaseqRun.mockRejectedValue(new Error("boom"));
    await startRun(["de"]);
    await flush();
    expect(rnaseq.status).toBe("failed");
    expect(rnaseq.logs[rnaseq.logs.length - 1].level).toBe("error");
    expect(lastToast()?.level).toBe("error");
  });

  it("marks cancelled from the terminal result", async () => {
    seedReadyState();
    mocks.rnaseqRun.mockResolvedValue({ ...makeResult(), status: "cancelled" });
    await startRun(["de"]);
    await flush();
    expect(rnaseq.status).toBe("cancelled");
    expect(lastToast()?.level).toBe("info");
  });

  it("cancels via the task-center job id (reactive first, list fallback)", async () => {
    seedReadyState();
    app.tasks.push(makeTask(31, "running"));
    await cancelRun();
    expect(mocks.rnaseqCancel).toHaveBeenCalledWith(31);
    app.tasks.splice(0, app.tasks.length);
    mocks.tasksList.mockResolvedValue([makeTask(32, "queued"), makeTask(30, "running")]);
    await cancelRun();
    expect(mocks.rnaseqCancel).toHaveBeenCalledWith(32);
    expect(rnaseq.jobId).toBe(32);
  });
});

describe("result directory loading", () => {
  it("loads results, restores params with output naming forced", async () => {
    const files: ResultFileItem[] = [
      { v: 1, name: "a.png", subdir: "heatmap", size: 1, mtimeMs: 1 },
    ];
    mocks.rnaseqListResultFiles.mockResolvedValue(files);
    mocks.rnaseqReadDeSummary.mockResolvedValue([]);
    const params = { ...makeConfig(), steps: ["de"] };
    mocks.rnaseqLoadParams.mockResolvedValue(params);
    mocks.rnaseqMergeConfig.mockImplementation(async (patch: Record<string, unknown>) => {
      return { ...makeConfig(), ...patch } as RnaSeqConfig;
    });
    rnaseq.config.data_file = "C:\\data\\norm.csv";
    rnaseq.config.input.count_file = "C:\\data\\norm.csv";

    const ok = await loadResultDir("C:\\out\\run1\\");
    expect(ok).toBe(true);
    const patch = mocks.rnaseqMergeConfig.mock.calls[0][0] as Record<string, unknown>;
    expect(patch.output_dir).toBe("C:\\out");
    expect(patch.run_name).toBe("run1");
    expect(patch.steps).toBeUndefined();
    expect(rnaseq.config.output_dir).toBe("C:\\out");
    expect(rnaseq.config.run_name).toBe("run1");
    expect(rnaseq.hasResult).toBe(true);
    expect(lastToast()?.level).toBe("success");
  });

  it("keeps the current config when params.json is missing", async () => {
    mocks.rnaseqListResultFiles.mockResolvedValue([
      { v: 1, name: "a.png", subdir: "heatmap", size: 1, mtimeMs: 1 },
    ]);
    mocks.rnaseqReadDeSummary.mockRejectedValue(new Error("missing"));
    mocks.rnaseqLoadParams.mockRejectedValue(new Error("params not found"));
    rnaseq.config.run_name = "previous";
    const ok = await loadResultDir("C:\\out\\run1");
    expect(ok).toBe(true);
    expect(rnaseq.config.output_dir).toBe("C:\\out");
    expect(rnaseq.config.run_name).toBe("run1");
    expect(mocks.rnaseqMergeConfig).not.toHaveBeenCalled();
    expect(lastToast()?.level).toBe("info");
  });

  it("rejects directories without run results", async () => {
    mocks.rnaseqListResultFiles.mockResolvedValue([]);
    mocks.rnaseqReadDeSummary.mockRejectedValue(new Error("missing"));
    const ok = await loadResultDir("C:\\not-a-run");
    expect(ok).toBe(false);
    expect(rnaseq.resultDir).toBe("");
    expect(rnaseq.hasResult).toBe(false);
    expect(lastToast()?.level).toBe("error");
  });
});

describe("config IO", () => {
  it("saves the config JSON without runtime steps", async () => {
    mocks.pickSaveFile.mockResolvedValue("C:\\cfg\\rnaseq_config.json");
    rnaseq.config = makeConfig();
    rnaseq.config.steps = ["de"];
    await saveConfigToDialog();
    expect(mocks.writeTextFileAt).toHaveBeenCalledTimes(1);
    const [path, text] = mocks.writeTextFileAt.mock.calls[0] as [string, string];
    expect(path).toBe("C:\\cfg\\rnaseq_config.json");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.steps).toBeUndefined();
    expect(parsed.run_name).toBe("auto");
    expect(lastToast()?.level).toBe("success");
  });

  it("loads a config JSON, merges and re-imports the data file", async () => {
    mocks.pickOpenFile.mockResolvedValue("C:\\cfg\\rnaseq_config.json");
    mocks.readTextFileAt.mockResolvedValue(
      JSON.stringify({ run_name: "loaded", data_file: "C:\\data\\raw.csv" }),
    );
    mocks.rnaseqMergeConfig.mockImplementation(async (patch: Record<string, unknown>) => {
      return { ...makeConfig(), ...patch } as RnaSeqConfig;
    });
    mocks.rnaseqImportCounts.mockResolvedValue(makeImportData());
    await loadConfigFromDialog();
    expect(rnaseq.config.run_name).toBe("loaded");
    expect(rnaseq.config.data_file).toBe("C:\\data\\norm.csv");
    expect(rnaseq.configReady).toBe(false); // config IO never fakes defaults
    expect(lastToast()?.level).toBe("success");
  });

  it("reports an info toast when the config data file fails to import", async () => {
    mocks.pickOpenFile.mockResolvedValue("C:\\cfg\\rnaseq_config.json");
    mocks.readTextFileAt.mockResolvedValue(JSON.stringify({ data_file: "C:\\data\\gone.csv" }));
    mocks.rnaseqMergeConfig.mockImplementation(async (patch: Record<string, unknown>) => {
      return { ...makeConfig(), ...patch } as RnaSeqConfig;
    });
    mocks.rnaseqImportCounts.mockRejectedValue(new Error("missing file"));
    await loadConfigFromDialog();
    const levels = app.toasts.map((toast) => toast.level);
    expect(levels).toContain("info");
    expect(levels).toContain("success");
  });
});

describe("step gating (legacy flow)", () => {
  it("blocks design/plots without a data file", () => {
    expect(goStep("design")).toBe(false);
    expect(rnaseq.step).toBe("import");
    expect(lastToast()?.level).toBe("info");
    rnaseq.config.data_file = "C:\\data\\norm.csv";
    expect(goStep("design")).toBe(true);
    expect(rnaseq.step).toBe("design");
  });

  it("blocks plots until a result is loaded", () => {
    rnaseq.config.data_file = "C:\\data\\norm.csv";
    expect(goStep("plots")).toBe(false);
    rnaseq.hasResult = true;
    expect(goStep("plots")).toBe(true);
    expect(rnaseq.step).toBe("plots");
  });
});

describe("R package installation", () => {
  it("installs missing packages and re-checks dependencies", async () => {
    mocks.rCheckDependencies
      .mockResolvedValueOnce({ v: 1, rscriptFound: true, missing: [], error: null })
      .mockResolvedValueOnce({ v: 1, rscriptFound: true, missing: [], error: null });
    mocks.rInstallPackages.mockResolvedValue(9);
    await installMissingPackages();
    expect(rnaseq.installPhase).toBe("success");
    expect(rnaseq.installJobId).toBe(9);
    expect(mocks.rInstallPackages).toHaveBeenCalledTimes(1);
  });

  it("surfaces install failures", async () => {
    mocks.rInstallPackages.mockRejectedValue(new Error("offline"));
    await installMissingPackages();
    expect(rnaseq.installPhase).toBe("error");
    expect(lastToast()?.level).toBe("error");
  });
});
