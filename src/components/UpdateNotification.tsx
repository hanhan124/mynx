import { useState, useEffect, useRef, useCallback } from "react";
import { type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { Download, X, AlertCircle, Loader2 } from "lucide-react";
import { checkForUpdates, detectPortable, type UpdateInfo } from "@/lib/updater";

/* ---- types ------------------------------------------------------------ */
type NotifStatus = "idle" | "available" | "downloading" | "ready" | "error";

interface NotifState {
  status: NotifStatus;
  version?: string;
  releaseNotes?: string;
  progress: number;   // 0–1
  speed: number;      // bytes/sec
  downloaded: number; // bytes so far
  total: number;      // bytes total
  error?: string;
}

/* ---- global event bus (lightweight) ----------------------------------- */

type NotifListener = (info: UpdateInfo) => void;
let notifListener: NotifListener | null = null;

/** Called by AboutModal to trigger the full update notification flow. */
export function showUpdateNotification(info: UpdateInfo) {
  notifListener?.(info);
}

/* ---- helpers ----------------------------------------------------------- */
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

function toErrorText(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message;
    // Inject user-friendly hints for common failures
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("fetch")) {
      return "网络连接失败，请检查网络后重试";
    }
    if (msg.includes("signature")) {
      return "安装包签名验证失败，请稍后重试";
    }
    if (msg.includes("permission") || msg.includes("denied")) {
      return "权限不足，请以管理员身份运行后重试";
    }
    return msg;
  }
  return String(e);
}

