import type { TaskRecord } from "../lib/contracts/generated/task/TaskRecord.js";
import type { LogLevel } from "../lib/contracts/generated/task/LogLevel.js";
import type { ThemeId } from "../lib/contracts/generated/settings/ThemeId.js";
import { applyUiStyle, initialUiStyle, type UiStyle } from "./ui-style.svelte";
import { setAlwaysOnTop, settingsLoad, settingsSave, type AppInfo } from "./tauri.js";
import { SvelteMap } from "svelte/reactivity";

/** UI language; legacy localStorage `mynx-language` mirrored. */
export type Language = "zh" | "en";

/** Actually applied theme (never "system"). */
export type ResolvedTheme = Exclude<ThemeId, "system">;

export const THEMES = ["system", "graphite", "pearl"] as const;

export const DEFAULT_THEME: ThemeId = "pearl";

const THEME_IDS = new Set<string>(["system", "graphite", "pearl"]);

/**
 * Ported from legacy `src/lib/theme.ts`: legacy "dark"/"light" values
 * normalize onto graphite/pearl; unknown values fall back to the default.
 */
export function normalizeTheme(value: string | null | undefined): ThemeId {
  if (!value) return DEFAULT_THEME;
  const lower = value.toLowerCase();
  if (lower === "dark") return "graphite";
  if (lower === "light") return "pearl";
  if (THEME_IDS.has(lower)) return lower as ThemeId;
  return DEFAULT_THEME;
}

/** System color-scheme preference ("light" → pearl, otherwise graphite). */
export function getSystemTheme(): ResolvedTheme {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "pearl";
  }
  return "graphite";
}

/** Resolve the user preference (incl. "system") to a concrete theme. */
export function resolveTheme(theme: ThemeId): ResolvedTheme {
  if (theme === "system") return getSystemTheme();
  return theme;
}

export interface ToastItem {
  id: number;
  level: LogLevel;
  message: string;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "failed"
  | "uptodate"
  | "dismissed";

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  error: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  speedBytesPerSecond: number;
}

export interface AppState {
  /** Bootstrap finished (settings applied, listeners registered). */
  ready: boolean;
  /** Current hash route, e.g. "/image". Owned by the router. */
  route: string;
  /** User theme preference, incl. "system". */
  theme: ThemeId;
  /** Concrete theme applied to `document.documentElement[data-theme]`. */
  resolvedTheme: ResolvedTheme;
  /** Visual style theme (see `ui-style.svelte.ts`), applied as `data-ui-style`. */
  uiStyle: UiStyle;
  language: Language;
  /** Task-center records, newest first. */
  tasks: TaskRecord[];
  taskDrawerOpen: boolean;
  helpOpen: boolean;
  aboutOpen: boolean;
  alwaysOnTop: boolean;
  systemTheme: ResolvedTheme;
  toasts: ToastItem[];
  appInfo: AppInfo | null;
  update: UpdateState;
}

export function readLocalStorage(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function initialLanguage(): Language {
  return readLocalStorage("mynx-language") === "en" ? "en" : "zh";
}

const initialTheme = normalizeTheme(readLocalStorage("mynx-theme"));

function setDocumentTheme(resolved: ResolvedTheme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
  }
}

function setDocumentLang(language: Language): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  }
}

export const app = $state<AppState>({
  ready: false,
  route: "/",
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme),
  uiStyle: initialUiStyle,
  language: initialLanguage(),
  tasks: [],
  taskDrawerOpen: false,
  helpOpen: false,
  aboutOpen: false,
  alwaysOnTop: false,
  systemTheme: getSystemTheme(),
  toasts: [],
  appInfo: null,
  update: {
    status: "idle",
    version: null,
    error: null,
    downloadedBytes: 0,
    totalBytes: null,
    speedBytesPerSecond: 0,
  },
});

// Apply the persisted theme/language/style before first paint.
setDocumentTheme(app.resolvedTheme);
applyUiStyle(app.uiStyle);
setDocumentLang(app.language);

/** Set the visual style theme (persisted via the `mynx-ui-style` mirror). */
export function setUiStyle(style: UiStyle): void {
  app.uiStyle = style;
  applyUiStyle(style);
}

