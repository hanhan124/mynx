import { IconPhoto, IconX } from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";
import { baseName, formatBytes } from "@/lib/image-convert";

export interface FileItem {
  path: string;
  name: string;
  /** null until the thumbnail request reports the real size. */
  size: number | null;
  /** Base64 data URL; empty string means the thumbnail failed. */
  thumb: string;
  dims: string | null;
}

interface FileListProps {
  items: FileItem[];
  onRemove: (path: string) => void;
}

export default function FileList({ items, onRemove }: FileListProps) {
  const { t } = useLanguage();
  return (
    <div className="imgconv-file-list">
      {items.map((item) => (
        <div key={item.path} className="imgconv-file-row">
          <div className="imgconv-thumb">
            {item.thumb ? (
              <img src={item.thumb} alt="" aria-hidden="true" />
            ) : (
              <IconPhoto size={18} stroke={1.6} />
            )}
          </div>
          <div className="imgconv-file-meta">
            <div className="imgconv-file-name" title={item.path}>
              {baseName(item.name)}
            </div>
            <div className="imgconv-file-sub">
              {[item.dims, item.size != null ? formatBytes(item.size) : null]
                .filter(Boolean)
                .join(" · ") || item.path}
            </div>
          </div>
          <button
            type="button"
            className="imgconv-file-remove"
            onClick={() => onRemove(item.path)}
            aria-label={t("imgconv.removeFile")}
            title={t("imgconv.removeFile")}
          >
            <IconX size={12} stroke={1.75} />
          </button>
        </div>
      ))}
    </div>
  );
}
