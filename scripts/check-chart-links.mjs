import fs from "node:fs/promises";

const inventory = JSON.parse(await fs.readFile("docs/chart-gallery-inventory.json", "utf8"));
const catalog = await fs.readFile("src/lib/charts/catalog.ts", "utf8");
const officialCatalog = catalog.split("const legacyChartTemplates", 1)[0];
const catalogUrls = [...officialCatalog.matchAll(/galleryUrl:\s*"([^"]+)"/g)].map((match) => match[1]);
const inventoryUrls = inventory.templates.filter((item) => item.status === "verified").map((item) => item.sourceUrl).filter(Boolean);
const urls = [...new Set([...inventoryUrls, ...catalogUrls])];
const failures = [];

for (const url of urls) {
  let response;
  try {
    response = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(12_000) });
    if (response.status === 405 || response.status === 403) response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12_000) });
  } catch (error) {
    failures.push(`${url} (${error instanceof Error ? error.message : String(error)})`);
    continue;
  }
  if (!response.ok) failures.push(`${url} (HTTP ${response.status})`);
}

if (failures.length) {
  console.error(`图表来源链接校验失败：${failures.length}/${urls.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`图表来源链接有效：${urls.length} 个唯一 R Graph Gallery 页面`);
}
