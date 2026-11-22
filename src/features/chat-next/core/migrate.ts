/**
 * One-time import of the legacy chat (localStorage `mynx-chat-sessions` v1/v2
 * and `mynx-chat-config`) into the v3 tree model.
 *
 * Pure and deterministic: ids derive from the legacy ids, so running it twice
 * yields the same result (idempotent import). The legacy keys are only READ;
 * the caller keeps them untouched as a backup. API keys are returned
 * separately in `secrets` so the store adapter can move them into the OS
 * keychain — they never enter the snapshot.
 *
 * Self-contained on purpose: it must keep working after the legacy chat
 * module is deleted.
 */
import {
  CHAT_STORE_VERSION,
  DEFAULT_CAPS,
  type ChatSettings,
  type ChatSnapshot,
  type Conversation,
  type MessageNode,
  type NodeStatus,
  type ProviderConfig,
  type ProviderKind,
  type SourceRef,
  type TokenUsage,
  type WebSearchProviderId,
} from "./types.js";

export const LEGACY_SESSIONS_KEY = "mynx-chat-sessions";
export const LEGACY_CONFIG_KEY = "mynx-chat-config";
/** Set by the caller after a successful import. */
export const LEGACY_MIGRATION_MARKER = "mynx-chat-next-migrated-v3";
export const WEB_SEARCH_SECRET_REF = "websearch";

