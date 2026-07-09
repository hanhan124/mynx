// post-installer-build.cjs — 在 installer 编完后:
//   1. 复制 mynx-installer.exe → release-installer/(覆盖)
//   2. 清理 installer/target/release/ 下所有中间产物
// 一次性做完"出包 + 清理",所以 release-installer/ 永远只有最新一份 exe
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC_EXE = path.join(ROOT, "installer", "src-tauri", "target", "release", "mynx-installer.exe");
const DST_DIR = path.join(ROOT, "release-installer");
const DST_EXE = path.join(DST_DIR, "mynx-installer.exe");

if (!fs.existsSync(SRC_EXE)) {
  console.error(`❌ 找不到 ${SRC_EXE}`);
  process.exit(1);
}

fs.mkdirSync(DST_DIR, { recursive: true });
fs.copyFileSync(SRC_EXE, DST_EXE);
const sizeMB = (fs.statSync(DST_EXE).size / 1024 / 1024).toFixed(2);
console.log(`✅ mynx-installer.exe → release-installer/ (${sizeMB} MB)`);

// 清理 installer/target/release 下除 mynx-installer.exe 外的所有产物
const TARGET = path.join(ROOT, "installer", "src-tauri", "target", "release");
let removed = 0;
for (const f of fs.readdirSync(TARGET)) {
  if (f.toLowerCase() === "mynx-installer.exe") continue;
  const full = path.join(TARGET, f);
  fs.rmSync(full, { recursive: true, force: true });
  removed++;
}
console.log(`🧹 清理了 ${removed} 个中间产物`);

// 同步清理 release-installer/ 内任何残留
for (const f of fs.readdirSync(DST_DIR)) {
  if (f.toLowerCase() !== "mynx-installer.exe") {
    fs.rmSync(path.join(DST_DIR, f), { recursive: true, force: true });
  }
}

console.log("\n📦 最终交付物:");
console.log(`   ${DST_EXE}  (${sizeMB} MB)`);