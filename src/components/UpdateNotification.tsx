import { useState, useEffect, useRef, useCallback } from "react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, X, AlertCircle, Loader2 } from "lucide-react";

type UpdateStatus = "idle" | "available" | "downloading" | "installing" | "error";

interface UpdateState {
  status: UpdateStatus;
  version?: string;
  body?: string;
  progress: number;
  speed: number;
  downloaded: number;
  total: number;
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export default function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({
    status: "idle",
    progress: 0,
    speed: 0,
    downloaded: 0,
    total: 0,
  });
  const updateRef = useRef<Update | null>(null);
  const startTimeRef = useRef(0);
  const downloadedRef = useRef(0);
  const totalRef = useRef(0);
  const lastUiUpdateRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (update) {
          updateRef.current = update;
          setState((prev) => ({
            ...prev,
            status: "available",
            version: update.version,
            body: update.body,
          }));
        }
      } catch {
        // 静默失败
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const handleUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setState((prev) => ({ ...prev, status: "downloading", progress: 0 }));
    startTimeRef.current = Date.now();
    downloadedRef.current = 0;
    lastUiUpdateRef.current = Date.now();

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            downloadedRef.current = 0;
            totalRef.current = event.data.contentLength ?? 0;
            setState((prev) => ({
              ...prev,
              status: "downloading",
              total: totalRef.current,
              progress: 0,
            }));
            break;
          case "Progress": {
            downloadedRef.current += event.data.chunkLength;
            const now = Date.now();
            if (now - lastUiUpdateRef.current > 250) {
              const elapsed = (now - startTimeRef.current) / 1000;
              const speed = elapsed > 0 ? downloadedRef.current / elapsed : 0;
              const total = totalRef.current;
              const progress = total > 0 ? downloadedRef.current / total : 0;
              setState((prev) => ({
                ...prev,
                progress,
                speed,
                downloaded: downloadedRef.current,
              }));
              lastUiUpdateRef.current = now;
            }
            break;
          }
          case "Finished":
            setState((prev) => ({
              ...prev,
              status: "installing",
              progress: 1,
            }));
            break;
        }
      });

      await relaunch();
    } catch (e) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setState((prev) => ({ ...prev, status: "idle" }));
  }, []);

  if (state.status === "idle") return null;

  const pct = Math.round(state.progress * 100);

  return (
    <div className="update-notification">
      <div className="update-box">
        {state.status === "available" && (
          <>
            <div className="update-header">
              <div className="update-icon-wrap">
                <Download size={16} strokeWidth={2} />
              </div>
              <div className="update-title-area">
                <div className="update-title">发现新版本 v{state.version}</div>
                {state.body && (
                  <div className="update-body">{state.body}</div>
                )}
              </div>
              <button className="update-close" onClick={handleDismiss}>
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            <div className="update-actions">
              <button className="btn" onClick={handleDismiss}>
                稍后
              </button>
              <button className="btn btn-primary" onClick={handleUpdate}>
                更新
              </button>
            </div>
          </>
        )}

        {state.status === "downloading" && (
          <>
            <div className="update-header">
              <div className="update-icon-wrap update-icon-spin">
                <Loader2 size={16} strokeWidth={2} />
              </div>
              <div className="update-title-area">
                <div className="update-title">正在下载更新</div>
              </div>
            </div>
            <div className="update-progress">
              <div
                className="update-progress-bar"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="update-progress-info">
              <span>{pct}%</span>
              <span>
                {formatSpeed(state.speed)}
                {state.total > 0 && (
                  <> · {formatBytes(state.downloaded)}/{formatBytes(state.total)}</>
                )}
              </span>
            </div>
          </>
        )}

        {state.status === "installing" && (
          <div className="update-header">
            <div className="update-icon-wrap update-icon-spin">
              <Loader2 size={16} strokeWidth={2} />
            </div>
            <div className="update-title-area">
              <div className="update-title">安装完成，正在重启...</div>
            </div>
          </div>
        )}

        {state.status === "error" && (
          <>
            <div className="update-header">
              <div
                className="update-icon-wrap"
                style={{ background: "rgba(255,69,58,0.12)", color: "#ff453a" }}
              >
                <AlertCircle size={16} strokeWidth={2} />
              </div>
              <div className="update-title-area">
                <div className="update-title">更新失败</div>
                <div className="update-body">{state.error}</div>
              </div>
              <button className="update-close" onClick={handleDismiss}>
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            <div className="update-actions">
              <button className="btn" onClick={handleDismiss}>
                关闭
              </button>
              <button className="btn btn-primary" onClick={handleUpdate}>
                重试
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
