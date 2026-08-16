/**
 * Counts 矩阵导入/规范化 — Go 端 normalizeCountMatrix 的 TS 移植。
 * 行为对齐 normalize_matrix_test.go:
 *  - featureCounts 预设丢弃注释列,保留 Geneid + 数值样本列
 *  - HTSeq 预设过滤 __no_feature 等特殊行
 *  - 重复基因名按原始计数求和合并
 */
import { joinPath, pathBase, readBytesAny, readTextAny, statAny } from "./io";
import type { ImportData, MatrixFormat, PageData } from "./types";

// ── CSV 解析(RFC4180 + 宽松引号,对齐 Go csv.Reader LazyQuotes) ──
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      // 跳过(\r\n 与孤立 \r 均按行尾处理)
      if (src[i + 1] !== "\n") pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

/** 探测文本文件分隔符(\t 多于 , 判为 TSV) */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4096);
  let tabs = 0;
  let commas = 0;
  for (const ch of sample) {
    if (ch === "\t") tabs++;
    else if (ch === ",") commas++;
  }
  return tabs > commas ? "\t" : ",";
}

// ── 矩阵格式预设归一 ──
export function normalizeMatrixFormat(s: string): MatrixFormat {
  const v = s.trim().toLowerCase();
  if (v === "featurecounts" || v === "feature_counts" || v === "fc")
    return "featurecounts";
  if (v === "htseq" || v === "htseq_merged" || v === "htseq-count") return "htseq";
  return "counts_matrix";
}

const FEATURECOUNTS_ANNO_COLS = new Set([
  "chr",
  "chromosome",
  "start",
  "end",
  "strand",
  "length",
  "gene_length",
  "status",
  "biotype",
  "gene_biotype",
]);

const GENE_COL_PRIORITY = [
  "geneid",
  "gene_id",
  "genesymbol",
  "gene_symbol",
  "symbol",
  "gene_name",
  "genename",
  "gene",
  "id",
];

function pickGeneColIndex(headers: string[]): number {
  if (headers.length === 0) return 0;
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const name of GENE_COL_PRIORITY) {
    const idx = lower.indexOf(name);
    if (idx >= 0) return idx;
  }
  return 0;
}

function isNumericCell(s: string): boolean {
  const v = s.trim();
  if (v === "" || v === "NA" || v === "NaN" || v === "nan" || v === ".") return true;
  return Number.isFinite(Number(v));
}

function colMostlyNumeric(rows: string[][], col: number, maxCheck: number): boolean {
  if (col < 0) return false;
  let checked = 0;
  let numeric = 0;
  for (const row of rows) {
    if (col >= row.length) continue;
    const v = row[col].trim();
    if (v === "") continue;
    checked++;
    if (isNumericCell(v)) numeric++;
    if (checked >= maxCheck) break;
  }
  if (checked === 0) return false;
  return numeric / checked >= 0.85;
}

// ── FNV-1a 64(缓存键;与 Go fnv.New64a 结果一致) ──
function fnv1a64Hex(input: string): string {
  const prime = 0x100000001b3n;
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(input);
  for (const b of bytes) {
    hash ^= BigInt(b);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16);
}

function sanitizeFileBase(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

// ── xlsx 读取(exceljs,第一张表,全部转字符串) ──
async function readXlsxRows(path: string): Promise<string[][]> {
  const ExcelJS = await import("exceljs");
  const bytes = await readBytesAny(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Excel 文件没有工作表");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cellStr = (v: any): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") {
      if (v.text !== undefined) return String(v.text);
      if (v.result !== undefined) return String(v.result);
      if (v.richText) return v.richText.map((r: { text: string }) => r.text).join("");
      if (v.hyperlink) return String(v.text ?? "");
      if (v.error) return String(v.error);
      return "";
    }
    if (typeof v === "number") {
      if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
      return String(v);
    }
    return String(v);
  };
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vals: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      vals.push(cellStr(cell.value));
    });
    rows.push(vals);
  });
  return rows;
}

