import { useEffect, useRef, useState } from "react";
import {
  IconAdjustmentsFilled,
  IconFolderFilled,
  IconPhotoFilled,
} from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  baseName,
  cancelImageConvert,
  collectImageFiles,
  fetchImageThumbnail,
  formatBytes,
  IMAGE_EXTENSIONS,
  startImageConvert,
  type ConvertEvent,
  type ConvertOptions,
} from "@/lib/image-convert";
import { loadConverterSettings, saveConverterSettings } from "@/lib/config";
import { useDropZone } from "@/hooks/useDropZone";
import { useLanguage } from "@/lib/i18n";
import { showToast } from "@/components/Toast";
import LoadingOverlay from "@/components/LoadingOverlay";
import HelpButton, { ImageConvertTutorial } from "@/components/HelpButton";
import FileList, { type FileItem } from "./FileList";
import OptionsPanel, {
  DEFAULT_SETTINGS,
  type ConverterSettings,
} from "./OptionsPanel";
import ResultTable, {
  type FinishedSummary,
  type ItemResult,
} from "./ResultTable";

/** Thumbnail generation is capped to keep very large drops responsive. */
const THUMBNAIL_LIMIT = 300;

function mergeSettings(saved: Record<string, unknown> | null): ConverterSettings {
  if (!saved) return DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    watermark: {
      ...DEFAULT_SETTINGS.watermark,
      ...(saved.watermark as Partial<ConverterSettings["watermark"]> | undefined),
    },
  } as ConverterSettings;
}

