/**
 * R 引擎运行器 — 通过 plugin-shell 启动 Rscript 执行 rnaseq_engine.R。
 *
 * Windows 经 PowerShell 包装(可写任意输出目录;输出路径含中文时先在
 * ASCII 临时目录运行,完成后复制回目标),macOS/Linux 经 bash -c exec。
 * 参数经 params.json 传递,与引擎(参考脚本 rnaseq_DE_heatmap.R)契约一致。
 */
import { Command as ShellCommand } from "@tauri-apps/plugin-shell";
import { isWindows, joinPath, psQuote, shQuote } from "./io.ts";
import type { RnaSeqConfig } from "./types.ts";

export type LogLevel = "info" | "warning" | "error" | "success";

export interface RunResult {
  taskId: string;
  status: "done" | "failed" | "cancelled";
  exitCode: number;
  outputDir: string;
  runName: string;
}

export interface RunHandle {
  taskId: string;
  outputDir: string;
  runName: string;
  promise: Promise<RunResult>;
  cancel: () => Promise<void>;
}

export interface RunCallbacks {
  onLog?: (level: LogLevel, msg: string) => void;
}

// ── 日志级别分类(对齐 Go classifyLine) ──
export function classifyLine(line: string): LogLevel {
  if (/^Error|\bError in\b|Execution halted|\[ERROR\]/.test(line)) return "error";
  if (/^Warning|\[WARN\]/.test(line)) return "warning";
  // [OK] = 步骤级成功;[DONE] = 流程级完成
  if (line.includes("[OK]") || line.includes("[DONE]")) return "success";
  return "info";
}

// ── Rscript 定位 ──
let rscriptCache: string | null = null;

