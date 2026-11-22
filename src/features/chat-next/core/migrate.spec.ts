import { describe, expect, it } from "vitest";
import { detectProviderKind, migrateLegacy, WEB_SEARCH_SECRET_REF } from "./migrate.js";
import { pathTo, siblingsOf } from "./tree.js";

const NOW = 1_700_000_000_000;

const v1Sessions = JSON.stringify({
  version: 1,
  sessions: [
    {
      id: "s1",
      title: "Ct 值",
      createdAt: 1000,
      messages: [
        { id: "m1", role: "user", content: "什么是 Ct？" },
        { id: "m2", role: "assistant", content: "阈值循环数", status: "ok" },
        { id: "m3", role: "user", content: "继续" },
        { id: "m4", role: "assistant", content: "半截", status: "streaming" },
      ],
    },
  ],
});

const v2Sessions = JSON.stringify({
  version: 2,
  sessions: [
    {
      id: "s2",
      title: "分支",
      createdAt: 2000,
      pinned: true,
      system: "  你是助手  ",
      summary: "早先的摘要",
      messages: [
        { id: "u1", role: "user", content: "hi" },
        {
          id: "a1",
          role: "assistant",
          activeVariant: 1,
          variants: [
            { content: "first", reasoning: "", status: "ok", usage: { prompt_tokens: 3, completion_tokens: 5 } },
            {
              content: "second",
              reasoning: "think",
              status: "ok",
              sources: [
                { title: "Doc", url: "https://example.com", snippet: "x" },
                { title: "bad", url: "javascript:alert(1)", snippet: "" },
              ],
            },
          ],
        },
        { id: "u2", role: "user", content: "next" },
        { id: "bogus", role: "system", content: "dropped" },
        { id: "a2", role: "assistant", variants: [{ content: "done", status: "error", error: "401" }] },
      ],
    },
    { id: "s2", title: "duplicate id", createdAt: 1, messages: [] },
    { title: "no id", messages: [] },
  ],
});

const config = JSON.stringify({
  baseUrl: "https://api.deepseek.com",
  apiKey: "sk-active",
  model: "deepseek-chat",
  systemPrompt: " 默认提示 ",
  temperature: 0.7,
  maxTokens: 2048,
  activeProviderId: "p2",
  providers: [
    { id: "p1", name: "DeepSeek", baseUrl: "https://api.deepseek.com/", apiKey: "sk-1", model: "deepseek-chat" },
    { id: "p2", name: "Local", baseUrl: "http://localhost:11434/v1", apiKey: "", model: "qwen3" },
    { id: "p3", name: "Empty", baseUrl: "  ", apiKey: "sk-x", model: "m" },
  ],
  webSearch: { provider: "tavily", apiKey: "tv-key", resultCount: 7, enabled: true },
});

