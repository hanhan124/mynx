/**
 * 步骤 1:数据导入 — Counts 文件 + 样本显示名 + 输出目录。
 * 导入只做列选择与规范化缓存,重复基因/取整等数据清洗全部由 R 端引擎
 * (参考脚本)按 input 配置处理。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  IconFileImport,
  IconFolderOpen,
  IconTable,
  IconTag,
  IconDatabase,
} from "@tabler/icons-react";
import { showToast } from "@/components/Toast";
import { useRnaSeq } from "./store";
import { useDropZone } from "@/hooks/useDropZone";
import { importPage } from "@/lib/rnaseq/matrix";
import { openInShell } from "@/lib/rnaseq/io";
import type { MatrixFormat, PageData } from "@/lib/rnaseq/types";
import { useLanguage } from "@/lib/i18n";

const FMT_CARDS: { id: MatrixFormat; zh: string; en: string; subZh: string; subEn: string }[] = [
  {
    id: "counts_matrix",
    zh: "标准计数矩阵",
    en: "Counts matrix",
    subZh: "第 1 列基因,其余列为样本",
    subEn: "Column 1 = gene, rest = samples",
  },
  {
    id: "featurecounts",
    zh: "featureCounts",
    en: "featureCounts",
    subZh: "自动丢弃 Chr/Start/Length 等注释列",
    subEn: "Drops annotation columns",
  },
  {
    id: "htseq",
    zh: "HTSeq 合并表",
    en: "HTSeq merged",
    subZh: "过滤 __no_feature 等汇总行",
    subEn: "Filters __ summary rows",
  },
];

export default function ImportStep() {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const st = useRnaSeq();
  const cfg = st.config;

  const pickFile = async () => {
    const picked = await open({
      multiple: false,
      title: l("选择 Counts 数据文件", "Select counts file"),
      filters: [
        { name: l("计数矩阵", "Count matrix"), extensions: ["csv", "tsv", "txt", "xlsx"] },
      ],
    });
    if (!picked) return;
    const p = Array.isArray(picked) ? picked[0] : picked;
    try {
      await st.doImport(p);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const onDrop = useCallback(
    (paths: string[]) => {
      if (!paths.length) return;
      void st
        .doImport(paths[0])
        .catch((e: unknown) =>
          showToast(e instanceof Error ? e.message : String(e), "error"),
        );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [st.matrixFormat],
  );
  const { dropRef, isDragOver } = useDropZone(onDrop);

  const pickDir = async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: l("选择输出根目录", "Select output root"),
      defaultPath: cfg.output_dir || undefined,
    });
    if (!picked) return;
    const p = Array.isArray(picked) ? picked[0] : picked;
    st.updateConfig((d) => {
      d.output_dir = p;
    });
  };

  const sampleCols = st.importData?.sample_cols ?? [];

  return (
    <div className="rx-step">
      {/* ── Counts 数据文件 ── */}
      <section className="card">
        <div className="card-title">
          <IconFileImport size={15} stroke={1.75} />
          <span>{l("Counts 数据文件", "Counts data file")}</span>
        </div>
        <div className="card-body">
          {!st.importData ? (
            <div
              ref={dropRef}
              className={`rx-drop-hero${isDragOver ? " drag" : ""}`}
              role="button"
              onClick={() => void pickFile()}
            >
              <div className="rx-drop-hero-icon">
                <IconTable size={26} stroke={1.5} />
              </div>
              <strong>{l("点击选择或拖入 Counts 文件", "Click or drop a counts file here")}</strong>
              <span className="rx-drop-hero-sub">
                {l("支持 .csv / .tsv / .txt / .xlsx;第 1 列为基因名,其余列为各样本的原始计数", "First column = gene name, others = raw counts per sample")}
              </span>
              <span className="drop-hint">
                {l("务必使用原始整数 Counts,不要用 TPM / FPKM", "Raw integer counts only — not TPM/FPKM")}
              </span>
            </div>
          ) : (
            <div className="file-display">
              <div className="file-icon file-icon--purple">
                <IconTable size={18} stroke={1.75} />
              </div>
              <div className="file-info">
                <div className="file-name">{st.importSourcePath.split(/[\\/]/).pop()}</div>
                <div className="file-path">{st.importSourcePath}</div>
              </div>
              <button type="button" className="btn" onClick={() => void pickFile()}>
                {l("更换文件", "Replace")}
              </button>
            </div>
          )}

          {/* 矩阵格式预设 */}
          <div className="rx-fmt-cards" role="radiogroup">
            {FMT_CARDS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={st.matrixFormat === f.id}
                className={`rx-fmt-card${st.matrixFormat === f.id ? " active" : ""}`}
                onClick={async () => {
                  st.setMatrixFormat(f.id);
                  if (st.importSourcePath) {
                    try {
                      await st.doImport(st.importSourcePath, f.id);
                    } catch (e) {
                      showToast(e instanceof Error ? e.message : String(e), "error");
                    }
                  }
                }}
              >
                <span className="rx-fmt-card-check" />
                <span className="rx-fmt-card-name">{l(f.zh, f.en)}</span>
                <span className="rx-fmt-card-sub">{l(f.subZh, f.subEn)}</span>
              </button>
            ))}
          </div>

          {st.importData && (
            <>
              <div className="rx-dims">
                <span className="rx-dim-chip">
                  {l("基因行", "Genes")}: {st.importData.total_genes.toLocaleString()}
                </span>
                <span className="rx-dim-chip">
                  {l("样本列", "Samples")}: {sampleCols.length}
                </span>
                <span className="rx-dim-chip rx-dim-chip--fmt">
                  {st.importData.matrix_format_applied === "featurecounts"
                    ? "featureCounts"
                    : st.importData.matrix_format_applied === "htseq"
                      ? "HTSeq"
                      : l("标准矩阵", "matrix")}
                </span>
                {st.importData.converted && (
                  <span className="rx-dim-chip" title={st.config.data_file}>
                    {l("已规范化缓存", "normalized cache")}
                  </span>
                )}
              </div>
              {st.importData.warnings && st.importData.warnings.length > 0 && (
                <div className="rx-warn-list">
                  {st.importData.warnings.map((w, i) => (
                    <div key={i} className="rx-alert rx-alert--warn">
                      {w}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <details className="rx-import-advanced">
            <summary>{l("手动输入文件路径", "Enter file path manually")}</summary>
            <div className="rx-path-row">
              <input
                className="rx-path-input"
                value={st.importSourcePath}
                placeholder="D:\data\gene.counts.csv"
                readOnly
              />
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const picked = await open({ multiple: false });
                  if (!picked) return;
                  const p = Array.isArray(picked) ? picked[0] : picked;
                  try {
                    await st.doImport(p);
                  } catch (e) {
                    showToast(e instanceof Error ? e.message : String(e), "error");
                  }
                }}
              >
                <IconFolderOpen size={13} stroke={1.75} />
              </button>
            </div>
          </details>
        </div>
      </section>

      {/* ── 样本显示名 ── */}
      {sampleCols.length > 0 && (
        <section className="card">
          <div className="card-title">
            <IconTag size={15} stroke={1.75} />
            <span>{l("样本显示名", "Sample display names")}</span>
            <span className="rx-title-actions">
              <span style={{ fontSize: 12, color: "var(--text-3, #888)" }}>
                {l("留空 = 使用原始列名;用于热图横轴、样本相关性图与 PCA 点标签", "Blank = keep column names; used on heatmaps, correlation and PCA")}
              </span>
            </span>
          </div>
          <div className="card-body">
            <div className="rx-param-grid">
              {sampleCols.map((s) => (
                <label key={s} className="rx-field">
                  <span className="rx-field-label">{s}</span>
                  <input
                    type="text"
                    value={cfg.sample_labels[s] ?? ""}
                    placeholder={s}
                    onChange={(e) => {
                      const v = e.target.value;
                      st.updateConfig((d) => {
                        if (v) d.sample_labels[s] = v;
                        else delete d.sample_labels[s];
                      });
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 输出设置 ── */}
      <details className="card rx-output-details">
        <summary className="card-title">
          <IconDatabase size={15} stroke={1.75} />
          <span>{l("输出目录与运行名", "Output directory & run name")}</span>
        </summary>
        <div className="card-body">
          <div className="form-group">
            <label>{l("输出根目录", "Output root")}</label>
            <div className="rx-path-row">
              <input
                className="rx-path-input"
                value={cfg.output_dir}
                readOnly
                placeholder={l("默认:~/Mynx/rnaseq_runs", "Default: ~/Mynx/rnaseq_runs")}
              />
              <button type="button" className="btn" onClick={() => void pickDir()}>
                <IconFolderOpen size={13} stroke={1.75} />
              </button>
            </div>
          </div>
          <div className="form-group">
            <label>{l("运行名(auto = 时间戳)", "Run name (auto = timestamp)")}</label>
            <input
              type="text"
              value={cfg.run_name}
              onChange={(e) =>
                st.updateConfig((d) => {
                  d.run_name = e.target.value;
                })
              }
              placeholder="auto"
            />
          </div>
          {cfg.output_dir && (
            <button type="button" className="btn" onClick={() => void openInShell(cfg.output_dir)}>
              <IconFolderOpen size={13} stroke={1.75} /> {l("打开目录", "Open folder")}
            </button>
          )}
        </div>
      </details>

      {/* ── 数据预览 ── */}
      <PreviewCard />
    </div>
  );
}

/** 数据预览:分页表格(导入后可用) */
function PreviewCard() {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const st = useRnaSeq();
  const dataFile = st.config.data_file;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState("");
  const reqSeq = useRef(0);

  useEffect(() => {
    if (!dataFile) return;
    const id = ++reqSeq.current;
    importPage(dataFile, page, 8, "")
      .then((r) => {
        if (reqSeq.current === id) {
          setData(r);
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (reqSeq.current === id)
          setError(e instanceof Error ? e.message : String(e));
      });
  }, [dataFile, page]);

  if (!dataFile) return null;
  return (
    <section className="card">
      <div className="card-title">
        <IconTable size={15} stroke={1.75} />
        <span>{l("数据预览", "Data preview")}</span>
      </div>
      <div className="card-body">
        {error ? (
          <div className="rx-alert rx-alert--error">{error}</div>
        ) : data ? (
          <>
            <div className="rx-table-wrap">
              <table className="rx-table">
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((row, i) => (
                    <tr key={i}>
                      {data.columns.map((c) => (
                        <td key={c}>{String(row[c] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rx-pager">
              <button
                type="button"
                className="btn rx-pager-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹
              </button>
              <span className="rx-pager-info">
                {data.page} / {data.total_pages} · {data.total.toLocaleString()} {l("行", "rows")}
              </span>
              <button
                type="button"
                className="btn rx-pager-btn"
                disabled={page >= data.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                ›
              </button>
            </div>
          </>
        ) : (
          <div className="rx-loading">{l("加载中…", "Loading…")}</div>
        )}
      </div>
    </section>
  );
}
