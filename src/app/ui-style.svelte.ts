/**
 * Visual style themes (orthogonal to the light/dark *mode*).
 *
 * The light/dark mode stays on the generated `ThemeId` contract
 * ("pearl" | "graphite" | "system", see `src/app/state.svelte.ts`) and is
 * applied as `document.documentElement[data-theme]`. The four visual
 * styles below are a second, independent dimension applied as
 * `document.documentElement[data-ui-style]`:
 *
 * Since 2026-11-22 every style shares the macOS 27 structure (Liquid Glass
 * chrome, controls, type scale, concentric radii; see app.css "macOS 27
 * structure"). A style only contributes its palette:
 * - `macos` (default) — Apple system grays + system blue.
 * - `minimal-linear` — cool neutrals + soft blue.
 * - `liquid-glass` — blue-gray base + lake-blue accent.
 * - `swiss-editorial` — white / ink black + editorial red.
 * - `memphis-pop` — kraft paper + amber accent.
 *
 * Persistence: localStorage mirror `mynx-ui-style`, the same pattern the
 * app already uses for the theme/language mirrors (`mynx-theme`,
 * `mynx-language`) so the style is applied before first paint.
 * TODO(sqlite): move this into the SQLite settings document once the Rust
 * side can carry it — add `ui_style: String` (default "macos") to
 * `SettingsDoc` in `src-tauri/crates/mynx-contracts/src/settings.rs`,
 * add the key in `SettingsStore::load`/`save` in
 * `src-tauri/crates/mynx-core/src/settings.rs`, then regenerate the TS
 * bindings + JSON schemas with
 * `TS_RS_EXPORT_DIR=…/src/lib/contracts/generated cargo test -p mynx-contracts --lib`.
 * Do NOT hand-edit the generated `SettingsDoc.ts` / `ThemeId.ts`.
 * (No cargo toolchain in this environment, so that step is intentionally
 * left as a follow-up; sending an unknown key through `settings_save`
 * today would be silently dropped by the Rust struct deserialization.)
 */

export type UiStyle =
  | "macos"
  | "liquid-glass"
  | "minimal-linear"
  | "swiss-editorial"
  | "memphis-pop";

export const UI_STYLES = [
  "macos",
  "minimal-linear",
  "liquid-glass",
  "swiss-editorial",
  "memphis-pop",
] as const satisfies readonly UiStyle[];

export const DEFAULT_UI_STYLE: UiStyle = "macos";

const UI_STYLE_IDS = new Set<string>(UI_STYLES);

const UI_STYLE_STORAGE_KEY = "mynx-ui-style";
const UI_STYLE_MIGRATION_KEY = "mynx-ui-style-default-v3";

export function normalizeUiStyle(value: string | null | undefined): UiStyle {
  if (!value) return DEFAULT_UI_STYLE;
  const lower = value.toLowerCase();
  if (UI_STYLE_IDS.has(lower)) return lower as UiStyle;
  return DEFAULT_UI_STYLE;
}

function readUiStyleMirror(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(UI_STYLE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeUiStyleMirror(style: UiStyle): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(UI_STYLE_STORAGE_KEY, style);
  } catch {
    /* storage unavailable */
  }
}

function initialStyle(): UiStyle {
  const saved = readUiStyleMirror();
  try {
    if (localStorage.getItem(UI_STYLE_MIGRATION_KEY) !== "1") {
      // Each release that flips the default moves the previous default once,
      // while preserving every other explicit style choice. v2 moved the old
      // liquid-glass default to minimal-linear; v3 moves minimal-linear to
      // the new macOS faithful default.
      const style = saved === null || saved === "minimal-linear"
        ? DEFAULT_UI_STYLE
        : normalizeUiStyle(saved);
      localStorage.setItem(UI_STYLE_MIGRATION_KEY, "1");
      writeUiStyleMirror(style);
      return style;
    }
  } catch {
    // Storage may be unavailable in web previews; use the app default.
  }
  return normalizeUiStyle(saved);
}

/** Persisted style (localStorage mirror) or the default. */
export const initialUiStyle: UiStyle = initialStyle();

/** Apply the style to `document.documentElement[data-ui-style]` + mirror. */
export function applyUiStyle(style: UiStyle): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.uiStyle = style;
  }
  writeUiStyleMirror(style);
}
