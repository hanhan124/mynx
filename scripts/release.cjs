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
// npm version 只会 commit package.json，sync-version.cjs 改的文件会漏掉
// 使用 --no-git-tag-version 抑制自动提交，手动处理确保所有文件同步
run(`npm version ${ver} --no-git-tag-version --allow-same-version`);

console.log(`\n📦 同步版本号到其他文件...`);
run("node scripts/sync-version.cjs");

console.log(`\n📝 提交版本变更...`);
run("git add -A");
run(`git commit -m "release: v${ver}"`);

console.log(`\n🏷️  创建标签...`);
run(`git tag -a v${ver} -m "release: v${ver}"`);

console.log(`\n✅ 版本已同步: ${ver}`);

console.log("\n🚀 推送代码到 GitHub...");
run("git push origin HEAD --follow-tags");

console.log(`\n✅ 已推送! GitHub Actions 将自动构建并创建 Release: v${ver}`);
console.log(`   查看进度: https://github.com/hanhan124/mynx/actions`);
