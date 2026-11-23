import { SvelteSet } from "svelte/reactivity";
import type { JsonValue } from "../../lib/contracts/generated/serde_json/JsonValue.js";
import type { ConvertEvent } from "../../lib/contracts/generated/image/ConvertEvent.js";
import type { ConvertOptions } from "../../lib/contracts/generated/image/ConvertOptions.js";
import { settingsLoad, settingsSave } from "../../app/tauri.js";
import { pushToast } from "../../app/state.svelte";
import { t } from "../../app/i18n.svelte";
import {
  cancelImageConvert,
  collectImageFiles,
  fetchImageThumbnail,
  startImageConvert,
} from "./client.js";

/**
 * Image-conversion page state (runes).
 *
 * Ported from legacy `src/pages/image/ImageConvertPage.tsx` +
 * `OptionsPanel.tsx` behavior: file intake (dialog/drag-drop/folder),
 * capped thumbnails, event-driven progress and the persisted
 * `imageConverterOptions` blob (same shape as legacy ConverterSettings).
 */

/* ---------------------------------------------------------------------------
 * Settings shape (legacy parity — do not rename fields).
 * ------------------------------------------------------------------------- */

export type CompressionMode = "lossless" | "lossy";
export type OutputMode = "subfolder" | "alongside" | "custom";
export type WatermarkPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "tile";

export interface WatermarkSettings {
  kind: "text" | "image";
  content: string;
  font: string;
  fontSize: number;
  bold: boolean;
  color: "white" | "black";
  /** 0..1 */
  opacity: number;
  position: WatermarkPosition;
  background: "none" | "opaque" | "semi" | "light";
  imagePath: string;
  /** Logo width as a fraction of the image's smaller side. */
  scale: number;
}

export interface ConverterSettings {
  mode: CompressionMode;
  /** 1 fast / 2 balanced / 3 max (maps onto oxipng presets). */
  optimizeLevel: number;
  colors: number;
  dither: boolean;
  outputMode: OutputMode;
  customDir: string;
  watermarkOn: boolean;
  watermark: WatermarkSettings;
}

export const DEFAULT_SETTINGS: ConverterSettings = {
  mode: "lossless",
  optimizeLevel: 2,
  colors: 256,
  dither: true,
  outputMode: "subfolder",
  customDir: "",
  watermarkOn: false,
  watermark: {
    kind: "text",
    content: "",
    font: "微软雅黑",
    fontSize: 72,
    bold: true,
    color: "white",
    opacity: 0.85,
    position: "bottom-right",
    background: "none",
    imagePath: "",
    scale: 0.25,
  },
};

/** Deep-merges the persisted blob over the defaults (legacy parity). */
export function mergeSettings(saved: unknown): ConverterSettings {
  if (saved === null || typeof saved !== "object" || Array.isArray(saved)) {
    return { ...DEFAULT_SETTINGS, watermark: { ...DEFAULT_SETTINGS.watermark } };
  }
  const savedRecord = saved as Record<string, unknown>;
  const watermark = savedRecord.watermark;
  return {
    ...DEFAULT_SETTINGS,
    ...savedRecord,
    watermark: {
      ...DEFAULT_SETTINGS.watermark,
      ...(typeof watermark === "object" && watermark !== null && !Array.isArray(watermark)
        ? (watermark as Partial<WatermarkSettings>)
        : {}),
    },
  } as ConverterSettings;
}

/* ---------------------------------------------------------------------------
 * Command payload assembly.
 * ------------------------------------------------------------------------- */

/** Maps page settings onto the Rust `ConvertOptions` contract. */
export function buildConvertOptions(settings: ConverterSettings, files: string[]): ConvertOptions {
  const wm = settings.watermark;
  return {
    files,
    mode: settings.mode,
    optimizeLevel: settings.optimizeLevel,
    colors: settings.colors,
    dither: settings.dither,
    outputMode: settings.outputMode,
    customDir: settings.customDir || null,
    watermark: settings.watermarkOn
      ? {
          kind: wm.kind,
          content: wm.content || null,
          font: wm.font || null,
          fontSize: wm.fontSize,
          bold: wm.bold,
          color: wm.color,
          opacity: wm.opacity,
          position: wm.position,
          background: wm.background,
          imagePath: wm.imagePath || null,
          scale: wm.scale,
        }
      : null,
  };
}

