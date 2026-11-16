import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Logo } from "./components/Logo";
import { Welcome } from "./pages/Welcome";
import { Installing } from "./pages/Installing";
import { Done } from "./pages/Done";
import { Uninstall } from "./pages/Uninstall";
import { UninstallProgress } from "./pages/UninstallProgress";
import { UninstallDone } from "./pages/UninstallDone";
import { api, InstallResult, Mode } from "./lib/ipc";

type InstallStep = "welcome" | "installing" | "done";
type UninstallStep = "confirm" | "removing" | "done";

interface InstallChoice {
  path: string;
  options: { desktop: boolean; startMenu: boolean };
}

export default function App() {
  const win = getCurrentWindow();

  // 模式由后端决定(install / uninstall)
  const [mode, setMode] = useState<Mode>("install");
  const [installStep, setInstallStep] = useState<InstallStep>("welcome");
  const [uninstallStep, setUninstallStep] = useState<UninstallStep>("confirm");
  const [choice, setChoice] = useState<InstallChoice | null>(null);
  const [result, setResult] = useState<InstallResult | null>(null);

  useEffect(() => {
    api.getContext().then((ctx) => {
      setMode(ctx.mode);
      if (ctx.mode === "uninstall") {
        // 卸载模式下默认从 confirm 开始
        setUninstallStep("confirm");
      }
    });
  }, []);

  useEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      document.documentElement.dataset.theme = colorScheme.matches ? "graphite" : "pearl";
    };

    applyTheme();
    colorScheme.addEventListener("change", applyTheme);
    return () => colorScheme.removeEventListener("change", applyTheme);
  }, []);

  // ESC 键关闭(进行中状态需二次确认)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installStep, uninstallStep]);

  const handleClose = () => {
    if (installStep === "installing" || uninstallStep === "removing") {
      if (!confirm("操作正在进行中,确定要取消吗?\n(已修改的文件需要手动清理)")) return;
    }
    win.close();
  };

  const handleMinimize = () => win.minimize();

  const title = mode === "uninstall" ? "卸载" : "安装";

  const handleLaunch = async () => {
    if (!result) return;
    try {
      await api.launchApp(result.install_path);
    } catch (e) {
      console.error("launch failed:", e);
    }
    win.close();
  };

  const handleInstallDone = useCallback((installResult: InstallResult) => {
    setResult(installResult);
    setInstallStep("done");
  }, []);

  const handleUninstallDone = useCallback(() => {
    setUninstallStep("done");
  }, []);

  return (
    <div className="installer">
      {/* Match the Mynx app title bar and window controls. */}
      <div className="titlebar" data-tauri-drag-region>
        <div className="titlebar__brand" data-tauri-drag-region>
          <Logo size={16} />
          <span className="titlebar__name" data-tauri-drag-region>Mynx</span>
          <span className="titlebar__title" data-tauri-drag-region>{title}</span>
        </div>
        <div className="titlebar__controls">
          <button
            type="button"
            className="window-control"
            title="最小化"
            aria-label="最小化"
            onClick={handleMinimize}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <button
            type="button"
            className="window-control window-control--close"
            title="关闭"
            aria-label="关闭"
            onClick={handleClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18 6-12 12M6 6l12 12" /></svg>
          </button>
        </div>
      </div>

      {/* === 内容 === */}
      <div className="content">
        {mode === "install" && installStep === "welcome" && (
          <Welcome
            onNext={(c) => {
              setChoice(c);
              setInstallStep("installing");
            }}
            onCancel={handleClose}
          />
        )}

        {mode === "install" && installStep === "installing" && choice && (
          <Installing
            path={choice.path}
            options={choice.options}
            onDone={handleInstallDone}
          />
        )}

        {mode === "install" && installStep === "done" && result && (
          <Done result={result} onLaunch={handleLaunch} onClose={() => win.close()} />
        )}

        {mode === "uninstall" && uninstallStep === "confirm" && (
          <Uninstall
            onConfirm={() => setUninstallStep("removing")}
            onCancel={handleClose}
          />
        )}

        {mode === "uninstall" && uninstallStep === "removing" && (
          <UninstallProgress
            onDone={handleUninstallDone}
          />
        )}

        {mode === "uninstall" && uninstallStep === "done" && (
          <UninstallDone onClose={() => win.close()} />
        )}
      </div>
    </div>
  );
}
