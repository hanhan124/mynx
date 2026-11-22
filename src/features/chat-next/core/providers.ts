/**
 * Provider factory: one place that turns a ProviderConfig into an AI SDK
 * language model. `resolveEndpoint` is pure (unit-tested); `createLanguageModel`
 * only wires the official provider packages.
 *
 * All requests go through the injected `fetch` (the Tauri HTTP plugin in
 * the desktop app), so WebView CORS rules never apply.
 */
import type { LanguageModel } from "ai";
import type { ProviderConfig, ProviderKind } from "./types.js";

export interface ResolvedEndpoint {
  kind: ProviderKind;
  baseURL: string;
  headers: Record<string, string>;
  /** Whether requests may omit an API key (local servers). */
  keyOptional: boolean;
}

const DEFAULT_BASE: Record<ProviderKind, string> = {
  openai: "https://api.openai.com/v1",
  "openai-compatible": "",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  ollama: "http://localhost:11434/v1",
};

function trimSlashes(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Normalise the base URL and headers for a provider kind. */
export function resolveEndpoint(provider: Pick<ProviderConfig, "kind" | "baseUrl" | "headers">): ResolvedEndpoint {
  const kind = provider.kind;
  let baseURL = trimSlashes(provider.baseUrl) || DEFAULT_BASE[kind];
  if (kind === "ollama" && !/\/v1$/.test(baseURL)) baseURL = `${baseURL}/v1`;
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(provider.headers ?? {})) {
    const key = name.trim();
    if (key && typeof value === "string") headers[key] = value;
  }
  if (kind === "anthropic") {
    // The desktop fetch can carry an Origin header; Anthropic only accepts
    // that with explicit opt-in (keys stay on this machine).
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseURL);
  return { kind, baseURL, headers, keyOptional: kind === "ollama" || local };
}

export class MissingApiKeyError extends Error {
  readonly providerName: string;

  constructor(providerName: string) {
    super(`missing API key for ${providerName}`);
    this.name = "MissingApiKeyError";
    this.providerName = providerName;
  }
}

/**
 * Each protocol package is loaded on first use (dynamic import), so the chat
 * page does not ship all four SDKs up front.
 */
export async function createLanguageModel(
  provider: ProviderConfig,
  modelId: string,
  apiKey: string | undefined,
  fetchFn: typeof fetch,
): Promise<LanguageModel> {
  const endpoint = resolveEndpoint(provider);
  const key = apiKey?.trim() || undefined;
  if (!key && !endpoint.keyOptional) throw new MissingApiKeyError(provider.name);
  const { baseURL, headers } = endpoint;

  switch (endpoint.kind) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      // Chat Completions keeps proxies and "OpenAI" gateways working.
      return createOpenAI({ baseURL, apiKey: key, headers, fetch: fetchFn }).chat(modelId);
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ baseURL, apiKey: key, headers, fetch: fetchFn })(modelId);
    }
    case "google": {
      const { createGoogle } = await import("@ai-sdk/google");
      return createGoogle({ baseURL, apiKey: key, headers, fetch: fetchFn })(modelId);
    }
    case "ollama":
    case "openai-compatible": {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      return createOpenAICompatible({
        name: provider.name || endpoint.kind,
        baseURL,
        apiKey: key,
        headers,
        fetch: fetchFn,
        includeUsage: true,
      }).chatModel(modelId);
    }
  }
}
