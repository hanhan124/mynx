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
  try {
    await update.downloadAndInstall();
    app.update.status = "ready";
  } catch (err) {
    app.update.status = "failed";
    app.update.error = err instanceof Error ? err.message : String(err);
    pushToast("error", t("update.failed"));
  }
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
