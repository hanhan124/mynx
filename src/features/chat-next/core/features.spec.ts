import { describe, expect, it } from "vitest";
import { artifactsOfNode, collectArtifacts, findBlocks, previewDocument } from "./artifacts.js";
import { classifyFile, clipText, dataUrlPayload } from "./attachments.js";
import { conversationMarkdown, exportBundle, fileNameFor, parseBundle } from "./exporting.js";
import {
  conversationsInFolder,
  estimateCost,
  estimateTokens,
  filterPrompts,
  formatCost,
  groupConversations,
  matchExcerpt,
  memoryInstructions,
  sanitizeTitle,
  searchConversations,
  timeGroupOf,
  titleFromText,
} from "./helpers.js";
import { uniqueToolName } from "./mcp.js";
import { guessCaps, mergeModels, parseModelList, parseSearchResults, searchInstructions } from "./remote.js";
import { buildPrompt } from "./request.js";
import type { Conversation, MessageNode } from "./types.js";

const NOW = new Date(2026, 10, 22, 15, 0, 0).getTime();
const DAY = 86_400_000;

function conv(id: string, updatedAt: number, extra: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    pinned: false,
    archived: false,
    folderId: null,
    temporary: false,
    activeLeafId: null,
    ...extra,
  };
}

let seq = 0;
function node(role: MessageNode["role"], content: string, extra: Partial<MessageNode> = {}): MessageNode {
  seq += 1;
  return { id: `n${seq}`, conversationId: "c", parentId: null, role, content, createdAt: seq, status: "ok", ...extra };
}

describe("sidebar grouping and search", () => {
  it("buckets by calendar day", () => {
    expect(timeGroupOf(NOW - 60_000, NOW)).toBe("today");
    expect(timeGroupOf(NOW - DAY, NOW)).toBe("yesterday");
    expect(timeGroupOf(NOW - 5 * DAY, NOW)).toBe("week");
    expect(timeGroupOf(NOW - 20 * DAY, NOW)).toBe("month");
    expect(timeGroupOf(NOW - 90 * DAY, NOW)).toBe("older");
  });

  it("puts pinned first, hides folder and archived chats from the time groups", () => {
    const sections = groupConversations(
      [
        conv("a", NOW - 1000),
        conv("b", NOW - 2 * DAY),
        conv("p", NOW - 40 * DAY, { pinned: true }),
        conv("f", NOW, { folderId: "x" }),
        conv("z", NOW, { archived: true }),
      ],
      NOW,
    );
    expect(sections.map((s) => [s.key, s.conversations.map((c) => c.id)])).toEqual([
      ["pinned", ["p"]],
      ["today", ["a"]],
      ["week", ["b"]],
    ]);
    expect(groupConversations([conv("z", NOW, { archived: true })], NOW, { archived: true })[0]?.conversations[0]?.id).toBe("z");
  });

  it("lists folder contents pinned first", () => {
    const list = conversationsInFolder(
      [conv("1", 5, { folderId: "f" }), conv("2", 9, { folderId: "f" }), conv("3", 1, { folderId: "f", pinned: true })],
      "f",
    );
    expect(list.map((c) => c.id)).toEqual(["3", "2", "1"]);
  });

  it("searches titles and message text with an excerpt", () => {
    const nodes = { b: [node("user", "how do I compute ΔΔCt for qPCR?")] };
    const found = searchConversations([conv("alpha", 1), conv("b", 2)], nodes, "ΔΔct");
    expect(found.map((c) => c.id)).toEqual(["b"]);
    expect(matchExcerpt(nodes.b, "ΔΔct", 5)).toBe("…pute ΔΔCt for…");
    expect(searchConversations([conv("alpha", 1)], {}, "  ")).toEqual([]);
  });
});

