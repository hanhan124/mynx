const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;
const fs = require("fs");
const path = require("path");

const SVG = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <path d="M512 1022c-31.7 0-63.1-8-90.9-23.2l-300-163.4A189.92 189.92 0 0 1 22 668.5v-313c0-69.6 38-133.5 99.1-166.8l300-163.4C448.9 10 480.3 2 512 2c31.7 0 63.1 8 90.9 23.2l300 163.4c61.1 33.3 99.1 97.2 99.1 166.8v313.1c0 69.6-38 133.5-99.1 166.8l-300 163.4c-27.8 15.3-59.2 23.3-90.9 23.3z m0-920c-14.8 0-29.6 3.7-43.1 11l-300 163.4c-29 15.8-46.9 46.1-46.9 79v313.1c0 33 18 63.3 46.9 79l300 163.4c27 14.7 59.2 14.7 86.1 0l300-163.4c29-15.8 46.9-46.1 46.9-79v-313c0-33-18-63.3-46.9-79L555.1 113c-13.5-7.4-28.3-11-43.1-11z" fill="#227CFF"/>
  <path d="M725.3 389.8c-13.8-23.9-44.4-32.1-68.3-18.3l-145 83.7-145-83.7c-23.9-13.8-54.5-5.6-68.3 18.3-13.8 23.9-5.6 54.5 18.3 68.3l145 83.7v167.4c0 27.6 22.4 50 50 50s50-22.4 50-50V541.8l145-83.7c23.9-13.8 32.1-44.4 18.3-68.3z" fill="#FFC81E"/>
</svg>`;

// Render at 2x then downscale for crisp anti-aliasing
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const ROOT = path.join(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "src-tauri", "icons");
const TMP_DIR = path.join(ROOT, "tmp-icons");

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const pngBuffers = [];

  for (const size of SIZES) {
    const pngPath = path.join(TMP_DIR, `icon-${size}.png`);
    // Render at 2x resolution then downscale for crisp edges
    const superSize = size * 2;
    await sharp(Buffer.from(SVG))
      .resize(superSize, superSize)
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(pngPath);
    pngBuffers.push(fs.readFileSync(pngPath));
    console.log(`  ${size}x${size} done (rendered at ${superSize}x${superSize})`);
  }

  // Generate ICO with all sizes for crisp taskbar rendering
  const icoBuf = await pngToIco(pngBuffers);
  const icoPath = path.join(ICONS_DIR, "icon.ico");
  fs.writeFileSync(icoPath, icoBuf);
  console.log(`ICO written: ${icoPath} (${(icoBuf.length / 1024).toFixed(1)} KB)`);

  // Also write standalone PNGs that tauri.conf.json references
  for (const size of [32, 128, 256]) {
    const src = path.join(TMP_DIR, `icon-${size}.png`);
    const label = size === 128 ? "128x128" : size === 256 ? "128x128@2x" : "32x32";
    fs.copyFileSync(src, path.join(ICONS_DIR, `${label}.png`));
    console.log(`  ${label}.png copied`);
  }

  // Cleanup temp
  for (const size of SIZES) {
    fs.unlinkSync(path.join(TMP_DIR, `icon-${size}.png`));
  }
  fs.rmdirSync(TMP_DIR);
  console.log("Done!");
}

main().catch((e) => { console.error(e); process.exit(1); });
