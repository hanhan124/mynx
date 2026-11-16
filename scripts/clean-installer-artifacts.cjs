// clean-installer-artifacts.cjs — 每次打包后清理所有中间产物
// 保留:
//   - release-installer/mynx-installer.exe + build.json + optional .sig
//   - mynx-next/src-tauri/target/release/mynx-next.exe ← 主应用 exe(下轮打包的输入)
//   - installer/src-tauri/resources/mynx.exe(.gz) ← payload 及压缩嵌入资源
// 删除:
//   - installer/src-tauri/target/release 下除 mynx-installer.exe 外的所有文件
//   - installer/src-tauri/target/release/{build,deps,examples,incremental,*.pdb,*.d,*.sig}
//   - release-installer/ 内除 mynx-installer.exe 外的所有历史文件
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release-installer");
const INSTALLER_TARGET = path.join(ROOT, "installer", "src-tauri", "target", "release");

const RELEASE_DELIVERABLES = new Set([
  "mynx-installer.exe",
  "mynx-installer.exe.sig",
  "mynx-installer.exe.build.json",
]);

// ── 1. 清理 release-installer/,只保留当前产物与校验信息 ──
if (fs.existsSync(RELEASE_DIR)) {
  for (const f of fs.readdirSync(RELEASE_DIR)) {
    if (!RELEASE_DELIVERABLES.has(f.toLowerCase())) {
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

console.log("\n✅ 清理完成,只保留安装器、签名与来源校验清单");