describe("titles, costs, prompts, memory", () => {
  it("cleans model titles", () => {
    expect(sanitizeTitle('"qPCR 数据分析。"\nextra')).toBe("qPCR 数据分析");
    expect(sanitizeTitle("<think>hmm</think>\nTitle: Gel imaging tips!")).toBe("Gel imaging tips");
    expect(titleFromText("  a   b  ")).toBe("a b");
    expect(titleFromText("x".repeat(40), 10)).toBe(`${"x".repeat(10)}…`);
  });

  it("estimates cost only when priced", () => {
    expect(estimateCost({ inputTokens: 1_000_000, outputTokens: 500_000 }, { vision: false, reasoning: false, tools: false, inputPrice: 1, outputPrice: 2 })).toBe(2);
    expect(estimateCost({ inputTokens: 10 }, { vision: false, reasoning: false, tools: false })).toBeUndefined();
    expect(formatCost(0.00001)).toBe("<$0.0001");
    expect(formatCost(0.0123)).toBe("$0.012");
  });

  it("filters prompts by title before body", () => {
    const prompts = [
      { id: "1", title: "translate", body: "Translate to English", createdAt: 1 },
      { id: "2", title: "summary", body: "Summarize; then translate", createdAt: 2 },
    ];
    expect(filterPrompts(prompts, "trans").map((p) => p.id)).toEqual(["1", "2"]);
    expect(filterPrompts(prompts, "").length).toBe(2);
  });

  it("formats memories and rough token counts", () => {
    expect(memoryInstructions([{ text: " likes R " }, { text: "" }])).toContain("- likes R");
    expect(memoryInstructions([])).toBeUndefined();
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("你好吗")).toBe(2);
  });
});

describe("artifacts", () => {
  const html = "```html\n<html><head><title>Plot</title></head><body>v1</body></html>\n```";
  const html2 = "```html\n<html><head><title>Plot</title></head><body>v2</body></html>\n```";

  it("finds previewable blocks and ignores the rest", () => {
    const blocks = findBlocks(`${html}\n\n\`\`\`python\nprint(1)\n\`\`\`\n\n\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`\n\n\`\`\`\n<svg viewBox="0 0 1 1"></svg>\n\`\`\``);
    expect(blocks.map((b) => [b.kind, b.title])).toEqual([
      ["html", "Plot"],
      ["mermaid", undefined],
      ["svg", undefined],
    ]);
    expect(findBlocks("```html\n<p>unterminated")).toEqual([]);
  });

  it("versions artifacts with the same key across answers", () => {
    const a1 = node("assistant", html);
    const a2 = node("assistant", html2);
    const a3 = node("assistant", html2);
    const artifacts = collectArtifacts([node("user", "draw"), a1, a2, a3]);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.versions.map((v) => v.nodeId)).toEqual([a1.id, a2.id]);
    expect(artifactsOfNode(artifacts, a2.id)).toHaveLength(1);
  });

  it("builds a locked-down preview document", () => {
    const doc = previewDocument("html", "<html><head></head><body>x</body></html>");
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("default-src 'none'");
    expect(previewDocument("svg", "<svg></svg>")).toContain("<body><svg></svg></body>");
  });
});

