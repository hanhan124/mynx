import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import Modal from "@/components/Modal";
import AppMark from "@/components/AppMark";
import { showToast, type ToastType } from "@/components/Toast";
import { showUpdateNotification } from "@/components/UpdateNotification";
import { checkForUpdates } from "@/lib/updater";
import { IconWorldFilled, IconLoader2 } from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";

interface AboutModalProps {
  open: boolean;
  onClose: () => void;
}

export default function AboutModal({ open, onClose }: AboutModalProps) {
  const { t } = useLanguage();
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
        showToast(t("about.latest"), "success");
      }
    } catch (e) {
      const hint = e instanceof Error ? e.message : String(e);
      console.error("[AboutModal] checkForUpdates error:", e);
      const isNetworkError = hint.includes("fetch") || hint.includes("network") || hint.includes("Failed");
      showToast(isNetworkError
        ? `${t("about.networkError")} (detail: ${hint.substring(0, 150)})`
        : t("about.checkFailed", { detail: hint }),
        "error" as ToastType,
      );
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("about.title")}>
      <div className="about-header">
        <AppMark size={48} />
        <div className="about-header-text">
          <div className="about-app-name">Mynx</div>
          <div className="about-app-desc">{t("about.tagline")}</div>
        </div>
      </div>

      <div className="about-info">
        <div className="about-row">
          <span>{t("about.version")}</span>
          <span>v{appVersion}</span>
        </div>
        <div className="about-row">
          <span>{t("about.author")}</span>
          <span>Han</span>
        </div>
        <div className="about-row">
          <span>{t("about.stack")}</span>
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
          <IconWorldFilled size={14} stroke={1.75} />
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
            <IconLoader2 size={14} stroke={1.75} className="about-spin-icon" />
            {t("about.checking")}
          </>
        ) : (
          t("about.checkUpdate")
        )}
      </button>

      <div className="about-copyright">© 2026 Han · MIT License</div>
    </Modal>
  );
}
