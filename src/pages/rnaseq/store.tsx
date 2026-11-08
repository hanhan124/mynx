/**
 * RNA-seq 页面共享状态 — 配置 + 导入 + R 引擎运行 + 结果检测。
 * 配置结构与参考脚本 rnaseq_DE_heatmap.R 的 CONFIG 一一对应
 * (经 r/rnaseq_engine.R 的 params.json 契约)。
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
import { open, save } from "@tauri-apps/plugin-dialog";
import { showToast } from "@/components/Toast";
import {
  cleanGeneClusters,
  cleanGeneList,
  DEFAULT_MARKER_GENES,
  DEFAULT_GENE_CLUSTERS,
  defaultConfig,
  deepMerge,
} from "@/lib/rnaseq/defaults";
import { importCounts as importCountsApi } from "@/lib/rnaseq/matrix";
import { joinPath, pathDir } from "@/lib/rnaseq/io";
import {
  checkRscript,
  defaultOutputBase,
  resetRDependencyCache,
  resetRscriptCache,
  runR,
  type LogLevel,
  type RunHandle,
} from "@/lib/rnaseq/runner";
import {
  isRunDir,
  listResultImages,
  loadRunParams,
  readDeSummary,
} from "@/lib/rnaseq/results";
import type {
  DeSummaryRow,
  ImportData,
  MatrixFormat,
  ResultFileItem,
  RunStatus,
  RnaSeqConfig,
} from "@/lib/rnaseq/types";
import { validComparisonsOf } from "@/features/rnaseq/model/validation";

const LOG_CAP = 2000;

export interface RnaSeqStore {
  // ── 配置 ──
  config: RnaSeqConfig;
  updateConfig: (mutator: (draft: RnaSeqConfig) => void) => void;
  mergeConfig: (patch: Record<string, unknown>) => void;

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

  // ── 运行 ──
  runStatus: RunStatus;
  runLogs: { ts: number; msg: string; level: string }[];
  runOutputDir: string | null;
  runExitCode: number | null;
  elapsedSec: number;
  /** steps: de / heatmap / plots 的任意组合 */
  startRun: (steps: string[]) => Promise<void>;
  cancelRun: () => Promise<void>;

  // ── 结果 ──
  resultDir: string;
  hasResult: boolean;
  deSummary: DeSummaryRow[] | null;
  resultImages: ResultFileItem[];
  refreshResult: () => Promise<boolean>;
  loadResultDir: (path: string, opts?: { mergeParams?: boolean }) => Promise<boolean>;

  // ── 配置存取 ──
  saveConfig: () => Promise<void>;
  loadConfig: () => Promise<void>;
}

const RnaSeqContext = createContext<RnaSeqStore | null>(null);

export function useRnaSeq(): RnaSeqStore {
  const ctx = useContext(RnaSeqContext);
  if (!ctx) throw new Error("useRnaSeq must be used within RnaSeqProvider");
  return ctx;
}

