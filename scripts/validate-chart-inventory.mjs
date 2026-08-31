import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const inventoryPath = resolve("docs/chart-gallery-inventory.json");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const issues = [];
const ids = new Set();
const families = new Set(inventory.targetFamilies ?? []);

for (const template of inventory.templates ?? []) {
  if (!template.id || typeof template.id !== "string") issues.push("模板缺少 id");
  else if (ids.has(template.id)) issues.push(`重复模板 id: ${template.id}`);
  else ids.add(template.id);
  if (!families.has(template.family)) issues.push(`${template.id}: 未登记的图表类型 ${template.family}`);
  if (!/^https:\/\//.test(template.sourceUrl ?? "")) issues.push(`${template.id}: 缺少有效官网来源 URL`);
  if (!['draft', 'verified'].includes(template.status)) issues.push(`${template.id}: status 必须为 draft 或 verified`);
  if (template.status === 'verified' && !template.sourceRepoPath) issues.push(`${template.id}: 已验证模板必须指向官方仓库源文件`);
  if (template.status === 'verified') {
    const dir = resolve('src-tauri/r/chart-templates', template.id);
    for (const file of ['manifest.json', 'sample.csv', 'render.R', 'defaults.json', 'README.zh-CN.md']) {
      if (!existsSync(resolve(dir, file))) issues.push(`${template.id}: 缺少已验证资源 ${file}`);
    }
    if (existsSync(resolve(dir, 'manifest.json'))) {
      try {
        const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
        if (manifest.id !== template.id) issues.push(`${template.id}: manifest.id 不一致`);
        if (!Array.isArray(manifest.outputs) || manifest.outputs.length === 0) issues.push(`${template.id}: manifest.outputs 为空`);
        if (!Array.isArray(manifest.dataRoles)) issues.push(`${template.id}: manifest.dataRoles 缺失`);
      } catch { issues.push(`${template.id}: manifest.json 不是有效 JSON`); }
    }
  }
}

if (issues.length) {
  console.error("图表清单校验失败:\n" + issues.map((issue) => `- ${issue}`).join("\n"));
  process.exit(1);
}

const verified = inventory.templates.filter((item) => item.status === "verified").length;
const drafts = inventory.templates.length - verified;
console.log(`图表清单有效：${inventory.templates.length} 个模板，${verified} 个已验证，${drafts} 个待逐例视觉回归；覆盖 ${families.size} 个官网图表类型目标。`);
