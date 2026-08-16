/**
 * 步骤 1:数据导入 — Counts 文件选择/拖拽/粘贴、矩阵预设、
 * 数据摘要与质量检查、输出目录与运行名、分页预览。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  IconFileSpreadsheet,
  IconFileText,
  IconRefresh,
  IconSearch,
  IconChevronDown,
  IconFolderOpen,
  IconUpload,
  IconCheck,
} from "@tabler/icons-react";
import { showToast } from "@/components/Toast";
import { useDropZone } from "@/hooks/useDropZone";
import { useRnaSeq } from "./store";
import { importPage } from "@/lib/rnaseq/matrix";
import { pathDir } from "@/lib/rnaseq/io";
import type { PageData } from "@/lib/rnaseq/types";

const MATRIX_FORMAT_LABELS: Record<string, string> = {
  counts_matrix: "标准 Counts 矩阵",
  featurecounts: "featureCounts",
  htseq: "HTSeq",
};

/* ── 矩阵格式引导:每种预设的适用场景、数据样例与自动处理 ── */
interface FmtGuide {
  id: string;
  label: string;
  sub: string;
  when: string;
  /** 示例表列;dropped = 展示但会被自动丢弃 */
  cols: { name: string; dropped?: boolean }[];
  rows: { cells: string[]; dropped?: boolean }[];
  points: string[];
}
const FORMAT_GUIDES: FmtGuide[] = [
  {
    id: "counts_matrix",
    label: "标准 Counts 矩阵",
    sub: "基因 × 样本计数表 · 最常见",
    when: "第 1 列是基因名,后面每列一个样本、每行一个基因的整数计数 —— R/Python 整理好的矩阵、GEO 下载的 counts、上游流程的最终输出都是这种。",
    cols: [
      { name: "gene" },
      { name: "WT_1" },
      { name: "WT_2" },
      { name: "KO_1" },
      { name: "KO_2" },
    ],
    rows: [
      { cells: ["GAPDH", "1204", "1188", "1102", "1096"] },
      { cells: ["TP53", "89", "95", "210", "198"] },
      { cells: ["IL6", "12", "9", "203", "187"] },
    ],
    points: [
      "单元格是整数计数(比对到基因的 reads 数),不能是 TPM/FPKM/百分比",
      "基因名重复会自动求和合并(DESeq2 推荐做法)",
      "列名即样本名,建议带分组前缀(如 WT_1、KO_1),后面可一键自动分组",
    ],
  },
  {
    id: "featurecounts",
    label: "featureCounts 输出",
    sub: "含注释列 · 免手工删列",
    when: "subread/featureCounts 的直接输出(第 1 列 Geneid,后跟 Chr/Start/End/Strand/Length 等注释列,再是各样本计数列)—— 不用自己删列,选它即可。",
    cols: [
      { name: "Geneid" },
      { name: "Chr", dropped: true },
      { name: "Start", dropped: true },
      { name: "End", dropped: true },
      { name: "Strand", dropped: true },
      { name: "Length", dropped: true },
      { name: "WT_1.counts" },
      { name: "KO_1.counts" },
    ],
    rows: [
      {
        cells: ["GAPDH", "chr12", "6638037", "6638723", "+", "1244", "1204", "1102"],
      },
      { cells: ["TP53", "chr17", "7676594", "7676854", "-", "1176", "89", "210"] },
    ],
    points: [
      "自动识别并丢弃 Chr / Start / End / Strand / Length 等注释列",
      "保留 Geneid 与全部样本计数列,样本名自动去掉 .counts 后缀",
      "基因名重复自动求和合并",
    ],
  },
  {
    id: "htseq",
    label: "HTSeq 合并矩阵",
    sub: "含 __ 统计行 · 自动过滤",
    when: "多个 htseq-count 输出按样本合并的矩阵(第 1 列基因名,后续每列一个样本)—— 文件底部那批 __no_feature 等统计行不用删,会自动过滤。",
    cols: [{ name: "gene" }, { name: "WT_1" }, { name: "WT_2" }, { name: "KO_1" }],
    rows: [
      { cells: ["GAPDH", "1204", "1188", "1102"] },
      { cells: ["TP53", "89", "95", "210"] },
      { cells: ["__no_feature", "8123", "7990", "8055"], dropped: true },
      { cells: ["__alignment_not_unique", "52031", "50120", "51402"], dropped: true },
    ],
    points: [
      '自动过滤 __ 开头的统计行(no_feature / alignment_not_unique 等)',
      "其余同标准矩阵:整数计数、重复基因名自动合并",
      "若已是清理过的 HTSeq 矩阵,选「标准 Counts 矩阵」即可",
    ],
  },
];

