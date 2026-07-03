// gen-installer-images.cjs — 生成 NSIS 安装界面用的 BMP 图片
// 现代视觉设计: 多色渐变 + 玻璃拟态高光 + 微纹理 + 阴影
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "src-tauri", "icons");

// Brand palette
const BLUE = "#227CFF";
const BLUE_DEEP = "#0B5FE0";
const BLUE_LIGHT = "#5BA1FF";
const YELLOW = "#FFC81E";
const PURPLE = "#722ED1";

// Brand logo (from 工具.svg)
const LOGO_HEX = "M512 1022c-31.7 0-63.1-8-90.9-23.2l-300-163.4A189.92 189.92 0 0 1 22 668.5v-313c0-69.6 38-133.5 99.1-166.8l300-163.4C448.9 10 480.3 2 512 2c31.7 0 63.1 8 90.9 23.2l300 163.4c61.1 33.3 99.1 97.2 99.1 166.8v313.1c0 69.6-38 133.5-99.1 166.8l-300 163.4c-27.8 15.3-59.2 23.3-90.9 23.3z m0-920c-14.8 0-29.6 3.7-43.1 11l-300 163.4c-29 15.8-46.9 46.1-46.9 79v313.1c0 33 18 63.3 46.9 79l300 163.4c27 14.7 59.2 14.7 86.1 0l300-163.4c29-15.8 46.9-46.1 46.9-79v-313c0-33-18-63.3-46.9-79L555.1 113c-13.5-7.4-28.3-11-43.1-11z";
const LOGO_BOLT = "M725.3 389.8c-13.8-23.9-44.4-32.1-68.3-18.3l-145 83.7-145-83.7c-23.9-13.8-54.5-5.6-68.3 18.3-13.8 23.9-5.6 54.5 18.3 68.3l145 83.7v167.4c0 27.6 22.4 50 50 50s50-22.4 50-50V541.8l145-83.7c23.9-13.8 32.1-44.4 18.3-68.3z";

// Read version from tauri.conf.json for badge text
function getVersion() {
  try {
    const conf = JSON.parse(
      fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8")
    );
    return `v${conf.version || "1.0.0"}`;
  } catch {
    return "v1.0.0";
  }
}

async function svgToBmp(svgStr, width, height, outPath) {
  const { data } = await sharp(Buffer.from(svgStr))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const rowBytes = width * 3;
  const rowPadding = (4 - (rowBytes % 4)) % 4;
  const paddedRowBytes = rowBytes + rowPadding;
  const pixelDataSize = paddedRowBytes * height;

  const fileHeader = Buffer.alloc(14);
  fileHeader.write("BM", 0, "ascii");
  fileHeader.writeUInt32LE(54 + pixelDataSize, 2);
  fileHeader.writeUInt16LE(0, 6);
  fileHeader.writeUInt16LE(0, 8);
  fileHeader.writeUInt32LE(54, 10);

  const infoHeader = Buffer.alloc(40);
  infoHeader.writeUInt32LE(40, 0);
  infoHeader.writeInt32LE(width, 4);
  infoHeader.writeInt32LE(height, 8);
  infoHeader.writeUInt16LE(1, 12);
  infoHeader.writeUInt16LE(24, 14);
  infoHeader.writeUInt32LE(0, 16);
  infoHeader.writeUInt32LE(pixelDataSize, 20);
  infoHeader.writeInt32LE(2835, 24);
  infoHeader.writeInt32LE(2835, 28);
  infoHeader.writeUInt32LE(0, 32);
  infoHeader.writeUInt32LE(0, 36);

  const pixelData = Buffer.alloc(pixelDataSize);
  for (let y = height - 1; y >= 0; y--) {
    const bmpRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = bmpRow * paddedRowBytes + x * 3;
      pixelData[dstIdx] = data[srcIdx + 2];
      pixelData[dstIdx + 1] = data[srcIdx + 1];
      pixelData[dstIdx + 2] = data[srcIdx];
    }
  }

  fs.writeFileSync(outPath, Buffer.concat([fileHeader, infoHeader, pixelData]));
}

