// build-singlefile.cjs — 构建单文件版并生成 GitHub Release 所需资源
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "dist-singlefile");
const EXE_NAME = "mynx.exe";

function run(cmd, cwd = ROOT) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd });
}

// 2. 编译 Rust 二进制（用 tauri build --no-bundle 保证前端正确嵌入）
console.log("\n🔨 编译 Rust...");
run("npx tauri build --no-bundle", ROOT);

// 3. 准备输出目录
if (fs.existsSync(OUT_DIR)) {
  fs.rmSync(OUT_DIR, { recursive: true });
}
fs.mkdirSync(OUT_DIR);

// 4. 复制 exe
const srcExe = path.join(ROOT, "src-tauri", "target", "release", EXE_NAME);
if (!fs.existsSync(srcExe)) {
  console.error("❌ 编译失败：找不到 mynx.exe");
  process.exit(1);
}
fs.copyFileSync(srcExe, path.join(OUT_DIR, EXE_NAME));

// 5. 复制 latest.json（如果存在）
const srcLatestJson = path.join(ROOT, "src-tauri", "target", "release", "bundle", "nsis", "latest.json");
if (fs.existsSync(srcLatestJson)) {
  fs.copyFileSync(srcLatestJson, path.join(OUT_DIR, "latest.json"));
  console.log("   ✓ latest.json 已复制");
} else {
  console.log("   ⚠ latest.json 不存在（首次构建或未签名），将在签名后生成");
}

// 6. 生成签名文件（如果有签名配置）
const privKeyPath = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;
const privKeyPass = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;

if (privKeyPath && fs.existsSync(privKeyPath)) {
  console.log("\n🔏 生成签名文件...");
  try {
    const { execSync: execSync2 } = require("child_process");
    const exePath = path.join(OUT_DIR, EXE_NAME);
    const sigPath = exePath + ".sig";

    execSync2(
      `npx tauri signer sign -k "${privKeyPath}" -p "${privKeyPass || ""}" "${exePath}"`,
      { stdio: "inherit", cwd: ROOT }
    );
    console.log("   ✓ 签名完成");
  } catch (e) {
    console.log("   ⚠ 签名失败，跳过（自动更新将不可用）");
  }
} else {
  console.log("\n💡 如需签名以启用自动更新，请设置环境变量：");
  console.log("   TAURI_SIGNING_PRIVATE_KEY_PATH=私钥路径");
  console.log("   TAURI_SIGNING_PRIVATE_KEY_PASSWORD=密码");
}

// 7. 写入版本说明
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const version = pkg.version;
const readmeContent = `Mynx v${version} 便携版
==================

直接运行 mynx.exe 即可，无需安装。

运行环境：
- Windows 10 / Windows 11
- Microsoft Edge WebView2 运行时
  （大多数 Windows 电脑已预装，未安装请前往：
   https://developer.microsoft.com/microsoft-edge/webview2/）

本文件为绿色软件，使用完毕直接删除即可，无残留。

---
开源项目：https://github.com/hanhan124/mynx
`;
fs.writeFileSync(path.join(OUT_DIR, "README.txt"), readmeContent);

// 8. 打包成 zip（如果 7-Zip 可用）
const sevenZip =
  fs.existsSync("C:\\Program Files\\7-Zip\\7z.exe")
    ? "C:\\Program Files\\7-Zip\\7z.exe"
    : fs.existsSync("C:\\Program Files (x86)\\7-Zip\\7z.exe")
    ? "C:\\Program Files (x86)\\7-Zip\\7z.exe"
    : null;

if (sevenZip) {
  console.log("\n📦 压缩为单文件 zip...");
  const zipName = `mynx-${version}-portable.zip`;
  const zipPath = path.join(ROOT, zipName);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(
    `"${sevenZip}" a -tzip "${zipPath}" "${OUT_DIR}\\*"`,
    { stdio: "inherit" }
  );
  const zipSize = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ 单文件版构建完成！`);
  console.log(`   便携 zip：${zipName}（${zipSize} MB）`);
  console.log(`   免安装 exe：${OUT_DIR}\\${EXE_NAME}`);
} else {
  console.log("\n📦 7-Zip 未安装，跳过 zip 压缩");
  console.log(`\n✅ 便携版已生成：${OUT_DIR}\\${EXE_NAME}`);
  console.log(`   手动压缩为 zip：安装 7-Zip 后运行：
   "C:\\Program Files\\7-Zip\\7z.exe" a -tzip mynx-${version}-portable.zip "${OUT_DIR}\\*"`);
}

// 9. 输出 GitHub Release 所需文件清单
console.log("\n📋 GitHub Release 所需文件：");
const releaseFiles = [];
const exeInOut = path.join(OUT_DIR, EXE_NAME);
if (fs.existsSync(exeInOut)) {
  const size = (fs.statSync(exeInOut).size / 1024 / 1024).toFixed(1);
  console.log(`   ✓ ${EXE_NAME}（${size} MB）`);
  releaseFiles.push({ name: `mynx-${version}.exe`, path: exeInOut });
}
const sigPath2 = exeInOut + ".sig";
if (fs.existsSync(sigPath2)) {
  console.log(`   ✓ mynx.exe.sig（签名文件）`);
  releaseFiles.push({ name: `mynx-${version}.exe.sig`, path: sigPath2 });
}
const ljPath = path.join(OUT_DIR, "latest.json");
if (fs.existsSync(ljPath)) {
  console.log(`   ✓ latest.json`);
  releaseFiles.push({ name: "latest.json", path: ljPath });
}
console.log("\n📝 上传以上文件到 GitHub Release 即可启用自动更新");
