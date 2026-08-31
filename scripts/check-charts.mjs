import { spawn } from "node:child_process";

const checks = [
  ["清单", "scripts/validate-chart-inventory.mjs"],
  ["来源链接", "scripts/check-chart-links.mjs"],
  ["参考图", "scripts/check-chart-references.mjs"],
  ["视觉报告", "scripts/check-chart-visual-report.mjs"],
  ["字段映射", "scripts/check-chart-mappings.mjs"],
];

for (const [label, script] of checks) {
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" });
    child.on("close", (exitCode) => resolve(exitCode ?? 1));
    child.on("error", () => resolve(1));
  });
  if (code !== 0) {
    console.error(`图表${label}检查未通过`);
    process.exit(code);
  }
}

console.log("图表工作台契约检查全部通过");
