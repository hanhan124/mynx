import fs from "node:fs";

const reportPath = "docs/chart-visual-regression.json";
if (!fs.existsSync(reportPath)) {
  console.error("视觉回归报告不存在，请先运行 npm run charts:visual");
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const templateRoot = "src-tauri/r/chart-templates";
const expected = fs.readdirSync(templateRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    try { return JSON.parse(fs.readFileSync(`${templateRoot}/${entry.name}/manifest.json`, "utf8")); }
    catch { return null; }
  })
  .filter((manifest) => manifest?.status === "verified")
  .map((manifest) => manifest.id)
  .sort();
const actual = (report.results ?? []).map((item) => item.id).sort();
const missing = expected.filter((id) => !actual.includes(id));
const incomplete = (report.results ?? []).filter((item) => !item.reference || !item.generated).map((item) => item.id);
if (missing.length || incomplete.length) {
  console.error(`视觉回归报告不完整：缺少 ${missing.join("、") || "无"}；输出不完整 ${incomplete.join("、") || "无"}`);
  process.exit(1);
}
console.log(`视觉回归报告有效：${actual.length} 个已验证模板，${report.generatedAt ?? "时间未知"}`);
