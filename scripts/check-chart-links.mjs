import fs from "node:fs/promises";

const inventory = JSON.parse(
  await fs.readFile("docs/chart-gallery-inventory.json", "utf8"),
);
const catalog = await fs.readFile("src/features/charts/catalog.ts", "utf8");
const officialCatalog = catalog.split("const legacyChartTemplates", 1)[0];
const catalogUrls = [...officialCatalog.matchAll(/galleryUrl:\s*"([^"]+)"/g)].map(
  (match) => match[1],
);
const inventoryUrls = inventory.templates
  .filter((item) => item.status === "verified")
  .map((item) => item.sourceUrl)
  .filter(Boolean);
const urls = [...new Set([...inventoryUrls, ...catalogUrls])];
const results = new Array(urls.length);
const maxAttempts = 3;
const concurrency = Math.min(4, urls.length);
let nextIndex = 0;

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function checkUrl(url) {
  let lastError = "fetch failed";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      let response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
      });
      if (response.status === 405 || response.status === 403) {
        response = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(12_000),
        });
      }

      if (response.ok) return null;

      lastError = `HTTP ${response.status}`;
      const transientStatus =
        response.status === 408 || response.status === 429 || response.status >= 500;
      if (!transientStatus || attempt === maxAttempts) return `${url} (${lastError})`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === maxAttempts) return `${url} (${lastError})`;
    }

    await delay(250 * 2 ** (attempt - 1));
  }

  return `${url} (${lastError})`;
}

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    while (nextIndex < urls.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await checkUrl(urls[index]);
    }
  }),
);

const failures = results.filter(Boolean);

if (failures.length) {
  console.error(`图表来源链接校验失败：${failures.length}/${urls.length}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`图表来源链接有效：${urls.length} 个唯一 R Graph Gallery 页面`);
}
