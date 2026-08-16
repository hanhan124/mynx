/**
 * RNA-seq 文件 IO 层。
 *
 * 优先走 Tauri fs 插件(作用域:家目录/文档/下载/桌面/临时目录);
 * Windows 下若路径在作用域之外,回退到 PowerShell 读取 —— 保证用户
 * 可以选择任意磁盘位置的数据文件与输出目录(与原 publication_pipeline_wails 行为一致)。
 */
import { platform } from "@tauri-apps/plugin-os";
import { Command as ShellCommand, open as shellOpen } from "@tauri-apps/plugin-shell";

export interface FileMeta {
  name: string;
  isDir: boolean;
  size: number;
  /** epoch ms */
  mtimeMs: number;
}

// ── PowerShell 字符串转义(单引号包裹,内部 ' 翻倍) ──
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** 执行 powershell 并收集 stdout(Windows 兜底通道) */
async function psCapture(command: string): Promise<string> {
  const cmd = ShellCommand.create("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${command}`,
  ]);
  const out = await cmd.execute();
  if (out.code !== 0) {
    throw new Error(out.stderr?.trim() || `PowerShell 退出码 ${out.code}`);
  }
  return out.stdout ?? "";
}

/** 执行 bash 并收集 stdout(macOS/Linux 兜底通道,BSD 工具语法) */
async function shCapture(script: string): Promise<string> {
  const cmd = ShellCommand.create("bash", ["-c", script]);
  const out = await cmd.execute();
  if (out.code !== 0) {
    throw new Error(out.stderr?.trim() || `bash 退出码 ${out.code}`);
  }
  return out.stdout ?? "";
}

export async function isWindows(): Promise<boolean> {
  try {
    return (await platform()) === "windows";
  } catch {
    return true;
  }
}

// ── exists ──
export async function pathExists(path: string): Promise<boolean> {
  const fs = await import("@tauri-apps/plugin-fs");
  try {
    return await fs.exists(path);
  } catch {
    try {
      if (await isWindows()) {
        const r = await psCapture(`Test-Path -LiteralPath ${psQuote(path)}`);
        return r.trim() === "True";
      }
      const r = await shCapture(`test -e ${shQuote(path)} && echo 1 || echo 0`);
      return r.trim() === "1";
    } catch {
      return false;
    }
  }
}

// ── 读文本 ──
export async function readTextAny(path: string): Promise<string> {
  const fs = await import("@tauri-apps/plugin-fs");
  try {
    return await fs.readTextFile(path);
  } catch {
    if (await isWindows()) {
      const text = await psCapture(
        `[System.IO.File]::ReadAllText(${psQuote(path)}, [System.Text.Encoding]::UTF8)`,
      );
      return text;
    }
    return await shCapture(`cat ${shQuote(path)}`);
  }
}

// ── 读字节 ──
export async function readBytesAny(path: string): Promise<Uint8Array> {
  const fs = await import("@tauri-apps/plugin-fs");
  try {
    return await fs.readFile(path);
  } catch {
    if (await isWindows()) {
      const b64 = await psCapture(
        `[Convert]::ToBase64String([System.IO.File]::ReadAllBytes(${psQuote(path)}))`,
      );
      return base64ToBytes(b64.replace(/\s+/g, ""));
    }
    // macOS(BSD) base64 用 -i;换行在 TS 侧统一剥掉
    const b64 = await shCapture(`base64 -i ${shQuote(path)}`);
    return base64ToBytes(b64.replace(/\s+/g, ""));
  }
}

// ── 列目录 ──
export async function readDirAny(path: string): Promise<FileMeta[]> {
  const fs = await import("@tauri-apps/plugin-fs");
  try {
    const entries = await fs.readDir(path);
    const out: FileMeta[] = [];
    for (const e of entries) {
      if (e.name === "." || e.name === "..") continue;
      out.push({
        name: e.name,
        isDir: !!e.isDirectory,
        size: 0,
        mtimeMs: 0,
      });
    }
    // readDir 不含 mtime/size,逐个补齐(失败不阻塞)
    await Promise.all(
      out.map(async (f) => {
        try {
          const st = await statAny(joinPath(path, f.name));
          if (st) {
            f.size = st.size;
            f.mtimeMs = st.mtimeMs;
          }
        } catch {
          /* ignore */
        }
      }),
    );
    return out;
  } catch {
    if (await isWindows()) {
      // 输出: name<TAB>isDir<TAB>size<TAB>mtimeMs
      const TAB = "`t";
      const text = await psCapture(
        `Get-ChildItem -LiteralPath ${psQuote(path)} -Force | ForEach-Object { ` +
          `"$($_.Name)${TAB}$([int]$_.PSIsContainer)${TAB}$($_.Length)${TAB}" + ` +
          `$(([System.DateTimeOffset]$_.LastWriteTime).ToUnixTimeMilliseconds()) }`,
      );
      return text
        .split(/\r?\n/)
        .filter((l) => l.includes("\t"))
        .map((line) => {
          const [name, isDir, size, mtime] = line.split("\t");
          return {
            name,
            isDir: isDir === "1",
            size: Number(size) || 0,
            mtimeMs: Number(mtime) || 0,
          };
        });
    }
    // macOS/Linux:find + BSD stat(GNU stat 兜底);字段与 PowerShell 版一致
    const text = await shCapture(
      `find ${shQuote(path)} -mindepth 1 -maxdepth 1 | while IFS= read -r f; do ` +
        `t=0; [ -d "$f" ] && t=1; ` +
        `sz=$(stat -f%z "$f" 2>/dev/null || stat -c '%s' "$f" 2>/dev/null || echo 0); ` +
        `mt=$(stat -f%m "$f" 2>/dev/null || stat -c '%Y' "$f" 2>/dev/null || echo 0); ` +
        `printf '%s\\t%s\\t%s\\t%s\\n' "\${f##*/}" "$t" "$sz" "$mt"; ` +
        `done`,
    );
    return text
      .split(/\r?\n/)
      .filter((l) => l.includes("\t"))
      .map((line) => {
        const [name, isDir, size, mtime] = line.split("\t");
        return {
          name,
          isDir: isDir === "1",
          size: Number(size) || 0,
          mtimeMs: (Number(mtime) || 0) * 1000,
        };
      });
    throw new Error(`无法读取目录(路径不在可访问范围): ${path}`);
  }
}