const RUN_NAME_BAD = /[\\/:*?"<>|]/g;

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    return v % 1 === 0 ? v.toLocaleString() : v.toFixed(2);
  }
  return String(v);
}

export default function ImportStep() {
  const st = useRnaSeq();
  const {
    config,
    updateConfig,
    importData,
    importSourcePath,
    matrixFormat,
    setMatrixFormat,
    doImport,
    clearDownstream,
  } = st;

  const [displayPath, setDisplayPath] = useState(importSourcePath || config.data_file);
  const [loading, setLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [pageData, setPageData] = useState<PageData | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [countPanelOpen, setCountPanelOpen] = useState(false);

  useEffect(() => {
    // 外部状态(store)变化后同步本地输入框
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayPath(importSourcePath || config.data_file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importSourcePath]);

  // 请求序号守卫:只采纳最新一次分页结果
  const pageReqSeq = useRef(0);
  const loadPage = useCallback(async () => {
    const dataFile = config.data_file;
    if (!dataFile) return;
    const seq = ++pageReqSeq.current;
    setLoading(true);
    try {
      const r = await importPage(dataFile, currentPage, pageSize, searchInput);
      if (seq !== pageReqSeq.current) return;
      setPageData(r);
      if (sortCol !== null && r.data.length > 0) {
        const colName = r.columns[sortCol];
        r.data.sort((a, b) => {
          const va = a[colName];
          const vb = b[colName];
          if (typeof va === "number" && typeof vb === "number") {
            return sortAsc ? va - vb : vb - va;
          }
          return sortAsc
            ? String(va).localeCompare(String(vb))
            : String(vb).localeCompare(String(va));
        });
      }
    } catch (e) {
      showToast(`读取失败:${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      if (seq === pageReqSeq.current) setLoading(false);
    }
  }, [config.data_file, currentPage, pageSize, searchInput, sortCol, sortAsc]);

  // 首次导入/换文件后加载完整分页
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (importData) void loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importData]);

  // 搜索防抖 300ms
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSearch = (v: string) => {
    setSearchInput(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setCurrentPage(1);
      void loadPage();
    }, 300);
  };

  const seedPreview = useCallback(() => {
    const d = st.importData;
    if (!d) return;
    setPageData({
      columns: d.preview_columns?.length
        ? d.preview_columns
        : [d.gene_col, ...d.sample_cols],
      data: d.preview,
      page: 1,
      page_size: pageSize,
      total: d.total_genes,
      total_pages: Math.max(1, Math.ceil(d.total_genes / pageSize)),
    });
  }, [st.importData, pageSize]);

  const doImportPath = useCallback(
    async (path?: string, force = false) => {
      const target = (path ?? displayPath)?.trim();
      if (!target) {
        showToast("请先选择文件", "info");
        return;
      }
      if (!force && target === importSourcePath && importData) {
        seedPreview();
        await loadPage();
        return;
      }
      // 换文件且已有下游设置 → 确认后清空
      const prev = importSourcePath || config.data_file;
      if (prev && prev !== target && Object.keys(config.groups).length > 0) {
        const ok = await ask(
          "切换数据文件将清空当前的分组、比较与绘图自定义设置(实验设计需重新配置)。继续?",
          { title: "切换数据文件", kind: "warning" },
        );
        if (!ok) return;
      }
      setLoading(true);
      setImportError("");
      try {
        const r = await doImport(target, matrixFormat);
        const prev2 = importSourcePath || config.data_file;
        if (prev2 && prev2 !== target) clearDownstream();
        setCurrentPage(1);
        setSearchInput("");
        setSortCol(null);
        seedPreview();
        showToast(
          `导入成功:${r.sample_cols.length} 个样本,${r.total_genes.toLocaleString()} 个基因`,
          "success",
        );
        await loadPage();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setImportError(msg);
        showToast(`导入失败:${msg}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [
      displayPath,
      importSourcePath,
      importData,
      config.data_file,
      config.groups,
      doImport,
      matrixFormat,
      clearDownstream,
      seedPreview,
      loadPage,
    ],
  );

  // 拖拽导入
  const onDrop = useCallback(
    (paths: string[]) => {
      const file = paths.find((p) => /\.(csv|tsv|txt|xlsx)$/i.test(p));
      if (file) void doImportPath(file);
    },
    [doImportPath],
  );
  const { dropRef, isDragOver } = useDropZone(onDrop);

  const browseData = async () => {
    const initial = displayPath ? pathDir(displayPath) : config.output_dir || undefined;
    const picked = await open({
      multiple: false,
      title: "选择 Counts 文件(选择后自动导入)",
      defaultPath: initial,
      filters: [
        { name: "所有支持格式", extensions: ["csv", "tsv", "txt", "xlsx"] },
        { name: "CSV 文件", extensions: ["csv"] },
        { name: "TSV/TXT 文件", extensions: ["tsv", "txt"] },
        { name: "Excel 文件", extensions: ["xlsx"] },
      ],
    });
    if (!picked) return;
    const p = Array.isArray(picked) ? picked[0] : picked;
    if (p !== importSourcePath) {
      await doImportPath(p);
    } else {
      seedPreview();
      await loadPage();
    }
  };

  const browseOutput = async () => {
    const initial = config.output_dir || (displayPath ? pathDir(displayPath) : undefined);
    const picked = await open({
      directory: true,
      multiple: false,
      title: "选择输出目录",
      defaultPath: initial,
    });
    if (!picked) return;
    const p = Array.isArray(picked) ? picked[0] : picked;
    updateConfig((c) => {
      c.output_dir = p;
    });
  };

  const onFormatChange = (fmt: string) => {
    setMatrixFormat(fmt as typeof matrixFormat);
    if (importSourcePath && importData) {
      void doImportPath(importSourcePath, true);
    }
  };

  // ── 摘要 ──
  const formatLabel =
    importData?.format === "excel"
      ? "Excel"
      : importData?.format === "tsv"
        ? "TSV"
        : "CSV";
  const matrixFormatLabel =
    MATRIX_FORMAT_LABELS[
      String(importData?.matrix_format_applied || importData?.matrix_format || "")
    ] ?? "";
  const dims = importData
    ? {
        rows: importData.total_genes,
        cols:
          (importData.preview_columns?.length ?? 0) || importData.sample_cols.length + 1,
        samples: importData.sample_cols.length,
        geneCol: importData.gene_col,
      }
    : null;

  const sampleCounts = useMemo(() => {
    const d = st.importData;
    if (!d) return [];
    return d.sample_cols
      .map((s) => ({ sample: s, nonzero: d.nonzero_counts[s] ?? 0 }))
      .sort((a, b) => a.nonzero - b.nonzero);
  }, [st.importData]);
  const lowCountSamples = sampleCounts.filter(
    (s) => s.nonzero < (st.importData?.total_genes ?? 0) * 0.3,
  );

  const onRunNameChange = (v: string) => {
    if (RUN_NAME_BAD.test(v)) {
      showToast('运行名称不能包含 \\ / : * ? " < > | 等字符,已自动移除', "info");
      updateConfig((c) => {
        c.run_name = v.replace(RUN_NAME_BAD, "");
      });
      return;
    }
    updateConfig((c) => {
      c.run_name = v;
    });
  };

  const onSort = (colIdx: number) => {
    if (sortCol === colIdx) setSortAsc(!sortAsc);
    else {
      setSortCol(colIdx);
      setSortAsc(true);
    }
    void loadPage();
  };

  return (
    <div className="rx-step">
      {/* 文件与预设 */}
      <div className="card">
        <div className="card-title">
          <IconFileSpreadsheet size={14} stroke={1.75} />
          <span>Counts 数据文件</span>
        </div>
        <div className="card-body" ref={dropRef}>
          {importData ? (
            <div
              className={`file-display${isDragOver ? " file-display--drag" : ""}`}
              style={{ marginBottom: 10 }}
            >
              <div className="file-icon" style={{ background: "#af52de" }}>
                <IconFileSpreadsheet size={20} color="white" stroke={1.75} />
              </div>
              <div className="file-info">
                <div className="file-name">{pathBase(importSourcePath)}</div>
                <div className="file-path">{importSourcePath}</div>
              </div>
              {isDragOver && <span className="drop-hint">释放以导入</span>}
            </div>
          ) : (
            /* 空状态:唯一的文件入口(拖拽 / 点击均可),替代原先 占位框+引导块 两处重复 */
            <div
              className={`rx-drop-hero${isDragOver ? " drag" : ""}`}
              role="button"
              tabIndex={0}
              aria-label="导入 Counts 文件"
              onClick={() => {
                if (!loading) browseData();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (!loading) browseData();
                }
              }}
            >
              <span className="rx-drop-hero-icon">
                <IconUpload size={24} stroke={1.5} />
              </span>
              <strong>{loading ? "正在导入…" : "拖拽 Counts 文件到此处"}</strong>
              <span className="rx-drop-hero-sub">
                或点击选择 · 支持 CSV / TSV / TXT / Excel(.xlsx)
              </span>
              {isDragOver && <span className="drop-hint">释放以导入</span>}
            </div>
          )}

          <div className="rx-path-row" style={{ marginTop: importData ? 0 : 10 }}>
            <input
              className="rx-path-input"
              type="text"
              placeholder="也可粘贴文件路径,回车导入"
              value={displayPath}
              onChange={(e) => setDisplayPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doImportPath();
              }}
            />
            <button className="btn" onClick={browseData} disabled={loading}>
              <IconFolderOpen size={14} stroke={1.75} /> 选择文件
            </button>
          </div>

          {/* 空状态:三步流程一览(导入后自动隐藏) */}
          {!importData && (
            <div className="rx-flow-strip">
              <span className="rx-flow-step current">① 导入与质检</span>
              <span className="rx-flow-arrow">→</span>
              <span className="rx-flow-step">② 分组 · 运行 DEG</span>
              <span className="rx-flow-arrow">→</span>
              <span className="rx-flow-step">③ 绘图导出</span>
            </div>
          )}

          <div className="form-group" style={{ marginTop: 10 }}>
            <label>
              矩阵格式预设
              <span className="rx-fmt-hint">按数据来源选,导入时自动做对应清理 · 不确定就选第一个</span>
            </label>
            <div className="rx-fmt-cards" role="radiogroup" aria-label="矩阵格式预设">
              {FORMAT_GUIDES.map((g) => {
                const active = matrixFormat === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`rx-fmt-card${active ? " active" : ""}`}
                    onClick={() => onFormatChange(g.id)}
                  >
                    {active && (
                      <span className="rx-fmt-card-check">
                        <IconCheck size={11} stroke={3} />
                      </span>
                    )}
                    <span className="rx-fmt-card-name">{g.label}</span>
                    <span className="rx-fmt-card-sub">{g.sub}</span>
                  </button>
                );
              })}
            </div>
            {(() => {
              const g = FORMAT_GUIDES.find((x) => x.id === matrixFormat) ?? FORMAT_GUIDES[0];
              const hasDropped =
                g.cols.some((c) => c.dropped) || g.rows.some((r) => r.dropped);
              return (
                <div className="rx-fmt-guide">
                  <p className="rx-fmt-when">{g.when}</p>
                  <div className="rx-fmt-example">
                    <div className="rx-fmt-example-cap">
                      <IconFileText size={12} stroke={1.75} /> 文件应长这样(示例)
                    </div>
                    <div className="rx-fmt-table-wrap">
                      <table className="rx-fmt-table">
                        <thead>
                          <tr>
                            {g.cols.map((c) => (
                              <th key={c.name} className={c.dropped ? "dropped" : ""}>
                                {c.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map((r, i) => (
                            <tr key={i} className={r.dropped ? "dropped" : ""}>
                              {r.cells.map((cell, j) => (
                                <td key={j} className={g.cols[j]?.dropped ? "dropped" : ""}>
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {hasDropped && (
                      <div className="rx-fmt-legend">
                        <span className="rx-fmt-legend-item dropped">
                          <s>删除线</s>
                        </span>
                        <span>= 导入时自动丢弃,无需手工处理</span>
                      </div>
                    )}
                  </div>
                  <ul className="rx-fmt-points">
                    {g.points.map((p, i) => (
                      <li key={i}>
                        <IconCheck size={12} stroke={2.2} /> {p}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>

          {importError && (
            <div className="rx-alert rx-alert--error">导入失败:{importError}</div>
          )}

          {/* 数据摘要条 */}
          {importData && dims && (
            <div className="rx-dims">
              <span className="rx-dim-chip">
                <b>{dims.rows.toLocaleString()}</b> 行(基因)
              </span>
              <span className="rx-dim-chip">
                <b>{dims.cols}</b> 列
              </span>
              <span className="rx-dim-chip">
                <b>{dims.samples}</b> 个样本
              </span>
              <span className="rx-dim-chip">
                基因列 <code>{dims.geneCol}</code>
              </span>
              <span className="rx-dim-chip rx-dim-chip--fmt">
                {importData.format === "excel" ? (
                  <IconFileSpreadsheet size={13} />
                ) : (
                  <IconFileText size={13} />
                )}
                {formatLabel}
                {matrixFormatLabel ? ` · ${matrixFormatLabel}` : ""}
                {importData.converted && <em>已转换为 CSV 供分析</em>}
              </span>
            </div>
          )}

          {importData?.warnings?.length ? (
            <div className="rx-warn-list">
              {importData.warnings.map((w, i) => (
                <div key={i} className="rx-alert rx-alert--warn">
                  {w}
                </div>
              ))}
            </div>
          ) : null}

          {importData && (
            <div className="rx-import-info">
              <div className="rx-import-info-text">
                检测到 <b>{importData.sample_cols.length}</b> 个样本列,共
                <b>{importData.total_genes.toLocaleString()}</b> 个基因。
                {importData.converted && config.data_file && (
                  <span className="rx-import-converted">
                    实际分析文件(转换缓存):{config.data_file}
                  </span>
                )}
              </div>
              <button
                className="btn"
                onClick={() => void doImportPath(importSourcePath, true)}
                disabled={loading}
              >
                <IconRefresh size={13} stroke={1.75} /> 重新导入
              </button>
            </div>
          )}

          {importData && (
            <>
              <button
                type="button"
                className="rx-collapse-toggle"
                onClick={() => setCountPanelOpen(!countPanelOpen)}
              >
                <span className="rx-collapse-title">样本计数概览</span>
                <small className="rx-collapse-sub">
                  每个样本的非零基因数(过低提示数据问题)
                </small>
                {lowCountSamples.length > 0 && (
                  <span className="rx-tag rx-tag--warn">
                    {lowCountSamples.length} 个样本偏低
                  </span>
                )}
                <span
                  className="rx-collapse-arrow open"
                  style={{
                    transform: countPanelOpen ? "rotate(0deg)" : "rotate(-90deg)",
                  }}
                >
                  <IconChevronDown size={15} stroke={2} />
                </span>
              </button>
              {countPanelOpen && (
                <div className="rx-count-list">
                  {sampleCounts.map((s) => {
                    const pct = Math.min(
                      100,
                      (s.nonzero / (st.importData?.total_genes || 1)) * 100,
                    );
                    return (
                      <div key={s.sample} className="rx-count-row">
                        <span className="rx-count-sample" title={s.sample}>
                          {s.sample}
                        </span>
                        <span className="rx-count-bar">
                          <span
                            className="rx-count-bar-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="rx-count-num">{s.nonzero.toLocaleString()}</span>
                        <span className="rx-count-pct">{pct.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 输出设置 */}
      <div className="card">
        <div className="card-title">
          <IconFolderOpen size={14} stroke={1.75} />
          <span>输出设置</span>
        </div>
        <div className="card-body">
          <div className="form-group">
            <label>输出目录(留空 = 家目录/Mynx/rnaseq_runs)</label>
            <div className="rx-path-row">
              <input
                className="rx-path-input"
                type="text"
                placeholder="输出目录"
                value={config.output_dir}
                onChange={(e) =>
                  updateConfig((c) => {
                    c.output_dir = e.target.value;
                  })
                }
              />
              <button className="btn" onClick={browseOutput}>
                <IconFolderOpen size={14} stroke={1.75} /> 浏览
              </button>
            </div>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>运行名称(留空 = RNA_seq + 时间戳)</label>
            <input
              type="text"
              placeholder="留空自动生成"
              value={config.run_name}
              onChange={(e) => onRunNameChange(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* 数据预览 */}
      {importData && (
        <div className="card">
          <div className="card-title">
            <span className="step-num" style={{ visibility: "hidden" }} />
            <span>数据预览</span>
            <div className="rx-preview-controls">
              <div className="rx-search-box">
                <IconSearch size={13} stroke={1.75} />
                <input
                  type="text"
                  placeholder="搜索基因名"
                  value={searchInput}
                  onChange={(e) => onSearch(e.target.value)}
                />
              </div>
              <select
                className="rx-page-size"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                  setTimeout(() => void loadPage(), 0);
                }}
              >
                <option value={25}>25 行/页</option>
                <option value={50}>50 行/页</option>
                <option value={100}>100 行/页</option>
              </select>
            </div>
          </div>
          <div className="card-body">
            <div className="rx-table-wrap">
              <table className="rx-table">
                <thead>
                  <tr>
                    {(pageData?.columns ?? []).map((col, i) => (
                      <th key={i} onClick={() => onSort(i)}>
                        <span className="rx-sortable">
                          {col}
                          <span className="rx-sort-icon">
                            {sortCol !== i ? "↕" : sortAsc ? "↑" : "↓"}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className={loading ? "rx-loading" : ""}>
                  {(pageData?.data ?? []).map((row, r) => (
                    <tr key={r}>
                      {(pageData?.columns ?? []).map((col, i) => (
                        <td key={i}>{fmtVal(row[col])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rx-pager">
              <button
                className="btn rx-pager-btn"
                disabled={currentPage <= 1}
                onClick={() => {
                  setCurrentPage((p) => p - 1);
                  setTimeout(() => void loadPage(), 0);
                }}
              >
                ‹
              </button>
              <span className="rx-pager-info">
                {currentPage} / {pageData?.total_pages ?? 1} 页 · 共{" "}
                {(pageData?.total ?? 0).toLocaleString()} 行
              </span>
              <button
                className="btn rx-pager-btn"
                disabled={currentPage >= (pageData?.total_pages ?? 1)}
                onClick={() => {
                  setCurrentPage((p) => p + 1);
                  setTimeout(() => void loadPage(), 0);
                }}
              >
                ›
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function pathBase(p: string): string {
  const idx = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}
