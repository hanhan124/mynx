import { useState } from "react";
import { IconPhotoFilled, IconFolderFilled, IconAdjustmentsFilled } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertTiff, type TiffOptions } from "@/lib/tiff-convert";
import ConvertOptions from "./ConvertOptions";
import LoadingOverlay from "@/components/LoadingOverlay";
import HelpButton, { TiffTutorial } from "@/components/HelpButton";
import { showToast } from "@/components/Toast";
import { useDropZone } from "@/hooks/useDropZone";
import { useLanguage } from "@/lib/i18n";

export default function TiffPage() {
  const { t } = useLanguage();
  const [folder, setFolder] = useState<{ name: string; path: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState(t("tiff.converting"));
  const [progress, setProgress] = useState<number | null>(null);

  const handlePick = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      const parts = selected.replace(/\\/g, "/").split("/");
      const name = parts[parts.length - 1] || selected;
      setFolder({ name, path: selected });
    }
  };

  const handleConvert = async (options: TiffOptions) => {
    if (!folder) return;
    setLoading(true);
    setProgress(0);
    setLoadingText(t("tiff.prepare"));
    try {
      const result = await convertTiff(folder.path, options, (current, total) => {
        setProgress(total > 0 ? Math.round((current / total) * 100) : 0);
        setLoadingText(`${t("tiff.converting")} (${current}/${total})...`);
      });
      setProgress(100);
      if (result.failed < 0) {
        showToast(t("tiff.failed"), "error");
      } else if (result.ok === 0 && result.failed === 0) {
        showToast(t("tiff.noFiles"), "info");
      } else if (result.failed > 0) {
        showToast(t("tiff.summary", { ok: result.ok, failed: result.failed }), "info");
      } else {
        showToast(t("tiff.complete", { count: result.ok }), "success");
      }
      if (result.watermarkSkipped) {
        showToast(t("tiff.watermarkSkipped"), "info");
      }
    } catch (e) {
      showToast(`${t("tiff.failed")}: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const handleDrop = (paths: string[]) => {
    const droppedPath = paths[0];
    if (!droppedPath) return;
    const parts = droppedPath.replace(/\\/g, "/").split("/");
    const name = parts[parts.length - 1] || droppedPath;
    setFolder({ name, path: droppedPath });
  };

  const { dropRef, isDragOver } = useDropZone(handleDrop);

  return (
    <div className="page-shell page-shell--wide unified-page unified-page--tiff">
      <LoadingOverlay visible={loading} text={loadingText} progress={progress} />

      <div className="panel-header">
        <div className="panel-icon" style={{ background: '#34c759' }}>
          <IconPhotoFilled size={18} color="white" stroke={1.75} />
        </div>
        <div className="panel-title">
        <h2>{t("tiff.title")}</h2>
          <p>{t("tiff.subtitle")}</p>
        </div>
        <div className="panel-actions">
          <HelpButton>{(close) => <TiffTutorial onClose={close} />}</HelpButton>
        </div>
      </div>

      {/* 宽屏: 源文件夹 + 转换选项 左右并排; 窄屏自动回退单列堆叠 */}
      <div className="card-grid card-grid--2">
        <div className="card">
          <div className="card-title">
            <IconFolderFilled size={14} stroke={1.75} />
            <span>{t("tiff.source")}</span>
          </div>
          <div className="card-body">
            <div
              ref={dropRef}
              className={`file-display${isDragOver ? ' file-display--drag' : ''}`}
            >
              <div className="file-icon" style={{ background: '#34c759' }}>
                <IconFolderFilled size={20} color="white" stroke={1.75} />
              </div>
              <div className="file-info">
                <div className="file-name">{folder ? folder.name : t("tiff.noFolder")}</div>
                <div className="file-path">{folder ? folder.path : t("tiff.folderHint")}</div>
              </div>
              {isDragOver && <span className="drop-hint">{t("tiff.drop")}</span>}
            </div>
            <button className="btn btn-primary btn-full" onClick={handlePick}>
              {folder ? t("tiff.changeFolder") : t("tiff.chooseFolder")}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">
            <IconAdjustmentsFilled size={14} stroke={1.75} />
            <span>{t("tiff.options")}</span>
          </div>
          <div className="card-body">
            <ConvertOptions onConvert={handleConvert} loading={loading} disabled={!folder} />
          </div>
        </div>
      </div>
    </div>
  );
}
