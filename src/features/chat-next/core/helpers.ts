/**
 * Small pure helpers for the chat UI: sidebar grouping and search, titles,
 * cost estimates, prompt-library filtering. No Svelte, no I/O.
 */
import type { Conversation, MessageNode, ModelCaps, PromptTemplate, TokenUsage } from "./types.js";

export type TimeGroup = "today" | "yesterday" | "week" | "month" | "older";

export const TIME_GROUPS: readonly TimeGroup[] = ["today", "yesterday", "week", "month", "older"];

const DAY = 86_400_000;

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function timeGroupOf(updatedAt: number, now: number): TimeGroup {
  const today = startOfDay(now);
  if (updatedAt >= today) return "today";
  if (updatedAt >= today - DAY) return "yesterday";
  if (updatedAt >= today - 7 * DAY) return "week";
  if (updatedAt >= today - 30 * DAY) return "month";
  return "older";
}

export interface SidebarSection {
  key: string;
  /** "pinned", a TimeGroup, or a folder id. */
  kind: "pinned" | "time" | "folder";
  group?: TimeGroup;
  folderId?: string;
  conversations: Conversation[];
}

function newestFirst(a: Conversation, b: Conversation): number {
  return b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1);
}

/**
 * Sidebar layout: pinned first, then time groups. Conversations inside a
 * folder are listed under that folder instead (folders are rendered by the
 * caller in their own section).
 */
export function groupConversations(
  conversations: readonly Conversation[],
  now: number,
  options: { archived?: boolean } = {},
): SidebarSection[] {
  const visible = conversations
    .filter((c) => Boolean(c.archived) === Boolean(options.archived))
    .slice()
    .sort(newestFirst);
  const sections: SidebarSection[] = [];
  const pinned = visible.filter((c) => c.pinned && !c.folderId);
  if (pinned.length > 0) sections.push({ key: "pinned", kind: "pinned", conversations: pinned });
  const loose = visible.filter((c) => !c.pinned && !c.folderId);
  for (const group of TIME_GROUPS) {
    const list = loose.filter((c) => timeGroupOf(c.updatedAt, now) === group);
    if (list.length > 0) sections.push({ key: group, kind: "time", group, conversations: list });
  }
  return sections;
}

export function conversationsInFolder(conversations: readonly Conversation[], folderId: string): Conversation[] {
  return conversations
    .filter((c) => c.folderId === folderId && !c.archived)
    .slice()
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || newestFirst(a, b));
}

/** Case-insensitive search over titles and message text. */
export function searchConversations(
  conversations: readonly Conversation[],
  nodes: Record<string, readonly MessageNode[]>,
  query: string,
): Conversation[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return conversations
    .filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        (nodes[c.id] ?? []).some((node) => node.content.toLowerCase().includes(q)),
    )
    .slice()
    .sort(newestFirst);
}

/** A short excerpt of the first match, for search results. */
export function matchExcerpt(nodes: readonly MessageNode[], query: string, radius = 36): string {
  const q = query.trim().toLowerCase();
  if (!q) return "";
  for (const node of nodes) {
    const index = node.content.toLowerCase().indexOf(q);
    if (index < 0) continue;
    const start = Math.max(0, index - radius);
    const end = Math.min(node.content.length, index + q.length + radius);
    const flat = node.content.slice(start, end).replace(/\s+/g, " ").trim();
    return `${start > 0 ? "…" : ""}${flat}${end < node.content.length ? "…" : ""}`;
  }
  return "";
}

