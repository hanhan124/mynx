// Copy the completed installer to release-installer/ and record the exact
// app payload and installer hashes. Keep Cargo's release cache for fast rebuilds;
// npm run installer:clean is the explicit cleanup command.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SRC_EXE = path.join(ROOT, "installer", "src-tauri", "target", "release", "mynx-installer.exe");
const SRC_SIG = `${SRC_EXE}.sig`;
const PAYLOAD_INFO = path.join(ROOT, "installer", "src-tauri", "resources", "mynx-payload.json");
const DST_DIR = path.join(ROOT, "release-installer");
const DST_EXE = path.join(DST_DIR, "mynx-installer.exe");
const DST_SIG = `${DST_EXE}.sig`;

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (!fs.existsSync(SRC_EXE)) throw new Error(`找不到 ${SRC_EXE}`);
if (!fs.existsSync(PAYLOAD_INFO)) throw new Error(`找不到新应用 payload 清单 ${PAYLOAD_INFO}`);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const payload = JSON.parse(fs.readFileSync(PAYLOAD_INFO, "utf8"));
if (payload.app_version !== pkg.version) {
  throw new Error(`安装器 payload 版本 ${payload.app_version} 与项目版本 ${pkg.version} 不一致`);
}

fs.mkdirSync(DST_DIR, { recursive: true });
fs.copyFileSync(SRC_EXE, DST_EXE);
if (fs.existsSync(SRC_SIG)) fs.copyFileSync(SRC_SIG, DST_SIG);
else if (fs.existsSync(DST_SIG)) fs.rmSync(DST_SIG);

const installerBytes = fs.statSync(DST_EXE).size;
const installerInfo = {
  schema_version: 1,
  app_version: pkg.version,
  installer: {
    filename: "mynx-installer.exe",
    size_bytes: installerBytes,
    sha256: sha256(DST_EXE),
    signed: fs.existsSync(DST_SIG),
  },
  app_payload: payload,
};
const metadataPath = path.join(DST_DIR, "mynx-installer.exe.build.json");
fs.writeFileSync(metadataPath, `${JSON.stringify(installerInfo, null, 2)}\n`, "utf8");

// Keep just the deliverables in the release directory.
for (const name of fs.readdirSync(DST_DIR)) {
  if (!["mynx-installer.exe", "mynx-installer.exe.sig", "mynx-installer.exe.build.json"].includes(name)) {
    fs.rmSync(path.join(DST_DIR, name), { recursive: true, force: true });
  }
}

console.log(`✅ mynx-installer.exe → release-installer/ (${(installerBytes / 1024 / 1024).toFixed(2)} MB)`);
console.log(`   应用版本 ${pkg.version}`);
console.log(`   主程序来源 ${payload.source}`);
console.log(`   主程序 SHA-256 ${payload.sha256}`);
console.log(`   安装器 SHA-256 ${installerInfo.installer.sha256}`);
console.log(`   构建清单 ${metadataPath}`);