/** 读取 csv/tsv/txt/xlsx 全部行为字符串表 */
export async function readTableRows(
  src: string,
): Promise<{ rows: string[][]; format: string }> {
  const ext = pathExtLower(src);
  if (ext === ".xlsx") {
    const rows = await readXlsxRows(src);
    return { rows, format: "excel" };
  }
  if (ext === ".csv" || ext === ".tsv" || ext === ".txt") {
    const text = await readTextAny(src);
    const delim = detectDelimiter(text);
    const rows = parseDelimited(text, delim);
    return { rows, format: delim === "\t" ? "tsv" : "csv" };
  }
  throw new Error(`不支持的文件格式 ${ext}(支持 .csv/.tsv/.txt/.xlsx)`);
}

export function pathExtLower(p: string): string {
  const base = pathBase(p);
  const idx = base.lastIndexOf(".");
  return idx >= 0 ? base.slice(idx).toLowerCase() : "";
}

// ── 核心规范化:[gene_id, sample1, sample2, ...] ──
export function normalizeCountMatrix(
  allRows: string[][],
  preset: string,
): {
  headers: string[];
  body: string[][];
  applied: string;
  warnings: string[];
} {
  if (allRows.length === 0) throw new Error("文件为空,没有可读的数据");
  const rawHeaders = [...allRows[0]];
  if (rawHeaders.length < 2) {
    throw new Error("至少需要 1 列基因 ID + 1 列样本计数");
  }
  rawHeaders[0] = rawHeaders[0].replace(/^\ufeff/, "");
  const data = allRows.slice(1);
  const applied = normalizeMatrixFormat(preset);
  const warnings: string[] = [];

  const keepIdx: number[] = [];

  if (applied === "featurecounts") {
    const geneIdx = pickGeneColIndex(rawHeaders);
    for (let i = 0; i < rawHeaders.length; i++) {
      if (i === geneIdx) continue;
      const lh = rawHeaders[i].trim().toLowerCase();
      if (FEATURECOUNTS_ANNO_COLS.has(lh)) continue;
      if (colMostlyNumeric(data, i, 40)) {
        keepIdx.push(i);
      } else {
        warnings.push(`已跳过非数值列「${rawHeaders[i].trim()}」`);
      }
    }
    keepIdx.unshift(geneIdx);
  } else if (applied === "htseq") {
    keepIdx.push(0);
    for (let i = 1; i < rawHeaders.length; i++) {
      if (colMostlyNumeric(data, i, 40)) keepIdx.push(i);
    }
  } else {
    // counts_matrix:其余列都当样本;明显非数值则警告但保留
    keepIdx.push(0);
    for (let i = 1; i < rawHeaders.length; i++) {
      if (!colMostlyNumeric(data, i, 30)) {
        warnings.push(
          `列「${rawHeaders[i].trim()}」多数单元格非数值,仍按样本列导入;若为注释列请改用 featureCounts 预设`,
        );
      }
      keepIdx.push(i);
    }
  }

  if (keepIdx.length < 2) {
    throw new Error(
      "规范化后没有可用的样本列。请确认文件是基因×样本计数矩阵,或更换「矩阵格式」预设",
    );
  }

  const headers = keepIdx.map((idx) =>
    idx < rawHeaders.length ? rawHeaders[idx].trim() : `col${idx + 1}`,
  );
  if (headers[0] === "") headers[0] = "gene_id";

  const body: string[][] = [];
  for (const row of data) {
    const out = keepIdx.map((idx) => (idx < row.length ? row[idx].trim() : ""));
    const gene = out[0];
    if (gene === "") continue;
    if (gene.startsWith("__")) continue; // HTSeq 汇总行:__no_feature 等
    body.push(out);
  }
  if (body.length === 0) throw new Error("没有有效的基因行");

  // 重复基因名:按原始计数求和合并(DESeq2 vignette 推荐做法)
  const seen = new Map<string, number>();
  let dupRows = 0;
  const merged: string[][] = [];
  for (const row of body) {
    const gene = row[0];
    const j = seen.get(gene);
    if (j !== undefined) {
      const target = merged[j];
      for (let c = 1; c < row.length; c++) {
        const prev = target[c].trim();
        const cur = row[c].trim();
        if (prev === "") {
          target[c] = cur; // 先前空缺用后到值补
          continue;
        }
        if (cur === "") continue;
        const fv = Number(prev);
        const av = Number(cur);
        if (!Number.isFinite(fv) || !Number.isFinite(av)) continue; // 非数值保留先出现的
        const sum = fv + av;
        target[c] =
          Number.isInteger(sum) && Math.abs(sum) < 1e15 ? String(sum) : String(sum);
      }
      dupRows++;
    } else {
      seen.set(gene, merged.length);
      merged.push(row);
    }
  }
  const finalBody = dupRows > 0 ? merged : body;
  if (dupRows > 0) warnings.push(`发现 ${dupRows} 行重复基因名,已按原始计数求和合并`);

  // 计数质量:抽样检查是否像原始整数 counts(而非 TPM/FPKM)
  let checked = 0;
  let integerish = 0;
  let negative = 0;
  let fractional = 0;
  outer: for (const row of finalBody) {
    for (let j = 1; j < row.length; j++) {
      const v = row[j].trim();
      if (v === "" || v === "NA") continue;
      const f = Number(v);
      if (!Number.isFinite(f)) continue;
      checked++;
      if (f < 0) negative++;
      const rounded = Math.round(f);
      if (f === Math.trunc(f) || (f > 1 && Math.abs(f - rounded) < 1e-6)) {
        integerish++;
      } else if (f !== Math.trunc(f)) {
        fractional++;
      }
      if (checked >= 2000) break outer;
    }
  }
  if (checked > 50) {
    const fracRatio = fractional / checked;
    const intRatio = integerish / checked;
    if (fracRatio > 0.35 && intRatio < 0.7) {
      warnings.push(
        "检测到大量非整数值。DESeq2/edgeR 需要原始 read counts;若这是 TPM/FPKM/log 矩阵请改用原始计数文件",
      );
    }
    if (negative > 0) {
      warnings.push(`发现 ${negative} 个负值,原始 counts 不应为负`);
    }
  }
  return { headers, body: finalBody, applied, warnings };
}

