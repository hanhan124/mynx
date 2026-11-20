const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function svgPaths(svg, source) {
  const paths = [...svg.matchAll(/<path\b([\s\S]*?)\/?\s*>/g)].map(([, body]) => {
    const d = body.match(/\bd="([^"]+)"/)?.[1];
    const fill = body.match(/\bfill="([^"]+)"/)?.[1];
    if (!d || !fill) throw new Error(`${source}: path is missing d/fill`);
    return { d, fill };
  });
  if (paths.length === 0) throw new Error(`${source}: no SVG paths found`);
  return paths;
}

function installerPaths(source) {
  const paths = [...source.matchAll(/<path\b([\s\S]*?)\/>/g)].map(([, body]) => {
    const d = body.match(/\bd="([^"]+)"/)?.[1];
    const fill = body.match(/\bfill="([^"]+)"/)?.[1];
    if (!d || !fill) throw new Error("installer/src/components/Logo.tsx: path is missing d/fill");
    return { d, fill };
  });
  if (paths.length === 0) throw new Error("installer/src/components/Logo.tsx: no logo paths found");
  return paths;
}

function assetHash(relativePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
}

const canonical = svgPaths(read("public/icon.svg"), "public/icon.svg");
const appMark = svgPaths(read("public/mynx.svg"), "public/mynx.svg");
const installerMark = installerPaths(read("installer/src/components/Logo.tsx"));

for (const [name, mark] of [
  ["public/mynx.svg", appMark],
  ["installer/src/components/Logo.tsx", installerMark],
]) {
  if (JSON.stringify(mark) !== JSON.stringify(canonical)) {
    throw new Error(`${name} does not match the canonical shield mark in public/icon.svg`);
  }
}

function block(source, pattern, name) {
  const match = source.match(pattern);
  if (!match) throw new Error(`${name}: style block not found`);
  return match[1];
}

function cssTokens(source) {
  return Object.fromEntries(
    [...source.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  );
}

function assertTokenParity(name, appTokens, installerTokens, tokenNames) {
  for (const token of tokenNames) {
    if (!appTokens[token] || appTokens[token] !== installerTokens[token]) {
      throw new Error(
        `${name} token --${token} differs: app=${appTokens[token] ?? "<missing>"}, installer=${installerTokens[token] ?? "<missing>"}`,
      );
    }
  }
}

const appCss = read("src/styles/app.css");
const installerCss = read("installer/src/styles/global.css");
const appLight = cssTokens(block(appCss, /@theme\s*\{([^}]*)\}/, "app @theme"));
const installerLight = cssTokens(
  block(
    installerCss,
    /:root\s*,\s*:root\[data-theme="pearl"\]\s*\{([^}]*)\}/,
    "installer pearl theme",
  ),
);
const appDark = cssTokens(
  block(appCss, /\[data-theme="graphite"\]\s*\{([^}]*)\}/, "app graphite theme"),
);
const installerDark = cssTokens(
  block(
    installerCss,
    /:root\[data-theme="graphite"\]\s*\{([^}]*)\}/,
    "installer graphite theme",
  ),
);
const colorTokens = Object.keys(appLight).filter((token) => token.startsWith("color-"));
assertTokenParity("Pearl theme", appLight, installerLight, [
  ...colorTokens,
  "font-sans",
  "font-mono",
]);
assertTokenParity("Graphite theme", appDark, installerDark, colorTokens);

const titleBar = read("src/components/TitleBar.svelte");
if (!/class="[^"]*\bh-12\b/.test(titleBar) || !/class="[^"]*w-\[46px\]/.test(titleBar)) {
  throw new Error("The app title bar must retain its 48px height and 46px window controls");
}
if (
  !/\.titlebar\s*\{[^}]*\bheight:\s*48px;/.test(installerCss) ||
  !/\.window-control\s*\{[^}]*\bwidth:\s*46px;/.test(installerCss)
) {
  throw new Error("The installer title bar must match the app's 48px height and 46px window controls");
}

const appConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const installerConfig = JSON.parse(read("installer/src-tauri/tauri.conf.json"));
for (const relativeIcon of ["icons/32x32.png", "icons/128x128.png", "icons/icon.ico"]) {
  if (!appConfig.bundle.icon.includes(relativeIcon) || !installerConfig.bundle.icon.includes(relativeIcon)) {
    throw new Error(`${relativeIcon} must be configured in both desktop bundles`);
  }
  const appPath = `src-tauri/${relativeIcon}`;
  const installerPath = `installer/src-tauri/${relativeIcon}`;
  if (assetHash(appPath) !== assetHash(installerPath)) {
    throw new Error(`${appPath} and ${installerPath} differ`);
  }
}

console.log(
  "Branding check passed: canonical shield mark, shared bundle icons, theme tokens, and title bar dimensions match.",
);
