/**
 * 运行记录 / 分析结果缓存 / 绘图文件管理
 * — Go 端 ListRuns / ValidateAnalysisDir / HasAnalysisResult /
 *   LoadAnalysisResult / PlotFiles / ReadPlotFile 的 TS 移植。
 */
import {
  bytesToBase64,
  fmtDateTime,
  joinPath,
  pathBase,
  readBytesAny,
  readDirAny,
  readTextAny,
  statAny,
} from "./io";
import { defaultOutputBase } from "./runner";
import type { Config, PlotFileContent, PlotFileItem, RunItem } from "./types";

export const EXCEL_NAME = "RNAseq_Analysis_Results.xlsx";

async function listSubDirs(base: string): Promise<string[]> {
  try {
    const entries = await readDirAny(base);
    return entries.filter((e) => e.isDir).map((e) => e.name);
  } catch {
    return [];
  }
}

/** 扫描某目录下的 run 子目录(名称降序 = 最新在前);单个子目录异常不拖垮整表 */
async function scanRuns(base: string): Promise<RunItem[]> {
  const names = (await listSubDirs(base)).sort().reverse();
  const items: RunItem[] = [];
  for (const name of names) {
    try {
      const d = joinPath(base, name);
      const excelStat = await statAny(joinPath(d, EXCEL_NAME));
      let nPlots: number;
      try {
        const plots = await readDirAny(joinPath(d, "plots"));
        nPlots = plots.length;
      } catch {
        nPlots = 0;
      }
      const dirStat = await statAny(d);
      items.push({
        name,
        base_dir: base,
        has_excel: !!excelStat,
        n_plots: nPlots,
        mtime: dirStat ? fmtDateTime(dirStat.mtimeMs) : "",
      });
    } catch {
      /* 跳过无法读取的子目录(如失败 run 缺产物) */
    }
  }
  return items;
}

/** 列出最近运行(自定义输出目录 + 默认目录,同名去重:优先含 Excel,其次取更新的) */
export async function listRuns(outputDir: string): Promise<RunItem[]> {
  const byName = new Map<string, RunItem>();
  const appendDir = async (base: string) => {
    for (const it of await scanRuns(base)) {
      const prev = byName.get(it.name);
      if (prev) {
        if (prev.has_excel && !it.has_excel) continue;
        if ((!prev.has_excel && it.has_excel) || prev.mtime < it.mtime) {
          byName.set(it.name, it);
        }
      } else {
        byName.set(it.name, it);
      }
    }
  };
  const p = outputDir.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  if (p) await appendDir(p);
  await appendDir(await defaultOutputBase());
  return [...byName.values()].sort((a, b) => {
    if (a.mtime !== b.mtime) return a.mtime > b.mtime ? -1 : 1;
    return a.name > b.name ? -1 : 1;
  });
}

export interface ValidatedDir {
  found: boolean;
  run_name?: string;
  output_dir?: string;
  excel_file?: string;
  error?: string;
}

/** 校验差异分析结果目录:本身是 run 目录,或含最新 run 子目录 */
export async function validateAnalysisDir(path: string): Promise<ValidatedDir> {
  const p = path.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  if (!p) return { found: false, error: "未指定目录" };
  const st = await statAny(p);
  if (!st || !st.isDir) return { found: false, error: `目录不存在: ${p}` };

  if (await statAny(joinPath(p, EXCEL_NAME))) {
    return {
      found: true,
      run_name: pathBase(p),
      output_dir: parentOf(p),
      excel_file: joinPath(p, EXCEL_NAME),
    };
  }
  for (const name of (await listSubDirs(p)).sort().reverse()) {
    const d = joinPath(p, name);
    if (await statAny(joinPath(d, EXCEL_NAME))) {
      return {
        found: true,
        run_name: name,
        output_dir: p,
        excel_file: joinPath(d, EXCEL_NAME),
      };
    }
  }
  return {
    found: false,
    error: "该目录下未找到差异分析结果(RNAseq_Analysis_Results.xlsx)",
  };
}

function parentOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : path;
}