/* ---------------------------------------------------------------------------
 * File intake helpers.
 * ------------------------------------------------------------------------- */

export interface ImageFileItem {
  path: string;
  name: string;
  /** null until the thumbnail request reports the real size. */
  size: number | null;
  /** Base64 data URL; null shows the generic placeholder icon. */
  thumb: string | null;
  dims: string | null;
}

/** Extensions accepted by the Rust backend (legacy SUPPORTED_EXTENSIONS). */
export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "tif",
  "tiff",
  "webp",
  "bmp",
  "gif",
  "ico",
  "tga",
  "pnm",
  "pbm",
  "pgm",
  "ppm",
  "pam",
  "qoi",
  "dds",
  "svg",
] as const;

let intakeGeneration = 0;
let activeIntakes = 0;

const IMAGE_EXTENSION_SET = new Set<string>(IMAGE_EXTENSIONS);

export function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** True when the path's extension is one of the backend's image formats. */
export function isImagePath(path: string): boolean {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return IMAGE_EXTENSION_SET.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Drop payloads may contain arbitrary files and folders: keep image files and
 * extension-less paths (probable folders) and let the backend expand them.
 */
export function filterImageDropPaths(paths: string[]): string[] {
  return paths.filter((path) => {
    // No extension → probable folder: let the backend expand it.
    return baseName(path).lastIndexOf(".") < 0 || isImagePath(path);
  });
}

/* ---------------------------------------------------------------------------
 * Results (event contracts).
 * ------------------------------------------------------------------------- */

export type ItemResult = Extract<ConvertEvent, { kind: "item" }>;
export type FinishedSummary = Extract<ConvertEvent, { kind: "finished" }>;

/* ---------------------------------------------------------------------------
 * Reactive page state.
 * ------------------------------------------------------------------------- */

export interface ImageState {
  files: ImageFileItem[];
  settings: ConverterSettings;
  results: ItemResult[];
  summary: FinishedSummary | null;
  collectingFiles: boolean;
  running: boolean;
  cancelling: boolean;
  cancelRequested: boolean;
  /** 0..100, null when idle. */
  progress: number | null;
  progressText: string;
  /** Conversion job id for cancellation; null when idle. */
  jobId: number | null;
}

export const imageState = $state<ImageState>({
  files: [],
  settings: { ...DEFAULT_SETTINGS },
  results: [],
  summary: null,
  collectingFiles: false,
  running: false,
  cancelling: false,
  cancelRequested: false,
  progress: null,
  progressText: "",
  jobId: null,
});

function detailOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/* ---------------------------------------------------------------------------
 * Settings persistence (`imageConverterOptions` blob).
 * ------------------------------------------------------------------------- */

const SAVE_DEBOUNCE_MS = 600;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let settingsLoadStarted = false;

function toBlob(settings: ConverterSettings): JsonValue {
  return JSON.parse(JSON.stringify(settings)) as JsonValue;
}

/** Restores persisted options once per session; tolerates absent commands. */
export function loadImageSettings(): void {
  if (settingsLoadStarted) return;
  settingsLoadStarted = true;
  void (async () => {
    try {
      const doc = await settingsLoad();
      imageState.settings = mergeSettings(doc.imageConverterOptions);
    } catch {
      // Settings unavailable: keep the defaults.
    }
  })();
}

function scheduleSettingsSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveImageSettingsNow();
  }, SAVE_DEBOUNCE_MS);
}

/** Flushes any pending debounced save and persists the current options. */
export async function saveImageSettingsNow(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    const doc = await settingsLoad();
    doc.imageConverterOptions = toBlob(imageState.settings);
    await settingsSave(doc);
  } catch {
    // Persistence is best-effort; conversion still runs with current options.
  }
}

