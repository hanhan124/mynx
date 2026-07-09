import { useEffect, useState } from "react";
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
  options: { desktop: boolean; startMenu: boolean; launchAfter: boolean };
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

  const title = mode === "uninstall" ? "卸载 Mynx" : "安装 Mynx";

  const handleLaunch = async () => {
    if (!result) return;
    try {
      await api.launchApp(result.install_path);
    } catch (e) {
      console.error("launch failed:", e);
    }
    win.close();
  };

  return (
    <div className="installer">
      {/* === macOS 风格标题栏 === */}
      <div className="titlebar" data-tauri-drag-region>
        <div className="traffic-lights">
          <button className="tl tl--close" title="关闭" onClick={handleClose} />
          <button className="tl tl--min" title="最小化" onClick={handleMinimize} />
          <button className="tl tl--zoom" disabled title="缩放(不可用)" />
        </div>
        <div className="titlebar__title">{title}</div>
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
            onDone={(r) => {
              setResult(r);
              setInstallStep("done");
            }}
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
            onDone={() => setUninstallStep("done")}
          />
        )}

        {mode === "uninstall" && uninstallStep === "done" && (
          <UninstallDone onClose={() => win.close()} />
        )}
      </div>
    </div>
  );
}