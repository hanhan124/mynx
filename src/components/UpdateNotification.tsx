import { useState, useEffect, useRef, useCallback } from "react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
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

const UPDATE_ENDPOINT = "https://github.com/hanhan124/mynx/releases/latest/download/latest.json";

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

interface LatestJson {
  version: string;
  date?: string;
  notes?: string;
  body?: string;
  downloads: Array<{
    name?: string;
    signature: string;
    url: string;
    size?: number;
  }>;
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
  const isPortableRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        // Check if running as portable
        try {
          isPortableRef.current = await invoke<boolean>("is_portable");
        } catch {
          isPortableRef.current = false;
        }

        if (isPortableRef.current) {
          // Portable: use custom update check
          await handlePortableCheck();
        } else {
          // Installed: use Tauri's built-in updater
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
        }
      } catch {
        // 静默失败
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  const handlePortableCheck = async () => {
    try {
      const resp = await fetch(UPDATE_ENDPOINT);
      if (!resp.ok) return;
      
      const latest: LatestJson = await resp.json();
      
      // Simple version comparison
      if (compareVersions(latest.version, "1.8.0") <= 0) return;
      
      setState((prev) => ({
        ...prev,
        status: "available",
        version: latest.version,
        body: latest.body || latest.notes,
      }));
    } catch {
      // 静默失败
    }
  };

  function compareVersions(a: string, b: string): number {
    const aParts = a.replace(/^v/, '').split('.').map(Number);
    const bParts = b.replace(/^v/, '').split('.').map(Number);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }
    return 0;
  }

  const handleUpdate = useCallback(async () => {
    if (isPortableRef.current) {
      await handlePortableUpdate();
    } else {
      await handleInstalledUpdate();
    }
  }, []);

  const handleInstalledUpdate = async () => {
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
  };

  const handlePortableUpdate = async () => {
    try {
      const resp = await fetch(UPDATE_ENDPOINT);
      if (!resp.ok) {
        throw new Error("Failed to fetch update info");
      }
      
      const latest: LatestJson = await resp.json();
      
      // Find the portable download entry
      const portableDownload = latest.downloads.find(d => 
        d.name && d.name.includes("portable")
      );
      
      if (!portableDownload) {
        throw new Error("No portable update available");
      }

      setState((prev) => ({ ...prev, status: "downloading", progress: 0 }));

      // Download using curl via Tauri shell
      const exePath = await invoke<string>("app_exe_path");
      const { os } = await import("@tauri-apps/plugin-os");
      const tempDir = os.tmpdir();
      const tempExe = tempDir + "\mynx_update_temp.exe";
      
      const { spawn } = await import("@tauri-apps/plugin-shell");
      const { writeBinaryFile } = await import("@tauri-apps/plugin-fs");
      
      // Download the portable exe
      const downloader = spawn("curl", [
        "-f",
        "-L",
        "-o", tempExe,
        portableDownload.url,
      ]);
      
      // Wait for download
      await downloader;

      // Create a batch script to replace the exe and relaunch
      const escapedExePath = exePath.replace(/\\/g, "\\\\");
      const escapedTempExe = tempExe.replace(/\\/g, "\\\\");
      
      const batchContent = `@echo off
timeout /t 1 /nobreak > nul
taskkill /F /IM mynx.exe 2>nul
timeout /t 1 /nobreak > nul
del "${escapedExePath}" 2>nul
move /y "${escapedTempExe}" "${escapedExePath}" > nul
start "" "${escapedExePath}"
exit
`;
      
      const batchPath = tempDir + "\mynx_update_helper.bat";
      await writeBinaryFile(batchPath, new TextEncoder().encode(batchContent));
      
      // Launch the batch script and exit the app
      const batchShell = await spawn("cmd", ["/c", batchPath]);
      await batchShell;
      
      // Exit the current process using Tauri process plugin
      await invoke<void>("terminate");
    } catch (e) {
      setState((prev) => ({
        ...prev,
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  };

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
