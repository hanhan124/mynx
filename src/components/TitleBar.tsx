import { useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import { loadConfig, saveAlwaysOnTop } from "@/lib/config";
import AppMark from "@/components/AppMark";
import { IconMinus, IconSquare, IconPinFilled, IconX } from "@tabler/icons-react";

interface TitleBarProps {
  title?: string;
}

export default function TitleBar({ title = "Mynx" }: TitleBarProps) {
  const [pinned, setPinned] = useState(false);
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const appWindow = useMemo(
    () => (isTauri ? getCurrentWindow() : null),
    [isTauri],
  );
  const isMac = useMemo(() => isTauri && platform() === "macos", [isTauri]);

  useEffect(() => {
    if (!appWindow) return;
    loadConfig().then((cfg) => {
      setPinned(cfg.alwaysOnTop);
      appWindow.setAlwaysOnTop(cfg.alwaysOnTop);
    });
  }, [appWindow]);

  if (!appWindow) return null;

  return (
    <div className={`title-bar${isMac ? " title-bar--mac" : ""}`} data-tauri-drag-region>
      <div className="title-bar-left">
        <AppMark size={24} className="title-bar-mark" />
        <span className="title-bar-text">{title}</span>
      </div>
      <div className={`title-bar-controls${isMac ? " title-bar-controls--left" : ""}`}>
        <button
          className={`title-bar-btn ${pinned ? "title-bar-btn--active" : ""}`}
          data-tauri-no-drag
          onClick={async () => {
            const next = !pinned;
            setPinned(next);
            await appWindow.setAlwaysOnTop(next);
            await saveAlwaysOnTop(next);
          }}
          title="窗口置顶"
        >
          <IconPinFilled size={14} stroke={1.75} />
        </button>
        <button className="title-bar-btn" data-tauri-no-drag onClick={() => appWindow.minimize()} title="最小化">
          <IconMinus size={14} stroke={1.75} />
        </button>
        <button className="title-bar-btn" data-tauri-no-drag onClick={() => appWindow.toggleMaximize()} title="最大化">
          <IconSquare size={14} stroke={1.75} />
        </button>
        <button className="title-bar-btn title-bar-btn--close" data-tauri-no-drag onClick={() => appWindow.close()} title="关闭">
          <IconX size={14} stroke={1.75} />
        </button>
      </div>
    </div>
  );
}
