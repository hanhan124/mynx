import { describe, expect, it } from "vitest";
import { parseSnapshot, persistable, snapshotFromDump } from "./repository.js";
import type { ChatSnapshot, Conversation } from "../core/types.js";

function conversation(id: string, temporary = false): Conversation {
  return {
    id,
    title: id,
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    archived: false,
    folderId: null,
    temporary,
    activeLeafId: null,
  };
}

const snapshot: ChatSnapshot = {
  version: 3,
  conversations: [conversation("keep"), conversation("temp", true)],
  nodes: { keep: [], temp: [] },
  folders: [],
  assistants: [],
  providers: [],
  prompts: [],
  memories: [],
  mcpServers: [],
  settings: { params: {} },
};

describe("chat-next repository", () => {
  it("never persists temporary chats", () => {
    const saved = persistable(snapshot);
    expect(saved.conversations.map((c) => c.id)).toEqual(["keep"]);
    expect(Object.keys(saved.nodes)).toEqual(["keep"]);
  });

  it("round-trips a snapshot and rejects other versions or bad JSON", () => {
    expect(parseSnapshot(JSON.stringify(persistable(snapshot)))?.conversations).toHaveLength(1);
    expect(parseSnapshot(JSON.stringify({ ...snapshot, version: 2 }))).toBeNull();
    expect(parseSnapshot("{oops")).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });

  it("fills missing collections with empty defaults", () => {
    const parsed = parseSnapshot(JSON.stringify({ version: 3, conversations: [] }));
    expect(parsed).toEqual({
      version: 3,
      conversations: [],
      nodes: {},
      folders: [],
      assistants: [],
      providers: [],
      prompts: [],
      memories: [],
      mcpServers: [],
      settings: { params: {} },
    });
  });

  it("treats an empty SQLite dump as 'not created yet'", () => {
    expect(snapshotFromDump({ conversations: [], nodes: {}, meta: {} })).toBeNull();
  });

  it("rebuilds a snapshot from SQLite documents", () => {
    const restored = snapshotFromDump({
      conversations: [conversation("keep"), { title: "no id" }],
      nodes: { keep: [{ id: "n1", conversationId: "keep" }], orphan: [{ id: "x" }] },
      meta: {
        folders: [{ id: "f1", name: "Lab", createdAt: 1 }],
        settings: { params: { temperature: 0.3 } },
        providers: "not an array",
      },
    });
    expect(restored?.conversations.map((c) => c.id)).toEqual(["keep"]);
    expect(Object.keys(restored?.nodes ?? {})).toEqual(["keep"]);
    expect(restored?.folders).toEqual([{ id: "f1", name: "Lab", createdAt: 1 }]);
    expect(restored?.providers).toEqual([]);
    expect(restored?.settings).toEqual({ params: { temperature: 0.3 } });
  });

  it("keeps settings-only stores (no conversations yet)", () => {
    expect(snapshotFromDump({ conversations: [], nodes: {}, meta: { settings: { params: {} } } })).toMatchObject({
      conversations: [],
      settings: { params: {} },
    });
  });
});
