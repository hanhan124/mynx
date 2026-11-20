/**
 * Visual style themes (orthogonal to the light/dark *mode*).
 *
 * The light/dark mode stays on the generated `ThemeId` contract
 * ("pearl" | "graphite" | "system", see `src/app/state.svelte.ts`) and is
 * applied as `document.documentElement[data-theme]`. The four visual
 * styles below are a second, independent dimension applied as
 * `document.documentElement[data-ui-style]`:
 *
 * - `minimal-linear` (default) — macOS 27-inspired cool neutrals, system-blue
 *   selection, a soft blue-violet color wash, and translucent title/navigation bars.
 * - `liquid-glass` — pure-white glass, subtle blue-gray / sage glows,
 *   restrained backdrop blur, one low-saturation lake-blue accent.
 * - `swiss-editorial` — pure white + ink black + one low-saturation
 *   editorial red #C2452D, square corners, strict grid.
 * - `memphis-pop` — kraft #F4ECDB + white cards + 2px warm-ink borders,
 *   cream pastels only as small accents.
 *
 * Persistence: localStorage mirror `mynx-ui-style`, the same pattern the
 * app already uses for the theme/language mirrors (`mynx-theme`,
 * `mynx-language`) so the style is applied before first paint.
 * TODO(sqlite): move this into the SQLite settings document once the Rust
 * side can carry it — add `ui_style: String` (default "minimal-linear") to
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

export type UiStyle = "liquid-glass" | "minimal-linear" | "swiss-editorial" | "memphis-pop";

export const UI_STYLES = [
  "minimal-linear",
  "liquid-glass",
  "swiss-editorial",
  "memphis-pop",
] as const satisfies readonly UiStyle[];

export const DEFAULT_UI_STYLE: UiStyle = "minimal-linear";

const UI_STYLE_IDS = new Set<string>(UI_STYLES);

const UI_STYLE_STORAGE_KEY = "mynx-ui-style";
const UI_STYLE_MIGRATION_KEY = "mynx-ui-style-default-v2";

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
      // Earlier releases wrote liquid-glass on first launch even when the
      // user had never selected a style. Move that old default once while
      // preserving the other explicit choices.
      const style = saved === null || saved === "liquid-glass"
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
