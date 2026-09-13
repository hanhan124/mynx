import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { loadConfig, saveAlwaysOnTop } from "@/lib/config";
import AppMark from "@/components/AppMark";
import { IconMinus, IconPinFilled, IconSquare, IconX } from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";

interface TitleBarProps {
  title?: string;
}

export default function TitleBar({ title = "Mynx" }: TitleBarProps) {
  const { t } = useLanguage();
  const [pinned, setPinned] = useState(false);
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const appWindow = useMemo(
    () => (isTauri ? getCurrentWindow() : null),
    [isTauri],
  );

  useEffect(() => {
    if (!appWindow) return;
    loadConfig().then((cfg) => {
      setPinned(cfg.alwaysOnTop);
      appWindow.setAlwaysOnTop(cfg.alwaysOnTop);
    });
  }, [appWindow]);

  useEffect(() => {
    if (appWindow) void appWindow.setTitle(title);
  }, [appWindow, title]);

  useEffect(() => {
    if (!appWindow) return;
    let unlisten: (() => void) | undefined;
    void listen<boolean>("mynx://always-on-top", ({ payload }) => {
      setPinned(payload);
      void saveAlwaysOnTop(payload);
    }).then((stop) => { unlisten = stop; }).catch(() => undefined);
    return () => unlisten?.();
  }, [appWindow]);

  if (!appWindow) return null;

  return (
    <div className="title-bar" data-tauri-drag-region>
      <div className="title-bar-left" data-tauri-drag-region>
        <AppMark size={24} className="title-bar-mark" />
        <span className="title-bar-text">{title}</span>
      </div>
      <div className="title-bar-controls">
        <button
          className={`title-bar-btn ${pinned ? "title-bar-btn--active" : ""}`}
          data-tauri-no-drag
          aria-label={t("window.pin")}
          aria-pressed={pinned}
          onClick={async () => {
            const next = !pinned;
            setPinned(next);
            await appWindow.setAlwaysOnTop(next);
            await saveAlwaysOnTop(next);
          }}
          title={t("window.pin")}
        >
          <IconPinFilled size={14} stroke={1.75} />
        </button>
        <button
          className="title-bar-btn"
          data-tauri-no-drag
          aria-label={t("window.minimize")}
          onClick={() => appWindow.minimize()}
          title={t("window.minimize")}
        >
          <IconMinus size={14} stroke={1.75} />
        </button>
        <button
          className="title-bar-btn"
          data-tauri-no-drag
          aria-label={t("window.maximize")}
          onClick={() => appWindow.toggleMaximize()}
          title={t("window.maximize")}
        >
          <IconSquare size={14} stroke={1.75} />
        </button>
        <button
          className="title-bar-btn title-bar-btn--close"
          data-tauri-no-drag
          aria-label={t("window.close")}
          onClick={() => appWindow.close()}
          title={t("window.close")}
        >
          <IconX size={14} stroke={1.75} />
        </button>
      </div>
    </div>
  );
}
