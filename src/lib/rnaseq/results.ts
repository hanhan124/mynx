/**
 * 运行结果层 — 对 rnaseq_engine.R(参考脚本)的输出目录布局:
 *   <run_dir>/{DE,heatmap,plots,data,logs,prepared}
 * prepared/params.json 由 runner 写入,用于「加载历史结果」还原配置。
 */
import { readTextAny, readBytesAny, readDirAny, joinPath, statAny } from "./io.ts";
import { parseDelimited, detectDelimiter } from "./matrix.ts";
import { deepMerge, defaultConfig } from "./defaults.ts";
import type {
  DeSummaryRow,
  RnaSeqConfig,
  ResultFileItem,
} from "./types.ts";

/** 运行目录下引擎产出的子目录 */
export const RESULT_IMAGE_DIRS = ["heatmap", "plots"] as const;

function pathBase(path: string): string {
  const norm = path.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

/** 目录是否存在(不可访问按不存在处理) */
async function dirExists(path: string): Promise<boolean> {
  const st = await statAny(path).catch(() => null);
  return !!st?.isDir;
}

/** 判断一个目录是否为引擎运行目录(DE/ 或 heatmap/ 或 plots/ 任一存在) */
export async function isRunDir(path: string): Promise<boolean> {
  if (!path.trim()) return false;
  for (const d of RESULT_IMAGE_DIRS) {
    if (await dirExists(joinPath(path, d))) return true;
  }
  return await dirExists(joinPath(path, "DE"));
}

/** 运行是否已有可用结果(DE_summary.csv 存在) */
export async function hasDeResult(runDir: string): Promise<boolean> {
  if (!runDir.trim()) return false;
  return await dirExists(joinPath(runDir, "DE"));
}

/** 读取 prepared/params.json(运行时由 runner 写入的最终参数) */
export async function loadRunParams(
  runDir: string,
): Promise<{ params: Record<string, unknown> | null; error?: string }> {
  const p = joinPath(runDir, "prepared", "params.json");
  try {
    const text = await readTextAny(p);
    return { params: JSON.parse(text) as Record<string, unknown> };
  } catch (e) {
    return { params: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 用历史 params 深合并还原配置(缺字段回退默认值) */
export function mergeRunParams(
  config: RnaSeqConfig,
  params: Record<string, unknown>,
): RnaSeqConfig {
  // 步骤/运行态字段不还原
  const { steps: _s, ...rest } = params as Record<string, unknown>;
  void _s;
  const merged = deepMerge(defaultConfig(), rest);
  // 输出目录以实际加载的运行目录为准
  merged.output_dir = config.output_dir;
  merged.run_name = config.run_name || merged.run_name;
  return merged;
}

/** 列出运行目录下的图片(png/svg/pdf) */
export async function listResultImages(
  runDir: string,
): Promise<ResultFileItem[]> {
  const out: ResultFileItem[] = [];
  for (const subdir of RESULT_IMAGE_DIRS) {
    const dir = joinPath(runDir, subdir);
    const entries = await readDirAny(dir).catch(() => []);
    for (const e of entries) {
      if (e.isDir) continue;
      if (!/\.(png|svg|pdf)$/i.test(e.name)) continue;
      out.push({ name: e.name, subdir, size: e.size, mtimeMs: e.mtimeMs });
    }
  }
  out.sort((a, b) =>
    a.subdir === b.subdir
      ? a.name.localeCompare(b.name)
      : a.subdir.localeCompare(b.subdir),
  );
  return out;
}

/** 读取图片字节为 data URL(png/svg 可直接内联展示) */
export async function readImageDataURL(
  runDir: string,
  subdir: string,
  name: string,
): Promise<string> {
  const bytes = await readBytesAny(joinPath(runDir, subdir, name));
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : ext === "pdf" ? "application/pdf" : "image/png";
  return `data:${mime};base64,${btoa(binary)}`;
}

/** 解析 CSV/TSV 文本为对象数组(表头为键) */
export function parseCsvText(text: string): Record<string, string>[] {
  const delim = detectDelimiter(text);
  const rows = parseDelimited(text, delim);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.replace(/^\ufeff/, "").trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = (r[i] ?? "").trim()));
      return obj;
    });
}

/** 读取 DE/DE_summary.csv */
export async function readDeSummary(
  runDir: string,
): Promise<DeSummaryRow[] | null> {
  try {
    const text = await readTextAny(joinPath(runDir, "DE", "DE_summary.csv"));
    const rows = parseCsvText(text);
    if (!rows.length) return null;
    return rows.map((r) => ({
      comparison: r.comparison ?? "",
      case: r.case ?? "",
      control: r.control ?? "",
      n_case: Number(r.n_case) || 0,
      n_control: Number(r.n_control) || 0,
      path: r.path ?? "",
      method: r.method ?? "",
      genes_tested: Number(r.genes_tested) || 0,
      padj_cutoff: Number(r.padj_cutoff) || 0,
      log2fc_cutoff: Number(r.log2fc_cutoff) || 0,
      Up: Number(r.Up) || 0,
      Down: Number(r.Down) || 0,
    }));
  } catch {
    return null;
  }
}

/** 读取单个比较结果表(供预览) */
export async function readDeTable(
  runDir: string,
  comparison: string,
): Promise<Record<string, string>[] | null> {
  try {
    const text = await readTextAny(
      joinPath(runDir, "DE", `DE_${comparison}.csv`),
    );
    return parseCsvText(text);
  } catch {
    return null;
  }
}

/** 扫描输出根目录下的历史运行目录(含 results 布局者),新到旧 */
export async function listRunDirs(outputBase: string): Promise<string[]> {
  const entries = await readDirAny(outputBase).catch(() => []);
  const runs: { path: string; mtimeMs: number }[] = [];
  for (const e of entries) {
    if (!e.isDir) continue;
    const p = joinPath(outputBase, e.name);
    if (await isRunDir(p)) runs.push({ path: p, mtimeMs: e.mtimeMs });
  }
  runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return runs.map((r) => r.path);
}

export { pathBase, joinPath };
