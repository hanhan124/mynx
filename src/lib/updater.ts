/**
 * Shared update check logic.
 *
 * Two callers:
 * - UpdateNotification (auto-check, silent when already latest)
 * - AboutModal  (manual check, shows toast when already latest)
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import { compareVersions } from "@/lib/version";

/* ---- types ------------------------------------------------------------ */
export interface UpdateInfo {
  version: string;
  body?: string;
  /** true when app is running as portable */
  isPortable: boolean;
  /** For installed mode: Tauri updater handle */
  installedUpdate?: Update;
  /** For portable mode: direct download URL */
  portableUrl?: string;
}

export type CheckResult =
  | { found: true; info: UpdateInfo }
  | { found: false };

/* ---- endpoint ---------------------------------------------------------- */
const LATEST_JSON_URL =
  "https://github.com/hanhan124/mynx/releases/latest/download/latest.json";

/* ---- helpers ----------------------------------------------------------- */

/** Detect portable vs installed (no Tauri invocation needed here — caller supplies it). */
export async function detectPortable(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("is_portable");
  } catch {
    return false;
  }
}

/** Fetch and parse latest.json, returns version + body. */
async function fetchLatestMeta(): Promise<{
  version: string;
  body: string;
}> {
  const resp = await fetch(LATEST_JSON_URL);
  if (!resp.ok) {
    throw new Error(`GitHub API returned ${resp.status}`);
  }
  const json = await resp.json();
  return {
    version: json.version,
    body: json.body || json.notes || "",
  };
}

/* ---- main entry -------------------------------------------------------- */

/**
 * Check for updates.
 *
 * @param isPortable  Whether running as portable (call `detectPortable()` first).
 * @returns           CheckResult with version info if a newer release exists.
 */
export async function checkForUpdates(
  isPortable: boolean,
): Promise<CheckResult> {
  if (isPortable) {
    // Portable path: fetch latest.json, compare versions
    const latest = await fetchLatestMeta();
    const current = await getVersion();

    if (compareVersions(latest.version, current) <= 0) {
      return { found: false };
    }

    const ghBase = `https://github.com/hanhan124/mynx/releases/download/v${latest.version}`;
    return {
      found: true,
      info: {
        version: latest.version,
        body: latest.body,
        isPortable: true,
        portableUrl: `${ghBase}/Mynx_${latest.version}_portable.exe`,
      },
    };
  }

  // Installed path: use Tauri's built-in updater plugin
  const update = await check();
  if (!update) {
    return { found: false };
  }

  return {
    found: true,
    info: {
      version: update.version,
      body: update.body,
      isPortable: false,
      installedUpdate: update,
    },
  };
}