export async function findRscript(): Promise<string> {
  if (rscriptCache) return rscriptCache;
  const win = await isWindows();
  let p: string;
  try {
    if (win) {
      const probe = ShellCommand.create("powershell", [
        "-NoProfile",
        "-Command",
        "$c = Get-Command Rscript -ErrorAction SilentlyContinue; " +
          "if ($c) { $c.Source } else { " +
          '  Get-ChildItem -LiteralPath "C:\\Program Files\\R" -Directory -ErrorAction SilentlyContinue ' +
          "  | Sort-Object Name -Descending " +
          '  | ForEach-Object { Join-Path $_.FullName "bin\\Rscript.exe" } ' +
          "  | Where-Object { Test-Path -LiteralPath $_ } " +
          "  | Select-Object -First 1 }",
      ]);
      const out = await probe.execute();
      p =
        (out.stdout ?? "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)[0] ?? "";
    } else {
      const probe = ShellCommand.create("bash", [
        "-c",
        "command -v Rscript || " +
          "for p in /opt/homebrew/bin/Rscript /usr/local/bin/Rscript " +
          "/Library/Frameworks/R.framework/Resources/Rscript; do " +
          '[ -x "$p" ] && echo "$p" && break; done',
      ]);
      const out = await probe.execute();
      p =
        (out.stdout ?? "")
          .split(/\n/)
          .map((l) => l.trim())
          .filter(Boolean)[0] ?? "";
    }
  } catch {
    p = "";
  }
  if (p) rscriptCache = p;
  return p;
}

export async function checkRscript(): Promise<{ rscript: string; found: boolean }> {
  const p = await findRscript();
  return { rscript: p, found: !!p };
}

export function resetRscriptCache(): void {
  rscriptCache = null;
}

/** rnaseq_engine.R(参考脚本)运行所需依赖;R 端 check_dependencies 亦按此清单校验。 */
export const RNA_SEQ_REQUIRED_PACKAGES = [
  "jsonlite",
  "DESeq2",
  "edgeR",
  "SummarizedExperiment",
  "matrixStats",
  "ComplexHeatmap",
  "circlize",
  "RColorBrewer",
  "viridisLite",
  "ggplot2",
  "ggrepel",
  "ragg",
] as const;

export interface RDependencyStatus {
  rscriptFound: boolean;
  missing: string[];
  error?: string;
}

let dependencyCache: { rscript: string; status: RDependencyStatus } | null = null;

export function resetRDependencyCache(): void {
  dependencyCache = null;
}

async function executeRExpression(
  rscript: string,
  expression: string,
  args: readonly string[] = [],
) {
  const win = await isWindows();
  const quotedArgs = args.map((arg) => (win ? psQuote(arg) : shQuote(arg))).join(" ");
  const invocation = win
    ? `& ${psQuote(rscript)} --vanilla -e ${psQuote(expression)}${quotedArgs ? ` ${quotedArgs}` : ""}`
    : `${shQuote(rscript)} --vanilla -e ${shQuote(expression)}${quotedArgs ? ` ${quotedArgs}` : ""}`;
  return ShellCommand.create(
    win ? "powershell" : "bash",
    win
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", invocation]
      : ["-lc", invocation],
  ).execute();
}

/** 在不加载包的前提下检查安装状态，避免首次运行直接落入难读的 R 错误日志。 */
export async function checkRDependencies(): Promise<RDependencyStatus> {
  const rscript = await findRscript();
  if (!rscript) return { rscriptFound: false, missing: [] };
  if (dependencyCache?.rscript === rscript) return dependencyCache.status;
  const expression = [
    "pkgs <- commandArgs(trailingOnly = TRUE)",
    "missing <- pkgs[!vapply(pkgs, requireNamespace, quietly = TRUE, FUN.VALUE = logical(1))]",
    "writeLines(missing)",
  ].join("; ");
  try {
    const result = await executeRExpression(
      rscript,
      expression,
      RNA_SEQ_REQUIRED_PACKAGES,
    );
    if (result.code !== 0) {
      return {
        rscriptFound: true,
        missing: [],
        error: (result.stderr || result.stdout || "R 依赖检测失败").trim(),
      };
    }
    const status = {
      rscriptFound: true,
      missing: (result.stdout || "")
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean),
    };
    dependencyCache = { rscript, status };
    return status;
  } catch (error) {
    return {
      rscriptFound: true,
      missing: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** 通过系统包管理器安装 R；仅由用户确认后调用。 */
export async function installRRuntime(): Promise<{ ok: boolean; error?: string }> {
  const win = await isWindows();
  const command = win
    ? "winget install --id RProject.R --exact --accept-package-agreements --accept-source-agreements"
    : "brew install --cask r";
  try {
    const result = await ShellCommand.create(
      win ? "powershell" : "bash",
      win
        ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]
        : ["-lc", command],
    ).execute();
    resetRscriptCache();
    resetRDependencyCache();
    return result.code === 0
      ? { ok: true }
      : { ok: false, error: (result.stderr || result.stdout || "R 安装未完成").trim() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 安装 CRAN 与 Bioconductor 依赖；不升级已存在的包。 */
export async function installRDependencies(
  packages: readonly string[] = RNA_SEQ_REQUIRED_PACKAGES,
): Promise<{ ok: boolean; error?: string }> {
  const rscript = await findRscript();
  if (!rscript) return { ok: false, error: "未找到 Rscript" };
  const bioc = packages.filter((pkg) =>
    ["edgeR", "DESeq2", "ComplexHeatmap"].includes(pkg),
  );
  const cran = packages.filter((pkg) => !bioc.includes(pkg));
  try {
    if (cran.length > 0) {
      const cranResult = await executeRExpression(
        rscript,
        "args <- commandArgs(trailingOnly = TRUE); repo <- args[1]; pkgs <- args[-1]; options(repos = c(CRAN = repo)); if (length(pkgs)) install.packages(pkgs, dependencies = TRUE)",
        ["https://cloud.r-project.org", ...cran],
      );
      if (cranResult.code !== 0) {
        return {
          ok: false,
          error: (cranResult.stderr || cranResult.stdout || "R 包安装未完成").trim(),
        };
      }
    }
    if (bioc.length > 0) {
      const biocResult = await executeRExpression(
        rscript,
        "args <- commandArgs(trailingOnly = TRUE); manager <- args[1]; installer <- args[2]; pkgs <- args[-c(1, 2)]; if (!requireNamespace(manager, quietly = TRUE)) install.packages(manager); if (length(pkgs)) getExportedValue(manager, installer)(pkgs, ask = FALSE, update = FALSE)",
        ["BiocManager", "install", ...bioc],
      );
      if (biocResult.code !== 0) {
        return {
          ok: false,
          error: (
            biocResult.stderr ||
            biocResult.stdout ||
            "Bioconductor 包安装未完成"
          ).trim(),
        };
      }
    }
    resetRDependencyCache();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── 引擎脚本资源定位(开发与打包均为 resourceDir()/r/rnaseq_engine.R) ──
export async function resolveRunnerR(): Promise<string> {
  const { resourceDir } = await import("@tauri-apps/api/path");
  const dir = await resourceDir();
  return joinPath(dir, "r", "rnaseq_engine.R");
}

// ── 默认输出根目录 ──
export async function defaultOutputBase(): Promise<string> {
  const { homeDir } = await import("@tauri-apps/api/path");
  return joinPath(await homeDir(), "Mynx", "rnaseq_runs");
}

function timestampRunName(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `RNA_seq_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

// ── stdout 行缓冲 ──
function createLineHandler(onLine: (line: string) => void) {
  let buffer = "";
  return (data: string) => {
    buffer += data;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, "");
      if (trimmed) onLine(trimmed);
    }
  };
}

let taskSeq = 0;

/**
 * 启动一次 R 任务(DEG 或单图导出)。
 * 返回句柄:promise 在进程结束后 resolve;cancel 终止进程树。
 */
export async function runR(
  config: RnaSeqConfig,
  callbacks: RunCallbacks = {},
): Promise<RunHandle> {
  const taskId = `t${Date.now()}_${++taskSeq}`;
  const win = await isWindows();

  const rscript = await findRscript();
  const runnerR = await resolveRunnerR();

  // 解析输出目录与运行名,写回 config 副本。
  // 引擎(参考脚本)把全部结果直接写进 params 的 output_dir,因此 R 侧
  // 拿到的是 <输出根目录>/<run_name> 本身,不再由 R 拼接 run_name。
  const cfg: RnaSeqConfig = { ...config };
  let outputBase = cfg.output_dir?.trim() ?? "";
  if (!outputBase) outputBase = await defaultOutputBase();
  let runName = cfg.run_name?.trim() ?? "";
  if (!runName || runName === "auto") runName = timestampRunName();
  cfg.output_dir = outputBase;
  cfg.run_name = runName;
  const outputDir = joinPath(outputBase, runName);
  // 批次功能已从 GUI 移除;旧保存的配置若带 batch 字段也不传给引擎
  const { batch: _batch, ...core } = cfg as RnaSeqConfig & { batch?: unknown };
  void _batch;
  const engineParams: RnaSeqConfig = { ...core, output_dir: outputDir };

  // params.json 先写到临时目录(fs 插件可写),再由包装 shell 复制到目标
  // (目标目录可在任意磁盘,绕开 fs 作用域限制)。Rscript 始终读取临时文件。
  // 部分 Windows R 运行时无法读取含中文字符的工作目录；此时把整次运算
  // 放到 ASCII 临时目录，成功后由 PowerShell 复制回用户选定的输出位置。
  const { writeFile, remove } = await import("@tauri-apps/plugin-fs");
  const { tempDir } = await import("@tauri-apps/api/path");
  const tmp = await tempDir();
  const hasNonAsciiOutput = [...outputDir].some((ch) => (ch.codePointAt(0) ?? 0) > 127);
  const useWindowsAsciiStage = win && hasNonAsciiOutput;
  const stageBase = useWindowsAsciiStage
    ? joinPath(tmp, `mynx_rnaseq_stage_${taskId}`)
    : "";
  const stageOutputDir = useWindowsAsciiStage ? joinPath(stageBase, runName) : "";
  const runnerCfg: RnaSeqConfig = useWindowsAsciiStage
    ? { ...engineParams, output_dir: stageOutputDir }
    : engineParams;
  const tmpRunnerParams = joinPath(tmp, `mynx_rnaseq_runner_${taskId}.json`);
  const tmpTargetParams = useWindowsAsciiStage
    ? joinPath(tmp, `mynx_rnaseq_target_${taskId}.json`)
    : tmpRunnerParams;
  await writeFile(
    tmpRunnerParams,
    new TextEncoder().encode(JSON.stringify(runnerCfg, null, 2)),
  );
  if (tmpTargetParams !== tmpRunnerParams) {
    await writeFile(
      tmpTargetParams,
      new TextEncoder().encode(JSON.stringify(engineParams, null, 2)),
    );
  }
  // 脚本标准布局：可供 GUI 复用的 JSON 放在 prepared/，根目录保留
  // analysis_parameters.txt 供人工审阅；runs.ts 对旧版根目录 params.json 仍兼容读取。
  const paramsPath = joinPath(outputDir, "prepared", "params.json");

  // 取消实现占位:promise executor 内替换
  let cancelImpl: () => Promise<void> = async () => {};

  const promise = new Promise<RunResult>((resolve) => {
    const result: RunResult = {
      taskId,
      status: "failed",
      exitCode: 1,
      outputDir,
      runName,
    };
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      void remove(tmpRunnerParams).catch(() => {});
      if (tmpTargetParams !== tmpRunnerParams) {
        void remove(tmpTargetParams).catch(() => {});
      }
      resolve(result);
    };

    if (!rscript) {
      callbacks.onLog?.(
        "error",
        "未找到 Rscript。请安装 R(https://cloud.r-project.org)并加入 PATH;程序也会自动扫描 C:\\Program Files\\R\\R-*",
      );
      result.exitCode = 127;
      settle();
      return;
    }

    callbacks.onLog?.("info", `Rscript: ${rscript}`);
    callbacks.onLog?.("info", `输出目录: ${outputDir}`);
    callbacks.onLog?.("info", `步骤: ${(cfg.steps ?? []).join(", ")}`);
    if (useWindowsAsciiStage) {
      callbacks.onLog?.(
        "info",
        "输出路径含中文字符：将在临时工作目录运行 R，完成后自动复制回此处",
      );
    }
    callbacks.onLog?.("info", "─".repeat(50));

    let cancelled = false;
    let childPid: number | null = null;
    let child: { kill: () => Promise<void> } | null = null;
    let command: ShellCommand<string>;

    const handleLine = createLineHandler((line) => {
      callbacks.onLog?.(classifyLine(line), line);
    });

    try {
      if (win) {
        // 注意:New-Item 在 Windows PowerShell 5.1 没有 -LiteralPath,
        // 用 .NET CreateDirectory 才能稳健处理任意(含方括号/Unicode)路径
        const script = useWindowsAsciiStage
          ? [
              "$ErrorActionPreference = 'Stop'",
              `[System.IO.Directory]::CreateDirectory(${psQuote(outputDir)}) | Out-Null`,
              `[System.IO.Directory]::CreateDirectory(${psQuote(joinPath(outputDir, "prepared"))}) | Out-Null`,
              `[System.IO.Directory]::CreateDirectory(${psQuote(stageBase)}) | Out-Null`,
              "$exitCode = 1",
              "try {",
              `Copy-Item -LiteralPath ${psQuote(outputDir)} -Destination ${psQuote(stageBase)} -Recurse -Force`,
              `[System.IO.Directory]::CreateDirectory(${psQuote(stageOutputDir)}) | Out-Null`,
              `Copy-Item -LiteralPath ${psQuote(tmpTargetParams)} -Destination ${psQuote(paramsPath)} -Force`,
              `& ${psQuote(rscript)} ${psQuote(runnerR)} ${psQuote(tmpRunnerParams)}`,
              "$exitCode = $LASTEXITCODE",
              "if ($exitCode -eq 0) {",
              `Get-ChildItem -LiteralPath ${psQuote(stageOutputDir)} -Force | Copy-Item -Destination ${psQuote(outputDir)} -Recurse -Force`,
              `Copy-Item -LiteralPath ${psQuote(tmpTargetParams)} -Destination ${psQuote(paramsPath)} -Force`,
              "}",
              "} finally {",
              `Remove-Item -LiteralPath ${psQuote(stageBase)} -Recurse -Force -ErrorAction SilentlyContinue`,
              "}",
              "exit $exitCode",
            ].join("\n")
          :
              `[System.IO.Directory]::CreateDirectory(${psQuote(outputDir)}) | Out-Null; ` +
              `[System.IO.Directory]::CreateDirectory(${psQuote(joinPath(outputDir, "prepared"))}) | Out-Null; ` +
              `Copy-Item -LiteralPath ${psQuote(tmpRunnerParams)} -Destination ${psQuote(paramsPath)} -Force; ` +
              `& ${psQuote(rscript)} ${psQuote(runnerR)} ${psQuote(tmpRunnerParams)}`;
        command = ShellCommand.create("powershell", [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          script,
        ]);
      } else {
        const script =
          `mkdir -p ${shQuote(outputDir)} && ` +
          `mkdir -p ${shQuote(joinPath(outputDir, "prepared"))} && ` +
          `cp ${shQuote(tmpRunnerParams)} ${shQuote(paramsPath)} && ` +
          `exec ${shQuote(rscript)} ${shQuote(runnerR)} ${shQuote(tmpRunnerParams)}`;
        command = ShellCommand.create("bash", ["-c", script]);
      }

      command.stdout.on("data", handleLine);
      command.stderr.on("data", handleLine);

      command.on("close", (payload: { code: number | null }) => {
        callbacks.onLog?.("info", "─".repeat(50));
        const code = payload.code ?? 1;
        result.exitCode = code;
        if (code === 0) {
          result.status = "done";
          callbacks.onLog?.(
            "success",
            `[DONE] 分析完成(退出码 ${result.exitCode})。输出: ${outputDir}`,
          );
        } else if (cancelled) {
          result.status = "cancelled";
          callbacks.onLog?.(
            "warning",
            `已取消(退出码 ${result.exitCode});已生成的文件保留在输出目录`,
          );
        } else {
          result.status = "failed";
          callbacks.onLog?.("error", `分析失败(退出码 ${result.exitCode})`);
        }
        settle();
      });

      command.on("error", () => {
        result.status = "failed";
        result.exitCode = 1;
        settle();
      });

      void command
        .spawn()
        .then((spawned) => {
          child = spawned;
          childPid = spawned.pid ?? null;
        })
        .catch((error) => {
          result.status = "failed";
          result.exitCode = 1;
          callbacks.onLog?.(
            "error",
            `启动失败: ${error instanceof Error ? error.message : String(error)}`,
          );
          settle();
        });
      cancelImpl = async () => {
        cancelled = true;
        callbacks.onLog?.("warning", "收到取消请求,正在终止 R 进程…");
        try {
          if (win) {
            if (childPid) {
              const kill = ShellCommand.create("powershell", [
                "-NoProfile",
                "-Command",
                `taskkill /PID ${childPid} /T /F 2>&1 | Out-Null`,
              ]);
              await kill.execute();
            }
          } else {
            await child?.kill();
          }
        } catch {
          /* close 事件兜底 */
        }
      };
    } catch (e) {
      result.status = "failed";
      callbacks.onLog?.(
        "error",
        `启动失败: ${e instanceof Error ? e.message : String(e)}`,
      );
      settle();
    }
  });

  return {
    taskId,
    outputDir,
    runName,
    promise,
    cancel: () => cancelImpl(),
  };
}
