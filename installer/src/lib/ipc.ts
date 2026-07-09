import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export type Mode = "install" | "uninstall";

export interface InstallContext {
  mode: Mode;
  app_name: string;
  app_version: string;
  publisher: string;
  default_install_path: string;
  installed_path: string | null;     // 仅 uninstall 模式:已安装位置
  installed_version: string | null;  // 仅 uninstall 模式
  payload_size_mb: number;            // 主程序大小(MB),用于提示
  is_admin: boolean;
}

export interface InstallOptions {
  install_path: string;
  create_desktop_icon: boolean;
  create_start_menu: boolean;
  launch_after: boolean;
}

export interface InstallProgress {
  stage: string;
  message: string;
  percent: number;
}

export interface InstallResult {
  install_path: string;
  launched: boolean;
}

export const api = {
  getContext: () => invoke<InstallContext>("get_install_context"),
  install: (opts: InstallOptions) => invoke<InstallResult>("perform_install", { opts }),
  uninstall: () => invoke<void>("perform_uninstall"),
  onProgress: async (cb: (p: InstallProgress) => void): Promise<UnlistenFn> => {
    return await listen<InstallProgress>("install-progress", (e) => cb(e.payload));
  },
  launchApp: (path: string) => invoke<void>("launch_app", { path }),
  pickInstallDir: () => invoke<string | null>("pick_install_dir"),
};