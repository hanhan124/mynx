/**
 * R 引擎运行器 — Go 端 runR/Cancel/CheckRscript 的 TS 移植。
 *
 * 通过 plugin-shell 启动 Rscript(Windows 经 PowerShell 包装,可写任意输出目录;
 * macOS/Linux 经 bash -c exec 直接替换进程以便取消),stdout/stderr 逐行流式回调。
 * 参数经 params.json 传递,与 r/runner.R 契约一致。
 */
import { Command as ShellCommand } from "@tauri-apps/plugin-shell";
import { isWindows, joinPath, psQuote, shQuote } from "./io";
import type { Config } from "./types";

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

// ── runner.R 资源定位(开发与打包均为 resourceDir()/r/runner.R) ──
export async function resolveRunnerR(): Promise<string> {
  const { resourceDir } = await import("@tauri-apps/api/path");
  const dir = await resourceDir();
  return joinPath(dir, "r", "runner.R");
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
  config: Config,
  callbacks: RunCallbacks = {},
): Promise<RunHandle> {
  const taskId = `t${Date.now()}_${++taskSeq}`;
  const win = await isWindows();

  const rscript = await findRscript();
  const runnerR = await resolveRunnerR();

  // 解析输出目录与运行名,写回 config 副本(Go 端语义:确保 R 侧用同一个 run_name)
  const cfg: Config = { ...config };
  let outputBase = cfg.output_dir?.trim() ?? "";
  if (!outputBase) outputBase = await defaultOutputBase();
  let runName = cfg.run_name?.trim() ?? "";
  if (!runName || runName === "auto") runName = timestampRunName();
  cfg.output_dir = outputBase;
  cfg.run_name = runName;
  const outputDir = joinPath(outputBase, runName);

  // params.json 先写到临时目录(fs 插件可写),再由包装 shell 复制到目标
  // (目标目录可在任意磁盘,绕开 fs 作用域限制)
  const { writeFile, remove } = await import("@tauri-apps/plugin-fs");
  const { tempDir } = await import("@tauri-apps/api/path");
  const tmp = await tempDir();
  const tmpParams = joinPath(tmp, `mynx_rnaseq_params_${Date.now()}.json`);
  await writeFile(tmpParams, new TextEncoder().encode(JSON.stringify(cfg, null, 2)));
  const paramsPath = joinPath(outputDir, "params.json");

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
      void remove(tmpParams).catch(() => {});
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
    callbacks.onLog?.("info", `步骤: ${cfg.steps.join(", ")}`);
    callbacks.onLog?.("info", `图格式: ${(cfg.plot_formats ?? []).join(", ") || "png"}`);
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
        const script =
          `[System.IO.Directory]::CreateDirectory(${psQuote(outputDir)}) | Out-Null; ` +
          `Copy-Item -LiteralPath ${psQuote(tmpParams)} -Destination ${psQuote(paramsPath)} -Force; ` +
          `& ${psQuote(rscript)} ${psQuote(runnerR)} ${psQuote(paramsPath)}`;
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
          `cp ${shQuote(tmpParams)} ${shQuote(paramsPath)} && ` +
          `exec ${shQuote(rscript)} ${shQuote(runnerR)} ${shQuote(paramsPath)}`;
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

      void command.spawn().then((spawned) => {
        child = spawned;
        childPid = spawned.pid ?? null;
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
