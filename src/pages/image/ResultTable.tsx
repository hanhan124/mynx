import { IconFolderOpen } from "@tabler/icons-react";
import { open as openInBrowser } from "@tauri-apps/plugin-shell";
import { useLanguage } from "@/lib/i18n";
import { baseName, formatBytes, type ConvertEvent } from "@/lib/image-convert";

export type ItemResult = Extract<ConvertEvent, { kind: "item" }>;
export type FinishedSummary = Extract<ConvertEvent, { kind: "finished" }>;

interface ResultTableProps {
  results: ItemResult[];
  summary: FinishedSummary;
}

function ratioLabel(item: ItemResult): string {
  if (item.status !== "ok" || item.originalBytes <= 0 || item.outputBytes <= 0) return "—";
  const saved = Math.round((1 - item.outputBytes / item.originalBytes) * 100);
  if (saved > 0) return `-${saved}%`;
  if (saved === 0) return "0%";
  return `+${-saved}%`;
}

export default function ResultTable({ results, summary }: ResultTableProps) {
  const { t } = useLanguage();
  const firstOutput = results.find((r) => r.status === "ok")?.outputs[0];
  const totalSaved =
    summary.totalInput > 0 && summary.totalOutput > 0
      ? Math.round((1 - summary.totalOutput / summary.totalInput) * 100)
      : 0;

  const openOutputFolder = async () => {
    if (!firstOutput) return;
    const dir = firstOutput.replace(/[\\/][^\\/]+$/, "");
    try {
      await openInBrowser(dir);
    } catch {
      /* best-effort only */
    }
  };

  return (
    <div className="card imgconv-result">
      <div className="card-title">
        <span>{t("imgconv.result")}</span>
        <div className="imgconv-result-actions">
          {firstOutput && (
            <button type="button" className="btn" onClick={openOutputFolder}>
              <IconFolderOpen size={14} stroke={1.75} />
              {t("imgconv.openFolder")}
            </button>
          )}
        </div>
      </div>
      <div className="card-body">
        <div className="imgconv-table-wrap">
          <table className="imgconv-table">
            <thead>
              <tr>
                <th>{t("imgconv.colFile")}</th>
                <th>{t("imgconv.colOriginal")}</th>
                <th>{t("imgconv.colOutput")}</th>
                <th>{t("imgconv.colRatio")}</th>
                <th>{t("imgconv.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((item) => (
                <tr
                  key={`${item.index}-${item.source}`}
                  className={item.status === "failed" ? "is-failed" : ""}
                >
                  <td className="imgconv-col-file" title={item.source}>
                    {baseName(item.source)}
                    {item.outputs.length > 1 && (
                      <span className="imgconv-pages"> · {t("imgconv.pages", { count: item.outputs.length })}</span>
                    )}
                  </td>
                  <td>{formatBytes(item.originalBytes)}</td>
                  <td>{item.status === "ok" ? formatBytes(item.outputBytes) : "—"}</td>
                  <td>{ratioLabel(item)}</td>
                  <td>
                    {item.status === "ok" ? (
                      <span className="imgconv-status-ok">{t("imgconv.ok")}</span>
                    ) : (
                      <span className="imgconv-status-failed" title={item.error ?? undefined}>
                        {t("imgconv.failed")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="imgconv-summary">
          <span>
            {t("imgconv.summary", { ok: summary.ok, failed: summary.failed })}
            {summary.status === "cancelled" && ` · ${t("imgconv.cancelled")}`}
          </span>
          {totalSaved > 0 && (
            <strong>{t("imgconv.saved", { percent: totalSaved })}</strong>
          )}
        </div>
      </div>
    </div>
  );
}
