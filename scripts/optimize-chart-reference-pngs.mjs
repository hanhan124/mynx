import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateRoot = path.join(root, "mynx-next", "src-tauri", "r", "chart-templates");
const checkOnly = process.argv.includes("--check");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.allocUnsafe(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), data.length + 8);
  return chunk;
}

function recompressPng(input) {
  if (input.length < pngSignature.length || !input.subarray(0, 8).equals(pngSignature)) {
    throw new Error("not a PNG file");
  }

  const chunks = [];
  const compressedImageData = [];
  let offset = pngSignature.length;
  let hasImageData = false;
  let hasEnd = false;

  while (offset + 12 <= input.length) {
    const dataLength = input.readUInt32BE(offset);
    const chunkEnd = offset + dataLength + 12;
    if (chunkEnd > input.length) throw new Error("truncated PNG chunk");

    const type = input.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + dataLength;
    if (type === "IDAT") {
      compressedImageData.push(input.subarray(dataStart, dataEnd));
      if (!hasImageData) chunks.push(null);
      hasImageData = true;
    } else {
      chunks.push(input.subarray(offset, chunkEnd));
    }

    offset = chunkEnd;
    if (type === "IEND") {
      hasEnd = true;
      break;
    }
  }

  if (!hasImageData || !hasEnd || offset !== input.length) {
    throw new Error("PNG is missing image data/end marker or has trailing bytes");
  }

  const pixels = inflateSync(Buffer.concat(compressedImageData));
  const compressed = deflateSync(pixels, { level: 9 });
  const replacement = makeChunk("IDAT", compressed);
  const output = Buffer.concat([
    pngSignature,
    ...chunks.map((chunk) => (chunk === null ? replacement : chunk)),
  ]);

  return output;
}

async function findReferencePngs() {
  const entries = await readdir(templateRoot, { withFileTypes: true });
  const paths = [];

  for (const entry of entries.filter((item) => item.isDirectory())) {
    const directory = path.join(templateRoot, entry.name);
    const manifestPath = path.join(directory, "manifest.json");
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch {
      continue;
    }
    if (manifest.status !== "verified") continue;

    const referencePath = manifest.referencePath || "reference.png";
    if (path.extname(referencePath).toLowerCase() !== ".png") continue;

    const fullPath = path.resolve(directory, referencePath);
    if (!fullPath.startsWith(`${path.resolve(directory)}${path.sep}`)) {
      throw new Error(`参考图路径越出模板目录：${manifest.id || entry.name}`);
    }
    paths.push(fullPath);
  }

  return paths;
}

const files = await findReferencePngs();
let originalBytes = 0;
let optimizedBytes = 0;
let changed = 0;
const improvements = [];

for (const file of files) {
  const original = await readFile(file);
  const optimized = recompressPng(original);
  originalBytes += original.length;

  if (optimized.length < original.length) {
    optimizedBytes += optimized.length;
    improvements.push({ file, original: original.length, optimized: optimized.length });
    if (!checkOnly) {
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, optimized, { flag: "wx" });
      await rename(temporary, file);
      changed += 1;
    }
  } else {
    optimizedBytes += original.length;
  }
}

const savings = originalBytes - optimizedBytes;
console.log(
  `${checkOnly ? "PNG 压缩检查" : "PNG 无损优化"}：${files.length} 张，` +
    `${originalBytes} B → ${optimizedBytes} B，` +
    `${checkOnly ? "可" : "已"}减少 ${savings} B` +
    (checkOnly ? "" : `，更新 ${changed} 张`),
);

if (checkOnly && improvements.length > 0) {
  console.error("仍有可无损缩小的图表参考 PNG；运行 npm run charts:optimize-references。");
  process.exitCode = 1;
}