export function updateSettings(patch: Partial<ConverterSettings>): void {
  imageState.settings = { ...imageState.settings, ...patch };
  scheduleSettingsSave();
}

export function updateWatermark(patch: Partial<WatermarkSettings>): void {
  updateSettings({
    watermark: { ...imageState.settings.watermark, ...patch },
  });
}

/* ---------------------------------------------------------------------------
 * File intake.
 * ------------------------------------------------------------------------- */

export function appendFiles(paths: string[]): void {
  if (imageState.running) return;
  const seen = new SvelteSet(imageState.files.map((item) => item.path));
  const additions: (typeof imageState.files)[number][] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    additions.push({
      path,
      name: baseName(path),
      size: null,
      thumb: null,
      dims: null,
    });
  }
  if (additions.length > 0) imageState.files.push(...additions);
}

export async function addPaths(paths: string[]): Promise<void> {
  if (!paths.length) return;
  if (imageState.running) {
    pushToast("info", t("imgconv.filesLockedDuringRun"));
    return;
  }
  const generation = intakeGeneration;
  activeIntakes += 1;
  imageState.collectingFiles = true;
  try {
    let expanded: string[];
    try {
      expanded = await collectImageFiles(paths);
    } catch (error) {
      if (generation === intakeGeneration) {
        pushToast("error", `${t("imgconv.collectFailed")}: ${detailOf(error)}`);
      }
      return;
    }
    if (generation !== intakeGeneration) return;
    if (imageState.running) {
      pushToast("info", t("imgconv.filesLockedDuringRun"));
      return;
    }
    if (!expanded.length) {
      pushToast("info", t("imgconv.noFiles"));
      return;
    }
    appendFiles(expanded);
  } finally {
    activeIntakes = Math.max(0, activeIntakes - 1);
    imageState.collectingFiles = activeIntakes > 0;
  }
}

export function removeItem(path: string): void {
  const index = imageState.files.findIndex((item) => item.path === path);
  if (index >= 0) imageState.files.splice(index, 1);
  // Allow the thumbnail to be re-fetched if the file is added again.
  pendingThumbs.delete(path);
}

export function clearAll(): void {
  if (imageState.running) return;
  intakeGeneration += 1;
  imageState.files.splice(0, imageState.files.length);
  pendingThumbs.clear();
}

/* ---------------------------------------------------------------------------
 * Thumbnails: sequential batches of 4, capped at 300 files (legacy parity).
 * ------------------------------------------------------------------------- */

const THUMBNAIL_LIMIT = 300;
const THUMBNAIL_BATCH = 4;
const THUMBNAIL_MAX_SIZE = 96;
// SvelteSet keeps the reactivity lint happy; the set itself is inert
// bookkeeping for already-attempted thumbnail fetches.
const pendingThumbs = new SvelteSet<string>();
let thumbPumpActive = false;

/** (Re)starts the thumbnail pump if it is not already running. */
export function scheduleThumbnails(): void {
  if (thumbPumpActive) return;
  thumbPumpActive = true;
  void pumpThumbnails();
}

async function pumpThumbnails(): Promise<void> {
  try {
    for (;;) {
      const missing = imageState.files
        .slice(0, THUMBNAIL_LIMIT)
        .filter((item) => item.thumb === null && !pendingThumbs.has(item.path));
      if (missing.length === 0) break;
      const batch = missing.slice(0, THUMBNAIL_BATCH);
      await Promise.all(
        batch.map(async (item) => {
          pendingThumbs.add(item.path);
          try {
            const thumb = await fetchImageThumbnail(item.path, THUMBNAIL_MAX_SIZE);
            applyThumbnail(
              item.path,
              thumb.dataUrl,
              thumb.fileSize,
              `${thumb.width}×${thumb.height}`,
            );
          } catch {
            // Failure keeps thumb = null so the row shows the generic icon.
          }
        }),
      );
    }
  } finally {
    thumbPumpActive = false;
  }
}

