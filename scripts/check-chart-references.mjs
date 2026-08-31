import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const templateRoot = path.join(root, "src-tauri", "r", "chart-templates");
const missing = [];
const entries = await fs.readdir(templateRoot, { withFileTypes: true });
const verified = [];

for (const entry of entries.filter((item) => item.isDirectory())) {
  const dir = path.join(templateRoot, entry.name);
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
  } catch {
    continue;
  }
  if (manifest.status !== "verified") continue;
  verified.push(manifest.id || entry.name);
  const reference = path.join(dir, manifest.referencePath || "reference.png");
  try {
    const stat = await fs.stat(reference);
    if (!stat.isFile() || stat.size < 1000) missing.push(`${item.id}（参考图为空）`);
  } catch {
    missing.push(`${item.id}（缺少参考图）`);
  }
}

if (missing.length) {
  console.error(`图表参考图检查失败：${missing.join("、")}`);
  process.exit(1);
}
console.log(`图表参考图有效：${verified.length} 个已验证模板`);
