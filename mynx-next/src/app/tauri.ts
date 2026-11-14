import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { TaskRecord } from "../lib/contracts/generated/task/TaskRecord.js";
import type { LogLine } from "../lib/contracts/generated/task/LogLine.js";
import type { ToastPayload } from "../lib/contracts/generated/task/ToastPayload.js";
import type { ErrorCode } from "../lib/contracts/generated/task/ErrorCode.js";
import type { SettingsDoc } from "../lib/contracts/generated/settings/SettingsDoc.js";
import type { LegacySettings } from "../lib/contracts/generated/settings/LegacySettings.js";
import type { RScriptStatus } from "../lib/contracts/generated/r/RScriptStatus.js";
import type { RDependencyStatus } from "../lib/contracts/generated/r/RDependencyStatus.js";

/**
 * Structured error surface. Rust commands serialize `Result<T, MynxError>`,
 * so a failed invoke rejects with `{ v, code, message }`.
 */
export class CommandError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "CommandError";
    this.code = code;
  }
}

export function toCommandError(err: unknown): CommandError {
  if (err !== null && typeof err === "object") {
    const candidate = err as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return new CommandError(candidate.code as ErrorCode, candidate.message);
    }
  }
  if (typeof err === "string") return new CommandError("internal", err);
  return new CommandError("internal", String(err));
}

/** Shared invoke helper: failed commands reject with a `CommandError`. */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw toCommandError(err);
  }
}

/* ---------------------------------------------------------------------------
 * Shell command surface (Rust side may still be landing; these names are the
 * frontend contract).
 * ------------------------------------------------------------------------- */

export interface AppInfo {
  version: string;
  exePath: string;
  isPortable: boolean;
}

export function settingsLoad(): Promise<SettingsDoc> {
  return call("settings_load");
}

export function settingsSave(doc: SettingsDoc): Promise<void> {
  return call("settings_save", { doc });
}

export function settingsMigrateLegacy(legacy: LegacySettings): Promise<void> {
  return call("settings_migrate_legacy", { legacy });
}

export function tasksList(): Promise<TaskRecord[]> {
  return call("tasks_list");
}

export function tasksCancel(id: number): Promise<boolean> {
  return call("tasks_cancel", { id });
}

export function appInfo(): Promise<AppInfo> {
  return call("app_info");
}

export function cleanupUpdateBak(): Promise<void> {
  return call("cleanup_update_bak");
}

export function rStatus(): Promise<RScriptStatus> {
  return call("r_status");
}

export function rCheckDependencies(packages: string[]): Promise<RDependencyStatus> {
  return call("r_check_dependencies", { packages });
}

/** Returns a task id; progress logs stream on `mynx://r-install-log`. */
export function rInstallRuntime(): Promise<number> {
  return call("r_install_runtime");
}

/** Returns a task id; progress logs stream on `mynx://r-install-log`. */
export function rInstallPackages(packages: string[]): Promise<number> {
  return call("r_install_packages", { packages });
}

/** Open a path (e.g. a task output dir) in the system file manager. */
export function openPath(path: string): Promise<boolean> {
  return call("open_path", { path });
}

/** Home-page aggregate: recent tasks, failure alerts, recent outputs. */
export function homeData(): Promise<Record<string, unknown>> {
  return call("home_data", {});
}

/* ---------------------------------------------------------------------------
 * Tauri events (legacy contract names preserved).
 * ------------------------------------------------------------------------- */

export const EVENT_NAVIGATE = "mynx://navigate";
export const EVENT_TOGGLE_LANGUAGE = "mynx://toggle-language";
export const EVENT_HELP = "mynx://help";
export const EVENT_ABOUT = "mynx://about";
export const EVENT_ALWAYS_ON_TOP = "mynx://always-on-top";
export const EVENT_TASK_CHANGED = "mynx://task-changed";
export const EVENT_TOAST = "mynx://toast";
export const EVENT_R_INSTALL_LOG = "mynx://r-install-log";

export function onNavigate(handler: (route: string) => void): Promise<UnlistenFn> {
  return listen<string>(EVENT_NAVIGATE, (event) => handler(event.payload));
}

export function onToggleLanguage(handler: () => void): Promise<UnlistenFn> {
  return listen<null>(EVENT_TOGGLE_LANGUAGE, () => handler());
}

export function onHelp(handler: () => void): Promise<UnlistenFn> {
  return listen<null>(EVENT_HELP, () => handler());
}

export function onAbout(handler: () => void): Promise<UnlistenFn> {
  return listen<null>(EVENT_ABOUT, () => handler());
}

export function onAlwaysOnTop(handler: (value: boolean) => void): Promise<UnlistenFn> {
  return listen<boolean>(EVENT_ALWAYS_ON_TOP, (event) => handler(event.payload));
}

export function onTaskChanged(handler: (task: TaskRecord) => void): Promise<UnlistenFn> {
  return listen<TaskRecord>(EVENT_TASK_CHANGED, (event) => handler(event.payload));
}

export function onToast(handler: (toast: ToastPayload) => void): Promise<UnlistenFn> {
  return listen<ToastPayload>(EVENT_TOAST, (event) => handler(event.payload));
}

export function onRInstallLog(handler: (line: LogLine) => void): Promise<UnlistenFn> {
  return listen<LogLine>(EVENT_R_INSTALL_LOG, (event) => handler(event.payload));
}

/* ---------------------------------------------------------------------------
 * Window controls (custom title bar).
 * ------------------------------------------------------------------------- */

export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}

export function toggleMaximizeWindow(): Promise<void> {
  return getCurrentWindow().toggleMaximize();
}

export function closeWindow(): Promise<void> {
  return getCurrentWindow().close();
}

export function setAlwaysOnTop(value: boolean): Promise<void> {
  return getCurrentWindow().setAlwaysOnTop(value);
}

export function isMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}

/** Fires on window resize; used to refresh the maximize/restore glyph. */
export function onWindowResized(handler: () => void): Promise<UnlistenFn> {
  return getCurrentWindow().onResized(() => handler());
}

/** Open an external URL in the default browser (plugin-shell). */
export async function openExternal(url: string): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(url);
}
