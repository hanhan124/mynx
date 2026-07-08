// gen-installer-images.cjs — 生成 NSIS 安装界面用的 BMP 图片
// 设计语言：Office 安装风格 —— 白底、大面积留白、纯高清 logo（无文字、无装饰）
// 高清技巧：以 4× SSAA 倍率渲染 SVG → raw → box-filter 2× 下采样 → 24位 BMP
//          实现矢量级平滑边缘，避免 128/164 这种小尺寸下的马赛克像素锯齿

const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "src-tauri", "icons");

// ── Brand palette ──────────────────────────────────────────────────────────
const BLUE = "#227CFF";
const BLUE_DEEP = "#0B5FE0";
const BLUE_LIGHT = "#5BA1FF";
const YELLOW = "#FFC81E";

// Logo paths (from 工具.svg) — hex shield + inner bolt. Pure shapes, no text.
const LOGO_HEX = "M512 1022c-31.7 0-63.1-8-90.9-23.2l-300-163.4A189.92 189.92 0 0 1 22 668.5v-313c0-69.6 38-133.5 99.1-166.8l300-163.4C448.9 10 480.3 2 512 2c31.7 0 63.1 8 90.9 23.2l300 163.4c61.1 33.3 99.1 97.2 99.1 166.8v313.1c0 69.6-38 133.5-99.1 166.8l-300 163.4c-27.8 15.3-59.2 23.3-90.9 23.3z m0-920c-14.8 0-29.6 3.7-43.1 11l-300 163.4c-29 15.8-46.9 46.1-46.9 79v313.1c0 33 18 63.3 46.9 79l300 163.4c27 14.7 59.2 14.7 86.1 0l300-163.4c29-15.8 46.9-46.1 46.9-79v-313c0-33-18-63.3-46.9-79L555.1 113c-13.5-7.4-28.3-11-43.1-11z";
const LOGO_BOLT = "M725.3 389.8c-13.8-23.9-44.4-32.1-68.3-18.3l-145 83.7-145-83.7c-23.9-13.8-54.5-5.6-68.3 18.3-13.8 23.9-5.6 54.5 18.3 68.3l145 83.7v167.4c0 27.6 22.4 50 50 50s50-22.4 50-50V541.8l145-83.7c23.9-13.8 32.1-44.4 18.3-68.3z";

// ── BMP encoding helpers ────────────────────────────────────────────────────
// NSIS expects Windows-format BMP (BI_RGB, 24bpp, bottom-up scanlines, 4-byte row padding).

// 4× SSAA rendering + box-filter downsample to target WxH.
// sharp resize uses lanczos3 by default which already over-samples well; we additionally
// render at the 4× pixel grid so even fine edges of the hex logo keep subpixel-level
// smoothness — this is what kills the "mosaic/锯齿" appearance on a 128px icon.
async function renderHqBmp(svgStr, width, height, outPath, ssaa = 4) {
  const superW = width * ssaa;
  const superH = height * ssaa;

  // Render SVG to raw RGBA at 4× the destination resolution
  const { data: srcRaw, info } = await sharp(Buffer.from(svgStr))
    .resize(superW, superH, { fit: "contain", background: { r: 1, g: 1, b: 1, alpha: 1 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Box-filter downsample (each output pixel = average of ssaa*ssaa source pixels)
  const dst = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const sx0 = x * ssaa;
      const sy0 = y * ssaa;
      for (let sy = 0; sy < ssaa; sy++) {
        for (let sx = 0; sx < ssaa; sx++) {
          const idx = ((sy0 + sy) * superW + (sx0 + sx)) * 4;
          r += srcRaw[idx];
          g += srcRaw[idx + 1];
          b += srcRaw[idx + 2];
          a += srcRaw[idx + 3];
        }
      }
      const n = ssaa * ssaa;
      const di = (y * width + x) * 4;
      dst[di]     = Math.round(r / n);
      dst[di + 1] = Math.round(g / n);
      dst[di + 2] = Math.round(b / n);
      dst[di + 3] = Math.round(a / n);
    }
  }

  // Composite onto flat white (avoid halo) then drop alpha for 24bpp BMP
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const al = dst[i * 4 + 3] / 255;
    const ar = 255 * (1 - al) + dst[i * 4]     * al;
    const ag = 255 * (1 - al) + dst[i * 4 + 1] * al;
    const ab = 255 * (1 - al) + dst[i * 4 + 2] * al;
    rgb[i * 3]     = Math.round(ab);
    rgb[i * 3 + 1] = Math.round(ag);
    rgb[i * 3 + 2] = Math.round(ar);
  }

  // Write 24bpp bottom-up BMP with row padding to 4-byte boundary
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
  for (let y = 0; y < height; y++) {
    const bmpRow = height - 1 - y; // bottom-up
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3;
      const dstIdx = bmpRow * paddedRowBytes + x * 3;
      pixelData[dstIdx]     = rgb[srcIdx + 2]; // BMP is BGR
      pixelData[dstIdx + 1] = rgb[srcIdx + 1];
      pixelData[dstIdx + 2] = rgb[srcIdx];
    }
  }

  fs.writeFileSync(outPath, Buffer.concat([fileHeader, infoHeader, pixelData]));
}

