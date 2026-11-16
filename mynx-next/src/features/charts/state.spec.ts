import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartImportedData } from "../../lib/contracts/generated/charts/ChartImportedData.js";
import type { SettingsDoc } from "../../lib/contracts/generated/settings/SettingsDoc.js";
import type { ChartPreset } from "../../lib/contracts/generated/settings/ChartPreset.js";
import type { JsonValue } from "../../lib/contracts/generated/serde_json/JsonValue.js";
import { app } from "../../app/state.svelte";
import {
  autoAssignColumns,
  buildRunConfig,
  chartState,
  clearData,
  deletePreset,
  importDataFile,
  loadChartStudioSettings,
  loadPreset,
  localizeChartError,
  localizeChartEventMessage,
  mergeImportedPresets,
  requestCancel,
  refreshRStatus,
  runGeneration,
  selectTemplate,
  savePreset,
  templateFieldDefaults,
  toneOfEvent,
  useSampleData,
  validateRunInputs,
} from "./state.svelte.js";
import { createInitialChartConfig } from "./inspector-fields.js";
import { DEFAULT_TEMPLATE, templateById } from "./catalog.js";

const mocks = vi.hoisted(() => ({
  settingsLoad: vi.fn(),
  settingsSave: vi.fn(),
  tasksList: vi.fn(),
  rStatus: vi.fn(),
  rInstallRuntime: vi.fn(),
  importChartData: vi.fn(),
  writeFile: vi.fn(),
  runChart: vi.fn(),
  cancelChartRun: vi.fn(),
  readChartManifest: vi.fn(),
}));
const pathMocks = vi.hoisted(() => ({
  homeDir: vi.fn(),
  join: vi.fn(),
  resourceDir: vi.fn(),
  tempDir: vi.fn(),
}));

vi.mock("../../app/tauri.js", () => ({
  setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  settingsLoad: mocks.settingsLoad,
  settingsSave: mocks.settingsSave,
  tasksList: mocks.tasksList,
  rStatus: mocks.rStatus,
  rInstallRuntime: mocks.rInstallRuntime,
  call: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("./client.js", () => ({
  importChartData: mocks.importChartData,
  runChart: mocks.runChart,
  cancelChartRun: mocks.cancelChartRun,
  readChartManifest: mocks.readChartManifest,
  listChartTemplates: vi.fn(),
  exportChartZip: vi.fn(),
  installChartTemplatePackage: vi.fn(),
}));
vi.mock("@tauri-apps/api/path", () => pathMocks);
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeFile: mocks.writeFile,
  writeTextFile: vi.fn(),
}));

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function importedData(filePath: string): ChartImportedData {
  return {
    v: 1,
    filePath,
    columns: ["group", "value"],
    rows: [
      ["A", 1],
      ["B", 2],
    ],
    totalRows: 2,
    warnings: [],
  };
}

function makeDoc(overrides: Partial<SettingsDoc> = {}): SettingsDoc {
  return {
    theme: "pearl",
    alwaysOnTop: false,
    chartColor: "#2f6fed",
    language: "zh",
    searchEngine: "",
    homeHeaderHeight: 0,
    imageConverterOptions: null,
    chartStudioPresets: [],
    ...overrides,
  };
}

function resetState(): void {
  chartState.cfg = createInitialChartConfig();
  chartState.imported = null;
  chartState.importing = false;
  chartState.manifest = null;
  chartState.presets = [];
  chartState.runPhase = "idle";
  chartState.rFound = null;
  chartState.installingR = false;
  chartState.cancelling = false;
  chartState.rInstallPrompt = false;
  chartState.events = [];
  chartState.logText = "";
  chartState.lastResult = null;
  chartState.selectedTemplateId = DEFAULT_TEMPLATE.id;
  app.toasts.splice(0, app.toasts.length);
  for (const mock of Object.values(mocks)) mock.mockReset();
  for (const mock of Object.values(pathMocks)) mock.mockReset();
  mocks.readChartManifest.mockResolvedValue(makeManifest());
}