describe("migrateLegacy — sessions", () => {
  it("imports a v1 session linearly without losing messages", () => {
    const { snapshot, report } = migrateLegacy(v1Sessions, null, NOW);
    expect(report).toMatchObject({ conversations: 1, nodes: 4, branches: 0, skipped: 0 });
    const conversation = snapshot.conversations[0]!;
    const path = pathTo(snapshot.nodes.s1!, conversation.activeLeafId);
    expect(path.map((n) => [n.role, n.content])).toEqual([
      ["user", "什么是 Ct？"],
      ["assistant", "阈值循环数"],
      ["user", "继续"],
      ["assistant", "半截"],
    ]);
    // An interrupted stream becomes "stopped", never stuck "streaming".
    expect(path[3]?.status).toBe("stopped");
    expect(conversation).toMatchObject({ id: "s1", title: "Ct 值", createdAt: 1000, pinned: false, archived: false });
  });

  it("turns v2 variants into sibling branches and follows the active one", () => {
    const { snapshot, report } = migrateLegacy(v2Sessions, null, NOW);
    expect(report).toMatchObject({ conversations: 1, branches: 1, skipped: 2 });
    const nodes = snapshot.nodes.s2!;
    const conversation = snapshot.conversations[0]!;
    const path = pathTo(nodes, conversation.activeLeafId);
    expect(path.map((n) => n.content)).toEqual(["hi", "second", "next", "done"]);
    expect(siblingsOf(nodes, path[1]!.id)).toMatchObject({ index: 1, total: 2 });
    const first = nodes.find((n) => n.content === "first");
    expect(first?.usage).toEqual({ inputTokens: 3, outputTokens: 5 });
    expect(path[1]?.reasoning).toBe("think");
    expect(path[1]?.sources).toEqual([{ title: "Doc", url: "https://example.com", snippet: "x" }]);
    expect(path[3]).toMatchObject({ status: "error", error: "401" });
    expect(conversation).toMatchObject({ pinned: true, system: "你是助手", summary: "早先的摘要" });
  });

  it("is deterministic (safe to re-run)", () => {
    expect(migrateLegacy(v2Sessions, config, NOW)).toEqual(migrateLegacy(v2Sessions, config, NOW));
  });

  it("survives empty, corrupt and unknown-version input", () => {
    for (const input of [null, "", "{not json", JSON.stringify({ version: 9, sessions: [] })]) {
      const { snapshot } = migrateLegacy(input, input, NOW);
      expect(snapshot.conversations).toEqual([]);
      expect(snapshot.providers).toEqual([]);
      expect(snapshot.version).toBe(3);
    }
  });

  it("keeps every node's parent inside the same conversation", () => {
    const { snapshot } = migrateLegacy(v2Sessions, null, NOW);
    const nodes = snapshot.nodes.s2!;
    const ids = new Set(nodes.map((n) => n.id));
    expect(nodes.every((n) => n.parentId === null || ids.has(n.parentId))).toBe(true);
  });
});

describe("migrateLegacy — config", () => {
  it("moves providers over without secrets and returns keys separately", () => {
    const { snapshot, secrets } = migrateLegacy(null, config, NOW);
    expect(snapshot.providers.map((p) => [p.id, p.kind, p.baseUrl, p.defaultModelId])).toEqual([
      ["p1", "openai-compatible", "https://api.deepseek.com", "deepseek-chat"],
      ["p2", "ollama", "http://localhost:11434/v1", "qwen3"],
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("sk-");
    expect(JSON.stringify(snapshot)).not.toContain("tv-key");
    expect(secrets).toEqual({ "provider:p1": "sk-1", [WEB_SEARCH_SECRET_REF]: "tv-key" });
  });

  it("carries the active provider, defaults and web search", () => {
    const { snapshot } = migrateLegacy(null, config, NOW);
    expect(snapshot.settings).toEqual({
      defaultProviderId: "p2",
      defaultModelId: "qwen3",
      systemPrompt: "默认提示",
      params: { temperature: 0.7, maxOutputTokens: 2048 },
      webSearch: {
        provider: "tavily",
        url: undefined,
        resultCount: 7,
        enabled: true,
        secretRef: WEB_SEARCH_SECRET_REF,
      },
    });
  });

  it("migrates a pre-registry flat config", () => {
    const flat = JSON.stringify({ baseUrl: "https://api.openai.com/v1", apiKey: "sk-flat", model: "gpt-4o-mini" });
    const { snapshot, secrets } = migrateLegacy(null, flat, NOW);
    expect(snapshot.providers).toHaveLength(1);
    expect(snapshot.providers[0]).toMatchObject({ kind: "openai", defaultModelId: "gpt-4o-mini" });
    expect(Object.values(secrets)).toEqual(["sk-flat"]);
  });
});

describe("detectProviderKind", () => {
  it("recognises native protocols by host", () => {
    expect(detectProviderKind("https://api.anthropic.com/v1")).toBe("anthropic");
    expect(detectProviderKind("https://generativelanguage.googleapis.com/v1beta")).toBe("google");
    expect(detectProviderKind("http://127.0.0.1:11434")).toBe("ollama");
    expect(detectProviderKind("https://api.openai.com/v1")).toBe("openai");
    expect(detectProviderKind("https://openrouter.ai/api/v1")).toBe("openai-compatible");
  });
});
