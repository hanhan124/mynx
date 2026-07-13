import { useState } from "react";
import { IconPhoto, IconFolder, IconSettings } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertTiff, type TiffOptions } from "@/lib/tiff-convert";
import ConvertOptions from "./ConvertOptions";
import LoadingOverlay from "@/components/LoadingOverlay";
import { showToast } from "@/components/Toast";
import { useDropZone } from "@/hooks/useDropZone";

export default function TiffPage() {
  const [folder, setFolder] = useState<{ name: string; path: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("转换中...");
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
    setLoadingText("准备转换...");
    try {
      const result = await convertTiff(folder.path, options, (current, total) => {
        setProgress(total > 0 ? Math.round((current / total) * 100) : 0);
        setLoadingText(`正在转换 (${current}/${total})...`);
      });
      setProgress(100);
      if (result.failed < 0) {
        showToast(`转换失败，请重试`, "error");
      } else if (result.ok === 0 && result.failed === 0) {
        showToast(`未找到 TIFF 文件`, "info");
      } else if (result.failed > 0) {
        showToast(`${result.ok} 个成功，${result.failed} 个失败`, "info");
      } else {
        showToast(`转换完成，${result.ok} 个文件`, "success");
      }
      if (result.watermarkSkipped) {
        showToast(`水印需要 ImageMagick（brew install imagemagick），已跳过水印`, "info");
      }
    } catch (e) {
      showToast(`转换失败：${e instanceof Error ? e.message : String(e)}`, "error");
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
    <div className="page-shell">
      <LoadingOverlay visible={loading} text={loadingText} progress={progress} />

      <div className="panel-header">
        <div className="panel-icon" style={{ background: '#34c759' }}>
          <IconPhoto size={18} color="white" stroke={2} />
        </div>
        <div className="panel-title">
          <h2>TIFF 转 JPG</h2>
          <p>批量将 TIFF 转为 JPG</p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <IconFolder size={14} stroke={2} />
          <span>源文件夹</span>
        </div>
        <div className="card-body">
          <div
            ref={dropRef}
            className={`file-display${isDragOver ? ' file-display--drag' : ''}`}
          >
            <div className="file-icon" style={{ background: '#34c759' }}>
              <IconFolder size={20} color="white" stroke={1.5} />
            </div>
            <div className="file-info">
              <div className="file-name">{folder ? folder.name : '未选择文件夹'}</div>
              <div className="file-path">{folder ? folder.path : '.tif / .tiff 文件目录'}</div>
            </div>
            {isDragOver && <span className="drop-hint">释放以导入</span>}
          </div>
          <button className="btn btn-primary btn-full" onClick={handlePick}>
            {folder ? '更换文件夹' : '选择文件夹'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <IconSettings size={14} stroke={2} />
          <span>转换选项</span>
        </div>
        <div className="card-body">
          <ConvertOptions onConvert={handleConvert} loading={loading} disabled={!folder} />
        </div>
      </div>
    </div>
  );
}