function lastToast(): { level: string; message: string } | undefined {
  return app.toasts[app.toasts.length - 1];
}

function makeManifest(): {
  id: string;
  name: string;
  family: string;
  status: string;
  sourceUrl: string | null;
  sourceRepoPath: string | null;
  packages: string[];
  outputs: string[];
  dataRoles: Array<{
    key: string;
    label: string;
    acceptedTypes: string[];
    required: boolean;
    description: string | null;
  }>;
  referencePath: string | null;
  referenceImageUrl: string | null;
} {
  return {
    ...(templateById.get(DEFAULT_TEMPLATE.id) as unknown as Record<string, never>),
    id: DEFAULT_TEMPLATE.id,
    name: "基础柱状图",
    family: "barplot",
    status: "verified",
    sourceUrl: null,
    sourceRepoPath: null,
    packages: ["ggplot2"],
    outputs: ["png", "svg"],
    dataRoles: [
      {
        key: "category",
        label: "分类",
        acceptedTypes: ["string"],
        required: true,
        description: "柱标签",
      },
      {
        key: "value",
        label: "数值",
        acceptedTypes: ["number"],
        required: true,
        description: "柱高度",
      },
    ],
    referencePath: "reference.png",
    referenceImageUrl: null,
  };
}

beforeEach(() => {
  resetState();
});

describe("R status on chart page re-entry", () => {
  it("reuses recent availability and allows a forced refresh", async () => {
    mocks.rStatus.mockResolvedValue({
      v: 1,
      found: true,
      rscript: "Rscript",
    });

    await refreshRStatus();
    await refreshRStatus();
    expect(mocks.rStatus).toHaveBeenCalledTimes(1);

    await refreshRStatus(true);
    expect(mocks.rStatus).toHaveBeenCalledTimes(2);
    expect(chartState.rFound).toBe(true);
  });

  it("coalesces simultaneous status checks", async () => {
    let resolveStatus!: (value: { v: 1; found: boolean; rscript: string }) => void;
    mocks.rStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );

    const first = refreshRStatus();
    const second = refreshRStatus();
    expect(mocks.rStatus).toHaveBeenCalledTimes(1);

    resolveStatus({ v: 1, found: true, rscript: "Rscript" });
    await Promise.all([first, second]);
    expect(chartState.rFound).toBe(true);
  });
});

describe("template selection requests", () => {
  it("coalesces same-template reads and ignores older selection results", async () => {
    const [firstId, secondId] = [...templateById.keys()].slice(0, 2);
    const resolveById = new Map<string, (manifest: ReturnType<typeof makeManifest>) => void>();
    mocks.readChartManifest.mockImplementation(
      (templateId: string) =>
        new Promise((resolve) => {
          resolveById.set(templateId, resolve);
        }),
    );

    const firstRequest = selectTemplate(firstId);
    const duplicateFirstRequest = selectTemplate(firstId);
    expect(mocks.readChartManifest).toHaveBeenCalledTimes(1);

    const secondRequest = selectTemplate(secondId);
    expect(mocks.readChartManifest).toHaveBeenCalledTimes(2);
    resolveById.get(secondId)!({ ...makeManifest(), id: secondId });
    await secondRequest;
    resolveById.get(firstId)!({ ...makeManifest(), id: firstId });
    await Promise.all([firstRequest, duplicateFirstRequest]);

    expect(chartState.selectedTemplateId).toBe(secondId);
    expect(chartState.manifest?.id).toBe(secondId);
  });
});

describe("chart settings initialization", () => {
  it("does not replace an output path entered while defaults are loading", async () => {
    let resolveOutputDir!: (value: string) => void;
    pathMocks.homeDir.mockResolvedValue("C:/Users/test");
    pathMocks.join.mockReturnValue(
      new Promise((resolve) => {
        resolveOutputDir = resolve;
      }),
    );
    mocks.settingsLoad.mockResolvedValue(makeDoc());

    loadChartStudioSettings();
    await vi.waitFor(() => expect(pathMocks.join).toHaveBeenCalledTimes(1));
    chartState.cfg = { ...chartState.cfg, outputDir: "D:/custom-output" };
    resolveOutputDir("C:/Users/test/Mynx/charts");
    await Promise.resolve();

    expect(chartState.cfg.outputDir).toBe("D:/custom-output");
  });
});

