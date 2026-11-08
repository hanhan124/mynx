import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * Image → PNG batch converter (native Rust backend, open-source crates:
 * image-rs / oxipng / color_quant / resvg / kamadak-exif / imageproc).
 * Replaces the old script-spawning tiff-convert.ts.
 */

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

export interface WatermarkOptions {
  kind: "text" | "image";
  /** Watermark text; empty/undefined uses the source file name. */
  content?: string;
  font?: string;
  fontSize: number;
  bold: boolean;
  color: "white" | "black";
  /** 0..1 */
  opacity: number;
  position: WatermarkPosition;
  background: "none" | "opaque" | "semi" | "light";
  /** Logo path for kind = "image". */
  imagePath?: string;
  /** Logo width as a fraction of the image's smaller side. */
  scale: number;
}

export interface ConvertOptions {
  files: string[];
  mode: CompressionMode;
  /** 1 fast / 2 balanced / 3 max (maps onto oxipng presets). */
  optimizeLevel: number;
  colors: number;
  dither: boolean;
  outputMode: OutputMode;
  customDir?: string;
  watermark?: WatermarkOptions | null;
}

export type ConvertEvent =
  | { kind: "started"; total: number }
  | {
      kind: "item";
      index: number;
      total: number;
      source: string;
      status: "ok" | "failed";
      outputs: string[];
      error: string | null;
      originalBytes: number;
      outputBytes: number;
    }
  | {
      kind: "finished";
      status: "completed" | "cancelled";
      ok: number;
      failed: number;
      totalInput: number;
      totalOutput: number;
      watermarkApplied: boolean;
    };

export interface Thumbnail {
  dataUrl: string;
  width: number;
  height: number;
  fileSize: number;
}

/** Extensions accepted by the Rust backend (mirrors SUPPORTED_EXTENSIONS). */
export const IMAGE_EXTENSIONS = [
  "png", "jpg", "jpeg", "jfif", "tif", "tiff", "webp", "bmp", "gif", "ico",
  "tga", "pnm", "pbm", "pgm", "ppm", "pam", "qoi", "dds", "svg",
];

/** Expands files/folders into the backend's supported image list. */
export function collectImageFiles(paths: string[]): Promise<string[]> {
  return invoke<string[]>("image_collect_files", { paths });
}

/** Starts a background conversion; progress streams through the channel. */
export async function startImageConvert(
  options: ConvertOptions,
  onEvent: (event: ConvertEvent) => void,
): Promise<number> {
  const channel = new Channel<ConvertEvent>();
  channel.onmessage = onEvent;
  return invoke<number>("image_convert_start", { options, onProgress: channel });
}

export function cancelImageConvert(taskId: number): Promise<boolean> {
  return invoke<boolean>("image_convert_cancel", { taskId });
}

export function fetchImageThumbnail(path: string, maxSize = 96): Promise<Thumbnail> {
  return invoke<Thumbnail>("image_thumbnail", { path, maxSize });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}
