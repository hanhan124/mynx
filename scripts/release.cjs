const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ver = process.argv[2];

if (!ver) {
  console.log("用法: npm run release <版本号>");
  console.log("示例: npm run release 1.9.0");
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT, ...opts });
}

const status = execSync("git status --porcelain", { cwd: ROOT }).toString().trim();
if (status) {
  run("git add -A");
  run(`git commit -m "chore: pre-release changes"`);
} else {
  console.log("   工作区已清洁，跳过");
}

console.log(`\n📦 升级版本: → v${ver}`);
run(`npm version ${ver} -m "release: v%s"`);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const tag = `v${pkg.version}`;
console.log(`\n✅ 版本已同步: ${pkg.version}`);

console.log("\n🚀 推送代码到 GitHub...");
run("git push origin HEAD --follow-tags");

console.log(`\n✅ 已推送! GitHub Actions 将自动构建并创建 Release: ${tag}`);
console.log(`   查看进度: https://github.com/hanhan124/mynx/actions`);
