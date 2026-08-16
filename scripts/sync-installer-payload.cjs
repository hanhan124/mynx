// sync-installer-payload.cjs — 把主应用编译产物复制到 installer/ 的 resources 目录
// (Tauri 自建安装器通过 include_bytes! 在编译期嵌入这些文件)
//   1. mynx.exe        主程序
//   2. r/              RNA-seq R 引擎脚本(运行时按 resourceDir()/r/... 解析)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src-tauri", "target", "release", "mynx.exe");
const DST = path.join(ROOT, "installer", "src-tauri", "resources", "mynx.exe");
const R_SRC = path.join(ROOT, "src-tauri", "r");
const R_DST = path.join(ROOT, "installer", "src-tauri", "resources", "r");

if (!fs.existsSync(SRC)) {
  console.error(`❌ 找不到 ${SRC}`);
  console.error("   请先跑: npm run tauri build -- --no-bundle");
  process.exit(1);
}
if (!fs.existsSync(R_SRC)) {
  console.error(`❌ 找不到 ${R_SRC}(RNA-seq R 引擎脚本)`);
  process.exit(1);
}

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.copyFileSync(SRC, DST);

const sizeMB = (fs.statSync(DST).size / 1024 / 1024).toFixed(1);
console.log(`✅ 已复制 mynx.exe → installer/src-tauri/resources/ (${sizeMB} MB)`);

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

// 与 install.rs 的 R_RESOURCES 清单比对,防止新增脚本后忘记登记
const manifest = path.join(ROOT, "installer", "src-tauri", "src", "install.rs");
const rust = fs.readFileSync(manifest, "utf8");
const missing = files.filter((f) => !rust.includes(`"${f.relPath}"`));
if (missing.length) {
  console.error("❌ 以下 R 脚本未登记到 install.rs 的 R_RESOURCES(否则不会打进安装器):");
  for (const m of missing) console.error(`   - ${m.relPath}`);
  process.exit(1);
}
console.log("✅ R_RESOURCES 清单与 r/ 目录一致");
