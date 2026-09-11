// sync-version.cjs — 从根 package.json 同步版本号到所有相关文件
//   1. src-tauri/Cargo.toml       (主应用 Rust)
//   2. src-tauri/tauri.conf.json  (主应用 Tauri)
//   3. installer/Cargo.toml       (installer Rust)
//   4. installer/package.json     (installer npm)
//   5. installer/src-tauri/tauri.conf.json  (installer Tauri)
//   6. package-lock.json / Cargo.lock（主应用与安装器）
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const ver = pkg.version;
const checkOnly = process.argv.includes("--check");

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
  // Both lockfiles also retain the workspace package version. Keeping them in
  // sync makes `npm ci` reproducible on Windows and macOS release runners.
  {
    file: path.join(root, "package-lock.json"),
    type: "lockfile",
  },
  {
    file: path.join(root, "installer", "package-lock.json"),
    type: "lockfile",
  },
  {
    file: path.join(root, "src-tauri", "Cargo.lock"),
    type: "toml-lock-pkg",
    packageName: "mynx",
  },
  {
    file: path.join(root, "installer", "src-tauri", "Cargo.lock"),
    type: "toml-lock-pkg",
    packageName: "mynx-installer",
  },
];

function setJsonPath(obj, path, val) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
  cur[path[path.length - 1]] = val;
}

function cargoLockPackageVersion(raw, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(\\[\\[package\\]\\]\\s+name\\s*=\\s*"${escaped}"\\s+version\\s*=\\s*")([^"]+)(")`);
  const match = raw.match(re);
  return { match, version: match?.[2] };
}

const mismatches = [];
for (const t of targets) {
  if (!fs.existsSync(t.file)) continue; // 跳过不存在的文件
  const raw = fs.readFileSync(t.file, "utf-8");
  if (t.type === "json") {
    const obj = JSON.parse(raw);
    const current = t.path.reduce((value, key) => value?.[key], obj);
    if (checkOnly) {
      if (current !== ver) mismatches.push(`${path.relative(root, t.file)}=${current ?? "missing"}`);
      continue;
    }
    setJsonPath(obj, t.path, ver);
    fs.writeFileSync(t.file, JSON.stringify(obj, null, 2) + "\n");
    console.log(`  ${path.relative(root, t.file)} (json) → ${ver}`);
  } else if (t.type === "toml-pkg") {
    const match = raw.match(/^version\s*=\s*"([^"]*)"/m);
    if (checkOnly) {
      if (match?.[1] !== ver) mismatches.push(`${path.relative(root, t.file)}=${match?.[1] ?? "missing"}`);
      continue;
    }
    const out = raw.replace(/^version\s*=\s*"[^"]*"/m, `version = "${ver}"`);
    fs.writeFileSync(t.file, out);
    console.log(`  ${path.relative(root, t.file)} (toml) → ${ver}`);
  } else if (t.type === "lockfile") {
    const obj = JSON.parse(raw);
    const current = obj.version;
    const workspaceCurrent = obj.packages?.[""]?.version;
    if (checkOnly) {
      if (current !== ver || workspaceCurrent !== ver) {
        mismatches.push(`${path.relative(root, t.file)}=${current ?? "missing"}/${workspaceCurrent ?? "missing"}`);
      }
      continue;
    }
    obj.version = ver;
    if (obj.packages?.[""]) obj.packages[""].version = ver;
    fs.writeFileSync(t.file, JSON.stringify(obj, null, 2) + "\n");
    console.log(`  ${path.relative(root, t.file)} (lockfile) → ${ver}`);
  } else if (t.type === "toml-lock-pkg") {
    const { match, version } = cargoLockPackageVersion(raw, t.packageName);
    if (checkOnly) {
      if (version !== ver) mismatches.push(`${path.relative(root, t.file)}=${version ?? "missing"}`);
      continue;
    }
    if (!match) {
      throw new Error(`未在 ${path.relative(root, t.file)} 找到包 ${t.packageName}`);
    }
    const out = raw.replace(match[0], `${match[1]}${ver}${match[3]}`);
    fs.writeFileSync(t.file, out);
    console.log(`  ${path.relative(root, t.file)} (Cargo.lock) → ${ver}`);
  }
}

if (checkOnly) {
  if (mismatches.length) {
    console.error(`❌ 版本不同步: ${mismatches.join(", ")}；期望 ${ver}`);
    process.exit(1);
  }
  console.log(`✅ 版本一致: ${ver}（package / Cargo / Tauri / 全部 lockfile）`);
} else {
  console.log(`\n✅ 版本已同步: ${ver} → 所有 Cargo.toml / tauri.conf.json / package.json / lockfile`);
}
