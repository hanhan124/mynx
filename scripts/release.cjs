// release.cjs — 一键发版：commit → bump版本 → build → 创建 GitHub Release
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ver = process.argv[2];

if (!ver) {
  console.log("用法: npm run release <版本号>");
  console.log("示例: npm run release 1.0.0");
  console.log("      npm run release 0.2.0-beta.1");
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

// 1. 先提交所有改动 (npm version 要求 clean git)
console.log("\n📝 提交当前改动...");
const status = execSync("git status --porcelain", { cwd: ROOT }).toString().trim();
if (status) {
  run("git add -A");
  run(`git commit -m "chore: pre-release changes"`);
} else {
  console.log("   工作区已清洁，跳过");
}

// 2. Bump 版本 (npm version 自动 commit + tag)
console.log(`\n📦 升级版本: → v${ver}`);
run(`npm version ${ver} -m "release: v%s"`);

// 3. 读取版本号确认
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const tag = `v${pkg.version}`;
console.log(`\n✅ 版本已同步: ${pkg.version}`);

// 4. Build (带签名)
console.log("\n🔨 开始构建 (签名)...");
console.log("   确保已设置环境变量:");
console.log("   TAURI_SIGNING_PRIVATE_KEY_PATH=<mynx.key 的路径>");
console.log("   TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<密钥密码>");
run("npm run tauri build");

// 5. 找到构建产物
const bundleDir = path.join(ROOT, "src-tauri", "target", "release", "bundle");
const nsisDir = path.join(bundleDir, "nsis");
const msiDir = path.join(bundleDir, "msi");
const releaseDir = path.join(ROOT, "src-tauri", "target", "release");

const assets = [];
if (fs.existsSync(nsisDir)) {
  for (const f of fs.readdirSync(nsisDir)) {
    if (f.endsWith(".exe") || f.endsWith(".sig")) {
      assets.push(path.join(nsisDir, f));
    }
  }
}
if (fs.existsSync(msiDir)) {
  for (const f of fs.readdirSync(msiDir)) {
    if (f.endsWith(".msi") || f.endsWith(".sig")) {
      assets.push(path.join(msiDir, f));
    }
  }
}

// latest.json (updater 需要的更新描述文件)
const latestJsonPath = path.join(nsisDir, "latest.json");
if (fs.existsSync(latestJsonPath)) {
  assets.push(latestJsonPath);
}

// 便携版 exe
const portableExe = path.join(releaseDir, "mynx.exe");
const portableDest = path.join(releaseDir, `Mynx_${pkg.version}_portable.exe`);
if (fs.existsSync(portableExe)) {
  fs.copyFileSync(portableExe, portableDest);
  assets.push(portableDest);
  
  // 便携版签名
  const portableSig = portableDest + ".sig";
  if (fs.existsSync(portableSig)) {
    assets.push(portableSig);
  }
}

console.log(`\n📁 构建产物 (${assets.length} 个文件):`);
for (const a of assets) {
  console.log(`   ${path.basename(a)}`);
}

// 6. Push commit + tag
console.log("\n🚀 推送代码到 GitHub...");
run("git push origin HEAD --follow-tags");

// 7. 创建 GitHub Release
console.log(`\n🎉 创建 GitHub Release: ${tag}`);
const assetArgs = assets.map((a) => `"${a}"`).join(" ");
run(
  `gh release create ${tag} ${assetArgs} --title "Mynx ${tag}" --generate-notes`,
  { stdio: "inherit" },
);

console.log(`\n✅ 发版完成! ${tag}`);
console.log(`   GitHub Release: https://github.com/hanhan124/mynx/releases/tag/${tag}`);
