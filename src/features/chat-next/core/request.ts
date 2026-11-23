/**
 * Builds the model prompt from the visible branch. Pure.
 */
import type { ImagePart, ModelMessage, TextPart } from "ai";
import { dataUrlPayload } from "./attachments.js";
import type { AttachmentRef, MessageNode } from "./types.js";

export interface PromptOptions {
  /** Effective system prompt (conversation > assistant > global). */
  system?: string;
  /** Compaction summary of earlier turns. */
  summary?: string;
  /**
   * Last node the summary covers. When set, the path up to it is replaced by
   * the summary; when it is not on this path (another branch), the summary
   * does not apply. Unset = legacy summary, always included.
   */
  summaryUntil?: string;
  /** Keep at most this many trailing messages (default 40). */
  maxMessages?: number;
  /** Supplies image bytes; overrides `vision`. */
  resolveImage?: (attachment: AttachmentRef) => ImagePart | undefined;
  /** Send attached images (data URLs) to the model; otherwise images become notes. */
  vision?: boolean;
  /** Extra instruction blocks (memories, web results), appended in order. */
  extra?: Array<string | undefined>;
}

export interface BuiltPrompt {
  instructions?: string;
  messages: ModelMessage[];
}

export const DEFAULT_MAX_MESSAGES = 40;

/** Text block appended for an extracted attachment. */
export function attachmentBlock(attachment: AttachmentRef): string {
  const name = attachment.name.replace(/"/g, "'");
  return `<attachment name="${name}" type="${attachment.mime}">\n${attachment.text ?? ""}\n</attachment>`;
}

function usable(node: MessageNode): boolean {
  if (node.role === "system") return false;
  if (node.role === "assistant") return node.status !== "error" && node.content.trim().length > 0;
  return node.content.trim().length > 0 || (node.attachments?.length ?? 0) > 0;
}

function defaultImage(attachment: AttachmentRef, options: PromptOptions): ImagePart | undefined {
  if (!options.vision || !attachment.dataUrl) return undefined;
  const payload = dataUrlPayload(attachment.dataUrl);
  return payload ? { type: "image", image: payload.base64, mediaType: payload.mediaType } : undefined;
}

function userContent(node: MessageNode, options: PromptOptions): ModelMessage {
  const attachments = node.attachments ?? [];
  const texts = attachments.filter((a) => a.text !== undefined).map(attachmentBlock);
  const body = [node.content.trim(), ...texts].filter(Boolean).join("\n\n");
  const images: ImagePart[] = [];
  const notes: string[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue;
    const part = options.resolveImage
      ? options.resolveImage(attachment)
      : defaultImage(attachment, options);
    if (part) images.push(part);
    else notes.push(`[image: ${attachment.name}]`);
  }
  const text = [body, ...notes].filter(Boolean).join("\n");
  if (images.length === 0) return { role: "user", content: text };
  const parts: Array<TextPart | ImagePart> = [];
  if (text) parts.push({ type: "text", text });
  parts.push(...images);
  return { role: "user", content: parts };
}

/**
 * `path` is root → last message to answer (the new assistant node excluded).
 */
/**
 * Output format the chat renders well. Without it some models write LaTeX in
 * code spans or with no delimiters at all, which shows as raw source.
 */
export const FORMAT_INSTRUCTIONS =
  "Format answers in Markdown. Write every mathematical formula in LaTeX with math delimiters: " +
  "$...$ for inline formulas and $$...$$ on their own lines for display formulas. " +
  "Never put formulas in code spans or code blocks; use code only for program code.";

export function buildPrompt(path: readonly MessageNode[], options: PromptOptions = {}): BuiltPrompt {
  const limit = Math.max(1, options.maxMessages ?? DEFAULT_MAX_MESSAGES);
  let summary = options.summary?.trim();
  let window = path;
  if (options.summaryUntil) {
    const cut = path.findIndex((node) => node.id === options.summaryUntil);
    if (cut >= 0) window = path.slice(cut + 1);
    else summary = undefined;
  }
  let turns = window.filter(usable);
  if (turns.length > limit) turns = turns.slice(-limit);
  // Providers expect the window to open with a user turn.
  while (turns.length > 0 && turns[0]?.role !== "user") turns = turns.slice(1);

  const messages: ModelMessage[] = turns.map((node) =>
    node.role === "user" ? userContent(node, options) : { role: "assistant", content: node.content },
  );

  const system = options.system?.trim();
  const instructions = [
    system,
    summary ? `Summary of the earlier conversation:\n${summary}` : "",
    ...(options.extra ?? []).map((block) => block?.trim() ?? ""),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { instructions: instructions || undefined, messages };
}
