import { describe, expect, it } from "vitest";
import { classifyFetchError, fetchModelIds, HttpError } from "./remote.js";
import type { ProviderConfig } from "./types.js";

function provider(kind: ProviderConfig["kind"], baseUrl: string): ProviderConfig {
  return { id: "p", name: "P", kind, baseUrl, secretRef: "provider:p", models: [], enabled: true };
}

type Call = { url: string; headers: Record<string, string> };

/** Fake fetch: answers by URL, records calls. */
function fakeFetch(routes: Record<string, { status: number; body: unknown }>, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const route = routes[url] ?? { status: 404, body: { error: "not found" } };
    return new Response(JSON.stringify(route.body), { status: route.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

describe("fetchModelIds", () => {
  it("sends the bearer key to OpenAI-compatible /models", async () => {
    const calls: Call[] = [];
    const fetchFn = fakeFetch({ "https://api.deepseek.com/models": { status: 200, body: { data: [{ id: "deepseek-chat" }] } } }, calls);
    expect(await fetchModelIds(provider("openai-compatible", "https://api.deepseek.com/"), " sk-1 ", fetchFn)).toEqual({ ids: ["deepseek-chat"] });
    expect(calls[0]?.headers.authorization).toBe("Bearer sk-1");
  });

  it("retries under /v1 on 404 and suggests the fixed base URL", async () => {
    const calls: Call[] = [];
    const fetchFn = fakeFetch({ "https://relay.example.com/v1/models": { status: 200, body: { data: [{ id: "m" }] } } }, calls);
    expect(await fetchModelIds(provider("openai-compatible", "https://relay.example.com"), "k", fetchFn)).toEqual({
      ids: ["m"],
      suggestedBaseUrl: "https://relay.example.com/v1",
    });
    expect(calls.map((c) => c.url)).toEqual(["https://relay.example.com/models", "https://relay.example.com/v1/models"]);
  });

  it("does not retry when the URL already ends with a version", async () => {
    const calls: Call[] = [];
    await expect(fetchModelIds(provider("openai-compatible", "https://x.example.com/v4"), "k", fakeFetch({}, calls))).rejects.toBeInstanceOf(HttpError);
    expect(calls).toHaveLength(1);
  });

  it("uses native headers for Anthropic and Gemini, and the tag list for Ollama", async () => {
    const calls: Call[] = [];
    const fetchFn = fakeFetch(
      {
        "https://api.anthropic.com/v1/models?limit=1000": { status: 200, body: { data: [{ id: "claude-sonnet-4" }] } },
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000": {
          status: 200,
          body: { models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] },
        },
        "http://localhost:11434/api/tags": { status: 200, body: { models: [{ name: "qwen3:8b" }] } },
      },
      calls,
    );
    expect((await fetchModelIds(provider("anthropic", ""), "ak", fetchFn)).ids).toEqual(["claude-sonnet-4"]);
    expect(calls[0]?.headers["x-api-key"]).toBe("ak");
    expect((await fetchModelIds(provider("google", ""), "gk", fetchFn)).ids).toEqual(["gemini-2.5-flash"]);
    expect(calls[1]?.headers["x-goog-api-key"]).toBe("gk");
    expect((await fetchModelIds(provider("ollama", "http://localhost:11434"), undefined, fetchFn)).ids).toEqual(["qwen3:8b"]);
  });

  it("rejects an empty or relative base URL before any request", async () => {
    const calls: Call[] = [];
    await expect(fetchModelIds(provider("openai-compatible", ""), "k", fakeFetch({}, calls))).rejects.toThrow("invalid-url");
    expect(calls).toHaveLength(0);
  });
});

describe("classifyFetchError", () => {
  it("maps statuses and transport messages to causes", () => {
    expect(classifyFetchError(new HttpError(401, "HTTP 401"))).toBe("auth");
    expect(classifyFetchError("Incorrect API key provided")).toBe("auth");
    expect(classifyFetchError(new HttpError(404, "HTTP 404"))).toBe("notFound");
    expect(classifyFetchError(new HttpError(429, "HTTP 429"))).toBe("rate");
    expect(classifyFetchError("url not allowed on the configured scope: http://192.168.1.2")).toBe("scope");
    expect(classifyFetchError(new HttpError(0, "invalid-url"))).toBe("url");
    expect(classifyFetchError(new Error("The operation timed out"))).toBe("timeout");
    expect(classifyFetchError(new HttpError(502, "HTTP 502"))).toBe("server");
    expect(classifyFetchError("error sending request for url")).toBe("network");
    expect(classifyFetchError("weird")).toBe("unknown");
  });
});