/* ---- component --------------------------------------------------------- */
export default function UpdateNotification() {
  const [state, setState] = useState<NotifState>({
    status: "idle",
    progress: 0,
    speed: 0,
    downloaded: 0,
    total: 0,
  });

  // persist across renders
  const updateRef = useRef<Update | null>(null);
  const portableUrlRef = useRef("");
  const isPortableRef = useRef(false);
  const startTimeRef = useRef(0);
  const downloadedRef = useRef(0);
  const totalRef = useRef(0);
  const lastUiUpdateRef = useRef(0);

  /* ---- show available dialog (called by both auto and manual) ---------- */
  const showAvailable = useCallback((info: UpdateInfo) => {
    portableUrlRef.current = info.portableUrl ?? "";
    updateRef.current = info.installedUpdate ?? null;
    isPortableRef.current = info.isPortable;
    setState({
      status: "available",
      version: info.version,
      releaseNotes: info.body,
      progress: 0,
      speed: 0,
      downloaded: 0,
      total: 0,
    });
  }, []);

  /* ---- auto-check on startup (silent) --------------------------------- */
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const isPortable = await detectPortable();
        isPortableRef.current = isPortable;

        if (isPortable) {
          await invoke("cleanup_update_bak").catch(() => {});
        }

        const result = await checkForUpdates(isPortable);

        if (result.found) {
          showAvailable(result.info);
        }
        // Silent: no toast when already latest
      } catch {
        // silently ignore auto-check failures
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [showAvailable]);

  /* ---- manual trigger listener (called by AboutModal) ----------------- */
  useEffect(() => {
    notifListener = (info: UpdateInfo) => {
      showAvailable(info);
    };
    return () => {
      notifListener = null;
    };
  }, [showAvailable]);

  /* ---- download: common helpers --------------------------------------- */
  const beginDownload = useCallback(() => {
    startTimeRef.current = Date.now();
    downloadedRef.current = 0;
    totalRef.current = 0;
    lastUiUpdateRef.current = Date.now();
    setState((prev) => ({ ...prev, status: "downloading", progress: 0, error: undefined }));
  }, []);

  const updateProgressUi = useCallback((contentLength: number) => {
    const now = Date.now();
    if (now - lastUiUpdateRef.current < 250) return;
    const elapsed = (now - startTimeRef.current) / 1000;
    const speed = elapsed > 0 ? downloadedRef.current / elapsed : 0;
    const progress = contentLength > 0 ? downloadedRef.current / contentLength : 0;
    setState((prev) => ({
      ...prev,
      progress,
      speed,
      downloaded: downloadedRef.current,
      total: contentLength,
    }));
    lastUiUpdateRef.current = now;
  }, []);

  const finishDownload = useCallback(() => {
    setState((prev) => ({
      ...prev,
      status: "ready",
      progress: 1,
      downloaded: downloadedRef.current,
      total: totalRef.current,
    }));
  }, []);

  /* ---- download: installed update -------------------------------------- */
  const handleInstalledUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    beginDownload();

    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        switch (event.event) {
          case "Started":
            totalRef.current = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloadedRef.current += event.data.chunkLength;
            updateProgressUi(totalRef.current);
            break;
          case "Finished":
            finishDownload();
            break;
        }
      });

      await relaunch();
    } catch (e) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: toErrorText(e),
      }));
    }
  }, [beginDownload, updateProgressUi, finishDownload]);

  /* ---- download: portable update --------------------------------------- */
  const handlePortableUpdate = useCallback(async () => {
    const url = portableUrlRef.current;
    if (!url) {
      setState((prev) => ({ ...prev, status: "error", error: "缺少下载地址" }));
      return;
    }

    beginDownload();

    try {
      const { tempDir } = await import("@tauri-apps/api/path");
      const tmpDir = await tempDir();
      const tempExe = `${tmpDir}\\mynx_update_temp.exe`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "安装包尚未就绪，请稍后重试"
            : `下载失败 (${response.status})`,
        );
      }

      const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
      totalRef.current = contentLength;

      const reader = response.body?.getReader();
      if (!reader) throw new Error("无法读取响应数据");

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        downloadedRef.current += value.length;
        updateProgressUi(contentLength);
      }

      // Assemble
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const totalBytes = new Uint8Array(downloadedRef.current);
      let offset = 0;
      for (const chunk of chunks) {
        totalBytes.set(chunk, offset);
        offset += chunk.length;
      }
      await writeFile(tempExe, totalBytes);

      finishDownload();

      // Auto-restart after brief delay so user can see "下载完成"
      setTimeout(async () => {
        try {
          await invoke<undefined>("portable_self_update", { newExePath: tempExe });
        } catch (e) {
          setState((prev) => ({
            ...prev,
            status: "error",
            error: toErrorText(e),
          }));
        }
      }, 1500);
    } catch (e) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: toErrorText(e),
      }));
    }
  }, [beginDownload, updateProgressUi, finishDownload]);

  /* ---- actions --------------------------------------------------------- */
  const handleUpdate = useCallback(async () => {
    if (isPortableRef.current) {
      await handlePortableUpdate();
    } else {
      await handleInstalledUpdate();
    }
  }, [handlePortableUpdate, handleInstalledUpdate]);

  const handleRestart = useCallback(async () => {
    if (isPortableRef.current) {
      // portable: temp file should still be there from download phase
      try {
        const { tempDir } = await import("@tauri-apps/api/path");
        const tmpDir = await tempDir();
        const tempExe = `${tmpDir}\\mynx_update_temp.exe`;
        await invoke("portable_self_update", { newExePath: tempExe });
      } catch (e) {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: toErrorText(e),
        }));
      }
    } else {
      try {
        await relaunch();
      } catch (e) {
        setState((prev) => ({
          ...prev,
          status: "error",
          error: toErrorText(e),
        }));
      }
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setState((prev) => ({ ...prev, status: "idle" }));
  }, []);

  /* ---- render ---------------------------------------------------------- */
  if (state.status === "idle") return null;

  const pct = Math.round(state.progress * 100);

  return (
    <div className="update-notification">
      <div className="update-box">
        {/* ---- Available ---- */}
        {state.status === "available" && (
          <>
            <div className="update-header">
              <div className="update-icon-wrap">
                <Download size={16} strokeWidth={2} />
              </div>
              <div className="update-title-area">
                <div className="update-title">发现新版本 v{state.version}</div>
                {state.releaseNotes && (
                  <div className="update-body">{state.releaseNotes}</div>
                )}
              </div>
              <button className="update-close" onClick={handleDismiss}>
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            <div className="update-actions">
              <button className="btn" onClick={handleDismiss}>
                稍后提示
              </button>
              <button className="btn btn-primary" onClick={handleUpdate}>
                立即更新
              </button>
            </div>
          </>
        )}

        {/* ---- Downloading ---- */}
        {state.status === "downloading" && (
          <>
            <div className="update-header">
              <div className="update-icon-wrap update-icon-spin">
                <Loader2 size={16} strokeWidth={2} />
              </div>
              <div className="update-title-area">
                <div className="update-title">正在下载 v{state.version}</div>
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
                  <> · {formatBytes(state.downloaded)} / {formatBytes(state.total)}</>
                )}
              </span>
            </div>
          </>
        )}

        {/* ---- Download complete ---- */}
        {state.status === "ready" && (
          <>
            <div className="update-header">
              <div
                className="update-icon-wrap"
                style={{ background: "rgba(48,209,88,0.12)", color: "#30d158" }}
              >
                <Download size={16} strokeWidth={2} />
              </div>
              <div className="update-title-area">
                <div className="update-title">下载完成</div>
              </div>
              <button className="update-close" onClick={handleDismiss}>
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            <div className="update-actions">
              <button className="btn" onClick={handleDismiss}>
                稍后
              </button>
              <button className="btn btn-primary" onClick={handleRestart}>
                立即重启
              </button>
            </div>
          </>
        )}

        {/* ---- Error ---- */}
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
                {state.error && <div className="update-body">{state.error}</div>}
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