describe("preset persistence (chartStudioPresets)", () => {
  it("saves a named preset over the current config", async () => {
    mocks.settingsLoad.mockResolvedValue(makeDoc({ chartStudioPresets: [] }));
    mocks.settingsSave.mockResolvedValue(undefined);
    chartState.cfg = { ...chartState.cfg, title: "Fig 1" };

    await savePreset("Nature 单栏");

    expect(mocks.settingsSave).toHaveBeenCalledTimes(1);
    const saved = mocks.settingsSave.mock.calls[0][0] as SettingsDoc;
    expect(saved.chartStudioPresets).toHaveLength(1);
    expect(saved.chartStudioPresets[0].name).toBe("Nature 单栏");
    expect((saved.chartStudioPresets[0].config as Record<string, unknown>).title).toBe("Fig 1");
    expect(chartState.presets).toHaveLength(1);
    expect(lastToast()?.level).toBe("success");
  });

  it("ignores empty preset names", async () => {
    await savePreset("   ");
    expect(mocks.settingsSave).not.toHaveBeenCalled();
    expect(chartState.presets).toHaveLength(0);
  });

  it("deletes a preset and persists the remaining list", async () => {
    const preset: ChartPreset = {
      id: "p1",
      name: "keep me out",
      config: JSON.parse(JSON.stringify(createInitialChartConfig())) as JsonValue,
      updatedAt: 1,
    };
    const keep: ChartPreset = { ...preset, id: "p2", name: "keep" };
    chartState.presets = [preset, keep];
    mocks.settingsLoad.mockResolvedValue(makeDoc({ chartStudioPresets: [preset, keep] }));
    mocks.settingsSave.mockResolvedValue(undefined);

    await deletePreset(preset);

    const saved = mocks.settingsSave.mock.calls[0][0] as SettingsDoc;
    expect(saved.chartStudioPresets.map((item) => item.id)).toEqual(["p2"]);
    expect(lastToast()?.level).toBe("success");
  });

  it("loadPreset merges the saved config over the defaults", async () => {
    const config = JSON.parse(
      JSON.stringify({ ...createInitialChartConfig(), title: "从预设", dpi: 600 }),
    ) as JsonValue;
    await loadPreset({ id: "p1", name: "保存的参数", config, updatedAt: 1 });
    expect(chartState.cfg.title).toBe("从预设");
    expect(chartState.cfg.dpi).toBe(600);
    expect(chartState.cfg.baseSize).toBe(createInitialChartConfig().baseSize);
    expect(chartState.cfg.template).toBe(DEFAULT_TEMPLATE.id);
  });

  it("loadPreset updates the selected template and its manifest", async () => {
    const templateId = [...templateById.keys()].find((id) => id !== DEFAULT_TEMPLATE.id)!;
    const config = JSON.parse(
      JSON.stringify({ ...createInitialChartConfig(), template: templateId, title: "跨模板预设" }),
    ) as JsonValue;
    mocks.readChartManifest.mockResolvedValue({ ...makeManifest(), id: templateId });

    await loadPreset({ id: "p2", name: "另一类图表", config, updatedAt: 2 });

    expect(chartState.cfg.template).toBe(templateId);
    expect(chartState.selectedTemplateId).toBe(templateId);
    expect(chartState.manifest?.id).toBe(templateId);
  });

  it("loadPreset migrates legacy parameter ids onto catalog templates", async () => {
    const config = JSON.parse(
      JSON.stringify({ ...createInitialChartConfig(), template: "bar" }),
    ) as JsonValue;
    await loadPreset({ id: "p1", name: "旧参数", config, updatedAt: 1 });
    expect(chartState.cfg.template).toBe("bar-basic-ggplot2");
  });

  it("loadPreset rejects configs with unknown templates", async () => {
    const config = JSON.parse(
      JSON.stringify({ ...createInitialChartConfig(), template: "no-such-template" }),
    ) as JsonValue;
    await loadPreset({ id: "p1", name: "坏参数", config, updatedAt: 1 });
    expect(chartState.cfg.template).toBe(DEFAULT_TEMPLATE.id);
    expect(lastToast()?.level).toBe("error");
  });
});

