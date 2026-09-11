// Verify that every R runtime file is present in both delivery paths:
// Tauri's main-app resources (macOS and Windows) and the Windows installer's
// compile-time resource manifest.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const rRoot = path.join(root, "src-tauri", "r");
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const generated = fs.readFileSync(
  path.join(root, "installer", "src-tauri", "src", "generated_resources.rs"),
  "utf8",
);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

if (tauriConfig.bundle?.resources?.["r/"] !== "r/") {
  throw new Error("主应用 Tauri 配置缺少 r/ 资源映射");
}

const files = walk(rRoot).map((full) =>
  path.relative(rRoot, full).split(path.sep).join("/"),
);
const missing = files.filter((relative) => !generated.includes(`(\"r/${relative}\",`));
if (missing.length) {
  throw new Error(`Windows 安装器缺少 R 资源: ${missing.join(", ")}`);
}

console.log(`✅ R 资源完整：主应用 + Windows 安装器共 ${files.length} 个文件`);
