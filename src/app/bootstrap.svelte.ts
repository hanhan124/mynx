import { router, startRouter } from "../lib/router.svelte";
import {
  app,
  applyTheme,
  normalizeTheme,
  pushToast,
  setLanguage,
  toggleLanguage,
  upsertTask,
  watchSystemTheme,
} from "./state.svelte";
import { buildLegacySettings, readLegacyMirrors } from "./migrations.js";
import { loadPanelWidths } from "./panel-widths.svelte.js";
import * as client from "./tauri.js";

let bootstrapped = false;

/**
 * Startup flow: register global listeners, migrate legacy localStorage
 * mirrors into SQLite, load settings, apply theme/language/always-on-top,
 * fetch app info and start the hash router.
 */
export async function bootstrap(): Promise<void> {
  startRouter();
  if (bootstrapped) return;
  bootstrapped = true;

  registerGlobalListeners();
  watchSystemTheme();

  try {
    await client.settingsMigrateLegacy(buildLegacySettings(readLegacyMirrors()));
  } catch {
    // Migration is best-effort and idempotent; defaults still apply below.
  }

  try {
    const doc = await client.settingsLoad();
    loadPanelWidths(doc.panelWidths);
    applyTheme(normalizeTheme(doc.theme));
    setLanguage(doc.language === "en" ? "en" : "zh");
    app.alwaysOnTop = doc.alwaysOnTop;
    try {
      await client.setAlwaysOnTop(doc.alwaysOnTop);
    } catch {
      // Window permission missing — keep the UI state only.
    }
  } catch {
    // Settings unavailable (e.g. commands not built yet): keep
    // localStorage-derived defaults.
  }

  try {
    app.appInfo = await client.appInfo();
  } catch {
    // Version display falls back until app_info lands.
  }

  // Fire-and-forget housekeeping from the updater flow.
  void client.cleanupUpdateBak().catch(() => {});

  app.ready = true;
}

function registerGlobalListeners(): void {
  // Each registration is fire-and-forget; failures (e.g. commands not yet
  // built) must not reject unhandled.
  client
    .onNavigate((route) => {
      router.navigate(route);
    })
    .catch(() => {});
  client.onToggleLanguage(() => toggleLanguage()).catch(() => {});
  client
    .onHelp(() => {
      app.helpOpen = true;
    })
    .catch(() => {});
  client
    .onAbout(() => {
      app.aboutOpen = true;
    })
    .catch(() => {});
  client
    .onAlwaysOnTop((value) => {
      app.alwaysOnTop = value;
    })
    .catch(() => {});
  client
    .onTaskChanged((task) => {
      upsertTask(task);
    })
    .catch(() => {});
  client
    .onToast((payload) => {
      pushToast(payload.level, payload.message);
    })
    .catch(() => {});
}
