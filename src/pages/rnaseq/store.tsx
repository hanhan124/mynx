/**
 * RNA-seq 页面共享状态 — 对应原 Vue/Pinia 的 config + run + analysisResult 三 store。
 * 以 React Context 提供;配置更新走结构化克隆保证不可变渲染。
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { showToast } from "@/components/Toast";
import { open, save } from "@tauri-apps/plugin-dialog";
import { defaultConfig, defaultPlotOptions, deepMerge } from "@/lib/rnaseq/defaults";
import { importCounts as importCountsApi } from "@/lib/rnaseq/matrix";
import {
  checkRscript,
  resetRscriptCache,
  runR,
  type LogLevel,
  type RunHandle,
  type RunResult,
} from "@/lib/rnaseq/runner";
import {
  hasAnalysisResult as hasAnalysisResultApi,
  loadAnalysisResult,
} from "@/lib/rnaseq/runs";
import type {
  Config,
  ImportData,
  LogEntry,
  MatrixFormat,
  RunStatus,
} from "@/lib/rnaseq/types";
export { batchConfounded, validComparisonsOf } from "@/features/rnaseq/model/validation";

export interface PlotLogEntry extends LogEntry {
  plotType: string;
}

export interface RnaSeqStore {
  // ── 配置 ──
  config: Config;
  updateConfig: (mutator: (draft: Config) => void) => void;
  replaceConfig: (next: Config) => void;
  mergeConfig: (patch: Record<string, unknown>) => void;
  resetPlotOption: (id: string) => void;
  resetAllPlotOptions: () => void;
  remapGroup: (oldName: string, newName: string) => void;
  removeGroupRefs: (name: string) => void;
  clearDownstream: () => void;

  // ── 导入 ──
  importData: ImportData | null;
  importSourcePath: string;
  successfulImportPath: string;
  matrixFormat: MatrixFormat;
  setMatrixFormat: (f: MatrixFormat) => void;
  doImport: (path: string, fmt?: string) => Promise<ImportData>;

  // ── Rscript ──
  rscriptFound: boolean | null;
  recheckRscript: () => Promise<boolean>;

  // ── DEG 运行 ──
  runStatus: RunStatus;
  runLogs: LogEntry[];
  stepsDone: number;
  stepsTotal: number;
  runOutputDir: string | null;
  runExitCode: number | null;
  elapsedSec: number;
  startRun: () => Promise<void>;
  cancelRun: () => Promise<void>;

  // ── 绘图导出 ──
  plotStatus: RunStatus;
  plotLogs: PlotLogEntry[];
  currentPlot: string | null;
  plotOutputDir: string | null;
  runSinglePlot: (
    plotType: string,
    opts?: { preview?: boolean; silent?: boolean },
  ) => Promise<RunResult | null>;
  cancelPlot: () => Promise<void>;
  clearPlotLogs: () => void;

  // ── 分析结果检测 ──
  hasResult: boolean;
  checkingResult: boolean;
  dirStatus: "none" | "ok" | "err";
  dirMsg: string;
  analysisDir: string;
  usingManualDir: boolean;
  dirChecking: boolean;
  mergeParamsOnLoad: boolean;
  setMergeParamsOnLoad: (v: boolean) => void;
  checkResult: () => Promise<boolean>;
  validateDir: (path?: string, opts?: { quiet?: boolean }) => Promise<boolean>;
  browseAnalysisDir: () => Promise<boolean>;
  loadFromPath: (
    path: string,
    opts?: { mergeParams?: boolean; quiet?: boolean },
  ) => Promise<boolean>;
  useAutoDetect: () => void;
  /** 保存当前实验设计/参数配置到 JSON(剔除运行态),走 Tauri 原生对话框选路径 */
  saveConfig: (
    savePath?: string,
  ) => Promise<{ saved: boolean; path?: string; error?: string }>;
  /** 从 config.json / params.json 加载配置(深合并还原),可选导入 data_file / 定位结果 */
  loadConfig: (loadPath: string) => Promise<{ ok: boolean; error?: string }>;
}

const LOG_CAP = 2000;

const RnaSeqContext = createContext<RnaSeqStore | null>(null);

export function useRnaSeq(): RnaSeqStore {
  const ctx = useContext(RnaSeqContext);
  if (!ctx) throw new Error("useRnaSeq must be used within RnaSeqProvider");
  return ctx;
}

