// sync-version.cjs — 从 package.json 同步版本号到 Cargo.toml 和 tauri.conf.json
const fs = require("fs");
const path = require("path");

const root = __dirname;
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const ver = pkg.version;

// 1. tauri.conf.json
const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
tauriConf.version = ver;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");

// 2. Cargo.toml (只改 [package] 下的 version)
const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
let cargo = fs.readFileSync(cargoPath, "utf-8");
cargo = cargo.replace(
  /^version\s*=\s*"[^"]*"/m,
  `version = "${ver}"`,
);
fs.writeFileSync(cargoPath, cargo);

console.log(`版本已同步: ${ver} → package.json / tauri.conf.json / Cargo.toml`);