// ── CSV 写入(缓存文件) ──
function csvEscape(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCsvText(headers: string[], body: string[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of body) lines.push(row.map(csvEscape).join(","));
  return lines.join("\r\n");
}

async function importCacheDir(): Promise<string> {
  const { mkdir } = await import("@tauri-apps/plugin-fs");
  const { homeDir } = await import("@tauri-apps/api/path");
  const dir = joinPath(await homeDir(), ".mynx", "rnaseq-import");
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    /* 已存在 */
  }
  return dir;
}

async function cacheCSVPath(src: string, matrixFormat: string): Promise<string> {
  const st = await statAny(src);
  const fingerprint = [
    src,
    st?.mtimeMs ? new Date(st.mtimeMs).toISOString() : "",
    String(st?.size ?? 0),
    normalizeMatrixFormat(matrixFormat),
  ].join("|");
  const base = sanitizeFileBase(pathBase(src).replace(/\.[^.]*$/, ""));
  const dir = await importCacheDir();
  return joinPath(dir, `${base}_${fnv1a64Hex(fingerprint)}.csv`);
}

// ── 导入入口 ──
export interface ImportMeta {
  source_file: string;
  data_file: string;
  converted: boolean;
  format: string;
  matrix_format: string;
  matrix_format_applied: string;
  warnings: string[];
}

