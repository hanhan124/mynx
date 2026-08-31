import { chartSchemaTestCases } from "../src/lib/charts/schema.test.ts";

const failures = Object.entries(chartSchemaTestCases)
  .filter(([, test]) => {
    try {
      return !test();
    } catch {
      return true;
    }
  })
  .map(([name]) => name);

if (failures.length) {
  console.error(`图表 schema smoke 失败：${failures.join(", ")}`);
  process.exit(1);
}

console.log(`图表 schema smoke 通过：${Object.keys(chartSchemaTestCases).length} 项`);