describe("mergeImportedPresets", () => {
  it("keeps valid entries, drops unknown templates, merges by id", () => {
    const valid = {
      id: "a",
      name: "A",
      config: { template: "bar-basic-ggplot2" },
      updatedAt: 5,
    };
    const legacyId = { ...valid, id: "b", config: { template: "bar" } };
    const unknown = { ...valid, id: "c", config: { template: "ghost" } };
    const existing: ChartPreset[] = [
      { id: "a", name: "old A", config: valid.config as JsonValue, updatedAt: 1 },
      { id: "z", name: "Z", config: valid.config as JsonValue, updatedAt: 1 },
    ];
    const { presets, imported } = mergeImportedPresets(
      [valid, legacyId, unknown, null, "junk"],
      existing,
    );
    expect(imported).toBe(2);
    expect(presets.map((item) => item.id)).toEqual(["a", "b", "z"]);
    expect(presets[0].updatedAt).toBe(5);
  });

  it("rejects non-array payloads", () => {
    expect(() => mergeImportedPresets({ nope: true }, [])).toThrow();
  });
});

describe("field mapping helpers", () => {
  it("derives per-field defaults from the catalog tables", () => {
    const defaults = templateFieldDefaults("bar-basic-ggplot2");
    expect(defaults).toEqual({ x: "group", y: "value", group: "", size: "" });
    const heatmap = templateFieldDefaults("heatmap-basic-ggplot2");
    expect(heatmap.x).toBe("col");
    expect(heatmap.y).toBe("row");
  });

  it("auto-assigns columns by role-key match, then by type", () => {
    const manifest = makeManifest();
    const assignment = autoAssignColumns(
      DEFAULT_TEMPLATE.id,
      manifest,
      ["label", "score", "value"],
      [
        ["a", 1, 2],
        ["b", 3, 4],
      ],
    );
    // role "category" has no exact match → first string column; "value" matches.
    expect(assignment.x).toBe("label");
    expect(assignment.y).toBe("value");
  });

  it("falls back to the template default column when present", () => {
    const manifest = makeManifest();
    const assignment = autoAssignColumns(
      DEFAULT_TEMPLATE.id,
      manifest,
      ["group", "value", "extra"],
      [
        ["a", 1, "x"],
        ["b", 2, "y"],
      ],
    );
    expect(assignment.x).toBe("group");
    expect(assignment.y).toBe("value");
  });

  it("imports data, stores the preview and auto-maps", async () => {
    mocks.readChartManifest.mockResolvedValue(makeManifest());
    mocks.importChartData.mockResolvedValue(importedData("C:/data/group.csv"));
    chartState.manifest = makeManifest();

    await importDataFile("C:/data/group.csv");

    expect(chartState.imported?.columns).toEqual(["group", "value"]);
    expect(chartState.cfg.filePath).toBe("C:/data/group.csv");
    expect(chartState.cfg.x).toBe("group");
    expect(chartState.cfg.y).toBe("value");
    expect(chartState.importing).toBe(false);
  });

  it("waits for the selected template manifest before mapping imported data", async () => {
    const pendingManifest = deferred<ReturnType<typeof makeManifest>>();
    mocks.readChartManifest.mockReturnValue(pendingManifest.promise);
    mocks.importChartData.mockResolvedValue(importedData("C:/data/group.csv"));
    chartState.manifest = null;

    const importing = importDataFile("C:/data/group.csv");
    await vi.waitFor(() => {
      expect(mocks.readChartManifest).toHaveBeenCalledWith(DEFAULT_TEMPLATE.id);
    });
    expect(chartState.imported).toBeNull();

    pendingManifest.resolve(makeManifest());
    await importing;

    expect(chartState.imported?.filePath).toBe("C:/data/group.csv");
    expect(chartState.cfg.x).toBe("group");
    expect(chartState.cfg.y).toBe("value");
  });

  it("keeps the latest selected file when imports finish out of order", async () => {
    const older = deferred<ChartImportedData>();
    const newer = deferred<ChartImportedData>();
    mocks.importChartData.mockImplementation((path: string) =>
      path.endsWith("older.csv") ? older.promise : newer.promise,
    );

    const olderImport = importDataFile("C:/data/older.csv");
    const newerImport = importDataFile("C:/data/newer.csv");
    newer.resolve(importedData("C:/data/newer.csv"));
    await newerImport;
    older.resolve(importedData("C:/data/older.csv"));
    await olderImport;

    expect(chartState.imported?.filePath).toBe("C:/data/newer.csv");
    expect(chartState.cfg.filePath).toBe("C:/data/newer.csv");
    expect(chartState.importing).toBe(false);
  });

  it("does not restore imported data after the user clears during import", async () => {
    const pending = deferred<ChartImportedData>();
    mocks.importChartData.mockReturnValue(pending.promise);

    const importing = importDataFile("C:/data/slow.csv");
    clearData();
    pending.resolve(importedData("C:/data/slow.csv"));
    await importing;

    expect(chartState.imported).toBeNull();
    expect(chartState.cfg.filePath).toBe("");
    expect(chartState.importing).toBe(false);
  });

  it("invalidates a sample file still being prepared when the user clears", async () => {
    const pendingDirectory = deferred<string>();
    pathMocks.tempDir.mockReturnValue(pendingDirectory.promise);

    const sample = useSampleData();
    expect(chartState.importing).toBe(true);
    clearData();
    pendingDirectory.resolve("C:/temp");
    await sample;

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.importChartData).not.toHaveBeenCalled();
    expect(chartState.imported).toBeNull();
    expect(chartState.importing).toBe(false);
  });

  it("toasts import failures without keeping partial state", async () => {
    mocks.importChartData.mockRejectedValue(new Error("boom"));
    await importDataFile("C:/bad.csv");
    expect(chartState.imported).toBeNull();
    expect(chartState.cfg.filePath).toBe("");
    expect(lastToast()?.level).toBe("error");
  });

  it("clearData resets the file path and preview", () => {
    chartState.imported = {
      v: 1,
      filePath: "C:/a.csv",
      columns: ["a"],
      rows: [[1]],
      totalRows: 1,
      warnings: [],
    };
    chartState.cfg = { ...chartState.cfg, filePath: "C:/a.csv" };
    clearData();
    expect(chartState.imported).toBeNull();
    expect(chartState.cfg.filePath).toBe("");
  });
});

