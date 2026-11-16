// Copy the standalone uninstall-only Tauri build into the installer resources.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "installer", "src-tauri", "target", "release", "mynx-installer.exe");
const DESTINATION = path.join(ROOT, "installer", "src-tauri", "resources", "Uninst.exe");
const TEMP = `${DESTINATION}.${process.pid}.tmp`;
const MAX_BYTES = 16 * 1024 * 1024;

if (!fs.existsSync(SOURCE)) {
  throw new Error(`找不到卸载专用构建产物 ${SOURCE}；请先运行 npm run installer:uninstaller`);
}

const sourceBytes = fs.readFileSync(SOURCE);
if (sourceBytes.length < 2 || sourceBytes.subarray(0, 2).toString("ascii") !== "MZ") {
  throw new Error("卸载专用构建产物不是有效 Windows PE 文件");
}
if (sourceBytes.length >= MAX_BYTES) {
  throw new Error(`卸载专用构建产物超过 16 MiB：${sourceBytes.length} B`);
}

fs.mkdirSync(path.dirname(DESTINATION), { recursive: true });
fs.copyFileSync(SOURCE, TEMP);
try {
  fs.rmSync(DESTINATION, { force: true });
  fs.renameSync(TEMP, DESTINATION);
} catch (error) {
  fs.rmSync(TEMP, { force: true });
  throw error;
}

const sha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
console.log(`✅ 独立卸载程序已生成：${sourceBytes.length} B · SHA-256 ${sha256}`);
