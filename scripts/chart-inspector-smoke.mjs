import { chartInspectorTestCases } from "../src/lib/charts/inspector-fields.test.ts";

const failures = Object.entries(chartInspectorTestCases)
  .filter(([, test]) => {
    try {
      return !test();
    } catch {
      return true;
    }
  })
  .map(([name]) => name);

if (failures.length) {
  console.error(`图表检查器值转换 smoke 失败：${failures.join(", ")}`);
  process.exit(1);
}

console.log(`图表检查器值转换 smoke 通过：${Object.keys(chartInspectorTestCases).length} 项`);
