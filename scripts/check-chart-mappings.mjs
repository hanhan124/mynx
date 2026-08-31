import fs from "node:fs/promises";
import path from "node:path";

const root = "src-tauri/r/chart-templates";
const entries = await fs.readdir(root, { withFileTypes: true });
const forbidden = /data\$(from|to|value|word|freq|group|before|after|longitude|latitude|region|wkt|stage1|stage2|stage3)\b/g;
const failures = [];

for (const entry of entries.filter((item) => item.isDirectory())) {
  const file = path.join(root, entry.name, "render.R");
  const source = await fs.readFile(file, "utf8");
  if (forbidden.test(source)) failures.push(`${entry.name}/render.R 仍包含固定列访问`);
  forbidden.lastIndex = 0;
}

if (failures.length) {
  console.error("图表字段映射检查失败：");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`图表字段映射有效：${entries.filter((item) => item.isDirectory()).length} 个模板`);
}