/** Set the theme preference, resolve it, persist the mirror and update `data-theme`. */
export function applyTheme(preference: ThemeId): void {
  app.theme = preference;
  app.resolvedTheme = resolveTheme(preference);
  setDocumentTheme(app.resolvedTheme);
  writeLocalStorage("mynx-theme", preference);
}

export function setLanguage(next: Language): void {
  app.language = next;
  setDocumentLang(next);
  writeLocalStorage("mynx-language", next);
}

export function toggleLanguage(): void {
  const next = app.language === "zh" ? "en" : "zh";
  setLanguage(next);
  void patchSettings({ language: next });
}

let settingsPatchQueue = Promise.resolve();

/** Patch persisted settings in order (best effort). */
export async function patchSettings(patch: Record<string, unknown>): Promise<void> {
  const operation = settingsPatchQueue.then(async () => {
    try {
      const doc = await settingsLoad();
      await settingsSave({ ...doc, ...patch } as never);
    } catch {
      // Settings persistence is best effort (dev/browser mode has no backend).
    }
  });
  settingsPatchQueue = operation;
  await operation;
}

/** Set the theme preference and persist it (command palette / settings). */
export function setTheme(preference: ThemeId): void {
  applyTheme(preference);
  void patchSettings({ theme: preference });
}

/** Toggle always-on-top via the window API and persist the result. */
export function toggleAlwaysOnTop(): void {
  const next = !app.alwaysOnTop;
  app.alwaysOnTop = next;
  void setAlwaysOnTop(next).catch(() => (app.alwaysOnTop = !next));
  void patchSettings({ alwaysOnTop: next });
}

/**
 * Optimistically flip the always-on-top state. Callers with access to the
 * Tauri client should call `setAlwaysOnTop` and revert on failure (see
 * TitleBar/SettingsPage).
 */
export function setAlwaysOnTopState(next: boolean): boolean {
  const previous = app.alwaysOnTop;
  app.alwaysOnTop = next;
  return previous;
}

let toastSeq = 0;
const TOAST_TIMEOUT_MS = 4000;
const TOAST_MAX = 5;
// Timer bookkeeping is intentionally inert; SvelteMap keeps the reactivity
// lint happy without observable cost.
const toastTimers = new SvelteMap<number, ReturnType<typeof setTimeout>>();

export function pushToast(level: LogLevel, message: string): void {
  const id = ++toastSeq;
  app.toasts.push({ id, level, message });
  if (app.toasts.length > TOAST_MAX) {
    const dropped = app.toasts.shift();
    if (dropped) clearToastTimer(dropped.id);
  }
  toastTimers.set(
    id,
    setTimeout(() => dismissToast(id), TOAST_TIMEOUT_MS),
  );
}

export function dismissToast(id: number): void {
  clearToastTimer(id);
  const index = app.toasts.findIndex((toast) => toast.id === id);
  if (index >= 0) app.toasts.splice(index, 1);
}

function clearToastTimer(id: number): void {
  const timer = toastTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    toastTimers.delete(id);
  }
}

/** Insert or replace a task record, keeping the list newest-first. */
export function upsertTask(record: TaskRecord): void {
  const index = app.tasks.findIndex((task) => task.id === record.id);
  if (index >= 0) {
    app.tasks[index] = record;
  } else {
    app.tasks.push(record);
  }
  app.tasks.sort((a, b) => b.createdAtMs - a.createdAtMs || b.id - a.id);
}

export function activeTaskCount(): number {
  return app.tasks.filter((task) => task.status === "running" || task.status === "queued").length;
}

let systemWatcherStarted = false;

/** Keep "system" theme preference in sync with the OS color scheme. */
export function watchSystemTheme(): void {
  if (systemWatcherStarted || typeof window === "undefined") return;
  systemWatcherStarted = true;
  const mql = window.matchMedia("(prefers-color-scheme: light)");
  const handler = (): void => {
    app.systemTheme = mql.matches ? "pearl" : "graphite";
    if (app.theme === "system") {
      app.resolvedTheme = app.systemTheme;
      setDocumentTheme(app.resolvedTheme);
    }
  };
  mql.addEventListener("change", handler);
  handler();
}
