import type { LegacySettings } from "../lib/contracts/generated/settings/LegacySettings.js";
import { readLocalStorage } from "./state.svelte";

/**
 * Legacy settings migration.
 *
 * The legacy config.json lived in tauri-plugin-store, which is NOT shipped in
 * the new frontend. That store file is read and migrated Rust-side by
 * `settings_migrate_legacy` (which opens config.json directly); the frontend
 * only forwards the localStorage mirrors below. localStorage is never
 * cleared, and the Rust migration is idempotent, so this is safe to call on
 * every startup.
 */
export interface LegacyMirrors {
  theme: string | null;
  language: string | null;
  searchEngine: string | null;
  homeHeaderHeight: number | null;
}

export function readLegacyMirrors(): LegacyMirrors {
  const heightRaw = readLocalStorage("mynx-home-header-height");
  let homeHeaderHeight: number | null = null;
  if (heightRaw !== null) {
    const parsed = Number(heightRaw);
    if (Number.isFinite(parsed)) homeHeaderHeight = parsed;
  }
  return {
    theme: readLocalStorage("mynx-theme"),
    language: readLocalStorage("mynx-language"),
    searchEngine: readLocalStorage("mynx-search-engine"),
    homeHeaderHeight,
  };
}

/**
 * Build the migration payload. Absent keys stay `null` ("keep default");
 * `alwaysOnTop`/`chartColor`/`imageConverterOptions`/`chartStudioPresets`
 * belong to the Rust-side config.json migration, not localStorage.
 */
export function buildLegacySettings(mirrors: LegacyMirrors): LegacySettings {
  return {
    v: 1,
    theme: mirrors.theme,
    alwaysOnTop: null,
    chartColor: null,
    language: mirrors.language,
    searchEngine: mirrors.searchEngine,
    homeHeaderHeight: mirrors.homeHeaderHeight,
    imageConverterOptions: null,
    chartStudioPresets: null,
  };
}
