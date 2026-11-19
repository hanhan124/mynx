import { app, pushToast } from "./state.svelte";
import { t } from "./i18n.svelte";

type UpdaterCheck = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

let pendingUpdate: UpdaterCheck = null;
let checking = false;

/** Check the updater endpoint once; results land in `app.update`. */
export async function checkForUpdates(): Promise<void> {
  if (checking) return;
  checking = true;
  app.update.status = "checking";
  app.update.error = null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    pendingUpdate = update;
    if (update) {
      app.update.version = update.version ?? null;
      app.update.status = "available";
    } else {
      app.update.version = null;
      app.update.status = "uptodate";
    }
  } catch (err) {
    pendingUpdate = null;
    app.update.status = "failed";
    app.update.error = err instanceof Error ? err.message : String(err);
  } finally {
    checking = false;
  }
}

/** Download and install the pending update (plugin-updater). */
export async function downloadAndInstallUpdate(): Promise<void> {
  const update = pendingUpdate;
  if (!update) {
    app.update.status = "failed";
    app.update.error = t("update.failed");
    return;
  }
  app.update.status = "downloading";
  app.update.downloadedBytes = 0;
  app.update.totalBytes = null;
  app.update.speedBytesPerSecond = 0;
  let lastSampleAt = performance.now();
  let lastSampleBytes = 0;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        app.update.totalBytes = event.data.contentLength ?? null;
        lastSampleAt = performance.now();
        lastSampleBytes = 0;
        return;
      }
      if (event.event === "Progress") {
        app.update.downloadedBytes += event.data.chunkLength;
        const now = performance.now();
        const elapsedSeconds = Math.max((now - lastSampleAt) / 1000, 0.05);
        const bytesSinceSample = app.update.downloadedBytes - lastSampleBytes;
        const sampleSpeed = bytesSinceSample / elapsedSeconds;
        app.update.speedBytesPerSecond = app.update.speedBytesPerSecond === 0
          ? sampleSpeed
          : app.update.speedBytesPerSecond * 0.65 + sampleSpeed * 0.35;
        lastSampleAt = now;
        lastSampleBytes = app.update.downloadedBytes;
      }
    });
    app.update.status = "ready";
  } catch (err) {
    app.update.status = "failed";
    app.update.error = err instanceof Error ? err.message : String(err);
    pushToast("error", t("update.failed"));
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function downloadPercent(downloaded: number, total: number | null): number | null {
  if (total === null || !Number.isFinite(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.floor((downloaded / total) * 100)));
}

/** Relaunch the app after a successful install (plugin-process). */
export async function relaunchApp(): Promise<void> {
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    pushToast("error", t("update.failed"));
  }
}

export function dismissUpdate(): void {
  app.update.status = "dismissed";
}
