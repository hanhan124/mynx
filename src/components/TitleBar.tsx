import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadConfig, saveAlwaysOnTop } from "@/lib/config";
import AppMark from "@/components/AppMark";
import { IconMinus, IconSquare, IconPin, IconX } from "@tabler/icons-react";

interface TitleBarProps {
  title?: string;
}

export default function TitleBar({ title = "Mynx" }: TitleBarProps) {
  const [pinned, setPinned] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    loadConfig().then((cfg) => {
      setPinned(cfg.alwaysOnTop);
      appWindow.setAlwaysOnTop(cfg.alwaysOnTop);
    });
  }, [appWindow]);

  return (
    <div className="title-bar" data-tauri-drag-region>
      <div className="title-bar-left">
        <AppMark size={24} className="title-bar-mark" />
        <span className="title-bar-text">{title}</span>
      </div>
      <div className="title-bar-controls">
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
          <IconPin size={14} stroke={2} />
        </button>
        <button className="title-bar-btn" data-tauri-no-drag onClick={() => appWindow.minimize()} title="最小化">
          <IconMinus size={14} stroke={2} />
        </button>
        <button className="title-bar-btn" data-tauri-no-drag onClick={() => appWindow.toggleMaximize()} title="最大化">
          <IconSquare size={14} stroke={2} />
        </button>
        <button className="title-bar-btn title-bar-btn--close" data-tauri-no-drag onClick={() => appWindow.close()} title="关闭">
          <IconX size={14} stroke={2} />
        </button>
      </div>
    </div>
  );
}
