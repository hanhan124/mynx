/**
 * Conversation export/import formats. Pure builders; the state layer does
 * the file dialogs.
 */
import { pathTo } from "./tree.js";
import { CHAT_STORE_VERSION, type Conversation, type MessageNode } from "./types.js";

export const EXPORT_FORMAT = "mynx-chat";

export interface ExportedConversation {
  conversation: Conversation;
  nodes: MessageNode[];
}

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  version: typeof CHAT_STORE_VERSION;
  exportedAt: number;
  conversations: ExportedConversation[];
}

/** Markdown of the visible branch. */
export function conversationMarkdown(
  conversation: Conversation,
  nodes: readonly MessageNode[],
  labels: { user: string; assistant: string; untitled: string },
): string {
  const lines = [`# ${conversation.title || labels.untitled}`, ""];
  for (const node of pathTo(nodes, conversation.activeLeafId)) {
    if (node.role === "system") continue;
    const who = node.role === "user" ? labels.user : `${labels.assistant}${node.modelId ? ` (${node.modelId})` : ""}`;
    lines.push(`## ${who}`, "");
    if (node.content) lines.push(node.content.trim(), "");
    for (const attachment of node.attachments ?? []) lines.push(`> 📎 ${attachment.name}`, "");
    if (node.sources?.length) {
      lines.push(...node.sources.map((s, i) => `[${i + 1}]: ${s.url} "${s.title.replace(/"/g, "'")}"`), "");
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export function exportBundle(items: readonly ExportedConversation[], now = Date.now()): ExportBundle {
  return {
    format: EXPORT_FORMAT,
    version: CHAT_STORE_VERSION,
    exportedAt: now,
    conversations: items
      .filter((item) => !item.conversation.temporary)
      .map((item) => ({ conversation: item.conversation, nodes: [...item.nodes] })),
  };
}

/** Parse an export bundle; returns null for anything else. Nodes are re-homed to their conversation. */
export function parseBundle(json: string): ExportedConversation[] | null {
  try {
    const parsed = JSON.parse(json) as Partial<ExportBundle>;
    if (parsed.format !== EXPORT_FORMAT || !Array.isArray(parsed.conversations)) return null;
    const out: ExportedConversation[] = [];
    for (const item of parsed.conversations) {
      const conversation = item?.conversation;
      if (!conversation || typeof conversation.id !== "string") continue;
      const nodes = (Array.isArray(item.nodes) ? item.nodes : []).filter(
        (n): n is MessageNode => Boolean(n) && typeof n.id === "string" && typeof n.content === "string",
      );
      out.push({
        conversation: { ...conversation, temporary: false, archived: Boolean(conversation.archived) },
        nodes: nodes.map((n) => ({ ...n, conversationId: conversation.id, status: n.status === "streaming" ? "stopped" : n.status })),
      });
    }
    return out;
  } catch {
    return null;
  }
}

/** Safe file name from a conversation title. */
export function fileNameFor(title: string, extension: string, fallback = "chat"): string {
  const base = title.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || fallback;
  return `${base}.${extension}`;
}
