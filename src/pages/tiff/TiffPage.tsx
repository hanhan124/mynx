import { useState } from "react";
import { Image, Folder, Settings } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { convertTiff, type TiffOptions } from "@/lib/tiff-convert";
import ConvertOptions from "./ConvertOptions";
import LoadingOverlay from "@/components/LoadingOverlay";
import { showToast } from "@/components/Toast";

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
        showToast(`${result.ok} 个成功，${result.failed} 个失败`, "info");
      } else {
        showToast(`转换完成，${result.ok} 个文件`, "success");
      }
    } catch (e) {
      showToast(`转换失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <LoadingOverlay visible={loading} text="转换中..." />

      <div className="panel-header">
        <div className="panel-icon" style={{ background: '#34c759' }}>
          <Image size={18} color="white" strokeWidth={1.8} />
        </div>
        <div className="panel-title">
          <h2>TIFF 转 JPG</h2>
          <p>批量将 TIFF 转为 JPG</p>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Folder size={14} strokeWidth={1.8} />
          <span>源文件夹</span>
        </div>
        <div className="card-body">
          <div className="file-display">
            <div className="file-icon" style={{ background: '#34c759' }}>
              <Folder size={20} color="white" strokeWidth={1.5} />
            </div>
            <div className="file-info">
              <div className="file-name">{folder ? folder.name : '未选择文件夹'}</div>
              <div className="file-path">{folder ? folder.path : '.tif / .tiff 文件目录'}</div>
            </div>
          </div>
          <button className="btn btn-primary btn-full" onClick={handlePick}>
            {folder ? '更换文件夹' : '选择文件夹'}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <Settings size={14} strokeWidth={1.8} />
          <span>转换选项</span>
        </div>
        <div className="card-body">
          <ConvertOptions onConvert={handleConvert} loading={loading} disabled={!folder} />
        </div>
      </div>
    </div>
  );
}