export interface MigrationResult {
  snapshot: ChatSnapshot;
  /** secretRef → API key, for the keychain. Empty keys are omitted. */
  secrets: Record<string, string>;
  report: {
    conversations: number;
    nodes: number;
    branches: number;
    providers: number;
    skipped: number;
  };
}

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function finite(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function status(value: unknown): NodeStatus {
  if (value === "streaming") return "stopped";
  return value === "stopped" || value === "error" ? value : "ok";
}

function usage(value: unknown): TokenUsage | undefined {
  if (!isObject(value)) return undefined;
  const inputTokens = finite(value.prompt_tokens);
  const outputTokens = finite(value.completion_tokens);
  return inputTokens === undefined && outputTokens === undefined
    ? undefined
    : { inputTokens, outputTokens };
}

function sources(value: unknown): SourceRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .filter((item): item is Raw => isObject(item) && /^https?:\/\//i.test(str(item.url)))
    .map((item) => ({
      title: str(item.title, str(item.url)),
      url: str(item.url),
      snippet: str(item.snippet),
    }));
  return list.length > 0 ? list : undefined;
}

export function normalizeLegacyBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** Best-effort protocol detection for legacy (OpenAI-compatible-only) entries. */
export function detectProviderKind(baseUrl: string): ProviderKind {
  const url = baseUrl.toLowerCase();
  if (url.includes("api.anthropic.com")) return "anthropic";
  if (url.includes("generativelanguage.googleapis.com")) return "google";
  if (/(localhost|127\.0\.0\.1):11434/.test(url)) return "ollama";
  if (url.includes("api.openai.com")) return "openai";
  return "openai-compatible";
}

interface LegacyProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

function legacyProviders(config: Raw): LegacyProvider[] {
  const entries = Array.isArray(config.providers) ? config.providers : [];
  const parsed = entries
    .filter(isObject)
    .map((entry, i) => ({
      id: str(entry.id) || `legacy-provider-${i + 1}`,
      name: str(entry.name) || `Provider ${i + 1}`,
      baseUrl: normalizeLegacyBaseUrl(str(entry.baseUrl)),
      apiKey: str(entry.apiKey).trim(),
      model: str(entry.model).trim(),
    }))
    .filter((entry) => entry.baseUrl);
  if (parsed.length > 0) return parsed;
  // Pre-registry installs stored one flat provider.
  const baseUrl = normalizeLegacyBaseUrl(str(config.baseUrl));
  return baseUrl
    ? [
        {
          id: "legacy-provider-1",
          name: "Provider 1",
          baseUrl,
          apiKey: str(config.apiKey).trim(),
          model: str(config.model).trim(),
        },
      ]
    : [];
}

function migrateConfig(json: string | null): {
  providers: ProviderConfig[];
  settings: ChatSettings;
  secrets: Record<string, string>;
} {
  const secrets: Record<string, string> = {};
  let config: Raw = {};
  try {
    const parsed: unknown = json ? JSON.parse(json) : {};
    if (isObject(parsed)) config = parsed;
  } catch {
    config = {};
  }
  const providers: ProviderConfig[] = legacyProviders(config).map((entry) => {
    const secretRef = `provider:${entry.id}`;
    if (entry.apiKey) secrets[secretRef] = entry.apiKey;
    return {
      id: entry.id,
      name: entry.name,
      kind: detectProviderKind(entry.baseUrl),
      baseUrl: entry.baseUrl,
      secretRef,
      models: entry.model ? [{ id: entry.model, caps: { ...DEFAULT_CAPS } }] : [],
      defaultModelId: entry.model || undefined,
      enabled: true,
    };
  });
  const activeId = str(config.activeProviderId);
  const active = providers.find((p) => p.id === activeId) ?? providers[0];

  const temperature = finite(config.temperature);
  const maxTokens = finite(config.maxTokens);
  const settings: ChatSettings = {
    defaultProviderId: active?.id,
    defaultModelId: active?.defaultModelId,
    systemPrompt: str(config.systemPrompt).trim() || undefined,
    params: {
      temperature: temperature !== undefined && temperature >= 0 && temperature <= 2 ? temperature : undefined,
      maxOutputTokens: maxTokens !== undefined && Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : undefined,
    },
  };
  const ws = config.webSearch;
  if (isObject(ws)) {
    const provider = str(ws.provider) as WebSearchProviderId;
    if (provider === "tavily" || provider === "serper" || provider === "searxng") {
      const key = str(ws.apiKey).trim();
      if (key) secrets[WEB_SEARCH_SECRET_REF] = key;
      const count = finite(ws.resultCount);
      settings.webSearch = {
        provider,
        url: str(ws.url).trim() || undefined,
        resultCount: count !== undefined && count >= 1 && count <= 10 ? Math.round(count) : 5,
        enabled: ws.enabled === true,
        secretRef: key ? WEB_SEARCH_SECRET_REF : undefined,
      };
    }
  }
  return { providers, settings, secrets };
}

function migrateSession(
  session: Raw,
  fallbackTime: number,
): { conversation: Conversation; nodes: MessageNode[]; branches: number } | null {
  const id = str(session.id);
  if (!id || !Array.isArray(session.messages)) return null;
  const createdAt = finite(session.createdAt) ?? fallbackTime;
  const nodes: MessageNode[] = [];
  let parentId: string | null = null;
  let branches = 0;
  let clock = createdAt;
  const tick = () => (clock += 1);

  session.messages.forEach((raw, position) => {
    if (!isObject(raw)) return;
    const role = raw.role;
    if (role !== "user" && role !== "assistant") return;
    const messageId = str(raw.id) || `m${position}`;
    const nodeId = `${id}:${messageId}`;

    if (role === "user") {
      nodes.push({
        id: nodeId,
        conversationId: id,
        parentId,
        role: "user",
        content: str(raw.content),
        createdAt: tick(),
        status: "ok",
      });
      parentId = nodeId;
      return;
    }

    // v2 assistant: variants[] → sibling nodes under the same parent.
    const storedVariants = Array.isArray(raw.variants) ? raw.variants.filter(isObject) : [];
    // v1 (or a v2 entry whose variants are all unreadable): the message
    // itself is the single answer.
    const variants: Raw[] = storedVariants.length > 0 ? storedVariants : [raw];
    const active = Math.min(
      Math.max(0, Math.trunc(finite(raw.activeVariant) ?? 0)),
      variants.length - 1,
    );
    let activeNodeId = nodeId;
    variants.forEach((variant, index) => {
      const variantId = variants.length > 1 ? `${nodeId}:v${index}` : nodeId;
      const reasoning = str(variant.reasoning);
      const error = str(variant.error);
      nodes.push({
        id: variantId,
        conversationId: id,
        parentId,
        role: "assistant",
        content: str(variant.content),
        createdAt: tick(),
        status: status(variant.status),
        error: error || undefined,
        reasoning: reasoning || undefined,
        usage: usage(variant.usage),
        sources: sources(variant.sources),
      });
      if (index === active) activeNodeId = variantId;
    });
    branches += variants.length - 1;
    parentId = activeNodeId;
  });

  const summary = str(session.summary).trim();
  const system = str(session.system).trim();
  return {
    conversation: {
      id,
      title: str(session.title) || "…",
      createdAt,
      updatedAt: Math.max(createdAt, clock),
      pinned: session.pinned === true,
      archived: false,
      folderId: null,
      temporary: false,
      system: system || undefined,
      activeLeafId: parentId,
      summary: summary || undefined,
    },
    nodes,
    branches,
  };
}

/**
 * Convert legacy localStorage values into a v3 snapshot.
 * `now` is injectable for deterministic tests.
 */
export function migrateLegacy(
  sessionsJson: string | null,
  configJson: string | null,
  now: number = Date.now(),
): MigrationResult {
  const { providers, settings, secrets } = migrateConfig(configJson);
  const conversations: Conversation[] = [];
  const nodes: Record<string, MessageNode[]> = {};
  let skipped = 0;
  let branches = 0;
  let nodeCount = 0;

  let sessions: unknown[] = [];
  try {
    const parsed: unknown = sessionsJson ? JSON.parse(sessionsJson) : null;
    if (isObject(parsed) && (parsed.version === 1 || parsed.version === 2) && Array.isArray(parsed.sessions)) {
      sessions = parsed.sessions;
    }
  } catch {
    sessions = [];
  }

  for (const raw of sessions) {
    const migrated = isObject(raw) ? migrateSession(raw, now) : null;
    if (!migrated || nodes[migrated.conversation.id]) {
      skipped += 1;
      continue;
    }
    conversations.push(migrated.conversation);
    nodes[migrated.conversation.id] = migrated.nodes;
    branches += migrated.branches;
    nodeCount += migrated.nodes.length;
  }

  return {
    snapshot: {
      version: CHAT_STORE_VERSION,
      conversations,
      nodes,
      folders: [],
      assistants: [],
      providers,
      prompts: [],
      memories: [],
      mcpServers: [],
      settings,
    },
    secrets,
    report: {
      conversations: conversations.length,
      nodes: nodeCount,
      branches,
      providers: providers.length,
      skipped,
    },
  };
}