export function RnaSeqProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<Config>(() => defaultConfig());
  // 供异步回调读取最新配置(避免闭包过期)
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const updateConfig = useCallback((mutator: (draft: Config) => void) => {
    setConfig((prev) => {
      const draft = structuredClone(prev);
      mutator(draft);
      return draft;
    });
  }, []);

  const replaceConfig = useCallback((next: Config) => setConfig(next), []);

  const mergeConfig = useCallback((patch: Record<string, unknown>) => {
    setConfig((prev) => {
      const merged = deepMerge(prev, patch);
      if (!Array.isArray(merged.plot_formats) || merged.plot_formats.length === 0) {
        merged.plot_formats = ["png"];
      }
      return merged;
    });
  }, []);

  const resetPlotOption = useCallback((id: string) => {
    setConfig((prev) => {
      const next = structuredClone(prev);
      const def = (defaultPlotOptions() as Record<string, unknown>)[id];
      if (def) (next.plot_options as Record<string, unknown>)[id] = def;
      return next;
    });
  }, []);

  const resetAllPlotOptions = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      plot_options: defaultPlotOptions(),
    }));
  }, []);

  /** 组名重映射:改名/合并后同步所有 plot_options 子集 */
  const remapGroup = useCallback((oldName: string, newName: string) => {
    setConfig((prev) => {
      const next = structuredClone(prev);
      const po = next.plot_options as Record<string, Record<string, unknown>>;
      for (const key of Object.keys(po)) {
        const o = po[key];
        if (Array.isArray(o.groups)) {
          o.groups = o.groups.map((g: string) => (g === oldName ? newName : g));
        }
        if (Array.isArray(o.column_group_order)) {
          o.column_group_order = o.column_group_order.map((g: string) =>
            g === oldName ? newName : g,
          );
        }
        if (Array.isArray(o.comparisons)) {
          o.comparisons = (o.comparisons as [string, string][])
            .map(
              (c) =>
                [
                  c[0] === oldName ? newName : c[0],
                  c[1] === oldName ? newName : c[1],
                ] as [string, string],
            )
            .filter((c) => c[0] !== c[1]);
        }
      }
      return next;
    });
  }, []);

  /** 删除组:清理所有 plot_options 子集引用 */
  const removeGroupRefs = useCallback((name: string) => {
    setConfig((prev) => {
      const next = structuredClone(prev);
      const po = next.plot_options as Record<string, Record<string, unknown>>;
      for (const key of Object.keys(po)) {
        const o = po[key];
        if (Array.isArray(o.groups)) {
          o.groups = o.groups.filter((g: string) => g !== name);
        }
        if (Array.isArray(o.column_group_order)) {
          o.column_group_order = o.column_group_order.filter((g: string) => g !== name);
        }
        if (Array.isArray(o.comparisons)) {
          o.comparisons = (o.comparisons as [string, string][]).filter(
            (c) => c[0] !== name && c[1] !== name,
          );
        }
      }
      return next;
    });
  }, []);

  /** 切换数据文件后清空下游(分组/比较/绘图自定义) */
  const clearDownstream = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      groups: {},
      group_display: {},
      group_order: [],
      selected_groups: [],
      comparisons: [],
      batches: {},
      plot_options: defaultPlotOptions(),
    }));
  }, []);

  // ── 导入 ──
  const [importData, setImportData] = useState<ImportData | null>(null);
  const [importSourcePath, setImportSourcePath] = useState("");
  const [successfulImportPath, setSuccessfulImportPath] = useState("");
  const [matrixFormat, setMatrixFormat] = useState<MatrixFormat>("counts_matrix");

  const doImport = useCallback(
    async (path: string, fmt?: string) => {
      const useFmt = (fmt || matrixFormat || "counts_matrix") as string;
      setMatrixFormat(useFmt as MatrixFormat);
      const r = await importCountsApi(path, 5, useFmt);
      setImportData(r);
      const actual = r.data_file || path;
      setConfig((prev) => ({ ...prev, data_file: actual }));
      setSuccessfulImportPath(actual);
      setImportSourcePath(r.source_file || path);
      if (r.matrix_format) setMatrixFormat(String(r.matrix_format) as MatrixFormat);
      return r;
    },
    [matrixFormat],
  );

  // ── Rscript ──
  const [rscriptFound, setRscriptFound] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    checkRscript()
      .then((r) => {
        if (alive) setRscriptFound(r.found);
      })
      .catch(() => {
        if (alive) setRscriptFound(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const recheckRscript = useCallback(async () => {
    resetRscriptCache();
    setRscriptFound(null);
    try {
      const r = await checkRscript();
      setRscriptFound(r.found);
      return r.found;
    } catch {
      setRscriptFound(false);
      return false;
    }
  }, []);

  // ── DEG 运行状态 ──
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [runLogs, setRunLogs] = useState<LogEntry[]>([]);
  const [stepsDone, setStepsDone] = useState(0);
  const [stepsTotal, setStepsTotal] = useState(0);
  const [runOutputDir, setRunOutputDir] = useState<string | null>(null);
  const [runExitCode, setRunExitCode] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const runHandleRef = useRef<RunHandle | null>(null);

  useEffect(() => {
    if (runStatus !== "running") return;
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [runStatus]);

  const pushLog = useCallback((level: LogLevel, msg: string) => {
    setRunLogs((prev) => {
      const next = [...prev, { ts: Date.now(), level, msg }];
      if (next.length > LOG_CAP) next.splice(0, next.length - LOG_CAP);
      return next;
    });
    if (msg.includes("[OK]")) setStepsDone((n) => n + 1);
  }, []);

  const startRun = useCallback(async () => {
    setRunLogs([]);
    setStepsDone(0);
    setRunOutputDir(null);
    setRunExitCode(null);
    setElapsedSec(0);
    setRunStatus("running");
    // 单 DEG 模式:所有图表在「绘图导出」逐张配置生成
    const cfg: Config = { ...configRef.current, steps: ["deg"] };
    setConfig(cfg);
    setStepsTotal(cfg.steps.length);
    try {
      const handle = await runR(cfg, { onLog: pushLog });
      runHandleRef.current = handle;
      setRunOutputDir(handle.outputDir);
      const r = await handle.promise;
      setRunExitCode(r.exitCode);
      setRunStatus(r.status);
    } catch (e) {
      pushLog("error", `启动失败:${e instanceof Error ? e.message : String(e)}`);
      setRunStatus("failed");
    }
  }, [pushLog]);

  const cancelRun = useCallback(async () => {
    try {
      await runHandleRef.current?.cancel();
    } catch {
      /* close 事件兜底 */
    }
  }, []);

  // ── 绘图导出状态 ──
  const [plotStatus, setPlotStatus] = useState<RunStatus>("idle");
  const [plotLogs, setPlotLogs] = useState<PlotLogEntry[]>([]);
  const [currentPlot, setCurrentPlot] = useState<string | null>(null);
  const [plotOutputDir, setPlotOutputDir] = useState<string | null>(null);
  const plotHandleRef = useRef<RunHandle | null>(null);

  const pushPlotLog = useCallback((plotType: string, level: string, msg: string) => {
    setPlotLogs((prev) => {
      const next = [...prev, { ts: Date.now(), level, msg, plotType }];
      if (next.length > LOG_CAP) next.splice(0, next.length - LOG_CAP);
      return next;
    });
  }, []);

  /** 单图导出/快速预览(preview=true 时 PNG@120dpi,R 侧走 RDS 缓存加速) */
  const runSinglePlot = useCallback(
    async (
      plotType: string,
      opts: { preview?: boolean; silent?: boolean } = {},
    ): Promise<RunResult | null> => {
      const preview = !!opts.preview;
      const cfg: Config = structuredClone(configRef.current);
      cfg.steps = [plotType];
      if (preview) {
        cfg.preview_mode = true;
        cfg.preview_dpi = 120;
        cfg.plot_formats = ["png"];
      } else {
        cfg.preview_mode = false;
      }
      // 单图导出依赖已有 DEG 缓存:run_name 未显式指定时自动复用最近含 Excel 的 run
      if (!cfg.run_name || cfg.run_name === "auto") {
        const r = await hasAnalysisResultApi(cfg);
        if (r.found) {
          if (r.run_name) cfg.run_name = r.run_name;
          if (r.output_dir) cfg.output_dir = r.output_dir;
        }
      }
      setPlotStatus("running");
      setCurrentPlot(plotType);
      pushPlotLog(plotType, "info", `──── 开始导出 ${plotType} ────`);
      try {
        const handle = await runR(cfg, {
          onLog: (level, msg) => pushPlotLog(plotType, level, msg),
        });
        plotHandleRef.current = handle;
        setPlotOutputDir(handle.outputDir);
        const r = await handle.promise;
        setPlotStatus(r.status);
        pushPlotLog(
          plotType,
          r.status === "done" ? "success" : r.status === "cancelled" ? "warning" : "error",
          r.status === "done"
            ? `[OK] ${plotType} 导出完成`
            : r.status === "cancelled"
              ? `[取消] ${plotType} 已取消`
              : `[失败] ${plotType} 导出失败(退出码 ${r.exitCode})`,
        );
        return r;
      } catch (e) {
        setPlotStatus("failed");
        pushPlotLog(
          plotType,
          "error",
          `[失败] ${plotType} 启动失败: ${e instanceof Error ? e.message : String(e)}`,
        );
        return null;
      }
    },
    [pushPlotLog],
  );

  const cancelPlot = useCallback(async () => {
    try {
      await plotHandleRef.current?.cancel();
    } catch {
      /* 状态通道兜底 */
    }
  }, []);

  const clearPlotLogs = useCallback(() => setPlotLogs([]), []);

  // ── 分析结果检测 ──
  const [hasResult, setHasResult] = useState(false);
  const [checkingResult, setCheckingResult] = useState(true);
  const [dirStatus, setDirStatus] = useState<"none" | "ok" | "err">("none");
  const [dirMsg, setDirMsg] = useState("");
  // dirMsg 引用(validateDir 的 toast 用最新值)
  const dirMsgRef = useRef("");
  useEffect(() => {
    dirMsgRef.current = dirMsg;
  }, [dirMsg]);
  const [analysisDir, setAnalysisDir] = useState("");
  const [usingManualDir, setUsingManualDir] = useState(false);
  const [dirChecking, setDirChecking] = useState(false);
  const [mergeParamsOnLoad, setMergeParamsOnLoad] = useState(true);

  const applyLocatedResult = useCallback(
    (
      r: {
        output_dir: string;
        run_name: string;
        has_params?: boolean;
        params?: Record<string, unknown>;
        n_plots?: number;
      },
      opts?: { mergeParams?: boolean; quiet?: boolean },
    ) => {
      const merge = opts?.mergeParams ?? mergeParamsOnLoad;
      if (merge && r.params) {
        // 以历史 params 还原分组/比较/阈值;图格式始终回退 PNG
        const { plot_formats: _old, ...rest } = r.params as Record<string, unknown>;
        void _old;
        mergeConfig(rest);
      }
      setConfig((prev) => ({
        ...prev,
        output_dir: r.output_dir,
        run_name: r.run_name,
        plot_formats: prev.plot_formats?.length ? prev.plot_formats : ["png"],
      }));
      setHasResult(true);
      setDirStatus("ok");
      const plotsHint = typeof r.n_plots === "number" ? ` · ${r.n_plots} 张图` : "";
      const paramsHint = r.has_params || r.params ? " · 已载入 params" : "";
      setDirMsg(`已使用:${r.run_name}${paramsHint}${plotsHint}`);
      if (!opts?.quiet) {
        showToast(
          `已定位分析结果「${r.run_name}」${r.params ? "并还原配置" : ""},可直接绘图`,
          "success",
        );
      }
    },
    [mergeConfig, mergeParamsOnLoad],
  );

  const validateDir = useCallback(
    async (path?: string, opts?: { quiet?: boolean }): Promise<boolean> => {
      const p = (path ?? analysisDir).trim();
      if (!p) {
        setDirStatus("err");
        setDirMsg("请选择或输入差异分析结果目录");
        setHasResult(false);
        return false;
      }
      setDirChecking(true);
      try {
        const r = await loadAnalysisResult(p, mergeParamsOnLoad);
        if (r.found && r.output_dir && r.run_name) {
          applyLocatedResult(
            {
              output_dir: r.output_dir,
              run_name: r.run_name,
              has_params: r.has_params,
              params: r.params,
              n_plots: r.n_plots,
            },
            { quiet: opts?.quiet },
          );
          return true;
        }
        setHasResult(false);
        setDirStatus("err");
        setDirMsg(r.error || "未找到差异分析结果(RNAseq_Analysis_Results.xlsx)");
        if (!opts?.quiet)
          showToast(dirMsgRef.current || r.error || "目录校验失败", "error");
        return false;
      } catch {
        setHasResult(false);
        setDirStatus("err");
        setDirMsg("目录校验失败");
        return false;
      } finally {
        setDirChecking(false);
      }
    },
    [analysisDir, applyLocatedResult, mergeParamsOnLoad],
  );

  const browseAnalysisDir = useCallback(async (): Promise<boolean> => {
    const initial = analysisDir || configRef.current.output_dir || undefined;
    const picked = await open({
      directory: true,
      multiple: false,
      title: "选择差异分析结果目录(含 RNAseq_Analysis_Results.xlsx)",
      defaultPath: initial,
    });
    if (!picked) return false;
    const path = Array.isArray(picked) ? picked[0] : picked;
    setAnalysisDir(path);
    setUsingManualDir(true);
    return validateDir(path);
  }, [analysisDir, validateDir]);

  const loadFromPath = useCallback(
    async (
      path: string,
      opts?: { mergeParams?: boolean; quiet?: boolean },
    ): Promise<boolean> => {
      const p = (path || "").trim();
      if (!p) return false;
      setAnalysisDir(p);
      setUsingManualDir(true);
      if (opts?.mergeParams !== undefined) setMergeParamsOnLoad(opts.mergeParams);
      return validateDir(p, { quiet: opts?.quiet });
    },
    [validateDir],
  );

  const checkResult = useCallback(async (): Promise<boolean> => {
    setCheckingResult(true);
    try {
      if (usingManualDir && analysisDir.trim()) {
        return await validateDir(analysisDir, { quiet: true });
      }
      const r = await hasAnalysisResultApi(configRef.current);
      setHasResult(r.found);
      if (r.found && r.output_dir && r.run_name) {
        if (
          configRef.current.output_dir !== r.output_dir ||
          configRef.current.run_name !== r.run_name
        ) {
          setConfig((prev) => ({
            ...prev,
            output_dir: r.output_dir!,
            run_name: r.run_name!,
          }));
          setDirMsg(`自动检测到:${r.run_name}(已同步到运行配置)`);
        } else {
          setDirMsg(`自动检测到:${r.run_name}`);
        }
        setDirStatus("ok");
        return true;
      }
      setDirStatus("err");
      setDirMsg("未在输出目录检测到差异分析结果");
      return false;
    } catch {
      setHasResult(false);
      setDirStatus("err");
      setDirMsg("结果检测失败");
      return false;
    } finally {
      setCheckingResult(false);
    }
  }, [analysisDir, usingManualDir, validateDir]);

  const useAutoDetect = useCallback(() => {
    setUsingManualDir(false);
    setAnalysisDir("");
    void checkResult();
  }, [checkResult]);

  // DEG / 绘图结束后自动重新检测缓存
  const prevRunStatus = useRef(runStatus);
  useEffect(() => {
    if (runStatus === "done" || runStatus === "failed" || runStatus === "cancelled") {
      if (runStatus === "done") {
        // 新跑完的结果优先自动检测,不再强制 manual
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setUsingManualDir(false);
      }
      void checkResult();
    }
    prevRunStatus.current = runStatus;
  }, [runStatus, checkResult]);

  const prevPlotStatus = useRef(plotStatus);
  useEffect(() => {
    if (
      (plotStatus === "done" || plotStatus === "failed") &&
      prevPlotStatus.current === "running"
    ) {
      void checkResult();
    }
    prevPlotStatus.current = plotStatus;
  }, [plotStatus, checkResult]);

  // ── 配置存取(对齐 publication_pipeline_wails 的保存/加载配置) ──
  const saveConfig = useCallback(
    async (
      savePath?: string,
    ): Promise<{ saved: boolean; path?: string; error?: string }> => {
      let path = savePath;
      if (!path) {
        let defaultPath = "rnaseq_config.json";
        try {
          const { homeDir } = await import("@tauri-apps/api/path");
          const home = await homeDir();
          const { joinPath } = await import("@/lib/rnaseq/io");
          defaultPath = joinPath(home, "rnaseq_config.json");
        } catch {
          /* 退回裸文件名,对话框会用各自默认目录 */
        }
        const r = await save({
          defaultPath,
          filters: [{ name: "JSON 配置文件", extensions: ["json"] }],
        });
        if (typeof r !== "string" || !r) return { saved: false, error: "未选择保存路径" };
        path = r;
      }
      // 只序列化非运行态字段(剔除 steps / preview_mode 等运行态),
      // 字段集对齐 runner.R 的 params.json 契约,便于被「加载结果」复用。
      const c = configRef.current;
      const serializable = {
        data_file: c.data_file,
        output_dir: c.output_dir,
        run_name: c.run_name,
        groups: c.groups,
        group_display: c.group_display,
        group_order: c.group_order,
        selected_groups: c.selected_groups,
        comparisons: c.comparisons,
        batches: c.batches,
        params: c.params,
        marker_genes: c.marker_genes,
        gene_clusters: c.gene_clusters,
        excluded_genes: c.excluded_genes,
        plot_formats: c.plot_formats,
        size_mode: c.size_mode,
        plot_options: c.plot_options,
        font_family: c.font_family,
      };
      try {
        const { writeFile } = await import("@tauri-apps/plugin-fs");
        await writeFile(path, new TextEncoder().encode(JSON.stringify(serializable, null, 2)));
        return { saved: true, path };
      } catch (e) {
        return { saved: false, path, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [],
  );

  const loadConfig = useCallback(
    async (loadPath: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        const text = await readTextFile(loadPath);
        const parsed = JSON.parse(text) as Record<string, unknown>;
        // 先重置为默认,再深合并(防止旧/残缺配置缺字段导致页面崩溃)
        setConfig(defaultConfig());
        mergeConfig(parsed);
        // 若含 data_file,尝试重新导入以便后续重跑;失败仅提示
        if (typeof parsed.data_file === "string" && parsed.data_file) {
          try {
            await doImport(
              parsed.data_file,
              typeof parsed.matrix_format === "string"
                ? parsed.matrix_format
                : matrixFormat,
            );
          } catch {
            showToast("配置中的数据文件无法导入,请检查路径或重新导入", "info");
          }
        }
        // 来自 params.json 或含 output_dir:静默尝试把同目录标为结果源
        const pathNorm = loadPath.replace(/\\/g, "/");
        if (/params\.json$/i.test(pathNorm) || typeof parsed.output_dir === "string") {
          const runDir = pathNorm.replace(/\/[^/]+$/, "");
          await loadFromPath(runDir, { mergeParams: false, quiet: true }).catch(() => {});
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [mergeConfig, doImport, matrixFormat, loadFromPath],
  );

  const value = useMemo<RnaSeqStore>(
    () => ({
      config,
      updateConfig,
      replaceConfig,
      mergeConfig,
      resetPlotOption,
      resetAllPlotOptions,
      remapGroup,
      removeGroupRefs,
      clearDownstream,
      importData,
      importSourcePath,
      successfulImportPath,
      matrixFormat,
      setMatrixFormat,
      doImport,
      rscriptFound,
      recheckRscript,
      runStatus,
      runLogs,
      stepsDone,
      stepsTotal,
      runOutputDir,
      runExitCode,
      elapsedSec,
      startRun,
      cancelRun,
      plotStatus,
      plotLogs,
      currentPlot,
      plotOutputDir,
      runSinglePlot,
      cancelPlot,
      clearPlotLogs,
      hasResult,
      checkingResult,
      dirStatus,
      dirMsg,
      analysisDir,
      usingManualDir,
      dirChecking,
      mergeParamsOnLoad,
      setMergeParamsOnLoad,
      checkResult,
      validateDir,
      browseAnalysisDir,
      loadFromPath,
      useAutoDetect,
      saveConfig,
      loadConfig,
    }),
    [
      config,
      updateConfig,
      replaceConfig,
      mergeConfig,
      resetPlotOption,
      resetAllPlotOptions,
      remapGroup,
      removeGroupRefs,
      clearDownstream,
      importData,
      importSourcePath,
      successfulImportPath,
      matrixFormat,
      doImport,
      rscriptFound,
      recheckRscript,
      runStatus,
      runLogs,
      stepsDone,
      stepsTotal,
      runOutputDir,
      runExitCode,
      elapsedSec,
      startRun,
      cancelRun,
      plotStatus,
      plotLogs,
      currentPlot,
      plotOutputDir,
      runSinglePlot,
      cancelPlot,
      clearPlotLogs,
      hasResult,
      checkingResult,
      dirStatus,
      dirMsg,
      analysisDir,
      usingManualDir,
      dirChecking,
      mergeParamsOnLoad,
      checkResult,
      validateDir,
      browseAnalysisDir,
      loadFromPath,
      useAutoDetect,
      saveConfig,
      loadConfig,
    ],
  );

  return <RnaSeqContext.Provider value={value}>{children}</RnaSeqContext.Provider>;
}
