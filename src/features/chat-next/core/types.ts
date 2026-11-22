/**
 * Chat-next domain model (v3). Pure data: no Svelte, no Tauri, no network.
 *
 * Conversations are message TREES: every node points at its parent, so
 * editing a message or regenerating an answer adds a sibling instead of
 * overwriting history. The visible thread is the path root → activeLeafId.
 */

export const CHAT_STORE_VERSION = 3;

export type Role = "system" | "user" | "assistant";
export type NodeStatus = "ok" | "streaming" | "stopped" | "error";

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

export interface SourceRef {
  title: string;
  url: string;
  snippet: string;
}

export interface AttachmentRef {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "text" | "pdf" | "other";
  /** Extracted text (text/code/CSV/PDF) fed into the context window. */
  text?: string;
  /** True when `text` was cut to the extraction limit. */
  truncated?: boolean;
  /** Downscaled image as a data: URL (sent to vision models). */
  dataUrl?: string;
}

export type ToolCallStatus = "pending" | "running" | "done" | "error" | "denied";

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
  status: ToolCallStatus;
}

export interface MessageNode {
  id: string;
  conversationId: string;
  /** `null` for a root message. */
  parentId: string | null;
  role: Role;
  content: string;
  createdAt: number;
  status: NodeStatus;
  error?: string;
  reasoning?: string;
  /** Wall-clock thinking time in ms, when the provider streamed reasoning. */
  reasoningMs?: number;
  attachments?: AttachmentRef[];
  sources?: SourceRef[];
  usage?: TokenUsage;
  /** Which model produced an assistant node. */
  providerId?: string;
  modelId?: string;
  /** MCP tool calls made while producing this answer. */
  tools?: ToolCallRecord[];
  /** Answers produced side by side for one question share this id. */
  compareGroup?: string;
  /** Provider finish reason ("stop", "length", ...), for "Continue". */
  finishReason?: string;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  folderId: string | null;
  /** Temporary chats are never persisted. */
  temporary: boolean;
  /** Per-conversation system prompt (overrides assistant / global). */
  system?: string;
  assistantId?: string;
  /** Leaf of the currently visible branch; `null` for an empty chat. */
  activeLeafId: string | null;
  /** Compaction summary of the oldest part of the active path. */
  summary?: string;
  /** Last node the summary covers; the prompt skips the path up to it. */
  summaryUntil?: string;
  /** Per-conversation model parameter overrides. */
  params?: ModelParams;
  /** True once the title came from the model or the user. */
  titled?: boolean;
}

export type ProviderKind = "openai" | "openai-compatible" | "anthropic" | "google" | "ollama";

export interface ModelCaps {
  vision: boolean;
  reasoning: boolean;
  tools: boolean;
  /** Context window in tokens, when known. */
  contextWindow?: number;
  /** USD per 1M tokens, for the cost estimate. */
  inputPrice?: number;
  outputPrice?: number;
}

export interface ModelInfo {
  id: string;
  label?: string;
  caps: ModelCaps;
}

/**
 * Provider settings. Secrets are NEVER stored here: API keys live in the OS
 * keychain under `secretRef` (see the store adapter).
 */
export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  headers?: Record<string, string>;
  secretRef: string;
  models: ModelInfo[];
  defaultModelId?: string;
  enabled: boolean;
}

export interface ModelParams {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
}

export interface Assistant {
  id: string;
  name: string;
  icon: string;
  system: string;
  providerId?: string;
  modelId?: string;
  params: ModelParams;
  createdAt: number;
}

export interface PromptTemplate {
  id: string;
  /** Shown in the "/" menu; also the search key. */
  title: string;
  body: string;
  createdAt: number;
}

export interface MemoryItem {
  id: string;
  text: string;
  createdAt: number;
}

/** Remote MCP server (HTTP or SSE transport only). */
export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  headers?: Record<string, string>;
  enabled: boolean;
}

export type WebSearchProviderId = "off" | "tavily" | "serper" | "searxng";

export interface ChatSettings {
  defaultProviderId?: string;
  defaultModelId?: string;
  systemPrompt?: string;
  params: ModelParams;
  /** Ask the model for a short title after the first answer (default on). */
  autoTitle?: boolean;
  /** Inject saved memories into every conversation (default on). */
  memoryEnabled?: boolean;
  /** Providers were seeded from the legacy chat once; never re-seed. */
  legacySeeded?: boolean;
  webSearch?: {
    provider: WebSearchProviderId;
    url?: string;
    resultCount: number;
    enabled: boolean;
    secretRef?: string;
  };
}

/** Everything except secrets; what the store adapter persists. */
export interface ChatSnapshot {
  version: typeof CHAT_STORE_VERSION;
  conversations: Conversation[];
  /** Nodes grouped by conversation id. */
  nodes: Record<string, MessageNode[]>;
  folders: Folder[];
  assistants: Assistant[];
  providers: ProviderConfig[];
  prompts: PromptTemplate[];
  memories: MemoryItem[];
  mcpServers: McpServerConfig[];
  settings: ChatSettings;
}

export const DEFAULT_CAPS: ModelCaps = { vision: false, reasoning: false, tools: false };

export function emptySnapshot(): ChatSnapshot {
  return {
    version: CHAT_STORE_VERSION,
    conversations: [],
    nodes: {},
    folders: [],
    assistants: [],
    providers: [],
    prompts: [],
    memories: [],
    mcpServers: [],
    settings: { params: {} },
  };
}
