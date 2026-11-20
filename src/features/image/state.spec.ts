import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsDoc } from "../../lib/contracts/generated/settings/SettingsDoc.js";
import type { ConvertEvent } from "../../lib/contracts/generated/image/ConvertEvent.js";
import { app } from "../../app/state.svelte";
import {
  DEFAULT_SETTINGS,
  addPaths,
  appendFiles,
  baseName,
  buildConvertOptions,
  cancelConversion,
  clearAll,
  filterImageDropPaths,
  formatBytes,
  handleConvertEvent,
  imageState,
  isImagePath,
  loadImageSettings,
  mergeSettings,
  removeItem,
  runConversion,
  saveImageSettingsNow,
  updateSettings,
} from "./state.svelte";

const mocks = vi.hoisted(() => ({
  settingsLoad: vi.fn(),
  settingsSave: vi.fn(),
  collectImageFiles: vi.fn(),
  startImageConvert: vi.fn(),
  cancelImageConvert: vi.fn(),
  fetchImageThumbnail: vi.fn(),
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

vi.mock("../../app/tauri.js", () => ({
  call: vi.fn(),
  openPath: vi.fn(),
  setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  settingsLoad: mocks.settingsLoad,
  settingsSave: mocks.settingsSave,
}));

vi.mock("./client.js", () => ({
  collectImageFiles: mocks.collectImageFiles,
  startImageConvert: mocks.startImageConvert,
  cancelImageConvert: mocks.cancelImageConvert,
  fetchImageThumbnail: mocks.fetchImageThumbnail,
}));

function makeDoc(overrides: Partial<SettingsDoc> = {}): SettingsDoc {
  return {
    theme: "pearl",
    alwaysOnTop: false,
    chartColor: "#2f6fed",
    language: "zh",
    searchEngine: "",
    homeHeaderHeight: 0,
    panelWidths: {},
    imageConverterOptions: null,
    chartStudioPresets: [],
    weatherEnabled: false,
    weatherConfigured: true,
    weatherCity: null,
    ...overrides,
  };
}

function resetState(): void {
  imageState.files = [];
  imageState.settings = { ...DEFAULT_SETTINGS, watermark: { ...DEFAULT_SETTINGS.watermark } };
  imageState.results = [];
  imageState.summary = null;
  imageState.collectingFiles = false;
  imageState.running = false;
  imageState.cancelling = false;
  imageState.cancelRequested = false;
  imageState.progress = null;
  imageState.progressText = "";
  imageState.jobId = null;
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

afterEach(() => {
  vi.useRealTimers();
});

describe("mergeSettings (legacy parity)", () => {
  it("returns the defaults for null or corrupted blobs", () => {
    for (const saved of [null, undefined, "junk", 42, ["png", "jpg"]]) {
      expect(mergeSettings(saved)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("merges a partial blob over the defaults", () => {
    const merged = mergeSettings({ mode: "lossy", colors: 64 });
    expect(merged.mode).toBe("lossy");
    expect(merged.colors).toBe(64);
    expect(merged.optimizeLevel).toBe(DEFAULT_SETTINGS.optimizeLevel);
    expect(merged.watermark).toEqual(DEFAULT_SETTINGS.watermark);
  });

  it("deep-merges watermark options without dropping defaults", () => {
    const merged = mergeSettings({
      watermark: { opacity: 0.5, position: "tile" },
    });
    expect(merged.watermark.opacity).toBe(0.5);
    expect(merged.watermark.position).toBe("tile");
    expect(merged.watermark.font).toBe(DEFAULT_SETTINGS.watermark.font);
    expect(merged.watermark.fontSize).toBe(DEFAULT_SETTINGS.watermark.fontSize);
    expect(merged.watermarkOn).toBe(false);
  });

  it("restores a full legacy blob verbatim", () => {
    const blob = {
      mode: "lossy",
      optimizeLevel: 3,
      colors: 32,
      dither: false,
      outputMode: "custom",
      customDir: "D:/out",
      watermarkOn: true,
      watermark: {
        kind: "image",
        content: "lab",
        font: "Arial",
        fontSize: 36,
        bold: false,
        color: "black",
        opacity: 0.7,
        position: "top-left",
        background: "semi",
        imagePath: "D:/logo.png",
        scale: 0.4,
      },
    };
    expect(mergeSettings(blob)).toEqual(blob);
  });
});

describe("buildConvertOptions (command payload)", () => {
  it("maps lossless settings with watermark off", () => {
    const options = buildConvertOptions({ ...DEFAULT_SETTINGS, customDir: "" }, ["C:/a.png"]);
    expect(options).toEqual({
      files: ["C:/a.png"],
      mode: "lossless",
      optimizeLevel: 2,
      colors: 256,
      dither: true,
      outputMode: "subfolder",
      customDir: null,
      watermark: null,
    });
  });

  it("keeps a non-empty custom dir", () => {
    const options = buildConvertOptions(
      { ...DEFAULT_SETTINGS, outputMode: "custom", customDir: "D:/out" },
      [],
    );
    expect(options.customDir).toBe("D:/out");
  });

  it("maps the watermark and nulls empty strings", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      watermarkOn: true,
      watermark: {
        ...DEFAULT_SETTINGS.watermark,
        content: "",
        font: "Arial",
        imagePath: "",
        opacity: 0.7,
        fontSize: 36,
        bold: false,
        color: "black" as const,
        position: "tile" as const,
      },
    };
    const options = buildConvertOptions(settings, []);
    expect(options.watermark).toEqual({
      kind: "text",
      content: null,
      font: "Arial",
      fontSize: 36,
      bold: false,
      color: "black",
      opacity: 0.7,
      position: "tile",
      background: "none",
      imagePath: null,
      scale: 0.25,
    });
  });
});

describe("settings persistence (imageConverterOptions)", () => {
  it("restores the persisted blob over the defaults", async () => {
    mocks.settingsLoad.mockResolvedValue(
      makeDoc({
        imageConverterOptions: { mode: "lossy", colors: 32 },
        chartColor: "#123456",
      }),
    );
    loadImageSettings();
    await flush();
    expect(imageState.settings.mode).toBe("lossy");
    expect(imageState.settings.colors).toBe(32);
    expect(imageState.settings.dither).toBe(DEFAULT_SETTINGS.dither);
    expect(mocks.settingsLoad).toHaveBeenCalledTimes(1);
  });

  it("keeps the defaults when settings cannot be loaded", async () => {
    vi.resetModules();
    const fresh = await import("./state.svelte");
    mocks.settingsLoad.mockRejectedValue(new Error("not built"));
    fresh.loadImageSettings();
    await flush();
    expect(fresh.imageState.settings.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(fresh.imageState.settings.watermark).toEqual(DEFAULT_SETTINGS.watermark);
  });

  it("saves debounced on change, preserving other doc fields", async () => {
    vi.useFakeTimers();
    mocks.settingsLoad.mockResolvedValue(makeDoc({ chartColor: "#123456" }));
    mocks.settingsSave.mockResolvedValue(undefined);

    updateSettings({ mode: "lossy", colors: 64 });
    expect(mocks.settingsSave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(700);
    expect(mocks.settingsSave).toHaveBeenCalledTimes(1);
    const saved = mocks.settingsSave.mock.calls[0][0] as SettingsDoc;
    expect(saved.chartColor).toBe("#123456");
    expect(saved.imageConverterOptions).toMatchObject({ mode: "lossy", colors: 64 });
  });

  it("collapses rapid edits into one save", async () => {
    vi.useFakeTimers();
    mocks.settingsLoad.mockResolvedValue(makeDoc());
    mocks.settingsSave.mockResolvedValue(undefined);

    updateSettings({ optimizeLevel: 1 });
    await vi.advanceTimersByTimeAsync(100);
    updateSettings({ optimizeLevel: 3 });
    await vi.advanceTimersByTimeAsync(700);

    expect(mocks.settingsSave).toHaveBeenCalledTimes(1);
    const saved = mocks.settingsSave.mock.calls[0][0] as SettingsDoc;
    expect(saved.imageConverterOptions).toMatchObject({ optimizeLevel: 3 });
  });

  it("flushes pending saves immediately via saveImageSettingsNow", async () => {
    vi.useFakeTimers();
    mocks.settingsLoad.mockResolvedValue(makeDoc());
    mocks.settingsSave.mockResolvedValue(undefined);

    updateSettings({ outputMode: "alongside" });
    await saveImageSettingsNow();
    expect(mocks.settingsSave).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.settingsSave).toHaveBeenCalledTimes(1);
    const saved = mocks.settingsSave.mock.calls[0][0] as SettingsDoc;
    expect(saved.imageConverterOptions).toMatchObject({ outputMode: "alongside" });
  });

  it("tolerates persistence failures", async () => {
    mocks.settingsLoad.mockRejectedValue(new Error("io"));
    await expect(saveImageSettingsNow()).resolves.toBeUndefined();
  });
});

describe("file intake", () => {
  it("appends files and dedupes by path", () => {
    appendFiles(["C:/pics/a.png", "C:/pics/b.jpg"]);
    appendFiles(["C:/pics/a.png", "C:/pics/c.tif", "C:/pics/c.tif"]);
    expect(imageState.files.map((item) => item.path)).toEqual([
      "C:/pics/a.png",
      "C:/pics/b.jpg",
      "C:/pics/c.tif",
    ]);
    expect(imageState.files[0].name).toBe("a.png");
    expect(imageState.files[0].thumb).toBeNull();
  });

  it("collects dropped files through the backend and reports empty results", async () => {
    mocks.collectImageFiles.mockResolvedValue(["C:/x.png"]);
    await addPaths(["C:/x.png"]);
    expect(mocks.collectImageFiles).toHaveBeenCalledWith(["C:/x.png"]);
    expect(imageState.files).toHaveLength(1);

    mocks.collectImageFiles.mockResolvedValue([]);
    await addPaths(["C:/empty-dir"]);
    expect(lastToast()?.level).toBe("info");
    expect(lastToast()?.message).toBe("未找到支持的图片文件");
  });

  it("blocks conversion until pending file collection has finished", async () => {
    const pending = deferred<string[]>();
    mocks.collectImageFiles.mockReturnValue(pending.promise);
    mocks.startImageConvert.mockResolvedValue(42);
    mocks.settingsLoad.mockResolvedValue(makeDoc());
    mocks.settingsSave.mockResolvedValue(undefined);
    appendFiles(["C:/existing.png"]);

    const adding = addPaths(["C:/folder"]);
    expect(imageState.collectingFiles).toBe(true);
    await runConversion();
    expect(mocks.startImageConvert).not.toHaveBeenCalled();

    pending.resolve(["C:/folder/new.png"]);
    await adding;
    expect(imageState.files.map((item) => item.path)).toEqual([
      "C:/existing.png",
      "C:/folder/new.png",
    ]);
    expect(imageState.collectingFiles).toBe(false);

    await runConversion();
    expect(mocks.startImageConvert).toHaveBeenCalledTimes(1);
  });

  it("does not add files from a folder scan completed after clear", async () => {
    const pending = deferred<string[]>();
    mocks.collectImageFiles.mockReturnValue(pending.promise);
    const adding = addPaths(["C:/slow-folder"]);
    clearAll();
    pending.resolve(["C:/slow-folder/old.png"]);
    await adding;

    expect(imageState.files).toHaveLength(0);
    expect(imageState.collectingFiles).toBe(false);
  });

  it("rejects new file intake during conversion", async () => {
    imageState.running = true;
    await addPaths(["C:/new.png"]);
    expect(mocks.collectImageFiles).not.toHaveBeenCalled();
    expect(lastToast()?.message).toBe("转换进行中，暂时不能添加文件");
  });

  it("toasts collect failures without touching the list", async () => {
    mocks.collectImageFiles.mockRejectedValue(new Error("boom"));
    await addPaths(["C:/broken"]);
    expect(imageState.files).toHaveLength(0);
    expect(lastToast()?.level).toBe("error");
    expect(lastToast()?.message).toBe("读取文件列表失败: boom");
  });

  it("removes single files and clears everything", () => {
    appendFiles(["C:/a.png", "C:/b.png"]);
    removeItem("C:/a.png");
    expect(imageState.files.map((item) => item.path)).toEqual(["C:/b.png"]);
    clearAll();
    expect(imageState.files).toHaveLength(0);
  });
});

describe("conversion run and events", () => {
  it("refuses to run without files", async () => {
    await runConversion();
    expect(mocks.startImageConvert).not.toHaveBeenCalled();
  });

  it("starts a job with the built options and resets results", async () => {
    mocks.settingsLoad.mockResolvedValue(makeDoc());
    mocks.settingsSave.mockResolvedValue(undefined);
    mocks.startImageConvert.mockResolvedValue(42);
    appendFiles(["C:/a.png", "C:/b.png"]);
    imageState.summary = {
      kind: "finished",
      status: "completed",
      ok: 9,
      failed: 0,
      totalInput: 9,
      totalOutput: 5,
      watermarkApplied: true,
    };

    await runConversion();

    expect(mocks.startImageConvert).toHaveBeenCalledTimes(1);
    const [options, onEvent] = mocks.startImageConvert.mock.calls[0];
    expect(options).toMatchObject({ files: ["C:/a.png", "C:/b.png"], mode: "lossless" });
    expect(typeof onEvent).toBe("function");
    expect(imageState.running).toBe(true);
    expect(imageState.jobId).toBe(42);
    expect(imageState.summary).toBeNull();
    expect(imageState.progress).toBe(0);
  });

  it("sends a cancel requested before the backend returns the job id", async () => {
    const pendingJobId = deferred<number>();
    mocks.settingsLoad.mockResolvedValue(makeDoc());
    mocks.settingsSave.mockResolvedValue(undefined);
    mocks.startImageConvert.mockReturnValue(pendingJobId.promise);
    mocks.cancelImageConvert.mockResolvedValue(true);
    appendFiles(["C:/a.png"]);

    const conversion = runConversion();
    expect(imageState.running).toBe(true);
    expect(imageState.jobId).toBeNull();
    cancelConversion();
    expect(imageState.cancelling).toBe(true);
    expect(mocks.cancelImageConvert).not.toHaveBeenCalled();

    pendingJobId.resolve(42);
    await conversion;
    expect(imageState.jobId).toBe(42);
    expect(mocks.cancelImageConvert).toHaveBeenCalledWith(42);
    expect(imageState.cancelling).toBe(true);

    handleConvertEvent({
      kind: "finished",
      status: "cancelled",
      ok: 0,
      failed: 0,
      totalInput: 1,
      totalOutput: 0,
      watermarkApplied: true,
    });
    expect(imageState.cancelling).toBe(false);
    expect(imageState.running).toBe(false);
  });

  it("tracks per-item progress and shows the summary on finish", () => {
    handleConvertEvent({ kind: "started", total: 4 } satisfies ConvertEvent);
    expect(imageState.results).toHaveLength(0);
    for (let i = 0; i < 3; i += 1) {
      handleConvertEvent({
        kind: "item",
        index: i,
        total: 4,
        source: `C:/f${i}.png`,
        status: "ok",
        outputs: [`C:/out/f${i}.png`],
        error: null,
        originalBytes: 100,
        outputBytes: 50,
      });
    }
    expect(imageState.results).toHaveLength(3);
    expect(imageState.progress).toBe(75);
    expect(imageState.progressText).toContain("(3/4)");

    const before = app.toasts.length;
    handleConvertEvent({
      kind: "finished",
      status: "completed",
      ok: 3,
      failed: 1,
      totalInput: 400,
      totalOutput: 200,
      watermarkApplied: true,
    });
    expect(imageState.summary?.ok).toBe(3);
    expect(imageState.running).toBe(false);
    expect(imageState.progress).toBeNull();
    expect(imageState.jobId).toBeNull();
    expect(lastToast()?.level).toBe("info");
    expect(lastToast()?.message).toBe("3 个成功，1 个失败");
    expect(app.toasts.length).toBe(before + 1);
  });

  it("mirrors the legacy toasts for cancelled, complete and watermark-skip", () => {
    imageState.settings = { ...DEFAULT_SETTINGS, watermarkOn: true };

    handleConvertEvent({
      kind: "finished",
      status: "cancelled",
      ok: 1,
      failed: 0,
      totalInput: 10,
      totalOutput: 5,
      watermarkApplied: false,
    });
    let messages = app.toasts.map((toast) => toast.message);
    expect(messages).toContain("已取消");
    expect(messages[messages.length - 1]).toBe("未找到可用字体或水印图，水印已跳过");

    const before = app.toasts.length;
    handleConvertEvent({
      kind: "finished",
      status: "completed",
      ok: 5,
      failed: 0,
      totalInput: 10,
      totalOutput: 5,
      watermarkApplied: false,
    });
    messages = app.toasts.slice(before).map((toast) => toast.message);
    expect(messages[0]).toBe("转换完成，5 个文件");
    expect(app.toasts[before]?.level).toBe("success");
    // watermarkOn but not applied → extra info toast pushed after the summary.
    expect(messages[1]).toBe("未找到可用字体或水印图，水印已跳过");

    imageState.settings = { ...DEFAULT_SETTINGS, watermarkOn: false };
    handleConvertEvent({
      kind: "finished",
      status: "completed",
      ok: 0,
      failed: 0,
      totalInput: 0,
      totalOutput: 0,
      watermarkApplied: true,
    });
    expect(lastToast()?.message).toBe("未找到支持的图片文件");
  });

  it("resets the run state when the start command fails", async () => {
    mocks.startImageConvert.mockRejectedValue(new Error("boom"));
    appendFiles(["C:/a.png"]);
    await runConversion();
    expect(imageState.running).toBe(false);
    expect(imageState.progress).toBeNull();
    expect(lastToast()?.level).toBe("error");
    expect(lastToast()?.message).toBe("失败: boom");
  });

  it("ignores cancellation while idle and sends it for the active job", async () => {
    mocks.cancelImageConvert.mockResolvedValue(true);
    cancelConversion();
    expect(mocks.cancelImageConvert).not.toHaveBeenCalled();

    imageState.running = true;
    imageState.jobId = 42;
    cancelConversion();
    expect(mocks.cancelImageConvert).toHaveBeenCalledWith(42);
    expect(imageState.cancelling).toBe(true);
    await flush();
  });
});

describe("path and size helpers", () => {
  it("detects backend-supported image extensions", () => {
    expect(isImagePath("C:/a.PNG")).toBe(true);
    expect(isImagePath("C:/a.svg")).toBe(true);
    expect(isImagePath("C:/a.txt")).toBe(false);
    expect(isImagePath("C:/folder")).toBe(false);
  });

  it("keeps image files and probable folders from a drop payload", () => {
    expect(filterImageDropPaths(["C:/a.png", "C:/notes.txt", "C:/folder", "C:/b.TIFF"])).toEqual([
      "C:/a.png",
      "C:/folder",
      "C:/b.TIFF",
    ]);
  });

  it("extracts the base name on both path styles", () => {
    expect(baseName("C:/pics/a.png")).toBe("a.png");
    expect(baseName("/home/user/a.png")).toBe("a.png");
  });

  it("formats bytes like the legacy helper", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
