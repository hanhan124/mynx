/**
 * Network-facing helpers that stay pure over an injected `fetch`:
 * model-list discovery per protocol and web search (Tavily / Serper /
 * SearXNG). Parsing functions are exported for tests.
 */
import { resolveEndpoint } from "./providers.js";
import { DEFAULT_CAPS, type ModelInfo, type ProviderConfig, type SourceRef, type WebSearchProviderId } from "./types.js";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

type Fetch = typeof fetch;

async function getJson(fetchFn: Fetch, url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetchFn(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new HttpError(response.status, `HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return response.json();
}

/** Guess capabilities from well-known model ids (user can override). */
export function guessCaps(id: string): ModelInfo["caps"] {
  const m = id.toLowerCase();
  return {
    vision: /(vision|vl\b|-vl|gpt-4o|gpt-4\.1|gpt-5|claude-(3|sonnet|opus|haiku)|gemini|qwen2?\.?5?-vl|llava|pixtral|glm-4v)/.test(m),
    reasoning: /(reason|think|r1\b|-r1|o1|o3|o4|gpt-5|deepseek-reasoner|qwq|claude-.*(opus|sonnet)-4)/.test(m),
    tools: !/(embed|whisper|tts|dall-e|image|moderation|rerank)/.test(m),
  };
}

/** Normalise any of the supported list shapes into sorted model ids. */
export function parseModelList(body: unknown): string[] {
  const out = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) out.add(value.trim().replace(/^models\//, ""));
  };
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const list of [record.data, record.models]) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (typeof item === "string") push(item);
        else if (item && typeof item === "object") {
          const entry = item as Record<string, unknown>;
          // Gemini lists generation-capable models via supportedGenerationMethods.
          const methods = entry.supportedGenerationMethods;
          if (Array.isArray(methods) && !methods.includes("generateContent")) continue;
          push(entry.id ?? entry.name ?? entry.model);
        }
      }
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** Merge a fetched id list into existing models, keeping user-edited caps. */
export function mergeModels(existing: readonly ModelInfo[], ids: readonly string[]): ModelInfo[] {
  const known = new Map(existing.map((m) => [m.id, m]));
  const merged = ids.map((id) => known.get(id) ?? { id, caps: { ...DEFAULT_CAPS, ...guessCaps(id) } });
  for (const model of existing) if (!ids.includes(model.id)) merged.push(model);
  return merged;
}

export type FetchErrorKind = "auth" | "notFound" | "rate" | "scope" | "url" | "timeout" | "network" | "server" | "unknown";

/** Map an HTTP / transport failure to a user-facing cause. Works on errors and plain messages. */
export function classifyFetchError(error: unknown): FetchErrorKind {
  const status = error instanceof HttpError ? error.status : undefined;
  const text = (error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "")).toLowerCase();
  if (status === 401 || status === 403 || /\b40[13]\b|unauthori[sz]ed|invalid.{0,12}(api[ _-]?)?key|incorrect api key|authentication|forbidden/.test(text)) {
    return "auth";
  }
  if (status === 404 || /\b404\b|not found/.test(text)) return "notFound";
  if (status === 429 || /\b429\b|rate.?limit|quota|too many requests/.test(text)) return "rate";
  if (/scope|not allowed|forbidden url/.test(text)) return "scope";
  if (/invalid-url|invalid url|relative url|url is not set|failed to parse url|builder error/.test(text)) return "url";
  if (/timeout|timed out|aborted|cancel/.test(text)) return "timeout";
  if (status !== undefined && status >= 500) return "server";
  if (/fetch|network|connect|dns|resolve|econn|refused|unreachable|certificate|tls|ssl|error sending request/.test(text)) {
    return "network";
  }
  return "unknown";
}

export interface ModelListResult {
  ids: string[];
  /** Set when the list only worked after appending /v1 to the base URL. */
  suggestedBaseUrl?: string;
}

export async function fetchModelIds(provider: ProviderConfig, apiKey: string | undefined, fetchFn: Fetch): Promise<ModelListResult> {
  const { kind, baseURL, headers } = resolveEndpoint(provider);
  if (!/^https?:\/\/[^/\s]+/i.test(baseURL)) throw new HttpError(0, "invalid-url");
  const key = apiKey?.trim();
  if (kind === "anthropic") {
    return {
      ids: parseModelList(
        await getJson(fetchFn, `${baseURL}/models?limit=1000`, {
          headers: { ...headers, "x-api-key": key ?? "", "anthropic-version": "2023-06-01" },
        }),
      ),
    };
  }
  if (kind === "google") {
    return {
      ids: parseModelList(
        await getJson(fetchFn, `${baseURL}/models?pageSize=1000`, {
          headers: { ...headers, "x-goog-api-key": key ?? "" },
        }),
      ),
    };
  }
  if (kind === "ollama") {
    // Native tag list works on every Ollama version; /v1/models is newer.
    const root = baseURL.replace(/\/v1$/, "");
    try {
      return { ids: parseModelList(await getJson(fetchFn, `${root}/api/tags`, { headers })) };
    } catch {
      /* fall through to the OpenAI-compatible list */
    }
  }
  const auth = key ? { ...headers, Authorization: `Bearer ${key}` } : headers;
  try {
    return { ids: parseModelList(await getJson(fetchFn, `${baseURL}/models`, { headers: auth })) };
  } catch (error) {
    // Many gateways live under /v1 but users paste the bare host.
    if (!(error instanceof HttpError) || error.status !== 404 || /\/v\d+[a-z]*$/i.test(baseURL)) throw error;
    const withV1 = `${baseURL}/v1`;
    const ids = parseModelList(await getJson(fetchFn, `${withV1}/models`, { headers: auth }));
    return { ids, suggestedBaseUrl: withV1 };
  }
}

/* ------------------------------------------------------------------ */
/* Web search                                                          */
/* ------------------------------------------------------------------ */

export interface WebSearchRequest {
  provider: Exclude<WebSearchProviderId, "off">;
  apiKey?: string;
  url?: string;
  resultCount: number;
}

export function parseSearchResults(body: unknown, limit: number): SourceRef[] {
  const sources: SourceRef[] = [];
  const push = (title: unknown, url: unknown, snippet: unknown) => {
    const link = String(url ?? "").trim();
    if (!/^https?:\/\//i.test(link) || sources.some((s) => s.url === link)) return;
    sources.push({ title: String(title ?? link).trim() || link, url: link, snippet: String(snippet ?? "").trim() });
  };
  const data = (body ?? {}) as {
    results?: Array<Record<string, unknown>>;
    organic?: Array<Record<string, unknown>>;
  };
  for (const entry of Array.isArray(data.results) ? data.results : []) {
    push(entry.title, entry.url ?? entry.link, entry.content ?? entry.snippet);
  }
  for (const entry of Array.isArray(data.organic) ? data.organic : []) {
    push(entry.title, entry.link, entry.snippet);
  }
  return sources.slice(0, limit);
}

export async function runWebSearch(query: string, request: WebSearchRequest, fetchFn: Fetch, signal?: AbortSignal): Promise<SourceRef[]> {
  const count = Math.min(Math.max(Math.round(request.resultCount) || 5, 1), 10);
  const timeout = AbortSignal.timeout(15_000);
  const combined = signal && "any" in AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
  let body: unknown;
  if (request.provider === "tavily") {
    body = await getJson(fetchFn, "https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${request.apiKey ?? ""}` },
      body: JSON.stringify({ query, max_results: count, search_depth: "basic" }),
      signal: combined,
    });
  } else if (request.provider === "serper") {
    body = await getJson(fetchFn, "https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": request.apiKey ?? "" },
      body: JSON.stringify({ q: query, num: count }),
      signal: combined,
    });
  } else {
    const base = (request.url ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) throw new HttpError(0, "SearXNG URL is not set");
    body = await getJson(fetchFn, `${base}/search?format=json&q=${encodeURIComponent(query)}`, { signal: combined });
  }
  return parseSearchResults(body, count);
}

/** Context block that carries search results into the instructions. */
export function searchInstructions(sources: readonly SourceRef[]): string | undefined {
  if (sources.length === 0) return undefined;
  const blocks = sources.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}${s.snippet ? `\n${s.snippet}` : ""}`);
  return [
    "Web search results for the user's latest message (they may be outdated; judge their reliability):",
    ...blocks,
    "When you use a result, cite it inline as [n] (e.g. [1]). Do not invent sources that are not listed.",
  ].join("\n\n");
}
