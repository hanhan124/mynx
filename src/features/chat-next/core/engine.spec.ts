import { describe, expect, it } from "vitest";
import { createLanguageModel, MissingApiKeyError, resolveEndpoint } from "./providers.js";
import { attachmentBlock, buildPrompt } from "./request.js";
import { consumeStream, errorMessage, type StreamPart } from "./stream.js";
import type { MessageNode, ProviderConfig, Role } from "./types.js";

async function* parts(list: StreamPart[], failWith?: unknown): AsyncGenerator<StreamPart> {
  for (const part of list) yield part;
  if (failWith !== undefined) throw failWith;
}

let seq = 0;
function msg(role: Role, content: string, extra: Partial<MessageNode> = {}): MessageNode {
  seq += 1;
  return { id: `n${seq}`, conversationId: "c", parentId: null, role, content, createdAt: seq, status: "ok", ...extra };
}

describe("resolveEndpoint", () => {
  it("normalises base URLs and fills protocol defaults", () => {
    expect(resolveEndpoint({ kind: "openai-compatible", baseUrl: "https://api.deepseek.com/// " }).baseURL).toBe(
      "https://api.deepseek.com",
    );
    expect(resolveEndpoint({ kind: "openai", baseUrl: "" }).baseURL).toBe("https://api.openai.com/v1");
    expect(resolveEndpoint({ kind: "anthropic", baseUrl: "" }).baseURL).toBe("https://api.anthropic.com/v1");
    expect(resolveEndpoint({ kind: "google", baseUrl: "" }).baseURL).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
  });

  it("points Ollama at its OpenAI-compatible /v1 and makes the key optional", () => {
    expect(resolveEndpoint({ kind: "ollama", baseUrl: "http://localhost:11434" })).toMatchObject({
      baseURL: "http://localhost:11434/v1",
      keyOptional: true,
    });
    expect(resolveEndpoint({ kind: "ollama", baseUrl: "http://127.0.0.1:11434/v1/" }).baseURL).toBe(
      "http://127.0.0.1:11434/v1",
    );
    expect(resolveEndpoint({ kind: "openai-compatible", baseUrl: "http://localhost:1234/v1" }).keyOptional).toBe(true);
    expect(resolveEndpoint({ kind: "openai-compatible", baseUrl: "https://api.x.ai/v1" }).keyOptional).toBe(false);
  });

  it("keeps custom headers and adds the Anthropic direct-access opt-in", () => {
    const headers = resolveEndpoint({
      kind: "anthropic",
      baseUrl: "",
      headers: { " X-Org ": "lab", "": "drop" },
    }).headers;
    expect(headers).toEqual({ "X-Org": "lab", "anthropic-dangerous-direct-browser-access": "true" });
  });
});

