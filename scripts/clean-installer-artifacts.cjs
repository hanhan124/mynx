// clean-installer-artifacts.cjs — 每次打包后清理所有中间产物
// 保留:
//   - release-installer/mynx-installer.exe  ← 唯一交付物
//   - src-tauri/target/release/mynx.exe     ← 主应用 exe(下轮打包的输入)
//   - installer/src-tauri/resources/mynx.exe ← 嵌入资源(下轮打包的输入)
// 删除:
//   - installer/src-tauri/target/release 下除 mynx-installer.exe 外的所有文件
//   - installer/src-tauri/target/release/{build,deps,examples,incremental,*.pdb,*.d,*.sig}
//   - release-installer/ 内除 mynx-installer.exe 外的所有历史文件
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release-installer");
const INSTALLER_TARGET = path.join(ROOT, "installer", "src-tauri", "target", "release");

// ── 1. 清理 release-installer/,只保留最新拷贝(由调用者负责先复制进来) ──
if (fs.existsSync(RELEASE_DIR)) {
  for (const f of fs.readdirSync(RELEASE_DIR)) {
    if (f.toLowerCase() !== "mynx-installer.exe") {
      fs.rmSync(path.join(RELEASE_DIR, f), { recursive: true, force: true });
      console.log(`  removed release-installer/${f}`);
    }
  }
}

// ── 2. 清理 installer target/release 中除最终 exe 外的所有产物 ──
if (fs.existsSync(INSTALLER_TARGET)) {
  for (const f of fs.readdirSync(INSTALLER_TARGET)) {
    const full = path.join(INSTALLER_TARGET, f);
    const stat = fs.statSync(full);
    if (f.toLowerCase() === "mynx-installer.exe") continue; // 保留
    if (stat.isDirectory()) {
      fs.rmSync(full, { recursive: true, force: true });
      console.log(`  removed installer/target/release/${f}/`);
    } else {
      fs.rmSync(full, { force: true });
      console.log(`  removed installer/target/release/${f}`);
    }
  }
}

console.log("\n✅ 清理完成,只保留 mynx-installer.exe 作为唯一交付物");
