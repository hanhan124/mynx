/**
 * 步骤 3:绘图与导出 — 主从双栏工作台(左图库/右预览+参数)、
 * 发表尺寸预设、批量导出、结果画廊与绘图日志。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconFolderOpen,
  IconRefresh,
  IconRuler,
  IconDownload,
  IconBolt,
  IconRotate,
  IconEye,
  IconPhoto,
  IconPhotoOff,
  IconTrash,
  IconPlayerStop,
  IconLoader2,
  IconChevronDown,
} from "@tabler/icons-react";
import Modal from "@/components/Modal";
import { showToast } from "@/components/Toast";
import { useRnaSeq } from "./store";
import { Collapse, CollapseToggle } from "./fields";
import {
  GgThemeSection,
  LabelsSection,
  ScopeSection,
  SizeSection,
  SpecificParams,
  ThemeSection,
} from "./PlotParams";
import {
  PLOT_FILE_PREFIX,
  PLOT_GROUPS,
  PUB_PRESETS,
  filePlotId,
  isGgplotPlot,
  plotLabel,
} from "./plotDefs";
import { joinPath, openInShell } from "@/lib/rnaseq/io";
import { plotFiles, readPlotFile } from "@/lib/rnaseq/runs";
import type { PlotFileItem } from "@/lib/rnaseq/types";

interface ThumbContent {
  kind: "svg" | "png";
  data: string;
  name: string;
  fp: string;
}

/** 规范化 SVG:补 viewBox、去固定宽高,交给容器等比 contain */
function normalizeSvg(svg: string): string {
  let s = svg;
  if (!/\sviewBox=/i.test(s)) {
    const w = s.match(/\swidth="([\d.]+)/i);
    const h = s.match(/\sheight="([\d.]+)/i);
    if (w && h) s = s.replace(/<svg\b/i, `<svg viewBox="0 0 ${w[1]} ${h[1]}"`);
  }
  s = s.replace(/(<svg\b[^>]*?)\swidth="[^"]*"/i, "$1");
  s = s.replace(/(<svg\b[^>]*?)\sheight="[^"]*"/i, "$1");
  return s;
}

function fileFingerprint(f: PlotFileItem): string {
  return `${f.name}|${f.size}|${f.mtime}`;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function PlotsStep({ goAnalysis }: { goAnalysis: () => void }) {
  const st = useRnaSeq();
  const {
    config,
    updateConfig,
    resetPlotOption,
    hasResult,
    checkingResult,
    dirStatus,
    dirMsg,
    analysisDir,
    usingManualDir,
    dirChecking,
    checkResult,
    browseAnalysisDir,
    useAutoDetect,
    plotStatus,
    plotLogs,
    runSinglePlot,
    cancelPlot,
    plotOutputDir,
  } = st;

  const [activeId, setActiveId] = useState("pca");
  const activePlot = PLOT_GROUPS.find((p) => p.id === activeId) ?? null;
  const [exportingPlot, setExportingPlot] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const lastPreviewSnap = useRef<Record<string, string>>({});

  // ── 发表尺寸预设 ──
  const [presetExpanded, setPresetExpanded] = useState(false);
  const [pubPreset, setPubPreset] = useState<string>("nature_sc");
  const [customOpen, setCustomOpen] = useState(false);
  const [customW, setCustomW] = useState(7);
  const [customH, setCustomH] = useState(5);
  const activePreset = PUB_PRESETS.find((p) => p.id === pubPreset) ?? null;

  const applyPreset = (p: { id: string; label: string; w: number; h: number }) => {
    setPubPreset(p.id);
    updateConfig((c) => {
      const po = c.plot_options as Record<string, Record<string, number>>;
      for (const id of Object.keys(po)) {
        po[id].width = p.w;
        po[id].height = p.h;
      }
    });
    showToast(
      `已应用「${p.label}」预设到全部 ${Object.keys(config.plot_options).length} 种图`,
      "success",
    );
  };

  // ── 参数快照(预览去重) ──
  const plotOptionSnapshot = useCallback(
    (plotType: string): string => {
      try {
        return JSON.stringify({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          o: (config.plot_options as any)?.[plotType] ?? {},
          size_mode: config.size_mode,
          font_family: config.font_family,
          top_n_label: config.params?.top_n_label,
          pvalue_cap: config.params?.pvalue_cap,
          log2fc_th: config.params?.log2fc_th,
          fdr_th: config.params?.fdr_th,
          marker_genes: config.marker_genes,
          gene_clusters: config.gene_clusters,
          excluded_genes: config.excluded_genes,
        });
      } catch {
        return String(Date.now());
      }
    },
    [config],
  );

  // ── 单图导出/快速预览 ──
  const exportSinglePlot = useCallback(
    async (plotType: string, opts: { preview?: boolean; silent?: boolean } = {}) => {
      const preview = !!opts.preview;
      const silent = !!opts.silent;
      if (!config.data_file) {
        if (!silent) showToast("请先在「数据导入」中导入数据", "info");
        return;
      }
      if (config.selected_groups.length < 2) {
        if (!silent) showToast("至少需要 2 个选定的组(差异分析页)", "info");
        return;
      }
      if (config.comparisons.length === 0) {
        if (!silent) showToast("至少需要 1 个比较(差异分析页)", "info");
        return;
      }
      let has = hasResult;
      if (!has) {
        has = await checkResult();
      }
      if (!has) {
        if (!silent) {
          showToast(
            "未检测到差异分析结果。请先运行 DEG,或在上方选择结果文件夹。",
            "error",
          );
        }
        return;
      }
      if (plotStatus === "running" || exportingPlot) {
        if (!silent) showToast("当前有导出/预览任务在进行,请稍候", "info");
        return;
      }
      const snap = plotOptionSnapshot(plotType);
      if (preview && lastPreviewSnap.current[plotType] === snap) {
        if (!silent)
          showToast("参数未变化,预览已是最新;调整参数或点「导出此图」", "info");
        return;
      }
      setExportingPlot(plotType);
      setPreviewBusy(preview);
      if (preview) lastPreviewSnap.current[plotType] = snap;
      try {
        await runSinglePlot(plotType, { preview, silent: true });
        if (!silent) {
          showToast(
            preview
              ? `快速预览 ${plotLabel(plotType)}(低分辨率 PNG)`
              : `正在导出 ${plotLabel(plotType)},日志见下方`,
            "success",
          );
        }
      } catch (e) {
        if (!silent) showToast(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setPreviewBusy(false);
        setExportingPlot(null);
      }
    },
    [
      config,
      hasResult,
      checkResult,
      plotStatus,
      exportingPlot,
      plotOptionSnapshot,
      runSinglePlot,
      st,
    ],
  );

  // ── 批量导出 ──
  const [batch, setBatch] = useState({ running: false, done: 0, total: 0, current: "" });
  const batchAbort = useRef(false);

  const exportAllPlots = async () => {
    if (!config.data_file) {
      showToast("请先在「数据导入」中导入数据", "info");
      return;
    }
    if (config.selected_groups.length < 2) {
      showToast("至少需要 2 个选定的组(差异分析页)", "info");
      return;
    }
    if (config.comparisons.length === 0) {
      showToast("至少需要 1 个比较(差异分析页)", "info");
      return;
    }
    let has = hasResult;
    if (!has) {
      has = await checkResult();
    }
    if (!has) {
      showToast("未检测到差异分析结果,请先运行 DEG 或选择结果文件夹。", "error");
      return;
    }
    if (plotStatus === "running" || exportingPlot) {
      showToast("当前有导出任务在进行,请稍候", "info");
      return;
    }
    batchAbort.current = false;
    const ids = PLOT_GROUPS.map((p) => p.id);
    setBatch({ running: true, done: 0, total: ids.length, current: "" });
    setPlotLogOpen(true);
    const failed: string[] = [];
    for (const id of ids) {
      if (batchAbort.current) break;
      setBatch((b) => ({ ...b, current: id }));
      setExportingPlot(id);
      setPreviewBusy(false);
      let ok: boolean;
      try {
        const r = await runSinglePlot(id, { silent: true });
        ok = r?.status === "done";
      } catch {
        ok = false;
      }
      if (!ok) failed.push(plotLabel(id));
      setBatch((b) => ({ ...b, done: b.done + 1 }));
    }
    setExportingPlot(null);
    setPreviewBusy(false);
    const aborted = batchAbort.current;
    setBatch({ running: false, done: 0, total: 0, current: "" });
    void loadGallery(true);
    if (aborted) showToast("已停止批量导出;已完成的图保留在输出目录", "info");
    else if (failed.length) {
      showToast(
        `批量导出完成:${ids.length - failed.length} 成功 / ${failed.length} 失败(${failed.join("、")}),详见绘图日志`,
        "error",
      );
    } else showToast(`已按当前参数导出全部 ${ids.length} 类图表`, "success");
  };

  const stopBatchExport = () => {
    batchAbort.current = true;
    void cancelPlot();
  };

  // ── 画廊 ──
  const [gallery, setGallery] = useState<PlotFileItem[]>([]);
  const [galleryDir, setGalleryDir] = useState("");
  const [galleryLoading, setGalleryLoading] = useState(false);
  // 画廊缩略图内容缓存:指纹(name|size|mtime) → 内容;重绘同名文件后指纹变,自动失效
  const [contentCache, setContentCache] = useState<Map<string, ThumbContent>>(new Map());
  const galleryReqSeq = useRef(0);
  const [galleryVersion, setGalleryVersion] = useState(0); // 触发缩略图重渲染
  const [galleryOpen, setGalleryOpen] = useState(false);

  const loadGallery = useCallback(
    async (force = false) => {
      const runName = config.run_name;
      if (!hasResult || !runName || runName === "auto") {
        setGallery([]);
        return;
      }
      const seq = ++galleryReqSeq.current;
      setGalleryLoading(true);
      try {
        const r = await plotFiles(config.output_dir, runName);
        if (seq !== galleryReqSeq.current) return;
        setGalleryDir(r.dir);
        setGallery(r.files);
        const next = new Map(contentCache);
        const liveFps = new Set(r.files.map(fileFingerprint));
        for (const k of next.keys()) {
          if (!liveFps.has(k)) next.delete(k);
        }
        await Promise.all(
          r.files.map(async (f) => {
            if (!/\.(svg|png)$/i.test(f.name)) return;
            const fp = fileFingerprint(f);
            if (!force && next.has(fp)) return;
            try {
              const c = await readPlotFile(r.dir, f.name);
              if (seq !== galleryReqSeq.current) return;
              if (c.kind === "svg" && c.content) {
                next.set(fp, {
                  kind: "svg",
                  data: normalizeSvg(c.content),
                  name: f.name,
                  fp,
                });
              } else if (c.kind === "png" && c.data_base64) {
                next.set(fp, {
                  kind: "png",
                  data: `data:image/png;base64,${c.data_base64}`,
                  name: f.name,
                  fp,
                });
              }
            } catch {
              /* 单文件失败不阻塞画廊 */
            }
          }),
        );
        if (seq !== galleryReqSeq.current) return;
        setContentCache(next);
        setGalleryVersion((v) => v + 1);
      } finally {
        if (seq === galleryReqSeq.current) setGalleryLoading(false);
      }
    },
    [config.output_dir, config.run_name, hasResult, contentCache],
  );

  useEffect(() => {
    void checkResult();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 导出完成/失败 → 刷新画廊
  const prevPlotStatus = useRef(plotStatus);
  useEffect(() => {
    if (prevPlotStatus.current === "running") {
      if (
        plotStatus === "done" ||
        plotStatus === "failed" ||
        plotStatus === "cancelled"
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPreviewBusy(false);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setExportingPlot(null);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void loadGallery(true);
      }
    }
    prevPlotStatus.current = plotStatus;
  }, [plotStatus, loadGallery]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hasResult) void loadGallery();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else setGallery([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasResult]);

  const latestPlotFile = useCallback(
    (plotId: string): PlotFileItem | null => {
      const prefixes = PLOT_FILE_PREFIX[plotId] ?? [];
      const files = gallery.filter((f) => prefixes.some((p) => f.name.startsWith(p)));
      if (files.length === 0) return null;
      return files.reduce(
        (best, f) => {
          if (!best) return f;
          if ((f.mtime || "") > (best.mtime || "")) return f;
          if (f.mtime === best.mtime && f.name > best.name) return f;
          return best;
        },
        null as PlotFileItem | null,
      );
    },
    [gallery],
  );

  const thumbOf = useCallback(
    (f: PlotFileItem | null): ThumbContent | null => {
      if (!f) return null;
      return contentCache.get(fileFingerprint(f)) ?? null;
    },
    [contentCache],
  );
  const cardThumb = useCallback(
    (plotId: string) => thumbOf(latestPlotFile(plotId)),
    [thumbOf, latestPlotFile],
  );

  const activePreview = activeId ? cardThumb(activeId) : null;
  const activePreviewFile = activeId ? latestPlotFile(activeId) : null;
  const previewRunning =
    !!exportingPlot &&
    exportingPlot === activeId &&
    (previewBusy || plotStatus === "running");

  // ── 大图查看 ──
  const [viewerFile, setViewerFile] = useState<PlotFileItem | null>(null);
  const viewerContent = viewerFile ? thumbOf(viewerFile) : null;

  // ── 绘图日志 ──
  const [plotLogOpen, setPlotLogOpen] = useState(false);
  const plotLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (plotLogRef.current)
      plotLogRef.current.scrollTop = plotLogRef.current.scrollHeight;
  }, [plotLogs.length, plotLogOpen]);
  useEffect(() => {
    if (plotStatus === "failed" && !batch.running) {
      setPlotLogOpen(true);
      const errs = plotLogs.filter((l) => l.level === "error");
      const last = errs[errs.length - 1];
      showToast(last ? `导出失败:${last.msg}` : "导出失败,请查看绘图日志", "error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plotStatus]);

  const batchCurrentLabel = plotLabel(batch.current);

  const toggleFormat = (fmt: string) =>
    updateConfig((c) => {
      const has2 = c.plot_formats.includes(fmt);
      if (has2 && c.plot_formats.length === 1) return; // 至少保留一种格式
      c.plot_formats = has2
        ? c.plot_formats.filter((f) => f !== fmt)
        : [...c.plot_formats, fmt];
    });

  return (
    <div className="rx-step">
      {/* 结果来源 */}
      <div className="card">
        <div className="card-title">
          <IconFolderOpen size={14} stroke={1.75} />
          <span>分析结果来源</span>
          <span
            className={`rx-tag ${dirStatus === "ok" ? "rx-tag--ok" : dirStatus === "err" ? "rx-tag--err" : ""}`}
          >
            {dirStatus === "ok" ? "已就绪" : dirStatus === "err" ? "未找到" : "检测中"}
          </span>
        </div>
        <div className="card-body">
          <p className="rx-source-desc">
            选择含 <code>RNAseq_Analysis_Results.xlsx</code> 的目录即可直接绘图;若有{" "}
            <code>params.json</code> 会自动还原分组与比较。
          </p>
          <div className="rx-path-row">
            <input
              className="rx-path-input"
              type="text"
              readOnly
              placeholder="尚未指定结果目录 — 点右侧选择,或先运行 DEG"
              value={
                usingManualDir
                  ? analysisDir
                  : config.output_dir && config.run_name
                    ? joinPath(config.output_dir, config.run_name)
                    : ""
              }
            />
            <button
              className="btn btn-primary"
              disabled={dirChecking}
              onClick={() => void browseAnalysisDir()}
            >
              <IconFolderOpen size={13} stroke={1.75} /> 选择结果文件夹
            </button>
            <button
              className="btn"
              disabled={dirChecking}
              onClick={() => void checkResult()}
            >
              <IconRefresh size={12} stroke={1.75} /> 重新检测
            </button>
            {usingManualDir && (
              <button className="btn" onClick={useAutoDetect}>
                恢复自动检测
              </button>
            )}
          </div>
          {dirStatus !== "none" && (
            <div className={`rx-dir-msg ${dirStatus === "err" ? "err" : ""}`}>
              {dirStatus === "err" && (
                <button className="rx-link-btn" onClick={goAnalysis}>
                  去运行 DEG →
                </button>
              )}
              {dirMsg}
            </div>
          )}
        </div>
      </div>

      {/* 全局格式 + 批量导出 */}
      <div className="card">
        <div className="card-body rx-global-row">
          <div className="rx-global-item">
            <span className="rx-global-label">格式</span>
            <div className="rx-format-group">
              {["pdf", "svg", "png"].map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  className={`rx-format-btn${config.plot_formats.includes(fmt) ? " on" : ""}`}
                  onClick={() => toggleFormat(fmt)}
                >
                  {fmt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div className="rx-global-item">
            <span className="rx-global-label">尺寸</span>
            <select
              className="rx-size-select"
              value={config.size_mode}
              onChange={(e) =>
                updateConfig((c) => {
                  c.size_mode = e.target.value as "auto" | "manual";
                })
              }
            >
              <option value="auto">自动(启发式)</option>
              <option value="manual">手动</option>
            </select>
          </div>
          <div className="rx-global-item rx-global-item--batch">
            <button
              className="btn btn-primary"
              disabled={
                !hasResult ||
                plotStatus === "running" ||
                (!!exportingPlot && !batch.running)
              }
              title={
                hasResult
                  ? "按当前各图参数与全局格式,顺序导出全部 14 类图表"
                  : "请先运行 DEG 或加载结果"
              }
              onClick={exportAllPlots}
            >
              <IconDownload size={13} stroke={1.75} />
              {batch.running
                ? `导出中 ${batch.done}/${batch.total} · ${batchCurrentLabel}`
                : "导出全部图表"}
            </button>
            {batch.running && (
              <button className="btn rx-cancel-btn" onClick={stopBatchExport}>
                <IconPlayerStop size={12} stroke={1.75} /> 停止
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 发表尺寸 */}
      <div className="card">
        <CollapseToggle onClick={() => setPresetExpanded(!presetExpanded)}>
          <span className="rx-preset-lead">
            <IconRuler size={14} stroke={1.75} />
            <strong>期刊尺寸</strong>
            {activePreset ? (
              <span className="rx-preset-val">
                {activePreset.label} · {activePreset.w}" × {activePreset.h}"
              </span>
            ) : (
              <span className="rx-preset-val muted">未选择</span>
            )}
          </span>
          <span className="rx-collapse-right">
            <button
              className="btn"
              disabled={!activePreset}
              onClick={(e) => {
                e.stopPropagation();
                if (activePreset) applyPreset(activePreset);
              }}
            >
              应用到全部图
            </button>
            <button
              className="btn"
              onClick={(e) => {
                e.stopPropagation();
                setCustomOpen(true);
              }}
            >
              自定义
            </button>
            <span className={`rx-collapse-arrow${presetExpanded ? " open" : ""}`}>
              <IconChevronDown size={15} stroke={2} />
            </span>
          </span>
        </CollapseToggle>
        {presetExpanded && (
          <div className="card-body rx-preset-showcase">
            {PUB_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`rx-preset-card${pubPreset === p.id ? " active" : ""}`}
                style={{ "--preset-accent": p.accent } as React.CSSProperties}
                onClick={() => setPubPreset(p.id)}
                onDoubleClick={() => applyPreset(p)}
              >
                <div className="rx-preset-card-top">
                  <span className="rx-preset-journal">{p.journal}</span>
                  <span className="rx-preset-span">{p.span}</span>
                </div>
                <div className="rx-preset-visual">
                  <span
                    className="rx-preset-frame"
                    style={{ aspectRatio: `${p.w} / ${p.h}` }}
                  />
                </div>
                <div className="rx-preset-card-body">
                  <strong>{p.label}</strong>
                  <span className="rx-preset-dims">
                    {p.w}" × {p.h}"
                  </span>
                  <small>{p.desc}</small>
                </div>
                {pubPreset === p.id && <span className="rx-preset-check">✓</span>}
              </button>
            ))}
            <p className="rx-preset-hint">
              单击选中 · 双击立即应用 · 或点「应用到全部图」
            </p>
          </div>
        )}
      </div>

      {!checkingResult && !hasResult && (
        <div className="rx-alert rx-alert--warn">
          未检测到差异分析结果:请先在「差异分析」页运行 DEG,或在上方选择结果文件夹。
        </div>
      )}

      {/* 主从工作台 */}
      <div className="rx-workbench">
        <aside className="rx-rail" aria-label="图表类型">
          <div className="rx-rail-head">
            <span>图表类型</span>
            <span className="rx-rail-count">{PLOT_GROUPS.length}</span>
          </div>
          <div className="rx-rail-list">
            {PLOT_GROUPS.map((g) => {
              const thumb = cardThumb(g.id);
              const custom =
                ((
                  config.plot_options as Record<
                    string,
                    { groups?: string[]; comparisons?: unknown[] }
                  >
                )[g.id]?.groups?.length ?? 0) > 0 ||
                ((config.plot_options as Record<string, { comparisons?: unknown[] }>)[
                  g.id
                ]?.comparisons?.length ?? 0) > 0;
              const Icon = g.icon;
              return (
                <button
                  key={g.id}
                  type="button"
                  className={`rx-rail-item${activeId === g.id ? " active" : ""}`}
                  style={{ "--plot-color": g.color } as React.CSSProperties}
                  onClick={() => setActiveId(g.id)}
                >
                  <span
                    className="rx-rail-icon"
                    style={{ background: `${g.color}22`, color: g.color }}
                  >
                    {thumb ? (
                      thumb.kind === "svg" ? (
                        <span
                          key={galleryVersion}
                          className="rx-thumb-svg"
                          dangerouslySetInnerHTML={{ __html: thumb.data }}
                        />
                      ) : (
                        <img key={galleryVersion} src={thumb.data} alt={g.label} />
                      )
                    ) : (
                      <Icon size={16} stroke={1.75} />
                    )}
                  </span>
                  <span className="rx-rail-meta">
                    <strong>{g.label}</strong>
                    <small>{g.desc}</small>
                  </span>
                  {custom && <span className="rx-rail-dot" title="已自定义范围" />}
                </button>
              );
            })}
          </div>
        </aside>

        {activePlot && (
          <section className="rx-work-panel">
            <header className="rx-work-head">
              <div className="rx-work-head-left">
                <span
                  className="rx-work-head-icon"
                  style={{ background: `${activePlot.color}22`, color: activePlot.color }}
                >
                  {(() => {
                    const Icon = activePlot.icon;
                    return <Icon size={20} stroke={1.75} />;
                  })()}
                </span>
                <div>
                  <strong>{activePlot.label}</strong>
                  <small>{activePlot.desc}</small>
                </div>
              </div>
              <div className="rx-work-head-actions">
                <button
                  className="btn"
                  disabled={!!exportingPlot}
                  onClick={() => resetPlotOption(activePlot.id)}
                >
                  <IconRotate size={12} stroke={1.75} /> 恢复默认
                </button>
                <button
                  className="btn"
                  disabled={!!exportingPlot || !hasResult || plotStatus === "running"}
                  title={
                    hasResult
                      ? "立即低分辨率预览(参数未变会跳过)"
                      : "请先运行 DEG 或加载结果"
                  }
                  onClick={() => void exportSinglePlot(activePlot.id, { preview: true })}
                >
                  <IconBolt size={13} stroke={1.75} /> 快速预览
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!!exportingPlot || !hasResult || plotStatus === "running"}
                  title={
                    hasResult
                      ? `按当前格式导出 ${activePlot.label}`
                      : "请先运行 DEG 或加载结果"
                  }
                  onClick={() => void exportSinglePlot(activePlot.id)}
                >
                  <IconDownload size={13} stroke={1.75} /> 导出此图
                </button>
              </div>
            </header>

            {/* 预览 */}
            <div
              className={`rx-work-preview${activePreview ? "" : " empty"}${previewRunning ? " running" : ""}`}
              onClick={() => {
                if (activePreview && !previewRunning && activePreviewFile)
                  setViewerFile(activePreviewFile);
              }}
            >
              {activePreview ? (
                <>
                  {activePreview.kind === "svg" ? (
                    <span
                      key={`svg-${activePreview.fp}-${galleryVersion}`}
                      className="rx-preview-svg"
                      dangerouslySetInnerHTML={{ __html: activePreview.data }}
                    />
                  ) : (
                    <img
                      key={`png-${activePreview.fp}-${galleryVersion}`}
                      src={activePreview.data}
                      alt={activePlot.label}
                    />
                  )}
                  <span className="rx-preview-zoom">
                    <IconEye size={13} stroke={1.75} /> 点击放大
                  </span>
                  {activePreviewFile && (
                    <span className="rx-preview-name">
                      {activePreviewFile.name} · {activePreviewFile.mtime}
                    </span>
                  )}
                </>
              ) : (
                <div className="rx-preview-empty">
                  <IconPhotoOff size={26} stroke={1.5} />
                  <strong>尚无预览</strong>
                  <span>调好参数后点「快速预览」查看效果;满意后再「导出此图」定稿</span>
                </div>
              )}
              {previewRunning && (
                <div className="rx-preview-busy">
                  <IconLoader2 size={17} stroke={2} className="rx-spin" />
                  <span>{previewBusy ? "快速预览中…" : "导出中…"}</span>
                </div>
              )}
            </div>

            {/* 参数 */}
            <div className="rx-work-params">
              <Collapse title="使用范围" defaultOpen>
                <ScopeSection plotId={activePlot.id} dim={activePlot.dim} />
              </Collapse>
              <Collapse title="本图专属" defaultOpen>
                <SpecificParams plotId={activePlot.id} />
              </Collapse>
              {isGgplotPlot(activePlot.id) && (
                <Collapse title="ggplot 主题" defaultOpen>
                  <GgThemeSection plotId={activePlot.id} />
                </Collapse>
              )}
              <Collapse title="尺寸" defaultOpen>
                <SizeSection plotId={activePlot.id} />
              </Collapse>
              <Collapse title="图例 · 标题 · 坐标轴">
                <LabelsSection plotId={activePlot.id} />
              </Collapse>
              <Collapse title="theme() 调节">
                <ThemeSection plotId={activePlot.id} />
              </Collapse>
            </div>
          </section>
        )}
      </div>

      {/* 结果画廊 */}
      <div className="card">
        <CollapseToggle onClick={() => setGalleryOpen(!galleryOpen)}>
          <span className="rx-preset-lead">
            <IconPhoto size={14} stroke={1.75} />
            <strong>结果画廊</strong>
            <small>
              {gallery.length ? `${gallery.length} 个文件` : "当前 run 已生成的图"}
            </small>
          </span>
          <span className="rx-collapse-right">
            <button
              className="btn"
              disabled={!hasResult || galleryLoading}
              onClick={(e) => {
                e.stopPropagation();
                void loadGallery(true);
              }}
            >
              <IconRefresh size={12} stroke={1.75} /> 刷新
            </button>
            <button
              className="btn"
              disabled={!galleryDir}
              onClick={(e) => {
                e.stopPropagation();
                void openInShell(galleryDir);
              }}
            >
              <IconFolderOpen size={12} stroke={1.75} /> 打开目录
            </button>
          </span>
        </CollapseToggle>
        {galleryOpen && (
          <div className="card-body">
            {!hasResult ? (
              <div className="rx-empty-hero rx-empty-hero--slim">
                <IconPhoto size={22} stroke={1.5} />
                <strong>暂无结果</strong>
                <span>先在「差异分析」页运行 DEG,再在工作台导出图表。</span>
              </div>
            ) : gallery.length === 0 && !galleryLoading ? (
              <div className="rx-empty-hero rx-empty-hero--slim">
                <IconPhotoOff size={22} stroke={1.5} />
                <strong>还没有生成任何图</strong>
                <span>在右侧工作台点「导出此图」,生成后会出现在这里与预览区。</span>
              </div>
            ) : (
              <div className={`rx-gallery-grid${galleryLoading ? " rx-loading" : ""}`}>
                {gallery.map((f) => {
                  const thumb = thumbOf(f);
                  const pid = filePlotId(f.name);
                  return (
                    <div
                      key={fileFingerprint(f)}
                      className="rx-gallery-item"
                      onClick={() => thumb && setViewerFile(f)}
                    >
                      <div className="rx-gallery-thumb">
                        {thumb?.kind === "svg" ? (
                          <span
                            className="rx-thumb-svg"
                            dangerouslySetInnerHTML={{ __html: thumb.data }}
                          />
                        ) : thumb?.kind === "png" ? (
                          <img src={thumb.data} alt={f.name} />
                        ) : (
                          <div className="rx-thumb-pdf">
                            <IconPhoto size={24} stroke={1.5} />
                            <span>PDF 请打开目录查看</span>
                          </div>
                        )}
                        {thumb && (
                          <span className="rx-thumb-zoom">
                            <IconEye size={13} stroke={1.75} />
                          </span>
                        )}
                      </div>
                      <div className="rx-gallery-meta">
                        <strong title={f.name}>{f.name}</strong>
                        <small>
                          {pid && <span className="rx-tag">{plotLabel(pid)}</span>}
                          {fmtSize(f.size)} · {f.mtime}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 绘图日志 */}
      <div className="card">
        <CollapseToggle onClick={() => setPlotLogOpen(!plotLogOpen)}>
          <strong>绘图日志</strong>
          <small>
            {plotLogs.length > 0
              ? `最近导出:${plotLogs[plotLogs.length - 1].plotType}`
              : "单图导出的实时日志"}
          </small>
          <span
            className={`rx-tag ${plotStatus === "running" ? "rx-tag--run" : plotStatus === "done" ? "rx-tag--ok" : plotStatus === "failed" ? "rx-tag--err" : plotStatus === "cancelled" ? "rx-tag--warn" : ""}`}
          >
            {
              {
                idle: "空闲",
                running: "导出中",
                done: "完成",
                failed: "失败",
                cancelled: "已取消",
              }[plotStatus]
            }
          </span>
        </CollapseToggle>
        {plotLogOpen && (
          <div className="card-body">
            <div className="rx-title-actions" style={{ marginBottom: 8 }}>
              <button
                className="btn"
                disabled={!plotOutputDir}
                onClick={() => plotOutputDir && void openInShell(plotOutputDir)}
              >
                <IconFolderOpen size={12} stroke={1.75} /> 打开输出目录
              </button>
              <button
                className="btn"
                disabled={plotStatus === "running"}
                onClick={st.clearPlotLogs}
              >
                <IconTrash size={12} stroke={1.75} /> 清空日志
              </button>
            </div>
            <div ref={plotLogRef} className="rx-log-area">
              {plotLogs.map((entry, i) => (
                <div key={i} className={`rx-log-line ${entry.level}`}>
                  <span className="rx-log-tag">[{entry.plotType}]</span>
                  {entry.msg}
                </div>
              ))}
              {plotLogs.length === 0 && (
                <div className="rx-empty-tip">
                  暂无日志。在右侧工作台点「导出此图」后,实时日志显示在此处。
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 大图查看弹窗 */}
      <Modal open={!!viewerFile} onClose={() => setViewerFile(null)} wide>
        {viewerFile && (
          <div className="rx-viewer">
            <div className="modal-header">
              <h3>{viewerFile.name}</h3>
            </div>
            <div className="rx-viewer-body">
              {viewerContent?.kind === "svg" ? (
                <span
                  className="rx-thumb-svg rx-viewer-svg"
                  dangerouslySetInnerHTML={{ __html: viewerContent.data }}
                />
              ) : viewerContent?.kind === "png" ? (
                <img src={viewerContent.data} alt={viewerFile.name} />
              ) : (
                <div className="rx-preview-empty">
                  <IconPhotoOff size={26} stroke={1.5} />
                  <span>该格式不支持内嵌预览,请打开输出目录查看</span>
                </div>
              )}
            </div>
            <div className="rx-viewer-footer">
              <button
                className="btn"
                onClick={() => galleryDir && void openInShell(galleryDir)}
              >
                <IconFolderOpen size={13} stroke={1.75} /> 打开所在目录
              </button>
              <button className="btn btn-primary" onClick={() => setViewerFile(null)}>
                关闭
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 自定义尺寸弹窗 */}
      <Modal open={customOpen} onClose={() => setCustomOpen(false)}>
        <div className="rx-custom-preset">
          <div className="modal-header">
            <h3>自定义尺寸</h3>
          </div>
          <div className="modal-body">
            <div className="form-group">
              <label>宽度(inches,单栏 3.5 / 双栏 7 / 全幅 ~9)</label>
              <input
                type="number"
                min={2}
                max={12}
                step={0.5}
                value={customW}
                onChange={(e) => setCustomW(Number(e.target.value))}
              />
            </div>
            <div className="form-group">
              <label>高度(inches,通常 4–6)</label>
              <input
                type="number"
                min={2}
                max={12}
                step={0.5}
                value={customH}
                onChange={(e) => setCustomH(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="rx-viewer-footer">
            <button className="btn" onClick={() => setCustomOpen(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                applyPreset({
                  id: "custom",
                  label: `自定义 ${customW}×${customH}`,
                  w: customW,
                  h: customH,
                });
                setCustomOpen(false);
              }}
            >
              应用到全部图
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