describe("run validation + run build", () => {
  it("requires imported data before running", () => {
    const invalid = validateRunInputs(chartState.cfg, null, null);
    expect(invalid?.key).toBe("charts.errNeedData");
  });

  it("blocks a run while a required role is unassigned", () => {
    const manifest = makeManifest();
    const cfg = {
      ...createInitialChartConfig(),
      filePath: "C:/a.csv",
      outputDir: "C:/out",
      x: "group",
      y: "",
    };
    const imported = {
      v: 1,
      filePath: "C:/a.csv",
      columns: ["group", "value"],
      rows: [],
      totalRows: 0,
      warnings: [],
    };
    expect(validateRunInputs(cfg, manifest, imported)).toMatchObject({
      key: "charts.errFillRole",
      roleKey: "value",
      field: "y",
    });
  });

  it("blocks a run when the mapped column is not in the data", () => {
    const manifest = makeManifest();
    const cfg = {
      ...createInitialChartConfig(),
      filePath: "C:/a.csv",
      outputDir: "C:/out",
      x: "group",
      y: "value",
    };
    const imported = {
      v: 1,
      filePath: "C:/a.csv",
      columns: ["group", "amount"],
      rows: [],
      totalRows: 0,
      warnings: [],
    };
    const invalid = validateRunInputs(cfg, manifest, imported);
    expect(invalid).toMatchObject({
      key: "charts.errColumnMissing",
      roleKey: "value",
      field: "y",
    });
  });

  it("injects catalog-only fields into the wire config", () => {
    const template = templateById.get("bar-basic-ggplot2")!;
    const config = buildRunConfig({ ...createInitialChartConfig(), group: "", size: "" }, template);
    expect(config.kind).toBe("bar");
    expect(config.galleryUrl).toBe(template.galleryUrl);
    expect(config.sourceRepoPath).toBe(template.sourceRepoPath ?? null);
    expect(config.verified).toBe(true);
    expect(config.group).toBe("");
  });
});

