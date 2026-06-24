// gen-installer-images.cjs — 生成 NSIS 安装界面用的 BMP 图片
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "src-tauri", "icons");

const BLUE = "#227CFF";
const YELLOW = "#FFC81E";

// New logo SVG paths (from 工具.svg)
const LOGO_HEX = "M512 1022c-31.7 0-63.1-8-90.9-23.2l-300-163.4A189.92 189.92 0 0 1 22 668.5v-313c0-69.6 38-133.5 99.1-166.8l300-163.4C448.9 10 480.3 2 512 2c31.7 0 63.1 8 90.9 23.2l300 163.4c61.1 33.3 99.1 97.2 99.1 166.8v313.1c0 69.6-38 133.5-99.1 166.8l-300 163.4c-27.8 15.3-59.2 23.3-90.9 23.3z m0-920c-14.8 0-29.6 3.7-43.1 11l-300 163.4c-29 15.8-46.9 46.1-46.9 79v313.1c0 33 18 63.3 46.9 79l300 163.4c27 14.7 59.2 14.7 86.1 0l300-163.4c29-15.8 46.9-46.1 46.9-79v-313c0-33-18-63.3-46.9-79L555.1 113c-13.5-7.4-28.3-11-43.1-11z";
const LOGO_BOLT = "M725.3 389.8c-13.8-23.9-44.4-32.1-68.3-18.3l-145 83.7-145-83.7c-23.9-13.8-54.5-5.6-68.3 18.3-13.8 23.9-5.6 54.5 18.3 68.3l145 83.7v167.4c0 27.6 22.4 50 50 50s50-22.4 50-50V541.8l145-83.7c23.9-13.8 32.1-44.4 18.3-68.3z";

async function svgToBmp(svgStr, width, height, outPath) {
  // Render SVG to raw RGBA pixels with sharp
  const { data } = await sharp(Buffer.from(svgStr))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 24-bit BMP: 3 bytes per pixel (BGR), rows padded to 4-byte boundary
  const rowBytes = width * 3;
  const rowPadding = (4 - (rowBytes % 4)) % 4;
  const paddedRowBytes = rowBytes + rowPadding;
  const pixelDataSize = paddedRowBytes * height;

  // BMP File Header (14 bytes)
  const fileHeader = Buffer.alloc(14);
  fileHeader.write("BM", 0, "ascii");
  fileHeader.writeUInt32LE(54 + pixelDataSize, 2); // file size
  fileHeader.writeUInt16LE(0, 6); // reserved
  fileHeader.writeUInt16LE(0, 8); // reserved
  fileHeader.writeUInt32LE(54, 10); // pixel data offset

  // DIB Info Header (BITMAPINFOHEADER, 40 bytes)
  const infoHeader = Buffer.alloc(40);
  infoHeader.writeUInt32LE(40, 0); // header size
  infoHeader.writeInt32LE(width, 4);
  infoHeader.writeInt32LE(height, 8); // positive = bottom-up
  infoHeader.writeUInt16LE(1, 12); // color planes
  infoHeader.writeUInt16LE(24, 14); // bits per pixel
  infoHeader.writeUInt32LE(0, 16); // no compression (BI_RGB)
  infoHeader.writeUInt32LE(pixelDataSize, 20);
  infoHeader.writeInt32LE(2835, 24); // h resolution (72 DPI)
  infoHeader.writeInt32LE(2835, 28); // v resolution
  infoHeader.writeUInt32LE(0, 32); // colors in palette
  infoHeader.writeUInt32LE(0, 36); // important colors

  // Pixel data: bottom-up row order, BGR format
  const pixelData = Buffer.alloc(pixelDataSize);
  for (let y = height - 1; y >= 0; y--) {
    const bmpRow = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = bmpRow * paddedRowBytes + x * 3;
      pixelData[dstIdx] = data[srcIdx + 2];     // B
      pixelData[dstIdx + 1] = data[srcIdx + 1]; // G
      pixelData[dstIdx + 2] = data[srcIdx];     // R
    }
  }

  fs.writeFileSync(outPath, Buffer.concat([fileHeader, infoHeader, pixelData]));
}

async function main() {
  // ---- Sidebar image: 164x314 BMP ----
  const sw = 164, sh = 314;

  const sidebarSvg = `<svg width="${sw}" height="${sh}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BLUE}"/>
        <stop offset="100%" stop-color="#1a5bc4"/>
      </linearGradient>
    </defs>
    <rect width="${sw}" height="${sh}" fill="url(#bg)"/>
    <g transform="translate(${(sw - 72) / 2}, ${sh / 2 - 65})">
      <svg viewBox="0 0 1024 1024" width="72" height="72">
        <path d="${LOGO_HEX}" fill="white" fill-opacity="0.85"/>
        <path d="${LOGO_BOLT}" fill="white"/>
      </svg>
    </g>
    <text x="${sw / 2}" y="${sh / 2 + 40}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="18" font-weight="bold" fill="white">Mynx</text>
    <text x="${sw / 2}" y="${sh / 2 + 60}" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="9" fill="white" opacity="0.65">让工作更简单</text>
  </svg>`;

  await svgToBmp(sidebarSvg, sw, sh, path.join(ICONS_DIR, "sidebar.bmp"));
  console.log(`  sidebar.bmp (${sw}x${sh}) done`);

  // ---- Header image: 150x57 BMP ----
  const hw = 150, hh = 57;

  const headerSvg = `<svg width="${hw}" height="${hh}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${hw}" height="${hh}" fill="#f5f5f5"/>
    <g transform="translate(12, ${(hh - 26) / 2})">
      <svg viewBox="0 0 1024 1024" width="26" height="26">
        <path d="${LOGO_HEX}" fill="${BLUE}"/>
        <path d="${LOGO_BOLT}" fill="${YELLOW}"/>
      </svg>
    </g>
    <text x="46" y="${hh / 2 + 5}" font-family="Segoe UI,Arial,sans-serif" font-size="13" font-weight="600" fill="#333">Mynx</text>
  </svg>`;

  await svgToBmp(headerSvg, hw, hh, path.join(ICONS_DIR, "header.bmp"));
  console.log(`  header.bmp (${hw}x${hh}) done`);

  // ---- Installer logo: 128x128 BMP (for custom single-page installer) ----
  const lw = 128, lh = 128;
  const iconSize = 80; // logo icon size within the 128x128 canvas
  const iconOffset = (lw - iconSize) / 2;

  const logoSvg = `<svg width="${lw}" height="${lh}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${lw}" height="${lh}" fill="white"/>
    <g transform="translate(${iconOffset}, ${iconOffset})">
      <svg viewBox="0 0 1024 1024" width="${iconSize}" height="${iconSize}">
        <path d="${LOGO_HEX}" fill="${BLUE}"/>
        <path d="${LOGO_BOLT}" fill="${YELLOW}"/>
      </svg>
    </g>
  </svg>`;

  await svgToBmp(logoSvg, lw, lh, path.join(ICONS_DIR, "installer-logo.bmp"));
  console.log(`  installer-logo.bmp (${lw}x${lh}) done`);

  console.log("Done!");
}

main().catch((e) => { console.error(e); process.exit(1); });