describe("remote helpers", () => {
  it("parses the model list shapes of every protocol", () => {
    expect(parseModelList({ data: [{ id: "gpt-4o" }, { id: "gpt-4o" }, { id: "a" }] })).toEqual(["a", "gpt-4o"]);
    expect(parseModelList({ models: [{ name: "qwen3:8b" }, { model: "llama3" }] })).toEqual(["llama3", "qwen3:8b"]);
    expect(
      parseModelList({
        models: [
          { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    ).toEqual(["gemini-2.5-pro"]);
    expect(parseModelList(null)).toEqual([]);
  });

  it("merges fetched ids and keeps edited capabilities", () => {
    const kept = { id: "x", caps: { vision: true, reasoning: false, tools: false, inputPrice: 3 } };
    const merged = mergeModels([kept, { id: "old", caps: { vision: false, reasoning: false, tools: false } }], ["x", "gpt-4o"]);
    expect(merged.map((m) => m.id)).toEqual(["x", "gpt-4o", "old"]);
    expect(merged[0]).toBe(kept);
    expect(guessCaps("gpt-4o").vision).toBe(true);
    expect(guessCaps("text-embedding-3-small").tools).toBe(false);
  });

  it("normalises search results and builds citation instructions", () => {
    const sources = parseSearchResults(
      {
        results: [{ title: "A", url: "https://a.org", content: "alpha" }, { title: "bad", url: "ftp://x" }],
        organic: [{ title: "B", link: "https://b.org", snippet: "beta" }, { title: "dup", link: "https://a.org" }],
      },
      5,
    );
    expect(sources).toEqual([
      { title: "A", url: "https://a.org", snippet: "alpha" },
      { title: "B", url: "https://b.org", snippet: "beta" },
    ]);
    expect(searchInstructions(sources)).toContain("[2] B");
    expect(searchInstructions([])).toBeUndefined();
  });
});

describe("export bundle", () => {
  it("round-trips conversations and skips temporary ones", () => {
    const user = node("user", "hi", { conversationId: "c1" });
    const answer = node("assistant", "hello", { conversationId: "c1", parentId: user.id, status: "streaming", modelId: "m" });
    const bundle = exportBundle(
      [
        { conversation: conv("c1", 1, { activeLeafId: answer.id, title: "Hi" }), nodes: [user, answer] },
        { conversation: conv("tmp", 1, { temporary: true }), nodes: [] },
      ],
      123,
    );
    expect(bundle.conversations).toHaveLength(1);
    const parsed = parseBundle(JSON.stringify(bundle));
    expect(parsed?.[0]?.nodes[1]?.status).toBe("stopped");
    expect(parseBundle("{}")).toBeNull();
    const md = conversationMarkdown(bundle.conversations[0]!.conversation, bundle.conversations[0]!.nodes, {
      user: "You",
      assistant: "AI",
      untitled: "Untitled",
    });
    expect(md).toBe("# Hi\n\n## You\n\nhi\n\n## AI (m)\n\nhello\n");
    expect(fileNameFor('a/b:c?"', "md")).toBe("a b c.md");
  });
});

describe("attachments, prompt extras, MCP names", () => {
  it("classifies files by type and extension", () => {
    expect(classifyFile("gel.png", "image/png")).toBe("image");
    expect(classifyFile("plot.svg", "image/svg+xml")).toBe("text");
    expect(classifyFile("paper.pdf", "")).toBe("pdf");
    expect(classifyFile("counts.tsv", "")).toBe("text");
    expect(classifyFile("data.xlsx", "application/vnd.ms-excel")).toBe("other");
    expect(clipText("abcdef", 3)).toEqual({ text: "abc", truncated: true });
    expect(dataUrlPayload("data:image/png;base64,QUJD")).toEqual({ mediaType: "image/png", base64: "QUJD" });
    expect(dataUrlPayload("data:text/plain,hi")).toBeNull();
  });

  it("sends images only to vision models and appends extra instructions", () => {
    const img = { id: "i", name: "a.png", mime: "image/png", size: 1, kind: "image" as const, dataUrl: "data:image/png;base64,QUJD" };
    const user = node("user", "look", { attachments: [img] });
    expect(buildPrompt([user]).messages[0]).toEqual({ role: "user", content: "look\n[image: a.png]" });
    expect(buildPrompt([user], { vision: true }).messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image", image: "QUJD", mediaType: "image/png" },
      ],
    });
    expect(buildPrompt([user], { system: "S", extra: [undefined, "M", " "] }).instructions).toBe("S\n\nM");
  });

  it("keeps MCP tool names unique", () => {
    expect(uniqueToolName("search", "Web", new Set())).toBe("search");
    expect(uniqueToolName("search", "My Web", new Set(["search"]))).toBe("My_Web__search");
    expect(uniqueToolName("search", "Web", new Set(["search", "Web__search"]))).toBe("Web__search_2");
  });
});
