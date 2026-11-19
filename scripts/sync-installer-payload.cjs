// sync-installer-payload.cjs — 把主程序编译产物复制到 installer/ 的 resources 目录
// (Tauri 自建安装器通过 include_bytes! 在编译期嵌入这些文件)
//   1. mynx.exe        原始主程序(校验与安装后还原的输入)
//   2. mynx.exe.gz     安装器内嵌的 gzip 主程序
//   3. r/              RNA-seq R 引擎脚本(运行时按 resourceDir()/r/... 解析)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const APP_ROOT = path.join(ROOT, "src-tauri");
const TARGET_ROOT = path.join(APP_ROOT, "target");
const defaultSource = path.join(TARGET_ROOT, "release", "mynx-next.exe");
const SRC = process.env.MYNX_RELEASE_EXE
  ? path.resolve(ROOT, process.env.MYNX_RELEASE_EXE)
  : defaultSource;
const relativeSource = path.relative(TARGET_ROOT, SRC);
if (!relativeSource || relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
  throw new Error(`主程序来源必须位于 ${TARGET_ROOT} 下：${SRC}`);
}
const DST = path.join(ROOT, "installer", "src-tauri", "resources", "mynx.exe");
const DST_GZIP = `${DST}.gz`;
const DST_GZIP_TEMP = `${DST_GZIP}.${process.pid}.tmp`;
const MANIFEST = path.join(ROOT, "installer", "src-tauri", "resources", "mynx-payload.json");
const UNINSTALLER = path.join(ROOT, "installer", "src-tauri", "resources", "Uninst.exe");
const R_SRC = path.join(APP_ROOT, "r");
const R_DST = path.join(ROOT, "installer", "src-tauri", "resources", "r");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const tauriConfig = JSON.parse(fs.readFileSync(path.join(APP_ROOT, "tauri.conf.json"), "utf8"));

if (pkg.version !== tauriConfig.version) {
  throw new Error(`版本不一致：package.json=${pkg.version}, Tauri=${tauriConfig.version}`);
}

if (!fs.existsSync(SRC)) {
  console.error(`❌ 找不到 ${SRC}`);
  console.error("   请先跑: npm run tauri -- build --no-bundle（构建主程序）");
  process.exit(1);
}
if (!fs.existsSync(R_SRC)) {
  console.error(`❌ 找不到 ${R_SRC}(RNA-seq R 引擎脚本)`);
  process.exit(1);
}
if (!fs.existsSync(UNINSTALLER)) {
  throw new Error("缺少独立卸载程序；请先运行 npm run installer:uninstaller");
}
const uninstallerBytes = fs.readFileSync(UNINSTALLER);
if (
  uninstallerBytes.length < 2 ||
  uninstallerBytes.subarray(0, 2).toString("ascii") !== "MZ" ||
  uninstallerBytes.length >= 16 * 1024 * 1024
) {
  throw new Error("独立卸载程序不是有效 PE 文件或超过 16 MiB，拒绝打包");
}
const uninstallerSha = crypto.createHash("sha256").update(uninstallerBytes).digest("hex");

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.copyFileSync(SRC, DST);

const sizeMB = (fs.statSync(DST).size / 1024 / 1024).toFixed(1);
const sourceHash = crypto.createHash("sha256").update(fs.readFileSync(SRC)).digest("hex");
const payloadHash = crypto.createHash("sha256").update(fs.readFileSync(DST)).digest("hex");
if (sourceHash !== payloadHash) throw new Error("安装器 payload 与主程序构建产物 SHA-256 不一致");
const compressedPayload = zlib.gzipSync(fs.readFileSync(DST), {
  level: zlib.constants.Z_BEST_COMPRESSION,
  mtime: 0,
});
const decompressedHash = crypto.createHash("sha256").update(zlib.gunzipSync(compressedPayload)).digest("hex");
if (decompressedHash !== payloadHash) throw new Error("压缩后的安装器 payload 无法通过 SHA-256 校验");
fs.writeFileSync(DST_GZIP_TEMP, compressedPayload);
try {
  fs.renameSync(DST_GZIP_TEMP, DST_GZIP);
} catch (error) {
  fs.rmSync(DST_GZIP_TEMP, { force: true });
  throw new Error(`替换压缩 payload 失败: ${error.message}`);
}
const payloadInfo = {
  schema_version: 2,
  app_version: pkg.version,
  source: path.relative(ROOT, SRC).replace(/\\/g, "/"),
  installed_filename: "mynx.exe",
  size_bytes: fs.statSync(DST).size,
  sha256: payloadHash,
  embedded_payload: {
    filename: "mynx.exe.gz",
    compression: "gzip",
    size_bytes: compressedPayload.length,
    sha256: crypto.createHash("sha256").update(compressedPayload).digest("hex"),
  },
  uninstaller: {
    filename: "Uninst.exe",
    size_bytes: uninstallerBytes.length,
    sha256: uninstallerSha,
  },
};
fs.writeFileSync(MANIFEST, `${JSON.stringify(payloadInfo, null, 2)}\n`, "utf8");
console.log(`✅ 已复制 mynx-next.exe → 安装器兼容名称 mynx.exe (${sizeMB} MB)`);
console.log(`   版本 ${pkg.version} · SHA-256 ${payloadHash}`);
console.log(`✅ 安装器内部压缩 payload: ${(compressedPayload.length / 1024 / 1024).toFixed(2)} MiB`);
console.log(`✅ 独立卸载程序: ${(uninstallerBytes.length / 1024 / 1024).toFixed(2)} MiB · SHA-256 ${uninstallerSha}`);

// 递归复制 r/ → resources/r/(保持相对路径,与 include_bytes! 清单对应)
fs.rmSync(R_DST, { recursive: true, force: true });
const files = [];
(function walk(dir, rel) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    // relPath 以 r/ 开头,与 install.rs 的 R_RESOURCES 登记(a)一致
    const relPath = rel ? `${rel}/${name}` : `r/${name}`;
    if (fs.statSync(abs).isDirectory()) walk(abs, relPath);
    else files.push({ abs, relPath });
  }
})(R_SRC, "");
for (const f of files) {
  // relPath 形如 r/modules/enrich.R;R_DST 已是 resources/r,取去掉 r/ 前缀的部分
  const under = f.relPath.split("/").slice(1).join(path.sep);
  const dst = path.join(R_DST, under);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(f.abs, dst);
}
const totalKB = files.reduce((n, f) => n + fs.statSync(f.abs).size, 0);
console.log(`✅ 已复制 ${files.length} 个 R 脚本 → installer/src-tauri/resources/r/ (${(totalKB / 1024).toFixed(1)} KB)`);

// Generate the Rust embedding list from the same R source tree and payload
// manifest. This catches missing resources and preserves the original EXE size
// for installer space estimates while embedding the compressed payload.
require("./generate-installer-resources.cjs");
console.log("✅ 已从主程序源目录生成 R_RESOURCES 清单");