// ── stat ──
export async function statAny(path: string): Promise<FileMeta | null> {
  const fs = await import("@tauri-apps/plugin-fs");
  try {
    const st = await fs.stat(path);
    return toMeta(path, st);
  } catch {
    if (await isWindows()) {
      // 注意:文件不存在时 fs.stat 与 Get-Item 都会报错 —— 这里必须返回 null
      // (os.Stat 语义),把错误抛出去会连累调用方的存在性检查
      try {
        const TAB = "`t";
        const text = await psCapture(
          `Get-Item -LiteralPath ${psQuote(path)} -Force | ForEach-Object { ` +
            `"$($_.Name)${TAB}$([int]$_.PSIsContainer)${TAB}$($_.Length)${TAB}" + ` +
            `$(([System.DateTimeOffset]$_.LastWriteTime).ToUnixTimeMilliseconds()) }`,
        );
        const line = text.split(/\r?\n/).find((l) => l.includes("\t"));
        if (!line) return null;
        const [name, isDir, size, mtime] = line.split("\t");
        return {
          name,
          isDir: isDir === "1",
          size: Number(size) || 0,
          mtimeMs: Number(mtime) || 0,
        };
      } catch {
        return null;
      }
    }
    // macOS(BSD) stat:大小|mtimeEpoch|类型
    try {
      const text = await shCapture(
        `stat -f '%z|%m|%HT' ${shQuote(path)} 2>/dev/null || stat -c '%s|%Y|%F' ${shQuote(path)}`,
      );
      const line = text.split(/\n/).find((l) => l.includes("|"));
      if (!line) return null;
      const [size, mtime, kind] = line.trim().split("|");
      return {
        name: pathBase(path),
        isDir: /directory|dir/i.test(kind ?? ""),
        size: Number(size) || 0,
        mtimeMs: (Number(mtime) || 0) * 1000,
      };
    } catch {
      return null;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMeta(path: string, st: any): FileMeta {
  const rawMtime = st.mtime ?? st.modifiedAt ?? null;
  const mtime = rawMtime ? new Date(rawMtime as string | number | Date).getTime() : 0;
  return {
    name: pathBase(path),
    isDir: !!(st.isDirectory ?? st.isDir ?? st.is_directory),
    size: Number(st.size ?? 0),
    mtimeMs: Number.isFinite(mtime) ? mtime : 0,
  };
}

export function pathBase(path: string): string {
  const norm = path.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("\\"), norm.lastIndexOf("/"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

export function pathDir(path: string): string {
  const idx = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return idx > 0 ? path.slice(0, idx) : path;
}

/** 按目录风格拼接路径(可变参数;避免硬编码分隔符) */
export function joinPath(...parts: string[]): string {
  let a = "";
  for (const b of parts) {
    if (!b) continue;
    if (!a) {
      a = b;
      continue;
    }
    const sep = a.includes("\\") && !a.includes("/") ? "\\" : "/";
    a = a.replace(/[\\/]+$/, "") + sep + b;
  }
  return a;
}

// ── base64 ──
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ── 时间格式化(Go 布局 "2006-01-02 15:04[:05]" 的等价输出) ──
export function fmtDateTime(ms: number, withSeconds = false): string {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return withSeconds ? `${base}:${p(d.getSeconds())}` : base;
}

// ── 用系统默认方式打开文件/目录 ──
export async function openInShell(path: string): Promise<void> {
  if (await isWindows()) {
    // Windows 下 explorer 需要正斜杠转义
    await shellOpen(path.replace(/\\/g, "/"));
  } else {
    await shellOpen(path);
  }
}

export { psQuote, shQuote };