/** 检查是否存在可用的 DEG 分析缓存(单图导出依赖) */
export async function hasAnalysisResult(
  config: Pick<Config, "output_dir" | "run_name">,
): Promise<{ found: boolean; run_name?: string; output_dir?: string }> {
  const scanDir = async (base: string) => {
    for (const name of (await listSubDirs(base)).sort().reverse()) {
      if (await statAny(joinPath(joinPath(base, name), EXCEL_NAME))) {
        return { name, base };
      }
    }
    return null;
  };

  const ob = config.output_dir?.trim() ?? "";
  if (ob) {
    const rn = config.run_name?.trim() ?? "";
    if (rn && rn !== "auto") {
      const d = joinPath(ob, rn);
      if (await statAny(joinPath(d, EXCEL_NAME))) {
        return { found: true, run_name: rn, output_dir: ob };
      }
    }
    const hit = await scanDir(ob);
    if (hit) return { found: true, run_name: hit.name, output_dir: hit.base };
  }
  const hit = await scanDir(await defaultOutputBase());
  if (hit) return { found: true, run_name: hit.name, output_dir: hit.base };
  return { found: false };
}

export interface LoadedAnalysisResult {
  found: boolean;
  run_name?: string;
  output_dir?: string;
  excel_file?: string;
  has_params?: boolean;
  params?: Record<string, unknown>;
  n_plots?: number;
  error?: string;
}

/** 从 run 目录加载缓存,可选合并 params.json 还原配置 */
export async function loadAnalysisResult(
  path: string,
  loadParams: boolean,
): Promise<LoadedAnalysisResult> {
  const v = await validateAnalysisDir(path);
  if (!v.found) return { found: false, error: v.error };
  const outDir = v.output_dir!;
  const runName = v.run_name!;
  const runPath = joinPath(outDir, runName);
  const result: LoadedAnalysisResult = {
    found: true,
    run_name: runName,
    output_dir: outDir,
    excel_file: v.excel_file,
    has_params: false,
  };
  if (loadParams) {
    try {
      const text = await readTextAny(joinPath(runPath, "params.json"));
      const cfg = JSON.parse(text) as Record<string, unknown>;
      // 强制对齐本次结果目录,避免 params 里旧 output_dir 覆盖
      cfg.output_dir = outDir;
      cfg.run_name = runName;
      result.params = cfg;
      result.has_params = true;
    } catch {
      /* params 缺失或损坏不阻塞 */
    }
  }
  try {
    const plots = await readDirAny(joinPath(runPath, "plots"));
    result.n_plots = plots.length;
  } catch {
    result.n_plots = 0;
  }
  return result;
}

/** 列出 <outputDir>/<runName>/plots 下的图文件(按 mtime 升序,新文件在后) */
export async function plotFiles(
  outputDir: string,
  runName: string,
): Promise<{ files: PlotFileItem[]; dir: string }> {
  const base = outputDir || (await defaultOutputBase());
  const dir = joinPath(joinPath(base, runName), "plots");
  const files: PlotFileItem[] = [];
  try {
    const entries = await readDirAny(dir);
    for (const e of entries) {
      if (e.isDir) continue;
      const ext = e.name.slice(e.name.lastIndexOf(".")).toLowerCase();
      if (ext !== ".svg" && ext !== ".png" && ext !== ".pdf") continue;
      files.push({
        name: e.name,
        size: e.size,
        // 含秒,便于前端缓存指纹在同分钟内重绘时失效
        mtime: fmtDateTime(e.mtimeMs, true),
      });
    }
  } catch {
    return { files: [], dir };
  }
  files.sort((a, b) => {
    if (a.mtime !== b.mtime) return a.mtime < b.mtime ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  });
  return { files, dir };
}

const MAX_PLOT_BYTES = 32 << 20;

/** 读取单个图文件内容(SVG 文本 / PNG base64;PDF 不支持内嵌) */
export async function readPlotFile(
  dir: string,
  fileName: string,
): Promise<PlotFileContent> {
  if (!fileName || fileName !== pathBase(fileName) || /[\\/]/.test(fileName)) {
    return { error: "非法文件名" };
  }
  const d = dir.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  if (!d) return { error: "未指定目录" };
  const p = joinPath(d, fileName);
  const st = await statAny(p);
  if (!st || st.isDir) return { error: `文件不存在: ${fileName}` };
  if (st.size > MAX_PLOT_BYTES) {
    return { error: "文件过大(>32MB),请直接打开目录查看" };
  }
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (ext === ".svg") {
    const content = await readTextAny(p);
    return { kind: "svg", content, name: fileName };
  }
  if (ext === ".png") {
    const bytes = await readBytesAny(p);
    return { kind: "png", data_base64: bytesToBase64(bytes), name: fileName };
  }
  if (ext === ".pdf") {
    return { kind: "pdf", unsupported: true, name: fileName };
  }
  return { error: `不支持的文件类型: ${ext}` };
}
