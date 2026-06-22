import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { loadConfig, saveAlwaysOnTop } from "../lib/config";

interface TitleBarProps {
  title?: string;
}

export default function TitleBar({ title = "Mynx" }: TitleBarProps) {
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    loadConfig().then((cfg) => {
      setPinned(cfg.alwaysOnTop);
      getCurrentWindow().setAlwaysOnTop(cfg.alwaysOnTop);
    });
  }, []);

  return (
    <div className="title-bar" data-tauri-drag-region>
      <span className="title-bar-text">{title}</span>
      <div className="title-bar-controls">
        <button
          className={`title-bar-btn ${pinned ? "title-bar-btn--active" : ""}`}
          onClick={async () => {
            const next = !pinned;
            setPinned(next);
            await getCurrentWindow().setAlwaysOnTop(next);
            await saveAlwaysOnTop(next);
          }}
          title="Always on top"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L8 8H4l2 4-2 4h4l4 6 4-6h4l-2-4 2-4h-4L12 2z" />
          </svg>
        </button>
        <button className="title-bar-btn" onClick={() => getCurrentWindow().minimize()} title="Minimize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button className="title-bar-btn" onClick={() => getCurrentWindow().toggleMaximize()} title="Maximize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="5" width="14" height="14" rx="1" />
          </svg>
        </button>
        <button className="title-bar-btn title-bar-btn--close" onClick={() => getCurrentWindow().close()} title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