describe("createLanguageModel", () => {
  const base: ProviderConfig = {
    id: "p",
    name: "Remote",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    secretRef: "provider:p",
    models: [],
    enabled: true,
  };

  it("refuses a remote provider without a key", async () => {
    await expect(createLanguageModel(base, "m", "  ", fetch)).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("builds models for all four protocols without network access", async () => {
    for (const kind of ["openai", "openai-compatible", "anthropic", "google"] as const) {
      const model = await createLanguageModel({ ...base, kind }, "model-x", "sk-test", fetch);
      expect(typeof model === "object" && model !== null && "modelId" in model ? model.modelId : model).toBe("model-x");
    }
    const local = await createLanguageModel({ ...base, kind: "ollama", baseUrl: "http://localhost:11434" }, "qwen3", undefined, fetch);
    expect(typeof local === "object" && local !== null && "modelId" in local ? local.modelId : local).toBe("qwen3");
  });
});

describe("buildPrompt", () => {
  it("drops failed or empty answers and system nodes, trims to a user-first window", () => {
    const path = [
      msg("user", "q1"),
      msg("assistant", "a1"),
      msg("user", "q2"),
      msg("assistant", "", { status: "stopped" }),
      msg("assistant", "boom", { status: "error" }),
      msg("system", "ignored"),
      msg("user", "q3"),
    ];
    expect(buildPrompt(path).messages).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "user", content: "q3" },
    ]);
    const windowed = buildPrompt(path, { maxMessages: 3 }).messages;
    expect(windowed[0]).toEqual({ role: "user", content: "q2" });
  });

  it("combines system prompt and compaction summary into instructions", () => {
    expect(buildPrompt([msg("user", "hi")], { system: " Be brief ", summary: "earlier" }).instructions).toBe(
      "Be brief\n\nSummary of the earlier conversation:\nearlier",
    );
    expect(buildPrompt([msg("user", "hi")]).instructions).toBeUndefined();
  });

  it("inlines extracted attachment text and sends images as parts when resolvable", () => {
    const doc = { id: "a", name: "data.csv", mime: "text/csv", size: 10, kind: "text" as const, text: "x,y\n1,2" };
    const img = { id: "b", name: "gel.png", mime: "image/png", size: 99, kind: "image" as const };
    const user = msg("user", "look", { attachments: [doc, img] });
    expect(buildPrompt([user]).messages[0]).toEqual({
      role: "user",
      content: `look\n\n${attachmentBlock(doc)}\n[image: gel.png]`,
    });
    const withVision = buildPrompt([user], {
      resolveImage: () => ({ type: "image", image: "BASE64", mediaType: "image/png" }),
    }).messages[0];
    expect(withVision).toEqual({
      role: "user",
      content: [
        { type: "text", text: `look\n\n${attachmentBlock(doc)}` },
        { type: "image", image: "BASE64", mediaType: "image/png" },
      ],
    });
  });
});

describe("consumeStream", () => {
  it("accumulates text, reasoning time, sources and usage", async () => {
    let clock = 1000;
    const now = () => (clock += 500);
    const texts: string[] = [];
    const outcome = await consumeStream(
      parts([
        { type: "reasoning-start" },
        { type: "reasoning-delta", text: "think" },
        { type: "reasoning-end" },
        { type: "text-delta", text: "Hel" },
        { type: "text-delta", text: "lo" },
        { type: "source", sourceType: "url", url: "https://a.org", title: "A" },
        { type: "source", sourceType: "url", url: "https://a.org" },
        { type: "source", sourceType: "url", url: "javascript:x" },
        { type: "finish", totalUsage: { inputTokens: 5, outputTokens: 7, outputTokenDetails: { reasoningTokens: 2 } } },
      ]),
      { onText: (delta) => texts.push(delta) },
      now,
    );
    expect(texts).toEqual(["Hel", "lo"]);
    expect(outcome).toEqual({
      status: "ok",
      text: "Hello",
      reasoning: "think",
      reasoningMs: 500,
      sources: [{ title: "A", url: "https://a.org", snippet: "" }],
      tools: [],
      usage: { inputTokens: 5, outputTokens: 7, reasoningTokens: 2 },
      error: undefined,
    });
  });

  it("reports provider errors with their message", async () => {
    const outcome = await consumeStream(
      parts([{ type: "text-delta", text: "par" }, { type: "error", error: new Error("401 Unauthorized") }]),
    );
    expect(outcome).toMatchObject({ status: "error", text: "par", error: "401 Unauthorized" });
  });

  it("treats aborts as stopped and keeps the partial answer", async () => {
    expect(await consumeStream(parts([{ type: "text-delta", text: "half" }, { type: "abort" }]))).toMatchObject({
      status: "stopped",
      text: "half",
    });
    const abortError = Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    expect(await consumeStream(parts([{ type: "text-delta", text: "x" }], abortError))).toMatchObject({
      status: "stopped",
      text: "x",
    });
  });

  it("turns a thrown non-abort error into an error outcome", async () => {
    expect(await consumeStream(parts([], { message: "network down" }))).toMatchObject({
      status: "error",
      error: "network down",
    });
  });

  it("extracts readable error messages", () => {
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage({ error: { message: "nested" } })).toBe("nested");
    expect(errorMessage(42)).toBe("unknown error");
  });
});
