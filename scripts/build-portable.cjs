// build-portable.cjs — 构建便携版（不打包 NSIS 安装程序）
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

// 1. 编译 Rust + 前端（--no-bundle 跳过 NSIS 打包，保证嵌入正确）
console.log("\n🔨 编译中...");
run("npx tauri build --no-bundle");

// 3. 找到编译产物
const exePath = path.join(ROOT, "src-tauri", "target", "release", "mynx.exe");
if (!fs.existsSync(exePath)) {
  console.error("❌ 编译失败：找不到 mynx.exe");
  process.exit(1);
}

const size = fs.statSync(exePath).size;
const sizeMB = (size / 1024 / 1024).toFixed(1);

// 4. 复制到项目根目录
const outPath = path.join(ROOT, "mynx-portable.exe");
fs.copyFileSync(exePath, outPath);

console.log(`\n✅ 便携版构建完成!`);
console.log(`   文件: ${outPath}`);
console.log(`   大小: ${sizeMB} MB`);
console.log(`   直接双击运行，无需安装。`);