describe("run lifecycle", () => {
  it("refuses to run without imported data and shows a hint", async () => {
    await runGeneration();
    expect(mocks.runChart).not.toHaveBeenCalled();
    expect(lastToast()?.level).toBe("info");
  });

  it("streams events, resolves with the output and flips to success", async () => {
    mocks.runChart.mockImplementation((_config: unknown, onEvent: (event: unknown) => void) => {
      onEvent({
        v: 1,
        tsMs: 1,
        stage: "data",
        level: "info",
        message: "data.reading",
        progress: 25,
        detail: null,
      });
      onEvent({
        v: 1,
        tsMs: 2,
        stage: "save",
        level: "info",
        message: "save.complete",
        progress: 100,
        detail: null,
      });
      return Promise.resolve({
        v: 1,
        ok: true,
        outputPath: "C:/out/mynx-bar-basic-ggplot2.png",
        outputDir: "C:/out",
        files: ["mynx-bar-basic-ggplot2.png", "mynx-bar-basic-ggplot2.json"],
        error: null,
        cancelled: false,
      });
    });
    const manifest = makeManifest();
    chartState.manifest = manifest;
    chartState.imported = {
      v: 1,
      filePath: "C:/a.csv",
      columns: ["group", "value"],
      rows: [],
      totalRows: 2,
      warnings: [],
    };
    chartState.cfg = {
      ...chartState.cfg,
      filePath: "C:/a.csv",
      outputDir: "C:/out",
      x: "group",
      y: "value",
    };

    await runGeneration();

    expect(chartState.runPhase).toBe("success");
    expect(chartState.lastResult?.outputPath).toBe("C:/out/mynx-bar-basic-ggplot2.png");
    // environment (startRun) → data → save → done
    expect(chartState.events.map((event) => event.tone)).toEqual([
      "info",
      "info",
      "success",
      "success",
    ]);
    expect(chartState.events.some((event) => event.progress === 25)).toBe(true);
  });

  it("marks cancelled runs and keeps the previous result", async () => {
    mocks.runChart.mockResolvedValue({
      v: 1,
      ok: false,
      outputPath: null,
      outputDir: null,
      files: [],
      error: "CHART_RUN_CANCELLED",
      cancelled: true,
    });
    chartState.manifest = makeManifest();
    chartState.imported = {
      v: 1,
      filePath: "C:/a.csv",
      columns: ["group", "value"],
      rows: [],
      totalRows: 0,
      warnings: [],
    };
    chartState.cfg = {
      ...chartState.cfg,
      filePath: "C:/a.csv",
      outputDir: "C:/out",
      x: "group",
      y: "value",
    };
    chartState.lastResult = {
      v: 1,
      ok: true,
      outputPath: "C:/old.png",
      outputDir: "C:/out",
      files: [],
      error: null,
      cancelled: false,
    };

    await runGeneration();

    expect(chartState.runPhase).toBe("cancelled");
    expect(chartState.lastResult?.outputPath).toBe("C:/old.png");
    expect(lastToast()?.message).toBe(localizeChartError("CHART_RUN_CANCELLED"));
  });

  it("offers the R install prompt when R discovery fails", async () => {
    mocks.runChart.mockRejectedValue(new Error("尚未安装 R。请先安装 R 后再生成图表。"));
    chartState.manifest = makeManifest();
    chartState.imported = {
      v: 1,
      filePath: "C:/a.csv",
      columns: ["group", "value"],
      rows: [],
      totalRows: 0,
      warnings: [],
    };
    chartState.cfg = {
      ...chartState.cfg,
      filePath: "C:/a.csv",
      outputDir: "C:/out",
      x: "group",
      y: "value",
    };

    await runGeneration();

    expect(chartState.runPhase).toBe("idle");
    expect(chartState.rInstallPrompt).toBe(true);
  });

  it("surfaces failed runs with a localized error event", async () => {
    mocks.runChart.mockResolvedValue({
      v: 1,
      ok: false,
      outputPath: null,
      outputDir: null,
      files: [],
      error: "MISSING_PACKAGE:ggplot2",
      cancelled: false,
    });
    chartState.manifest = makeManifest();
    chartState.imported = {
      v: 1,
      filePath: "C:/a.csv",
      columns: ["group", "value"],
      rows: [],
      totalRows: 0,
      warnings: [],
    };
    chartState.cfg = {
      ...chartState.cfg,
      filePath: "C:/a.csv",
      outputDir: "C:/out",
      x: "group",
      y: "value",
    };

    await runGeneration();

    expect(chartState.runPhase).toBe("error");
    expect(lastToast()?.message).toBe(localizeChartError("MISSING_PACKAGE:ggplot2"));
    expect(lastToast()?.level).toBe("error");
  });
});