// ── Logo SVG fragment builders ──────────────────────────────────────────────
// Pure logo — no text. Two color variants: brand gradient vs single color.

function logoSvg(size, opts = {}) {
  const { gradient = true } = opts;
  const hexFill = gradient
    ? `<linearGradient id="hex${size}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${BLUE_LIGHT}"/>
        <stop offset="100%" stop-color="${BLUE_DEEP}"/>
      </linearGradient>`
    : "";
  return `
    <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <defs>${hexFill}</defs>
      <path d="${LOGO_HEX}" fill="${gradient ? `url(#hex${size})` : BLUE}"/>
      <path d="${LOGO_BOLT}" fill="${YELLOW}"/>
    </svg>`;
}

async function main() {
  // ---- installer-logo.bmp : 256×256 — pure logo, no text ----
  // Hero icon (used as installer/uninstaller icon by NSIS where configured). SSAA = 4 →
  // 1024×1024 effective source, giving crisp vector edges even when Windows scales the icon.
  {
    const lw = 256, lh = 256;
    const logo = logoSvg(1024, { gradient: true });
    const svgStr = `<svg width="${lw}" height="${lh}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${lw}" height="${lh}" fill="#ffffff"/>
      <g transform="translate(${lw * 0.05}, ${lh * 0.05}) scale(0.9)">
        ${logo}
      </g>
    </svg>`;
    await renderHqBmp(svgStr, lw, lh, path.join(ICONS_DIR, "installer-logo.bmp"));
    console.log(`  installer-logo.bmp (${lw}x${lh}) done`);
  }

  // ---- sidebar.bmp : 164×314 — Office-style left brand panel ----
  // Pure white background, large logo centered vertically and horizontally, no text.
  // Logo box = 0.78 × panel width → fills ~100px (≈ 60% of panel width) — the dominant
  // visual element, with generous breathing room top/bottom for the premium "Office" feel.
  {
    const sw = 164, sh = 314;
    const logoBox = sw * 0.78;                // 128px — large but with white margin on both sides
    const ox = (sw - logoBox) / 2;            // horizontally centered
    const oy = (sh - logoBox) / 2;            // vertically centered
    const svgStr = `<svg width="${sw}" height="${sh}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${sw}" height="${sh}" fill="#ffffff"/>
      <g transform="translate(${ox}, ${oy}) scale(${logoBox})">
        ${logoSvg(1024, { gradient: true })}
      </g>
    </svg>`;
    await renderHqBmp(svgStr, sw, sh, path.join(ICONS_DIR, "sidebar.bmp"));
    console.log(`  sidebar.bmp (${sw}x${sh}) done`);
  }

  // ---- header.bmp : 150×57 — minimal white header, no text ----
  // Only shown on inner pages (directory, components). Pure white, single small logo left-aligned.
  {
    const hw = 150, hh = 57;
    const logoBox = hh * 0.82;                 // ~47px tall, comfortable within 57px header
    const ox = 12;
    const oy = (hh - logoBox) / 2;
    const svgStr = `<svg width="${hw}" height="${hh}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${hw}" height="${hh}" fill="#ffffff"/>
      <g transform="translate(${ox}, ${oy}) scale(${logoBox})">
        ${logoSvg(1024, { gradient: true })}
      </g>
    </svg>`;
    await renderHqBmp(svgStr, hw, hh, path.join(ICONS_DIR, "header.bmp"));
    console.log(`  header.bmp (${hw}x${hh}) done`);
  }

  console.log("Done!");
}

main().catch((e) => { console.error(e); process.exit(1); });
