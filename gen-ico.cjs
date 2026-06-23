const sharp = require("sharp");
const pngToIco = require("png-to-ico").default;
const fs = require("fs");
const path = require("path");

const SVG = `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <path d="M512 0L32 208v608l480 208 480-208V208L512 0zM129.6 222.4L512 56l388.8 169.6L512 393.6 129.6 222.4z m812.8 558.4l-404.8 176V440l404.8-176v516.8z" fill="#8a8a8a"/>
  <path d="M486.4 955.2L81.6 780.8V257.6l404.8 182.4z" fill="#2F75EC"/>
  <path d="M353.6 542.4l-174.4-76.8c-12.8-6.4-19.2-20.8-12.8-33.6 6.4-12.8 20.8-19.2 33.6-12.8L374.4 496c12.8 6.4 19.2 20.8 12.8 33.6-6.4 12.8-20.8 19.2-33.6 12.8z" fill="#333333"/>
</svg>`;

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICONS_DIR = path.join(__dirname, "src-tauri", "icons");
const TMP_DIR = path.join(__dirname, "tmp-icons");

async function main() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const pngBuffers = [];

  for (const size of SIZES) {
    const pngPath = path.join(TMP_DIR, `icon-${size}.png`);
    await sharp(Buffer.from(SVG))
      .resize(size, size)
      .png()
      .toFile(pngPath);
    pngBuffers.push(fs.readFileSync(pngPath));
    console.log(`  ${size}x${size} done`);
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