describe("cancellation", () => {
  it("cancels the running task-center job", async () => {
    mocks.tasksList.mockResolvedValue([
      {
        id: 7,
        kind: "chartRun",
        label: "科研绘图 bar-basic-ggplot2",
        status: "running",
        createdAtMs: 1,
        startedAtMs: 1,
        finishedAtMs: null,
        progress: null,
        detail: null,
        error: null,
        outputDir: null,
      },
    ]);
    mocks.cancelChartRun.mockResolvedValue(true);

    await requestCancel();

    expect(mocks.cancelChartRun).toHaveBeenCalledWith(7);
  });

  it("reports when the task already finished", async () => {
    mocks.tasksList.mockResolvedValue([]);
    await requestCancel();
    expect(mocks.cancelChartRun).not.toHaveBeenCalled();
    expect(chartState.cancelling).toBe(false);
    expect(lastToast()?.level).toBe("info");
  });
});

describe("event localization", () => {
  it("maps known code messages and keeps unknown text", () => {
    expect(localizeChartEventMessage("data.reading")).toBe("正在读取数据");
    expect(localizeChartEventMessage("deps.install:ggplot2")).toContain("ggplot2");
    expect(localizeChartEventMessage("任意输出")).toBe("任意输出");
  });

  it("maps run events onto tones", () => {
    const event = (stage: string, level: string) => ({
      v: 1,
      tsMs: 1,
      stage,
      level,
      message: "m",
      progress: null,
      detail: null,
    });
    expect(toneOfEvent(event("save", "info"))).toBe("success");
    expect(toneOfEvent(event("render", "error"))).toBe("error");
    expect(toneOfEvent(event("cancel", "info"))).toBe("cancelled");
    expect(toneOfEvent(event("render", "info"))).toBe("info");
  });

  it("localizes legacy sentinel errors", () => {
    expect(localizeChartError("CHART_RUN_CANCELLED")).toBe("已取消本次图表生成。");
    expect(localizeChartError("MISSING_PACKAGE:ggplot2")).toContain("ggplot2");
    expect(localizeChartError("TEMPLATE_RESOURCE_INCOMPLETE:x")).not.toBe(
      "TEMPLATE_RESOURCE_INCOMPLETE:x",
    );
  });
});