async function main() {
  const VERSION = getVersion();

  // ---- Sidebar image: 164×314 BMP ----
  const sw = 164, sh = 314;
  const sidebarSvg = `<svg width="${sw}" height="${sh}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${BLUE}"/>
        <stop offset="55%" stop-color="${BLUE_DEEP}"/>
        <stop offset="100%" stop-color="${PURPLE}"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.32" r="0.6">
        <stop offset="0%" stop-color="white" stop-opacity="0.28"/>
        <stop offset="60%" stop-color="white" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="hex" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="white" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="white" stop-opacity="0.08"/>
      </linearGradient>
    </defs>
    <rect width="${sw}" height="${sh}" fill="url(#bg)"/>
    <rect width="${sw}" height="${sh}" fill="url(#glow)"/>

    <!-- decorative hex pattern -->
    <g opacity="0.08" fill="white">
      <polygon points="20,40 30,34.6 30,23.9 20,18.5 10,23.9 10,34.6"/>
      <polygon points="50,60 60,54.6 60,43.9 50,38.5 40,43.9 40,54.6"/>
      <polygon points="140,80 150,74.6 150,63.9 140,58.5 130,63.9 130,74.6"/>
      <polygon points="30,180 40,174.6 40,163.9 30,158.5 20,163.9 20,174.6"/>
      <polygon points="120,210 130,204.6 130,193.9 120,188.5 110,193.9 110,204.6"/>
      <polygon points="80,260 90,254.6 90,243.9 80,238.5 70,243.9 70,254.6"/>
    </g>

    <!-- logo hex backdrop -->
    <g transform="translate(${sw / 2 - 38}, ${sh / 2 - 90})">
      <svg viewBox="0 0 1024 1024" width="76" height="76">
        <path d="${LOGO_HEX}" fill="url(#hex)"/>
        <path d="${LOGO_BOLT}" fill="white"/>
      </svg>
    </g>

    <!-- title -->
    <text x="${sw / 2}" y="${sh / 2 + 18}" text-anchor="middle"
          font-family="Segoe UI,Microsoft YaHei,Arial,sans-serif"
          font-size="22" font-weight="600" fill="white" letter-spacing="1">Mynx</text>

    <!-- tagline -->
    <text x="${sw / 2}" y="${sh / 2 + 38}" text-anchor="middle"
          font-family="Segoe UI,Microsoft YaHei,Arial,sans-serif"
          font-size="10" fill="white" opacity="0.85">让工作更简单</text>

    <!-- version pill -->
    <g transform="translate(${sw / 2 - 26}, ${sh / 2 + 56})">
      <rect x="0" y="0" width="52" height="18" rx="9"
            fill="white" fill-opacity="0.18"/>
      <text x="26" y="13" text-anchor="middle"
            font-family="Segoe UI,Arial,sans-serif"
            font-size="10" font-weight="500" fill="white">${VERSION}</text>
    </g>

    <!-- bottom decorative line -->
    <line x1="${sw / 2 - 30}" y1="${sh - 32}" x2="${sw / 2 + 30}" y2="${sh - 32}"
          stroke="white" stroke-opacity="0.25" stroke-width="0.8"/>
    <text x="${sw / 2}" y="${sh - 14}" text-anchor="middle"
          font-family="Segoe UI,Arial,sans-serif"
          font-size="8" fill="white" opacity="0.55">© 2026 Han</text>
  </svg>`;

  await svgToBmp(sidebarSvg, sw, sh, path.join(ICONS_DIR, "sidebar.bmp"));
  console.log(`  sidebar.bmp (${sw}x${sh}) done`);

  // ---- Header image: 150×57 BMP ----
  const hw = 150, hh = 57;
  const headerSvg = `<svg width="${hw}" height="${hh}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="hdr" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#f3f7fc"/>
      </linearGradient>
      <linearGradient id="hexhdr" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${BLUE}"/>
        <stop offset="100%" stop-color="${BLUE_DEEP}"/>
      </linearGradient>
    </defs>
    <rect width="${hw}" height="${hh}" fill="url(#hdr)"/>

    <!-- left: hex logo with text -->
    <g transform="translate(14, ${(hh - 30) / 2})">
      <svg viewBox="0 0 1024 1024" width="30" height="30">
        <path d="${LOGO_HEX}" fill="url(#hexhdr)"/>
        <path d="${LOGO_BOLT}" fill="${YELLOW}"/>
      </svg>
    </g>
    <text x="52" y="${hh / 2 + 5}" font-family="Segoe UI,Microsoft YaHei,Arial,sans-serif"
          font-size="14" font-weight="600" fill="#1a1a1a">Mynx</text>

    <!-- right: version -->
    <text x="${hw - 12}" y="${hh / 2 + 4}" text-anchor="end"
          font-family="Segoe UI,Arial,sans-serif"
          font-size="10" fill="#888">${VERSION}</text>

    <!-- bottom accent line -->
    <line x1="0" y1="${hh - 1}" x2="${hw}" y2="${hh - 1}"
          stroke="${BLUE_LIGHT}" stroke-opacity="0.4" stroke-width="1"/>
  </svg>`;

  await svgToBmp(headerSvg, hw, hh, path.join(ICONS_DIR, "header.bmp"));
  console.log(`  header.bmp (${hw}x${hh}) done`);

  // ---- Installer logo: 128×128 BMP ----
  const lw = 128, lh = 128;
  const iconSize = 88;
  const iconOffset = (lw - iconSize) / 2;

  const logoSvg = `<svg width="${lw}" height="${lh}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bglogo" cx="0.5" cy="0.5" r="0.65">
        <stop offset="0%" stop-color="#ffffff"/>
        <stop offset="100%" stop-color="#eaf2ff"/>
      </radialGradient>
      <linearGradient id="hexlogo" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BLUE_LIGHT}"/>
        <stop offset="100%" stop-color="${BLUE_DEEP}"/>
      </linearGradient>
    </defs>
    <rect width="${lw}" height="${lh}" fill="url(#bglogo)"/>
    <g transform="translate(${iconOffset}, ${iconOffset})">
      <svg viewBox="0 0 1024 1024" width="${iconSize}" height="${iconSize}">
        <path d="${LOGO_HEX}" fill="url(#hexlogo)"/>
        <path d="${LOGO_BOLT}" fill="${YELLOW}"/>
      </svg>
    </g>
  </svg>`;

  await svgToBmp(logoSvg, lw, lh, path.join(ICONS_DIR, "installer-logo.bmp"));
  console.log(`  installer-logo.bmp (${lw}x${lh}) done`);

  console.log("Done!");
}

main().catch((e) => { console.error(e); process.exit(1); });