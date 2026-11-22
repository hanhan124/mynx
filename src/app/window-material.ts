import { platform, version } from "@tauri-apps/plugin-os";

/**
 * Marks whether the native window paints a system material behind the
 * webview (tauri.conf.json `transparent` + `windowEffects`):
 * - macOS: NSVisualEffectView (`underWindowBackground`).
 * - Windows 11 (build >= 22000): Mica.
 * Windows 10 and browser previews have no backdrop material, so the shell
 * must stay opaque there. CSS reads `html[data-window-material]`.
 * Presentation only: no settings, state or IPC are touched.
 */
export type WindowMaterial = "glass" | "solid";

export function detectWindowMaterial(): WindowMaterial {
  try {
    const os = platform();
    if (os === "macos") return "glass";
    if (os === "windows") {
      const build = Number(version().split(".")[2] ?? "0");
      return Number.isFinite(build) && build >= 22000 ? "glass" : "solid";
    }
  } catch {
    /* plugin unavailable outside Tauri (browser preview / tests) */
  }
  return "solid";
}

export function applyWindowMaterial(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.windowMaterial = detectWindowMaterial();
}
