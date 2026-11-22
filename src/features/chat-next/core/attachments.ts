/**
 * Attachment intake: classify a picked/dropped/pasted file and extract what
 * the model can use (text for documents, a downscaled data URL for images).
 * `classifyFile` and `clipText` are pure; the readers use browser APIs and
 * load pdf.js lazily.
 */
import type { AttachmentRef } from "./types.js";

export const MAX_TEXT_CHARS = 200_000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "xml", "html", "htm", "css",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "svelte", "vue", "py", "r", "rmd", "ipynb", "rs", "go", "java", "kt",
  "c", "h", "cpp", "hpp", "cs", "swift", "rb", "php", "sh", "bash", "ps1", "sql", "ini", "cfg", "conf", "log",
  "tex", "bib", "fasta", "fa", "fastq", "gff", "gtf", "bed", "vcf", "sam",
]);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function classifyFile(name: string, mime: string): AttachmentRef["kind"] {
  const type = mime.toLowerCase();
  const ext = extensionOf(name);
  if (type.startsWith("image/") && type !== "image/svg+xml") return "image";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type.startsWith("text/") || type === "application/json" || type === "image/svg+xml" || TEXT_EXTENSIONS.has(ext)) {
    return "text";
  }
  return "other";
}

export function clipText(text: string, limit = MAX_TEXT_CHARS): { text: string; truncated: boolean } {
  return text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text, truncated: false };
}

export class AttachmentError extends Error {
  readonly reason: "too-large" | "unsupported" | "unreadable";

  constructor(reason: "too-large" | "unsupported" | "unreadable", message: string) {
    super(message);
    this.name = "AttachmentError";
    this.reason = reason;
  }
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `att_${crypto.randomUUID()}`
    : `att_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // pdf.js 6: destroy() lives on the loading task, not on the document.
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  let length = 0;
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 200) && length < MAX_TEXT_CHARS; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push(`--- page ${i} ---\n${text}`);
      length += text.length;
    }
  } finally {
    void task.destroy();
  }
  return pages.join("\n\n");
}

async function imageDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new AttachmentError("unreadable", "canvas unavailable");
    context.drawImage(bitmap, 0, 0, width, height);
    const keepAlpha = file.type === "image/png" || file.type === "image/webp" || file.type === "image/gif";
    return canvas.toDataURL(keepAlpha ? "image/png" : "image/jpeg", 0.86);
  } finally {
    bitmap.close();
  }
}

/** Read a File into an attachment the prompt builder understands. */
export async function readAttachment(file: File): Promise<AttachmentRef> {
  if (file.size > MAX_FILE_BYTES) throw new AttachmentError("too-large", file.name);
  const kind = classifyFile(file.name, file.type);
  const base = { id: uid(), name: file.name || "file", mime: file.type || "application/octet-stream", size: file.size, kind };
  try {
    if (kind === "image") {
      const dataUrl = await imageDataUrl(file);
      return { ...base, mime: dataUrl.slice(5, dataUrl.indexOf(";")), dataUrl };
    }
    if (kind === "text") {
      const { text, truncated } = clipText(await file.text());
      return { ...base, text, truncated };
    }
    if (kind === "pdf") {
      const { text, truncated } = clipText(await extractPdf(file));
      return { ...base, text, truncated };
    }
  } catch (error) {
    if (error instanceof AttachmentError) throw error;
    throw new AttachmentError("unreadable", file.name);
  }
  throw new AttachmentError("unsupported", file.name);
}

/** Base64 payload of a data: URL (what the AI SDK expects for image parts). */
export function dataUrlPayload(dataUrl: string): { base64: string; mediaType: string } | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match || !match[2]) return null;
  return { mediaType: match[1] ?? "application/octet-stream", base64: match[3] ?? "" };
}