/** Fallback title from the first user message. */
export function titleFromText(text: string, max = 28): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Clean a model-generated title: one line, no quotes or trailing punctuation. */
export function sanitizeTitle(raw: string, max = 40): string {
  const line =
    raw
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const cleaned = line
    .replace(/^(title|标题)\s*[:：]\s*/i, "")
    .replace(/^["'“”‘’「」《》*#\s]+|["'“”‘’「」《》*#\s]+$/g, "")
    .replace(/[。．.!！?？,，;；:：]+$/u, "")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

export const TITLE_INSTRUCTIONS =
  "Write a short title (at most 8 words, or 15 Chinese characters) for the conversation below. " +
  "Use the conversation's language. Reply with the title only — no quotes, no punctuation at the end.";

/** Estimated USD cost from token usage and per-1M prices; undefined when unpriced. */
export function estimateCost(usage: TokenUsage | undefined, caps: ModelCaps | undefined): number | undefined {
  if (!usage || !caps) return undefined;
  const input = caps.inputPrice;
  const output = caps.outputPrice;
  if (input === undefined && output === undefined) return undefined;
  const cost = ((usage.inputTokens ?? 0) * (input ?? 0) + (usage.outputTokens ?? 0) * (output ?? 0)) / 1_000_000;
  return Number.isFinite(cost) ? cost : undefined;
}

export function formatCost(cost: number): string {
  if (cost === 0) return "$0";
  if (cost < 0.0001) return "<$0.0001";
  return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}`;
}

/** "/" prompt menu: match on title or body, title matches first. */
export function filterPrompts(prompts: readonly PromptTemplate[], query: string): PromptTemplate[] {
  const q = query.trim().toLowerCase();
  if (!q) return prompts.slice(0, 20);
  const byTitle = prompts.filter((p) => p.title.toLowerCase().includes(q));
  const byBody = prompts.filter((p) => !byTitle.includes(p) && p.body.toLowerCase().includes(q));
  return [...byTitle, ...byBody].slice(0, 20);
}

/** Memories block appended to the system instructions. */
export function memoryInstructions(memories: readonly { text: string }[]): string | undefined {
  const lines = memories.map((m) => m.text.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;
  return `Facts the user has asked you to remember (use them when relevant):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

export const COMPACT_INSTRUCTIONS =
  "Summarize the conversation below so it can replace the original messages as context. " +
  "Keep facts, numbers, decisions, file names, code identifiers, open questions and the user's preferences. " +
  "Write in the conversation's language, as compact bullet points. Output the summary only.";

export const CONTINUE_PROMPT =
  "Continue exactly where your previous answer stopped. Do not repeat what you already wrote and do not add a preamble.";

export interface CompactionPlan {
  /** Messages to fold into the summary (after any earlier summary). */
  older: MessageNode[];
  /** Id of the last message the new summary will cover. */
  until: string;
}

/**
 * Which part of the visible path to summarise: everything after the current
 * summary except the most recent `keepRecent` messages. Null when there is
 * too little to fold (fewer than 2 messages).
 */
export function compactionPlan(
  path: readonly MessageNode[],
  summaryUntil: string | undefined,
  keepRecent = 6,
): CompactionPlan | null {
  const start = summaryUntil ? path.findIndex((n) => n.id === summaryUntil) + 1 : 0;
  const candidates = path.slice(start).filter((n) => n.role !== "system" && n.status !== "streaming");
  const older = candidates.slice(0, Math.max(0, candidates.length - Math.max(2, keepRecent)));
  const last = older[older.length - 1];
  return older.length >= 2 && last ? { older, until: last.id } : null;
}

/** Transcript fed to the summariser. */
export function compactionTranscript(previousSummary: string | undefined, nodes: readonly MessageNode[]): string {
  const lines: string[] = [];
  if (previousSummary?.trim()) lines.push(`Earlier summary:\n${previousSummary.trim()}`, "");
  for (const node of nodes) {
    const who = node.role === "user" ? "User" : "Assistant";
    const files = (node.attachments ?? []).map((a) => `[file: ${a.name}]`).join(" ");
    lines.push(`${who}: ${node.content.slice(0, 6000)}${files ? ` ${files}` : ""}`);
  }
  return lines.join("\n");
}

/** Estimated prompt size of the visible path (after the summary). */
export function estimatePathTokens(path: readonly MessageNode[], summaryUntil?: string, summary?: string): number {
  const cut = summaryUntil ? path.findIndex((n) => n.id === summaryUntil) : -1;
  const window = cut >= 0 ? path.slice(cut + 1) : path;
  return (
    estimateTokens(cut >= 0 ? summary ?? "" : "") +
    window.reduce((sum, n) => sum + estimateTokens(n.content) + (n.attachments ?? []).reduce((s, a) => s + estimateTokens(a.text ?? ""), 0), 0)
  );
}

/** Merge parameter layers; later layers win, unset values never override. */
export function mergeParams<T extends object>(...layers: Array<T | undefined>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer ?? {})) {
      if (value !== undefined && value !== null && !(typeof value === "number" && Number.isNaN(value))) out[key] = value;
    }
  }
  return out as Partial<T>;
}

/** Rough token estimate (≈4 chars/token Latin, 1.5 chars/token CJK). */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) if (/[\u3000-\u9fff\uac00-\ud7af]/.test(ch)) cjk += 1;
  return Math.ceil(cjk / 1.5 + (text.length - cjk) / 4);
}
