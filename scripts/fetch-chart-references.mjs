import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const inventoryPath = path.join(root, "docs", "chart-gallery-inventory.json");
const templateRoot = path.join(root, "src-tauri", "r", "chart-templates");
const write = process.argv.includes("--write");
const idsArg = process.argv.find((arg) => arg.startsWith("--ids="));
const selectedIds = idsArg ? new Set(idsArg.slice("--ids=".length).split(",").map((id) => id.trim()).filter(Boolean)) : null;
const inventory = JSON.parse(await fs.readFile(inventoryPath, "utf8"));
const verified = inventory.templates.filter((item) => item.status === "verified" && (!selectedIds || selectedIds.has(item.id)));

function firstImage(html) {
  const matches = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)];
  const sources = matches.map((match) => match[1]).filter((src) => !src.startsWith("data:"));
  return sources.sort((a, b) => scoreImage(b) - scoreImage(a))[0];
}

function scoreImage(src) {
  let score = 0;
  if (/figure-html|figure\/|_files\/figure/i.test(src)) score += 100;
  if (/\/img\/graph\//i.test(src)) score += 70;
  if (/\.png$/i.test(src)) score += 10;
  if (/logo|header|footer|section|background|poster|typo/i.test(src)) score -= 100;
  return score;
}

let found = 0;
let failed = 0;
for (const item of verified) {
  try {
    const page = await fetch(item.sourceUrl, { headers: { "user-agent": "mynx-chart-reference-audit/1.0" } });
    if (!page.ok) throw new Error(`来源页 HTTP ${page.status}`);
    const html = await page.text();
    const imagePath = firstImage(html);
    if (!imagePath) throw new Error("来源页未找到图片");
    const imageUrl = new URL(imagePath, item.sourceUrl).toString();
    found += 1;
    if (write) {
      const image = await fetch(imageUrl, { headers: { "user-agent": "mynx-chart-reference-audit/1.0" } });
      if (!image.ok) throw new Error(`图片 HTTP ${image.status}`);
      const buffer = Buffer.from(await image.arrayBuffer());
      const target = path.join(templateRoot, item.id, "reference.png");
      await fs.writeFile(target, buffer);
      const manifestPath = path.join(templateRoot, item.id, "manifest.json");
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      manifest.referencePath = "reference.png";
      manifest.referenceImageUrl = imageUrl;
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
      console.log(`已保存 ${item.id} ← ${imageUrl}`);
    } else {
      console.log(`可用 ${item.id} ← ${imageUrl}`);
    }
  } catch (error) {
    failed += 1;
    console.error(`缺少 ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(`官方参考图审计：${found}/${verified.length} 个模板找到示例图，${failed} 个待处理。${write ? "已写入模板目录。" : "未写入文件；使用 --write 下载。"}`);
if (failed > 0 && write) process.exitCode = 1;
