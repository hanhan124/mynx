// sync-version.cjs — 从根 package.json 同步版本号到所有相关文件
//   1. src-tauri/Cargo.toml       (主应用 Rust)
//   2. src-tauri/tauri.conf.json  (主应用 Tauri)
//   3. installer/Cargo.toml       (installer Rust)
//   4. installer/package.json     (installer npm)
//   5. installer/src-tauri/tauri.conf.json  (installer Tauri)
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const ver = pkg.version;

const targets = [
  // 主应用: tauri.conf.json
  {
    file: path.join(root, "src-tauri", "tauri.conf.json"),
    type: "json",
    path: ["version"],
  },
  // 主应用: Cargo.toml
  {
    file: path.join(root, "src-tauri", "Cargo.toml"),
    type: "toml-pkg",
  },
  // installer: Cargo.toml
  {
    file: path.join(root, "installer", "src-tauri", "Cargo.toml"),
    type: "toml-pkg",
  },
  // installer: package.json
  {
    file: path.join(root, "installer", "package.json"),
    type: "json",
    path: ["version"],
  },
  // installer: tauri.conf.json
  {
    file: path.join(root, "installer", "src-tauri", "tauri.conf.json"),
    type: "json",
    path: ["version"],
  },
];

function setJsonPath(obj, path, val) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = val;
}

for (const t of targets) {
  if (!fs.existsSync(t.file)) continue; // 跳过不存在的文件
  const raw = fs.readFileSync(t.file, "utf-8");
  if (t.type === "json") {
    const obj = JSON.parse(raw);
    setJsonPath(obj, t.path, ver);
    fs.writeFileSync(t.file, JSON.stringify(obj, null, 2) + "\n");
    console.log(`  ${path.relative(root, t.file)} (json) → ${ver}`);
  } else if (t.type === "toml-pkg") {
    const out = raw.replace(/^version\s*=\s*"[^"]*"/m, `version = "${ver}"`);
    fs.writeFileSync(t.file, out);
    console.log(`  ${path.relative(root, t.file)} (toml) → ${ver}`);
  }
}

console.log(`\n✅ 版本已同步: ${ver} → 所有 Cargo.toml / tauri.conf.json / package.json`);