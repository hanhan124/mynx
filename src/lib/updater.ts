/**
 * updater.ts — Update check logic (installed mode only, no portable support).
 *
 * Two callers:
 * - UpdateNotification (auto-check, silent when already latest)
 * - AboutModal  (manual check, shows toast when already latest)
 */
import { check, type Update } from "@tauri-apps/plugin-updater";

/* ---- types ------------------------------------------------------------ */
export interface UpdateInfo {
  version: string;
  body?: string;
  /** For installed mode: Tauri updater handle */
  installedUpdate: Update;
}

export type CheckResult =
  | { found: true; info: UpdateInfo }
  | { found: false };

/**
 * Check for updates via Tauri built-in updater plugin.
 * Uses latest.json from GitHub Release (configured in tauri.conf.json).
 */
export async function checkForUpdates(): Promise<CheckResult> {
  const update = await check();
  if (!update) {
    return { found: false };
  }

  return {
    found: true,
    info: {
      version: update.version,
      body: update.body,
      installedUpdate: update,
    },
  };
}
