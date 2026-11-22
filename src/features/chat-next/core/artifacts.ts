/**
 * Artifacts: previewable blocks (HTML, SVG, Mermaid) found in assistant
 * answers. Blocks with the same key across answers become versions of one
 * artifact, so "change the button colour" yields v2 of the same page.
 * Pure; the panel renders HTML/SVG in a sandboxed iframe (no scripts run:
 * the srcdoc inherits the app CSP, and the frame has no same-origin access).
 */
import type { MessageNode } from "./types.js";

export type ArtifactKind = "html" | "svg" | "mermaid";

export interface ArtifactVersion {
  nodeId: string;
  code: string;
}

export interface Artifact {
  key: string;
  kind: ArtifactKind;
  title: string;
  versions: ArtifactVersion[];
}

const FENCE = /^```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;

function kindOf(lang: string, code: string): ArtifactKind | null {
  const l = lang.toLowerCase();
  if (l === "html" || l === "htm") return "html";
  if (l === "svg") return "svg";
  if (l === "mermaid" || l === "mmd") return "mermaid";
  if ((l === "xml" || l === "") && /^\s*<svg[\s>]/i.test(code)) return "svg";
  if (l === "" && /^\s*<!doctype html|^\s*<html[\s>]/i.test(code)) return "html";
  return null;
}

function titleOf(kind: ArtifactKind, code: string): string | undefined {
  if (kind === "html") return /<title>([^<]{1,80})<\/title>/i.exec(code)?.[1]?.trim() || undefined;
  if (kind === "svg") return /<title>([^<]{1,80})<\/title>/i.exec(code)?.[1]?.trim() || undefined;
  return /^\s*(?:%%\s*title:?\s*|---\s*\n\s*title:\s*)([^\n]{1,80})/i.exec(code)?.[1]?.trim() || undefined;
}

export interface FoundBlock {
  kind: ArtifactKind;
  code: string;
  title?: string;
}

/** Previewable blocks in one markdown answer, in order. Unclosed fences are ignored. */
export function findBlocks(markdown: string): FoundBlock[] {
  const blocks: FoundBlock[] = [];
  for (const match of markdown.matchAll(FENCE)) {
    const code = (match[2] ?? "").replace(/\s+$/, "");
    const kind = kindOf(match[1] ?? "", code);
    if (kind && code.trim()) blocks.push({ kind, code, title: titleOf(kind, code) });
  }
  return blocks;
}

/** Artifacts across the visible path (assistant answers only), oldest version first. */
export function collectArtifacts(path: readonly MessageNode[]): Artifact[] {
  const byKey = new Map<string, Artifact>();
  for (const node of path) {
    if (node.role !== "assistant" || !node.content) continue;
    const ordinal: Record<string, number> = {};
    for (const block of findBlocks(node.content)) {
      // Untitled blocks of one kind pair up by position across answers.
      const slot = (ordinal[block.kind] = (ordinal[block.kind] ?? 0) + 1);
      const key = block.title ? `${block.kind}:${block.title}` : `${block.kind}#${slot}`;
      const existing = byKey.get(key);
      if (existing) {
        const last = existing.versions[existing.versions.length - 1];
        if (last?.code !== block.code) existing.versions.push({ nodeId: node.id, code: block.code });
      } else {
        byKey.set(key, {
          key,
          kind: block.kind,
          title: block.title ?? `${block.kind.toUpperCase()} ${slot}`,
          versions: [{ nodeId: node.id, code: block.code }],
        });
      }
    }
  }
  return [...byKey.values()];
}

/** Artifact keys whose latest-or-any version came from `nodeId`. */
export function artifactsOfNode(artifacts: readonly Artifact[], nodeId: string): Artifact[] {
  return artifacts.filter((a) => a.versions.some((v) => v.nodeId === nodeId));
}

const PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:";

/** Self-contained document for the sandboxed preview frame. No network, no scripts. */
export function previewDocument(kind: "html" | "svg", code: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  if (kind === "svg") {
    return `<!doctype html><html><head><meta charset="utf-8">${meta}<style>html,body{margin:0;height:100%;display:grid;place-items:center;background:transparent}svg{max-width:100%;max-height:100vh}</style></head><body>${code}</body></html>`;
  }
  if (/<head[\s>]/i.test(code)) return code.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  return `<!doctype html><html><head><meta charset="utf-8">${meta}</head><body>${code}</body></html>`;
}

export function artifactFileName(artifact: Artifact): string {
  const base = artifact.title.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || artifact.kind;
  return `${base}.${artifact.kind === "mermaid" ? "mmd" : artifact.kind}`;
}