export function RnaSeqProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<RnaSeqConfig>(() => defaultConfig());
  // 供异步回调读取最新配置(避免闭包过期)
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const updateConfig = useCallback((mutator: (draft: RnaSeqConfig) => void) => {
    setConfig((prev) => {
      const draft = structuredClone(prev);
      mutator(draft);
      return draft;
    });
  }, []);

  const mergeConfig = useCallback((patch: Record<string, unknown>) => {
    setConfig((prev) => {
      const merged = deepMerge(prev, patch);
      merged.overall_genes = cleanGeneList(merged.overall_genes);
      merged.gene_clusters = cleanGeneClusters(merged.gene_clusters);
      if (merged.overall_heatmap?.marker_genes)
        merged.overall_heatmap.marker_genes = cleanGeneList(
          merged.overall_heatmap.marker_genes,
        );
      if (merged.overall_heatmap && !merged.overall_heatmap.marker_genes?.length)
        merged.overall_heatmap.marker_genes = [...DEFAULT_MARKER_GENES];
      if (!merged.gene_clusters || Object.keys(merged.gene_clusters).length === 0)
        merged.gene_clusters = Object.fromEntries(
          Object.entries(DEFAULT_GENE_CLUSTERS).map(([k, v]) => [k, [...v]]),
        );
      return merged;
    });
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
      setConfig((prev) => ({
        ...prev,
        data_file: actual,
        input: { ...prev.input, count_file: actual },
      }));
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
    resetRDependencyCache();
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

  // ── 运行状态 ──
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [runLogs, setRunLogs] = useState<{ ts: number; msg: string; level: string }[]>([]);
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
  }, []);

  const startRun = useCallback(
    async (steps: string[]) => {
      const cfg = configRef.current;
      // 前置校验
      if (!cfg.data_file) {
        showToast("请先导入 Counts 数据文件", "error");
        return;
      }
      if (steps.includes("de") && validComparisonsOf(cfg).length === 0) {
        showToast("请先完成分组并至少配置一个有效的比较(case ≠ control)", "error");
        return;
      }
      setRunLogs([]);
      setRunOutputDir(null);
      setRunExitCode(null);
      setElapsedSec(0);
      setRunStatus("running");
      const runCfg: RnaSeqConfig = { ...structuredClone(cfg), steps };
      const outputBase = runCfg.output_dir?.trim() || (await defaultOutputBase());
      try {
        const handle = await runR(runCfg, { onLog: pushLog });
        runHandleRef.current = handle;
        setRunOutputDir(handle.outputDir);
        const r = await handle.promise;
        setRunExitCode(r.exitCode);
        setRunStatus(r.status);
        if (r.status === "done") {
          setConfig((prev) => ({ ...prev, output_dir: outputBase, run_name: r.runName }));
        }
      } catch (e) {
        pushLog("error", `启动失败:${e instanceof Error ? e.message : String(e)}`);
        setRunStatus("failed");
      }
    },
    [pushLog],
  );

  const cancelRun = useCallback(async () => {
    try {
      await runHandleRef.current?.cancel();
    } catch {
      /* close 事件兜底 */
    }
  }, []);

  // ── 结果检测 ──
  const [resultDir, setResultDir] = useState("");
  const [hasResult, setHasResult] = useState(false);
  const [deSummary, setDeSummary] = useState<DeSummaryRow[] | null>(null);
  const [resultImages, setResultImages] = useState<ResultFileItem[]>([]);

  const refreshResult = useCallback(async (): Promise<boolean> => {
    const cfg = configRef.current;
    // 已知运行目录优先;否则按 output_dir + run_name 推导
    let dir = resultDir;
    if (!dir && cfg.output_dir && cfg.run_name && cfg.run_name !== "auto") {
      dir = joinPath(cfg.output_dir, cfg.run_name);
    }
    if (!dir) {
      setHasResult(false);
      setDeSummary(null);
      setResultImages([]);
      return false;
    }
    const ok = await isRunDir(dir);
    setHasResult(ok);
    if (ok) {
      setResultDir(dir);
      const [summary, images] = await Promise.all([
        readDeSummary(dir),
        listResultImages(dir),
      ]);
      setDeSummary(summary);
      setResultImages(images);
    } else {
      setDeSummary(null);
      setResultImages([]);
    }
    return ok;
  }, [resultDir]);

  const loadResultDir = useCallback(
    async (path: string, opts?: { mergeParams?: boolean }): Promise<boolean> => {
      const p = (path || "").trim();
      if (!p) return false;
      const ok = await isRunDir(p);
      if (!ok) {
        showToast("该目录不是引擎运行结果目录(缺少 DE/heatmap/plots)", "error");
        return false;
      }
      setResultDir(p);
      const summary = await readDeSummary(p);
      const images = await listResultImages(p);
      setDeSummary(summary);
      setResultImages(images);
      setHasResult(true);
      const norm = p.replace(/[\\/]+$/, "");
      const runName = norm.slice(Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/")) + 1);
      const baseDir = pathDir(norm);
      const setRun = (prev: RnaSeqConfig) => ({
        ...prev,
        output_dir: baseDir || prev.output_dir,
        run_name: runName,
      });
      if (opts?.mergeParams !== false) {
        const { params } = await loadRunParams(p);
        if (params) {
          mergeConfig(params);
          setConfig(setRun);
          showToast("已加载结果并还原配置", "success");
        } else {
          setConfig(setRun);
          showToast("已加载结果目录(未找到 prepared/params.json,保留当前配置)", "info");
        }
      } else {
        setConfig(setRun);
      }
      return true;
    },
    [mergeConfig],
  );

  // 运行结束后自动刷新结果
  useEffect(() => {
    if (runStatus === "done") void refreshResult();
  }, [runStatus, refreshResult]);

  // ── 配置存取 ──
  const saveConfig = useCallback(async (): Promise<void> => {
    let defaultPath = "rnaseq_config.json";
    try {
      const { homeDir } = await import("@tauri-apps/api/path");
      defaultPath = joinPath(await homeDir(), "rnaseq_config.json");
    } catch {
      /* 对话框用各自默认目录 */
    }
    const r = await save({
      defaultPath,
      filters: [{ name: "JSON 配置文件", extensions: ["json"] }],
    });
    if (typeof r !== "string" || !r) return;
    try {
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const { steps: _s, ...serializable } = configRef.current as unknown as Record<string, unknown>;
      void _s;
      await writeFile(r, new TextEncoder().encode(JSON.stringify(serializable, null, 2)));
      showToast(`配置已保存:${r}`, "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, []);

  const loadConfig = useCallback(async (): Promise<void> => {
    const picked = await open({
      multiple: false,
      filters: [{ name: "JSON 配置", extensions: ["json"] }],
    });
    if (!picked) return;
    const p = Array.isArray(picked) ? picked[0] : picked;
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const text = await readTextFile(p);
      const parsed = JSON.parse(text) as Record<string, unknown>;
      // 先重置为默认再深合并,防止旧/残缺配置缺字段导致页面崩溃
      setConfig(defaultConfig());
      mergeConfig(parsed);
      // 若含数据文件,尝试重新导入;失败仅提示
      const df = typeof parsed.data_file === "string" ? parsed.data_file : "";
      const cf =
        parsed.input && typeof (parsed.input as Record<string, unknown>).count_file === "string"
          ? ((parsed.input as Record<string, unknown>).count_file as string)
          : "";
      if (df || cf) {
        try {
          await doImport(df || cf);
        } catch {
          showToast("配置中的数据文件无法导入,请检查路径或重新导入", "info");
        }
      }
      showToast("配置已加载,请核对分组与比较设置", "success");
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [mergeConfig, doImport]);

  const value = useMemo<RnaSeqStore>(
    () => ({
      config,
      updateConfig,
      mergeConfig,
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
      runOutputDir,
      runExitCode,
      elapsedSec,
      startRun,
      cancelRun,
      resultDir,
      hasResult,
      deSummary,
      resultImages,
      refreshResult,
      loadResultDir,
      saveConfig,
      loadConfig,
    }),
    [
      config,
      updateConfig,
      mergeConfig,
      importData,
      importSourcePath,
      successfulImportPath,
      matrixFormat,
      doImport,
      rscriptFound,
      recheckRscript,
      runStatus,
      runLogs,
      runOutputDir,
      runExitCode,
      elapsedSec,
      startRun,
      cancelRun,
      resultDir,
      hasResult,
      deSummary,
      resultImages,
      refreshResult,
      loadResultDir,
      saveConfig,
      loadConfig,
    ],
  );

  return <RnaSeqContext.Provider value={value}>{children}</RnaSeqContext.Provider>;
}
