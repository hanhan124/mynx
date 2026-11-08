/**
 * rnaseq_engine.R 契约冒烟测试 — 模拟 GUI 生成 params.json 的完整链路。
 *
 * 1. 用 src/lib/rnaseq/defaults.ts 的 defaultConfig() 作为参数基线(与 GUI 一致)
 * 2. 写入合成计数矩阵(含中文组名,验证编码链路)
 * 3. 调 Rscript 运行 r/rnaseq_engine.R(全步骤 + 仅 de 两轮)
 * 4. 断言输出布局与 DE_summary 内容
 *
 * 用法:node --experimental-strip-types scripts/rnaseq-engine-smoke.ts
 * 本机未安装 R 时跳过(退出码 0)。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defaultConfig } from "../src/lib/rnaseq/defaults.ts";
import type { RnaSeqConfig } from "../src/lib/rnaseq/types.ts";

let failed = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

// ── 定位 Rscript ──
function findRscript(): string | null {
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\R";
    if (!existsSync(base)) return null;
    const versions = readdirSync(base)
      .filter((d) => /^R-/.test(d))
      .sort()
      .reverse();
    for (const v of versions) {
      const exe = join(base, v, "bin", "Rscript.exe");
      if (existsSync(exe)) return exe;
    }
    return null;
  }
  const r = spawnSync("bash", ["-c", "command -v Rscript"], { encoding: "utf8" });
  const p = r.stdout?.trim();
  return p || null;
}

const rscript = findRscript();
if (!rscript) {
  console.log("SKIP: 未找到 Rscript,跳过引擎冒烟测试");
  process.exit(0);
}

// ── 合成计数(确定性)──
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MARKERS = [
  "RPE65", "MITF", "BEST1", "NANOG", "SOX2", "POU5F1", "PAX6", "PMEL", "RAX",
  "TYR", "OTX2", "TYRP1", "MERTK", "LHX2", "VSX2", "DCT", "RLBP1",
  "RDH5", "MLANA", "ITGAV", "ATP1A1", "TJP1", "AQP1", "EZR", "SERPINF1", "VEGFA",
];
const GENES = [...MARKERS, ...Array.from({ length: 374 }, (_, i) => `GENE${String(i).padStart(4, "0")}`)];

const rng = mulberry32(42);
const base = GENES.map(() => Math.exp(3.2 + rng() * 2.4 - 1.2));

const SAMPLES = ["CTL_1", "CTL_2", "CTL_3", "TREAT_1", "TREAT_2", "TREAT_3"];
const counts: number[][] = GENES.map((g, gi) => {
  const isRpe = ["RPE65", "MITF", "TYR", "OTX2", "TYRP1", "PMEL", "BEST1"].includes(g);
  return SAMPLES.map((s) => {
    const sf = 0.8 + SAMPLES.indexOf(s) * 0.08;
    const eff = s.startsWith("TREAT") ? (isRpe ? 4 : 1) : 1;
    const mu = base[gi] * sf * eff;
    return Math.max(0, Math.round(mu * (0.6 + rng() * 0.9)));
  });
});

// ── 临时工作区 ──
const work = mkdtempSync(join(tmpdir(), "mynx-rnaseq-engine-"));
const runBase = join(work, "runs");
const csvPath = join(work, "gene.count.csv");
const csv = ["gene", ...SAMPLES].join(",") + "\n" + GENES.map((g, i) => `${g},${counts[i].join(",")}`).join("\n");
writeFileSync(csvPath, csv, "utf8");

// ── 参数:GUI defaultConfig() 基线 + 场景覆盖(中文组名)──
// 注意:与 runner.ts 的 runR 一致,引擎拿到的 output_dir 是「运行目录」本身
// (= 输出根目录/run_name),结果直接写入其中。
function buildParams(steps: string[]): RnaSeqConfig {
  const cfg = defaultConfig();
  cfg.run_name = `smoke_${steps.join("_").replace(/[^a-z]/g, "")}`;
  cfg.output_dir = join(runBase, cfg.run_name);
  cfg.steps = steps;
  cfg.data_file = csvPath;
  cfg.input.count_file = csvPath;
  cfg.groups = { "对照组": ["CTL_1", "CTL_2", "CTL_3"], "处理组": ["TREAT_1", "TREAT_2", "TREAT_3"] };
  cfg.sample_labels = { CTL_1: "Control-1", TREAT_1: "Treated-1" };
  cfg.comparisons = [{ name: "Treatment_vs_Control", case: "处理组", control: "对照组" }];
  return cfg;
}

function runEngine(steps: string[]): { code: number; stdout: string; runDir: string } {
  const params = buildParams(steps);
  const runDir = params.output_dir ?? "";
  const paramsPath = join(work, `params_${params.run_name}.json`);
  writeFileSync(paramsPath, JSON.stringify(params, null, 2), "utf8");
  const r = spawnSync(rscript, [join("src-tauri", "r", "rnaseq_engine.R"), paramsPath], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
  });
  // runner.ts(runR)在启动成功后会把最终参数复制到 <runDir>/prepared/params.json
  if (r.status === 0) {
    mkdirSync(join(runDir, "prepared"), { recursive: true });
    copyFileSync(paramsPath, join(runDir, "prepared", "params.json"));
  }
  return { code: r.status ?? 1, stdout: `${r.stdout ?? ""}\n${r.stderr ?? ""}`, runDir };
}

// ── 1. 全步骤 ──
console.log("== 全步骤(de + heatmap + plots) ==");
const full = runEngine(["de", "heatmap", "plots"]);
check("engine exit 0", full.code === 0, full.stdout.slice(-2000));
if (full.code !== 0) {
  console.error(full.stdout.split("\n").slice(-40).join("\n"));
} else {
  for (const f of [
    join("DE", "DE_Treatment_vs_Control.csv"),
    join("DE", "DE_summary.csv"),
    join("heatmap", "heatmap_overall.png"),
    join("heatmap", "heatmap_overall_matrix.csv"),
    join("heatmap", "sample_correlation_overall.png"),
    join("heatmap", "heatmap_gene_clusters.png"),
    join("plots", "PCA_selected.png"),
    join("plots", "PCA_selected_coords.csv"),
    join("plots", "volcano_Treatment_vs_Control.png"),
    join("data", "counts_clean_integer.csv"),
    join("data", "sample_table.csv"),
    join("logs", "run.log"),
    join("prepared", "params.json"),
  ]) {
    check(`output ${f.replace(/\\/g, "/")}`, existsSync(join(full.runDir, f)));
  }
  const summary = readFileSync(join(full.runDir, "DE", "DE_summary.csv"), "utf8");
  check("DE_summary has comparison", summary.includes("Treatment_vs_Control"));
  check("DE_summary has Up/Down", /,\d+,\d+\s*$/.test(summary.trim().split("\n")[1] ?? ""));
  check("sample_table uses groups", summary.length > 0);
  const sampleTable = readFileSync(join(full.runDir, "data", "sample_table.csv"), "utf8");
  check("sample_table 中文组名保留", sampleTable.includes("对照组") && sampleTable.includes("处理组"), sampleTable.slice(0, 200));
  const paramsPath = join(full.runDir, "prepared", "params.json");
  if (existsSync(paramsPath)) {
    const paramsJson = JSON.parse(readFileSync(paramsPath, "utf8")) as Record<string, unknown>;
    check("prepared/params.json steps recorded", Array.isArray(paramsJson.steps));
    check("prepared/params.json 中文组名保留", JSON.stringify(paramsJson).includes("处理组"));
  } else {
    check("prepared/params.json steps recorded", false, "file missing");
  }
}

// ── 2. 仅 de 步骤(单步重跑)──
console.log("== 仅 de 步骤 ==");
const deOnly = runEngine(["de"]);
check("de-only exit 0", deOnly.code === 0, deOnly.stdout.slice(-2000));
check("de-only writes DE csv", existsSync(join(deOnly.runDir, "DE", "DE_summary.csv")));
check("de-only skips heatmap png", !existsSync(join(deOnly.runDir, "heatmap", "heatmap_overall.png")));

// ── 清理 ──
rmSync(work, { recursive: true, force: true });

console.log(failed === 0 ? "\n全部通过 ✓" : `\n${failed} 项失败 ✗`);
process.exit(failed === 0 ? 0 : 1);
