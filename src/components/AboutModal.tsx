import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import Modal from "@/components/Modal";
import AppMark from "@/components/AppMark";
import { showToast, type ToastType } from "@/components/Toast";
import { showUpdateNotification } from "@/components/UpdateNotification";
import { checkForUpdates } from "@/lib/updater";
import { IconWorld, IconLoader } from "@tabler/icons-react";

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [appVersion, setAppVersion] = useState("...");

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("?"));
  }, []);

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    try {
      const result = await checkForUpdates();

      if (result.found) {
        showUpdateNotification(result.info);
      } else {
        showToast("当前已是最新版本", "success");
      }
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[AboutModal] checkForUpdates error:", e);
      const isNetworkError = hint.includes("fetch") || hint.includes("network") || hint.includes("Failed");
      showToast(isNetworkError
        ? `网络连接失败，请检查网络后重试 (detail: ${hint.substring(0, 150)})`
        : `检查更新失败: ${hint}`,
        "error" as ToastType,
      );
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="关于">
      <div className="about-header">
        <AppMark size={48} />
        <div className="about-header-text">
          <div className="about-app-name">Mynx</div>
          <div className="about-app-desc">让工作更简单</div>
        </div>
      </div>

      <div className="about-info">
        <div className="about-row">
          <span>版本</span>
          <span>v{appVersion}</span>
        </div>
        <div className="about-row">
          <span>作者</span>
          <span>Han</span>
        </div>
        <div className="about-row">
          <span>技术栈</span>
          <span>Tauri · React · Rust</span>
        </div>
      </div>

      <div className="about-links">
        <button
          className="btn btn-full"
          onClick={() => {
            import("@tauri-apps/plugin-shell").then(({ open }) =>
              open("https://github.com/hanhan124/mynx"),
            );
          }}
        >
          <IconWorld size={14} stroke={2} />
          GitHub
        </button>
      </div>

      <button
        className="btn btn-primary about-check"
        onClick={handleCheckUpdate}
        disabled={checkingUpdate}
      >
        {checkingUpdate ? (
          <>
            <IconLoader size={14} stroke={2} className="about-spin-icon" />
            检查中...
          </>
        ) : (
          "检查更新"
        )}
      </button>

      <div className="about-copyright">© 2026 Han · MIT License</div>
    </Modal>
  );
}