function applyThumbnail(
  path: string,
  dataUrl: string | null,
  fileSize: number | null,
  dims: string | null,
): void {
  const index = imageState.files.findIndex((item) => item.path === path);
  if (index < 0) return;
  const entry = imageState.files[index];
  imageState.files[index] = {
    ...entry,
    thumb: dataUrl,
    size: entry.size ?? fileSize,
    dims: dims ?? entry.dims,
  };
}

/* ---------------------------------------------------------------------------
 * Conversion run + event stream.
 * ------------------------------------------------------------------------- */

const totals = { total: 0, done: 0 };

export function handleConvertEvent(event: ConvertEvent): void {
  if (event.kind === "started") {
    imageState.results = [];
    totals.total = event.total;
    totals.done = 0;
    return;
  }
  if (event.kind === "item") {
    totals.done += 1;
    // Workers finish out of order; keep the list in the user's file order.
    const at = imageState.results.findIndex((item) => item.index > event.index);
    if (at < 0) imageState.results.push(event);
    else imageState.results.splice(at, 0, event);
    const { total, done } = totals;
    imageState.progress = total > 0 ? Math.round((done / total) * 100) : 0;
    imageState.progressText = `${t("imgconv.converting")} (${done}/${total})…`;
    return;
  }
  // finished
  imageState.summary = event;
  imageState.running = false;
  imageState.cancelling = false;
  imageState.cancelRequested = false;
  imageState.progress = null;
  imageState.jobId = null;
  if (event.status === "cancelled") {
    pushToast("info", t("imgconv.cancelled"));
  } else if (event.ok === 0 && event.failed === 0) {
    pushToast("info", t("imgconv.noFiles"));
  } else if (event.failed > 0) {
    pushToast("info", t("imgconv.summary", { ok: event.ok, failed: event.failed }));
  } else {
    pushToast("success", t("imgconv.complete", { count: event.ok }));
  }
  if (!event.watermarkApplied && imageState.settings.watermarkOn) {
    pushToast("info", t("imgconv.watermarkSkipped"));
  }
}

export async function runConversion(): Promise<void> {
  if (imageState.running || imageState.collectingFiles || imageState.files.length === 0) return;
  const files = imageState.files.map((item) => item.path);
  // Persist the exact options used by this run (flushes pending debounce).
  void saveImageSettingsNow();
  imageState.results = [];
  imageState.summary = null;
  imageState.running = true;
  imageState.cancelling = false;
  imageState.cancelRequested = false;
  imageState.progress = 0;
  imageState.progressText = `${t("imgconv.converting")} (0/${files.length})…`;
  const options = buildConvertOptions(imageState.settings, files);
  try {
    const jobId = await startImageConvert(options, handleConvertEvent);
    if (!imageState.running) return;
    imageState.jobId = jobId;
    if (imageState.cancelRequested) sendCancelRequest(jobId);
  } catch (error) {
    if (!imageState.running) return;
    imageState.running = false;
    imageState.jobId = null;
    imageState.cancelling = false;
    imageState.cancelRequested = false;
    imageState.progress = null;
    pushToast("error", `${t("imgconv.failed")}: ${detailOf(error)}`);
  }
}

function sendCancelRequest(jobId: number): void {
  void cancelImageConvert(jobId)
    .then((accepted) => {
      if (!accepted && imageState.running && imageState.jobId === jobId) {
        imageState.cancelling = false;
        imageState.cancelRequested = false;
        pushToast("info", t("imgconv.cancelFailed"));
      }
    })
    .catch((error) => {
      if (!imageState.running || imageState.jobId !== jobId) return;
      imageState.cancelling = false;
      imageState.cancelRequested = false;
      pushToast("error", `${t("imgconv.cancelFailed")}: ${detailOf(error)}`);
    });
}

export function cancelConversion(): void {
  if (!imageState.running || imageState.cancelling) return;
  imageState.cancelling = true;
  imageState.cancelRequested = true;
  const jobId = imageState.jobId;
  if (jobId !== null) sendCancelRequest(jobId);
}
