// sync-installer-payload.cjs — 把主应用编译产物复制到 installer/ 的 resources 目录
// (Tauri 自建安装器通过 include_bytes! 在编译期嵌入这个文件)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src-tauri", "target", "release", "mynx.exe");
const DST = path.join(ROOT, "installer", "src-tauri", "resources", "mynx.exe");

if (!fs.existsSync(SRC)) {
  console.error(`❌ 找不到 ${SRC}`);
  console.error("   请先跑: npm run tauri build -- --no-bundle");
  process.exit(1);
}

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.copyFileSync(SRC, DST);

const sizeMB = (fs.statSync(DST).size / 1024 / 1024).toFixed(1);
console.log(`✅ 已复制 mynx.exe → installer/src-tauri/resources/ (${sizeMB} MB)`);