import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertTiff, type TiffOptions } from "../../lib/tiff-convert";
import ConvertOptions from "./ConvertOptions";
import { FolderOpen, Folder } from "lucide-react";
import { showToast } from "../../components/Toast";

export default function TiffPage() {
  const [folder, setFolder] = useState<{ name: string; path: string } | null>(null);
  const [loading, setLoading] = useState(false);

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
    try {
      const result = await convertTiff(folder.path, options);
      if (result.failed > 0) {
        showToast(`转换完成: ${result.ok} 成功, ${result.failed} 失败`, "info");
      } else {
        showToast(`全部转换成功: ${result.ok} 个文件`, "success");
      }
    } catch (e) {
      showToast(`转换失败: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="tiff-page">
      {!folder ? (
        <div className="tiff-empty">
          <button className="pick-folder-btn" onClick={handlePick}>
            <span className="pick-folder-icon"><FolderOpen size={20} strokeWidth={1.5} /></span>
            <span>选择包含 TIFF 文件的文件夹</span>
          </button>
        </div>
      ) : (
        <>
          <div className="folder-card">
            <span className="folder-card-icon"><Folder size={24} strokeWidth={1.5} /></span>
            <div className="folder-card-info">
              <span className="folder-card-name">{folder.name}</span>
              <span className="folder-card-path">{folder.path}</span>
            </div>
            <button className="folder-card-change" onClick={handlePick}>更换</button>
          </div>
          <ConvertOptions onConvert={handleConvert} loading={loading} />
        </>
      )}
    </div>
  );
}