export async function resolveImportFile(
  filePath: string,
  matrixFormat: string,
): Promise<{ meta: ImportMeta; dataPath: string; headers: string[]; body: string[][] }> {
  const p = filePath.trim().replace(/^["'\s]+|["'\s]+$/g, "");
  const { exists } = await import("@tauri-apps/plugin-fs");
  let ok: boolean;
  try {
    ok = await exists(p);
  } catch {
    ok = (await statAny(p)) !== null;
  }
  if (!ok) throw new Error(`文件不存在: ${p}`);
  const ext = pathExtLower(p);
  if (![".csv", ".tsv", ".txt", ".xlsx"].includes(ext)) {
    throw new Error(`不支持的文件格式 ${ext}(支持 .csv/.tsv/.txt/.xlsx)`);
  }

  const mf = normalizeMatrixFormat(matrixFormat);
  const { rows, format } = await readTableRows(p);
  const { headers, body, applied, warnings } = normalizeCountMatrix(rows, mf);

  // 标准 counts + 源已是 CSV 且列未变化:直接用原文件(更快)
  if (
    format === "csv" &&
    applied === "counts_matrix" &&
    mf === "counts_matrix" &&
    warnings.length === 0 &&
    headers.length === (rows[0]?.length ?? -1)
  ) {
    const same = headers.every((h, i) => {
      const raw = (rows[0][i] ?? "").trim().replace(/^\ufeff/, "");
      return raw === h;
    });
    if (same) {
      return {
        meta: {
          source_file: p,
          data_file: p,
          converted: false,
          format: "csv",
          matrix_format: mf,
          matrix_format_applied: applied,
          warnings,
        },
        dataPath: p,
        headers,
        body,
      };
    }
  }

  const dst = await cacheCSVPath(p, applied);
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(dst, new TextEncoder().encode(toCsvText(headers, body)));
  return {
    meta: {
      source_file: p,
      data_file: dst,
      converted: true,
      format,
      matrix_format: mf,
      matrix_format_applied: applied,
      warnings,
    },
    dataPath: dst,
    headers,
    body,
  };
}

function toNumber(v: string): number | string {
  if (v === "") return v;
  const n = Number(v);
  return Number.isFinite(n) && v.trim() !== "" ? n : v;
}

/** ImportCounts:表头 + 预览 + 每样本非零计数 */
export async function importCounts(
  filePath: string,
  nPreview: number,
  matrixFormat: string,
): Promise<ImportData> {
  const n = nPreview > 0 ? nPreview : 5;
  const { meta, headers, body } = await resolveImportFile(filePath, matrixFormat);
  if (headers.length < 2) throw new Error("至少需要 1 列基因 ID + 1 列样本计数");

  const nonzero: Record<string, number> = {};
  for (const c of headers.slice(1)) nonzero[c] = 0;
  const preview: Record<string, unknown>[] = [];
  for (let r = 0; r < body.length; r++) {
    if (r < n) {
      const rowObj: Record<string, unknown> = {};
      for (let i = 0; i < headers.length && i < body[r].length; i++) {
        rowObj[headers[i]] = toNumber(body[r][i]);
      }
      preview.push(rowObj);
    }
    for (let i = 1; i < headers.length && i < body[r].length; i++) {
      const v = Number(body[r][i]);
      if (Number.isFinite(v) && v > 0) nonzero[headers[i]]++;
    }
  }
  return {
    gene_col: headers[0],
    sample_cols: headers.slice(1),
    nonzero_counts: nonzero,
    total_genes: body.length,
    preview,
    preview_columns: headers,
    ...meta,
  };
}

/** 分页 + 基因名搜索(直接读缓存 CSV) */
export async function importPage(
  dataFile: string,
  page: number,
  pageSize: number,
  search: string,
  columns?: string[],
): Promise<PageData> {
  const text = await readTextAny(dataFile);
  const delim = detectDelimiter(text);
  const rows = parseDelimited(text, delim);
  if (rows.length === 0) throw new Error("读取失败(请确认是逗号或制表符分隔的计数文件)");
  const headers = rows[0];
  const pg = page > 0 ? page : 1;
  const size = pageSize > 0 ? pageSize : 50;
  const start = (pg - 1) * size;
  const end = start + size;
  const searchLower = search.trim().toLowerCase();

  let totalAll = 0;
  let totalFiltered = 0;
  const matched: Record<string, unknown>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    totalAll++;
    if (searchLower) {
      const geneVal = (row[0] ?? "").toLowerCase();
      if (!geneVal.includes(searchLower)) continue;
    }
    totalFiltered++;
    if (matched.length < size && totalFiltered > start && totalFiltered <= end) {
      const rowObj: Record<string, unknown> = {};
      for (let i = 0; i < headers.length && i < row.length; i++) {
        rowObj[headers[i]] = toNumber(row[i]);
      }
      matched.push(rowObj);
    }
  }
  const showCols = columns && columns.length > 0 ? columns : headers;
  return {
    columns: showCols,
    data: matched,
    page: pg,
    page_size: size,
    total: totalFiltered,
    total_pages: Math.max(1, Math.ceil(totalFiltered / size)),
  };
}