export default function ImageConvertPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<FileItem[]>([]);
  const [settings, setSettings] = useState<ConverterSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<ItemResult[]>([]);
  const [summary, setSummary] = useState<FinishedSummary | null>(null);
  const taskIdRef = useRef<number | null>(null);
  const totalsRef = useRef({ total: 0, done: 0 });
  const pendingThumbsRef = useRef<Set<string>>(new Set());

  // Restore persisted options once on mount.
  useEffect(() => {
    loadConverterSettings().then((saved) => setSettings(mergeSettings(saved)));
  }, []);

  // ── file intake ──────────────────────────────────────────────────────────

  const addPaths = async (paths: string[]) => {
    if (!paths.length) return;
    let expanded: string[] = [];
    try {
      expanded = await collectImageFiles(paths);
    } catch (error) {
      showToast(`${t("imgconv.collectFailed")}: ${error instanceof Error ? error.message : String(error)}`, "error");
      return;
    }
    if (!expanded.length) {
      showToast(t("imgconv.noFiles"), "info");
      return;
    }
    setItems((prev) => {
      const seen = new Set(prev.map((item) => item.path));
      const additions = expanded
        .filter((path) => !seen.has(path))
        .map((path) => ({ path, name: baseName(path), size: null, thumb: "", dims: null }));
      return [...prev, ...additions];
    });
  };

  const handlePickFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
    });
    if (Array.isArray(selected)) await addPaths(selected);
    else if (typeof selected === "string") await addPaths([selected]);
  };

  const handlePickFolder = async () => {
    const selected = await open({ directory: true });
    if (typeof selected === "string") await addPaths([selected]);
  };

  const handleDrop = (paths: string[]) => void addPaths(paths);
  const { dropRef, isDragOver } = useDropZone(handleDrop);

  const removeItem = (path: string) =>
    setItems((prev) => prev.filter((item) => item.path !== path));

  const clearAll = () => {
    setItems([]);
    pendingThumbsRef.current = new Set();
  };

  // ── lazy thumbnails ──────────────────────────────────────────────────────

  useEffect(() => {
    const missing = items
      .filter((item) => !item.thumb && !pendingThumbsRef.current.has(item.path))
      .slice(0, THUMBNAIL_LIMIT);
    if (!missing.length) return;
    let alive = true;
    void (async () => {
      for (const item of missing) {
        if (!alive) return;
        pendingThumbsRef.current.add(item.path);
        try {
          const thumb = await fetchImageThumbnail(item.path, 96);
          if (!alive) return;
          setItems((prev) =>
            prev.map((entry) =>
              entry.path === item.path
                ? {
                    ...entry,
                    thumb: thumb.dataUrl,
                    size: entry.size ?? thumb.fileSize,
                    dims: `${thumb.width}×${thumb.height}`,
                  }
                : entry,
            ),
          );
        } catch {
          if (!alive) return;
          // Empty string marks "failed" so the row keeps a placeholder icon.
          setItems((prev) =>
            prev.map((entry) =>
              entry.path === item.path ? { ...entry, thumb: "" } : entry,
            ),
          );
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [items]);

  // ── conversion ───────────────────────────────────────────────────────────

  const handleEvent = (event: ConvertEvent) => {
    if (event.kind === "started") {
      totalsRef.current = { total: event.total, done: 0 };
      return;
    }
    if (event.kind === "item") {
      totalsRef.current.done += 1;
      const { total, done } = totalsRef.current;
      setResults((prev) => [...prev, event]);
      setProgress(total > 0 ? Math.round((done / total) * 100) : 0);
      setLoadingText(`${t("imgconv.converting")} (${done}/${total})…`);
      return;
    }
    // finished
    setSummary(event);
    setLoading(false);
    setProgress(null);
    if (event.status === "cancelled") {
      showToast(t("imgconv.cancelled"), "info");
    } else if (event.ok === 0 && event.failed === 0) {
      showToast(t("imgconv.noFiles"), "info");
    } else if (event.failed > 0) {
      showToast(t("imgconv.summary", { ok: event.ok, failed: event.failed }), "info");
    } else {
      showToast(t("imgconv.complete", { count: event.ok }), "success");
    }
    if (!event.watermarkApplied && settings.watermarkOn) {
      showToast(t("imgconv.watermarkSkipped"), "info");
    }
  };

  const handleConvert = async () => {
    if (loading || items.length === 0) return;
    void saveConverterSettings(settings as unknown as Record<string, unknown>);
    setResults([]);
    setSummary(null);
    setLoading(true);
    setProgress(0);
    setLoadingText(`${t("imgconv.converting")} (0/${items.length})…`);
    const options: ConvertOptions = {
      files: items.map((item) => item.path),
      mode: settings.mode,
      optimizeLevel: settings.optimizeLevel,
      colors: settings.colors,
      dither: settings.dither,
      outputMode: settings.outputMode,
      customDir: settings.customDir || undefined,
      watermark: settings.watermarkOn ? { ...settings.watermark } : null,
    };
    try {
      taskIdRef.current = await startImageConvert(options, handleEvent);
    } catch (error) {
      setLoading(false);
      setProgress(null);
      showToast(`${t("imgconv.failed")}: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };

  const handleCancel = () => {
    if (taskIdRef.current != null) void cancelImageConvert(taskIdRef.current);
  };

  const totalSize = items.reduce((sum, item) => sum + (item.size ?? 0), 0);

  return (
    <div className="page-shell page-shell--wide unified-page unified-page--image">
      <LoadingOverlay
        visible={loading}
        text={loadingText}
        progress={progress}
        onCancel={handleCancel}
      />

      <div className="panel-header">
        <div className="panel-icon panel-icon--accent">
          <IconPhotoFilled size={18} color="white" stroke={1.75} />
        </div>
        <div className="panel-title">
          <h2>{t("imgconv.title")}</h2>
          <p>{t("imgconv.subtitle")}</p>
        </div>
        <div className="panel-actions">
          <HelpButton>{(close) => <ImageConvertTutorial onClose={close} />}</HelpButton>
        </div>
      </div>

      <div className="card-grid card-grid--2">
        <div className="card">
          <div className="card-title">
            <IconFolderFilled size={15} stroke={1.75} />
            <span>{t("imgconv.files")}</span>
            {items.length > 0 && <span className="imgconv-count">{items.length}</span>}
          </div>
          <div className="card-body">
            <div
              ref={dropRef}
              className={`imgconv-dropzone${isDragOver ? " is-drag" : ""}`}
            >
              {items.length === 0 ? (
                <div className="imgconv-empty">{t("imgconv.dropHint")}</div>
              ) : (
                <FileList items={items} onRemove={removeItem} />
              )}
            </div>
            <div className="btn-row">
              <button className="btn" onClick={handlePickFiles} disabled={loading}>
                {t("imgconv.addFiles")}
              </button>
              <button className="btn" onClick={handlePickFolder} disabled={loading}>
                {t("imgconv.addFolder")}
              </button>
              {items.length > 0 && (
                <button className="btn" onClick={clearAll} disabled={loading}>
                  {t("imgconv.clear")}
                </button>
              )}
            </div>
            {items.length > 0 && (
              <div className="imgconv-total">
                {t("imgconv.fileCount", { count: items.length })}
                {totalSize > 0 && ` · ${formatBytes(totalSize)}`}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <IconAdjustmentsFilled size={15} stroke={1.75} />
            <span>{t("imgconv.options")}</span>
          </div>
          <div className="card-body">
            <OptionsPanel
              settings={settings}
              onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
              onConvert={handleConvert}
              canConvert={items.length > 0}
              loading={loading}
            />
          </div>
        </div>
      </div>

      {summary && <ResultTable results={results} summary={summary} />}
    </div>
  );
}
