/**
 * chat-next runes store: the single source of truth for the chat page.
 * Structural edits use the pure tree helpers; streaming deltas mutate the
 * reactive node in place (cheap, fine-grained updates).
 */
import type { ToolSet } from "ai";
import { pushToast } from "../../../app/state.svelte";
import { t } from "../../../app/i18n.svelte";
import type { McpSession } from "../core/mcp.js";
import {
  COMPACT_INSTRUCTIONS,
  compactionPlan,
  compactionTranscript,
  CONTINUE_PROMPT,
  estimatePathTokens,
  memoryInstructions,
  mergeParams,
  sanitizeTitle,
  TITLE_INSTRUCTIONS,
  titleFromText,
} from "../core/helpers.js";
import { setChatReadyHint } from "../handoff.js";
import { createLanguageModel, MissingApiKeyError } from "../core/providers.js";
import { fetchModelIds, mergeModels, runWebSearch, searchInstructions } from "../core/remote.js";
import { buildPrompt } from "../core/request.js";
import { consumeStream, errorMessage, type StreamPart } from "../core/stream.js";
import { appendNode, forkPath, latestLeaf, pathTo, removeSubtree, switchSibling } from "../core/tree.js";
import {
  emptySnapshot,
  type Assistant,
  type AttachmentRef,
  type ChatSettings,
  type ChatSnapshot,
  type Conversation,
  type Folder,
  type McpServerConfig,
  type MessageNode,
  type ModelInfo,
  type ModelParams,
  type PromptTemplate,
  type ProviderConfig,
  type ProviderKind,
  type SourceRef,
} from "../core/types.js";
import type { ExportedConversation } from "../core/exporting.js";
import { WEB_SEARCH_SECRET_REF } from "../core/migrate.js";
import { loadLayout, localRepository, openSnapshot, saveLayout, type ChatRepository, type SecretStore } from "./repository.js";

export interface ModelChoice {
  providerId: string;
  modelId: string;
}

export type SettingsTab = "providers" | "assistants" | "prompts" | "memory" | "search" | "mcp" | "general";

export interface PendingApproval {
  id: string;
  nodeId: string;
  serverName: string;
  toolName: string;
  input: unknown;
}

export const chatNext = $state({
  ready: false,
  snapshot: emptySnapshot() as ChatSnapshot,
  activeId: null as string | null,
  choice: null as ModelChoice | null,
  /** Extra models answering side by side (compare mode, max 2). */
  compare: [] as ModelChoice[],
  /** Assistant node ids currently streaming / searching the web. */
  streaming: [] as string[],
  searching: [] as string[],
  /** Legacy conversations imported on first open (for a one-off notice). */
  imported: null as number | null,
  sidebarOpen: true,
  showArchived: false,
  query: "",
  artifactsOpen: false,
  artifactKey: null as string | null,
  settingsOpen: false,
  settingsTab: "providers" as SettingsTab,
  /** Pre-filled text for the memory editor ("save to memory"). */
  memoryDraft: "",
  approvals: [] as PendingApproval[],
  /** Message id the composer asked to edit (↑ in an empty composer). */
  editRequest: null as string | null,
  /** Conversation currently being compacted. */
  compacting: null as string | null,
  /** Conversation whose settings sheet is open. */
  conversationSettingsId: null as string | null,
  /** provider id → whether a key is stored. */
  keyStatus: {} as Record<string, boolean>,
  webSearchKeySet: false,
});

let secrets: SecretStore = { get: async () => undefined, set: async () => {}, remove: async () => {} };
let repository: ChatRepository = localRepository;
let opening: Promise<void> | null = null;
// Bookkeeping only (abort handles, approval resolvers, pending writes);
// never rendered, so these must not be reactive.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const controllers = new Map<string, AbortController>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const approvalResolvers = new Map<string, (allowed: boolean) => void>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const dirtyConversations = new Set<string>();
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const deletedConversations = new Set<string>();
let metaDirty = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let fetchPromise: Promise<typeof fetch> | null = null;

export function uid(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function scheduleSave(scope: string | "meta"): void {
  if (scope === "meta") metaDirty = true;
  else dirtyConversations.add(scope);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

function flushSave(): void {
  saveTimer = null;
  const changes = { conversations: [...dirtyConversations], deleted: [...deletedConversations], meta: metaDirty };
  dirtyConversations.clear();
  deletedConversations.clear();
  metaDirty = false;
  void repository.save($state.snapshot(chatNext.snapshot), changes).catch(() => {
    for (const id of changes.conversations) dirtyConversations.add(id);
    for (const id of changes.deleted) deletedConversations.add(id);
    metaDirty ||= changes.meta;
  });
}

/** Tauri HTTP plugin fetch in the desktop app; window.fetch in previews. */
export function platformFetch(): Promise<typeof fetch> {
  fetchPromise ??= (async () => {
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const mod = await import("@tauri-apps/plugin-http");
        return mod.fetch as typeof fetch;
      }
    } catch {
      /* fall back to the WebView fetch */
    }
    return fetch;
  })();
  return fetchPromise;
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

export function choiceKey(choice: ModelChoice | null | undefined): string {
  return choice ? `${choice.providerId}\u0000${choice.modelId}` : "";
}

export function parseChoiceKey(key: string): ModelChoice | null {
  const [providerId, modelId] = key.split("\u0000");
  return providerId && modelId ? { providerId, modelId } : null;
}

export function usableProviders(): ProviderConfig[] {
  return chatNext.snapshot.providers.filter((p) => p.enabled && p.models.length > 0);
}

export function modelInfo(choice: { providerId?: string; modelId?: string } | null | undefined): ModelInfo | undefined {
  if (!choice?.providerId || !choice.modelId) return undefined;
  return chatNext.snapshot.providers.find((p) => p.id === choice.providerId)?.models.find((m) => m.id === choice.modelId);
}

export function providerName(providerId: string | undefined): string {
  return chatNext.snapshot.providers.find((p) => p.id === providerId)?.name ?? "";
}

export function activeConversation(): Conversation | null {
  return chatNext.snapshot.conversations.find((c) => c.id === chatNext.activeId) ?? null;
}

export function nodesOf(conversationId: string): MessageNode[] {
  return chatNext.snapshot.nodes[conversationId] ?? [];
}

export function visiblePath(): MessageNode[] {
  const conversation = activeConversation();
  return conversation ? pathTo(nodesOf(conversation.id), conversation.activeLeafId) : [];
}

export function isStreaming(nodeId?: string): boolean {
  return nodeId ? chatNext.streaming.includes(nodeId) : chatNext.streaming.length > 0;
}

export function webSearchReady(): boolean {
  const ws = chatNext.snapshot.settings.webSearch;
  if (!ws || ws.provider === "off") return false;
  return ws.provider === "searxng" ? Boolean(ws.url) : chatNext.webSearchKeySet;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

function validChoice(choice: ModelChoice | null): boolean {
  return Boolean(choice && usableProviders().some((p) => p.id === choice.providerId && p.models.some((m) => m.id === choice.modelId)));
}

function defaultChoice(): ModelChoice | null {
  const settings = chatNext.snapshot.settings;
  const providers = usableProviders();
  const preferred = providers.find((p) => p.id === settings.defaultProviderId) ?? providers[0];
  if (!preferred) return null;
  const model =
    preferred.models.find((m) => m.id === settings.defaultModelId) ??
    preferred.models.find((m) => m.id === preferred.defaultModelId) ??
    preferred.models[0];
  return model ? { providerId: preferred.id, modelId: model.id } : null;
}

function repairChoice(): void {
  if (!validChoice(chatNext.choice)) chatNext.choice = defaultChoice();
  chatNext.compare = chatNext.compare.filter((c) => validChoice(c) && choiceKey(c) !== choiceKey(chatNext.choice));
  setChatReadyHint(usableProviders().length > 0);
}

export async function refreshKeyStatus(): Promise<void> {
  const status: Record<string, boolean> = {};
  for (const provider of chatNext.snapshot.providers) {
    status[provider.id] = Boolean(await secrets.get(provider.secretRef));
  }
  chatNext.keyStatus = status;
  chatNext.webSearchKeySet = Boolean(await secrets.get(WEB_SEARCH_SECRET_REF));
}

export function initChatNext(): Promise<void> {
  if (chatNext.ready) return Promise.resolve();
  opening ??= openStore();
  return opening;
}

async function openStore(): Promise<void> {
  const opened = await openSnapshot();
  secrets = opened.secrets;
  repository = opened.repository;
  for (const list of Object.values(opened.snapshot.nodes)) {
    for (const node of list) if (node.status === "streaming") node.status = "stopped";
  }
  chatNext.snapshot = opened.snapshot;
  chatNext.imported = opened.imported;
  chatNext.sidebarOpen = loadLayout().sidebarOpen;
  chatNext.choice = defaultChoice();
  setChatReadyHint(usableProviders().length > 0);
  chatNext.activeId =
    chatNext.snapshot.conversations
      .filter((c) => !c.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
  chatNext.ready = true;
  void refreshKeyStatus();
}

export function setSidebarOpen(open: boolean): void {
  chatNext.sidebarOpen = open;
  saveLayout({ sidebarOpen: open });
}

export function chooseModel(choice: ModelChoice): void {
  chatNext.choice = choice;
  chatNext.compare = chatNext.compare.filter((c) => choiceKey(c) !== choiceKey(choice));
  chatNext.snapshot.settings.defaultProviderId = choice.providerId;
  chatNext.snapshot.settings.defaultModelId = choice.modelId;
  scheduleSave("meta");
}

export function toggleCompare(choice: ModelChoice): void {
  const key = choiceKey(choice);
  if (chatNext.compare.some((c) => choiceKey(c) === key)) {
    chatNext.compare = chatNext.compare.filter((c) => choiceKey(c) !== key);
  } else if (chatNext.compare.length < 2 && key !== choiceKey(chatNext.choice)) {
    chatNext.compare = [...chatNext.compare, choice];
  }
}

export function openSettings(tab: SettingsTab = "providers", memoryDraft = ""): void {
  chatNext.settingsTab = tab;
  chatNext.memoryDraft = memoryDraft;
  chatNext.settingsOpen = true;
}

/* ------------------------------------------------------------------ */
/* Conversations & folders                                             */
/* ------------------------------------------------------------------ */

function liveConversation(id: string): Conversation | undefined {
  return chatNext.snapshot.conversations.find((c) => c.id === id);
}

function liveNode(conversationId: string, nodeId: string): MessageNode | undefined {
  return chatNext.snapshot.nodes[conversationId]?.find((node) => node.id === nodeId);
}

function setNodes(conversationId: string, nodes: MessageNode[]): void {
  chatNext.snapshot.nodes[conversationId] = nodes;
}

function touch(conversation: Conversation, leafId: string | null): void {
  conversation.activeLeafId = leafId;
  conversation.updatedAt = Date.now();
}

/** Leaving a temporary chat discards it. */
function discardTemporary(exceptId: string | null): void {
  const temporary = chatNext.snapshot.conversations.filter((c) => c.temporary && c.id !== exceptId);
  for (const conversation of temporary) {
    stopConversation(conversation.id);
    delete chatNext.snapshot.nodes[conversation.id];
  }
  if (temporary.length > 0) {
    chatNext.snapshot.conversations = chatNext.snapshot.conversations.filter((c) => !c.temporary || c.id === exceptId);
  }
}

export function newConversation(temporary = false, folderId: string | null = null): Conversation {
  const current = activeConversation();
  // Reuse an untouched empty chat instead of stacking blanks.
  if (current && !temporary && !current.temporary && nodesOf(current.id).length === 0 && current.folderId === folderId) {
    return current;
  }
  const now = Date.now();
  const conversation: Conversation = {
    id: uid("conv"),
    title: "",
    createdAt: now,
    updatedAt: now,
    pinned: false,
    archived: false,
    folderId,
    temporary,
    activeLeafId: null,
  };
  discardTemporary(null);
  chatNext.snapshot.conversations.unshift(conversation);
  chatNext.snapshot.nodes[conversation.id] = [];
  chatNext.activeId = conversation.id;
  chatNext.artifactsOpen = false;
  if (!temporary) scheduleSave(conversation.id);
  return conversation;
}

export function selectConversation(id: string): void {
  if (!liveConversation(id)) return;
  discardTemporary(id);
  chatNext.activeId = id;
  chatNext.artifactsOpen = false;
}

function patchConversation(id: string, patch: Partial<Conversation>): void {
  const conversation = liveConversation(id);
  if (!conversation) return;
  Object.assign(conversation, patch);
  if (!conversation.temporary) scheduleSave(id);
}

export function renameConversation(id: string, title: string): void {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean) patchConversation(id, { title: clean.slice(0, 120), titled: true });
}

export function togglePin(id: string): void {
  const conversation = liveConversation(id);
  if (conversation) patchConversation(id, { pinned: !conversation.pinned });
}

export function setArchived(id: string, archived: boolean): void {
  patchConversation(id, { archived, pinned: archived ? false : liveConversation(id)?.pinned ?? false });
  if (archived && chatNext.activeId === id) chatNext.activeId = null;
}

export function moveToFolder(id: string, folderId: string | null): void {
  patchConversation(id, { folderId });
}

export function setConversationSystem(id: string, system: string): void {
  patchConversation(id, { system: system.trim() || undefined });
}

export function setConversationParams(id: string, params: ModelParams): void {
  const clean = mergeParams<ModelParams>(params);
  patchConversation(id, { params: Object.keys(clean).length > 0 ? clean : undefined });
}

export function setConversationAssistant(id: string, assistantId: string | undefined): void {
  patchConversation(id, { assistantId });
  const assistant = chatNext.snapshot.assistants.find((a) => a.id === assistantId);
  if (assistant?.providerId && assistant.modelId) {
    const choice = { providerId: assistant.providerId, modelId: assistant.modelId };
    if (validChoice(choice)) chatNext.choice = choice;
  }
}

export function deleteConversation(id: string): void {
  stopConversation(id);
  chatNext.snapshot.conversations = chatNext.snapshot.conversations.filter((c) => c.id !== id);
  delete chatNext.snapshot.nodes[id];
  if (chatNext.activeId === id) chatNext.activeId = null;
  dirtyConversations.delete(id);
  deletedConversations.add(id);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

/** Copy the branch up to `nodeId` into a new conversation. */
export function forkConversation(nodeId: string, titleSuffix: string): void {
  const source = activeConversation();
  if (!source) return;
  const now = Date.now();
  const id = uid("conv");
  const nodes = forkPath(nodesOf(source.id), nodeId, id, () => uid("msg"));
  if (nodes.length === 0) return;
  const conversation: Conversation = {
    ...$state.snapshot(source),
    id,
    title: `${source.title || titleFromText(nodes[0]?.content ?? "")} ${titleSuffix}`.trim(),
    createdAt: now,
    updatedAt: now,
    pinned: false,
    archived: false,
    temporary: false,
    activeLeafId: nodes[nodes.length - 1]?.id ?? null,
  };
  chatNext.snapshot.conversations.unshift(conversation);
  chatNext.snapshot.nodes[id] = nodes;
  chatNext.activeId = id;
  scheduleSave(id);
}

export function createFolder(name: string): Folder | null {
  const clean = name.trim();
  if (!clean) return null;
  const folder: Folder = { id: uid("folder"), name: clean.slice(0, 60), createdAt: Date.now() };
  chatNext.snapshot.folders.push(folder);
  scheduleSave("meta");
  return folder;
}

export function renameFolder(id: string, name: string): void {
  const folder = chatNext.snapshot.folders.find((f) => f.id === id);
  if (folder && name.trim()) {
    folder.name = name.trim().slice(0, 60);
    scheduleSave("meta");
  }
}

export function deleteFolder(id: string): void {
  chatNext.snapshot.folders = chatNext.snapshot.folders.filter((f) => f.id !== id);
  for (const conversation of chatNext.snapshot.conversations) {
    if (conversation.folderId === id) {
      conversation.folderId = null;
      scheduleSave(conversation.id);
    }
  }
  scheduleSave("meta");
}

/** Merge imported conversations by id (existing ones win). */
export function importConversations(items: readonly ExportedConversation[]): number {
  let added = 0;
  for (const item of items) {
    if (liveConversation(item.conversation.id)) continue;
    chatNext.snapshot.conversations.push({ ...item.conversation, folderId: null });
    chatNext.snapshot.nodes[item.conversation.id] = item.nodes;
    scheduleSave(item.conversation.id);
    added += 1;
  }
  return added;
}

/* ------------------------------------------------------------------ */
/* Messaging                                                           */
/* ------------------------------------------------------------------ */

function addAssistant(conversation: Conversation, parentId: string, choice: ModelChoice | null, group?: string): MessageNode {
  const node: MessageNode = {
    id: uid("msg"),
    conversationId: conversation.id,
    parentId,
    role: "assistant",
    content: "",
    createdAt: Date.now(),
    status: "streaming",
    providerId: choice?.providerId,
    modelId: choice?.modelId,
    compareGroup: group,
  };
  setNodes(conversation.id, appendNode(nodesOf(conversation.id), node));
  return node;
}

function save(conversation: Conversation): void {
  if (!conversation.temporary) scheduleSave(conversation.id);
}

async function maybeCompact(conversationId: string, assistantId: string): Promise<void> {
  const conversation = liveConversation(conversationId);
  const node = liveNode(conversationId, assistantId);
  const window = modelInfo(node)?.caps.contextWindow;
  if (!conversation || !node?.parentId || !window) return;
  const history = pathTo(nodesOf(conversationId), node.parentId);
  if (estimatePathTokens(history, conversation.summaryUntil, conversation.summary) > window * 0.8) {
    await compactConversation(conversationId, node.parentId);
  }
}

async function runTurn(conversationId: string, assistantIds: string[], query: string): Promise<void> {
  if (assistantIds[0]) await maybeCompact(conversationId, assistantIds[0]);
  let sources: SourceRef[] | undefined;
  const ws = chatNext.snapshot.settings.webSearch;
  if (ws?.enabled && ws.provider !== "off" && webSearchReady() && query.trim()) {
    chatNext.searching = [...chatNext.searching, ...assistantIds];
    try {
      sources = await runWebSearch(
        query,
        { provider: ws.provider, url: ws.url, resultCount: ws.resultCount, apiKey: await secrets.get(WEB_SEARCH_SECRET_REF) },
        await platformFetch(),
      );
    } catch (error) {
      pushToast("warning", t("chatNext.searchFailed", { detail: errorMessage(error) }));
    } finally {
      chatNext.searching = chatNext.searching.filter((id) => !assistantIds.includes(id));
    }
  }
  for (const id of assistantIds) {
    const node = liveNode(conversationId, id);
    if (node && sources?.length) node.sources = sources;
  }
  await Promise.all(assistantIds.map((id) => generate(conversationId, id, sources ?? [])));
}

/** Send a new user message on the visible branch (optionally to several models). */
export function sendMessage(text: string, attachments: AttachmentRef[] = []): void {
  const content = text.trim();
  if (!content && attachments.length === 0) return;
  const conversation = activeConversation() ?? newConversation();
  const user: MessageNode = {
    id: uid("msg"),
    conversationId: conversation.id,
    parentId: conversation.activeLeafId,
    role: "user",
    content,
    createdAt: Date.now(),
    status: "ok",
    attachments: attachments.length > 0 ? attachments : undefined,
  };
  setNodes(conversation.id, appendNode(nodesOf(conversation.id), user));
  if (!conversation.title) conversation.title = titleFromText(content || attachments[0]?.name || "");
  const targets = [chatNext.choice, ...chatNext.compare].filter(
    (c, i, all): c is ModelChoice => Boolean(c) && all.findIndex((o) => choiceKey(o) === choiceKey(c)) === i,
  );
  const group = targets.length > 1 ? uid("cmp") : undefined;
  const assistants = (targets.length > 0 ? targets : [null]).map((choice) => addAssistant(conversation, user.id, choice, group));
  touch(conversation, assistants[0]?.id ?? user.id);
  save(conversation);
  void runTurn(conversation.id, assistants.map((a) => a.id), content);
}

/** New answer as a sibling of an existing assistant node (current model, or `choice`). */
export function regenerate(assistantId: string, choice: ModelChoice | null = chatNext.choice): string | null {
  const conversation = activeConversation();
  const target = conversation ? liveNode(conversation.id, assistantId) : undefined;
  if (!conversation || !target?.parentId || target.role !== "assistant") return null;
  const parent = liveNode(conversation.id, target.parentId);
  const assistant = addAssistant(conversation, target.parentId, choice);
  touch(conversation, assistant.id);
  save(conversation);
  void runTurn(conversation.id, [assistant.id], parent?.content ?? "");
  return assistant.id;
}

/** Re-run a failed answer with the same model and drop the failed one. */
export function retry(assistantId: string): void {
  const conversation = activeConversation();
  const failed = conversation ? liveNode(conversation.id, assistantId) : undefined;
  if (!conversation || !failed) return;
  const choice =
    failed.providerId && failed.modelId && validChoice({ providerId: failed.providerId, modelId: failed.modelId })
      ? { providerId: failed.providerId, modelId: failed.modelId }
      : chatNext.choice;
  const fresh = regenerate(assistantId, choice);
  if (!fresh) return;
  setNodes(conversation.id, removeSubtree(nodesOf(conversation.id), assistantId).nodes);
  conversation.activeLeafId = fresh;
  save(conversation);
}

/** Keep writing a stopped or length-truncated answer in place. */
export function continueAnswer(assistantId: string): void {
  const conversation = activeConversation();
  const node = conversation ? liveNode(conversation.id, assistantId) : undefined;
  if (!conversation || !node || node.role !== "assistant" || !node.content || isStreaming()) return;
  node.status = "streaming";
  node.error = undefined;
  node.finishReason = undefined;
  void generate(conversation.id, assistantId, node.sources ?? [], { continuing: true });
}

/** Ask the composer's owner to open the editor on a message. */
export function requestEdit(nodeId: string | null): void {
  chatNext.editRequest = nodeId;
}

/**
 * Summarise the older part of the visible branch into conversation.summary.
 * `leafId` defaults to the conversation's active leaf.
 */
export async function compactConversation(conversationId = chatNext.activeId, leafId?: string): Promise<boolean> {
  const conversation = conversationId ? liveConversation(conversationId) : undefined;
  const choice = chatNext.choice;
  const provider = chatNext.snapshot.providers.find((p) => p.id === choice?.providerId);
  if (!conversation || !choice || !provider || chatNext.compacting) return false;
  const path = pathTo(nodesOf(conversation.id), leafId ?? conversation.activeLeafId);
  const plan = compactionPlan(path, conversation.summaryUntil);
  if (!plan) return false;
  chatNext.compacting = conversation.id;
  try {
    const { generateText } = await import("ai");
    const model = await createLanguageModel(provider, choice.modelId, await secrets.get(provider.secretRef), await platformFetch());
    const result = await generateText({
      model,
      instructions: COMPACT_INSTRUCTIONS,
      prompt: compactionTranscript(conversation.summaryUntil ? conversation.summary : undefined, plan.older),
      maxOutputTokens: 1500,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(90_000),
    });
    const summary = result.text.trim();
    if (!summary) return false;
    conversation.summary = summary;
    conversation.summaryUntil = plan.until;
    save(conversation);
    pushToast("success", t("chatNext.compacted", { count: plan.older.length }));
    return true;
  } catch (error) {
    pushToast("error", t("chatNext.compactFailed", { detail: errorMessage(error) }));
    return false;
  } finally {
    chatNext.compacting = null;
  }
}

/** Forget the summary so the full branch is sent again. */
export function clearSummary(conversationId: string): void {
  patchConversation(conversationId, { summary: undefined, summaryUntil: undefined });
}

/** Edit a user message: a new sibling branch, answered immediately. */
export function editAndResend(userId: string, text: string): void {
  const conversation = activeConversation();
  const original = conversation ? liveNode(conversation.id, userId) : undefined;
  const content = text.trim();
  if (!conversation || !original || original.role !== "user" || !content) return;
  const user: MessageNode = {
    id: uid("msg"),
    conversationId: conversation.id,
    parentId: original.parentId,
    role: "user",
    content,
    createdAt: Date.now(),
    status: "ok",
    attachments: original.attachments,
  };
  setNodes(conversation.id, appendNode(nodesOf(conversation.id), user));
  const assistant = addAssistant(conversation, user.id, chatNext.choice);
  touch(conversation, assistant.id);
  save(conversation);
  void runTurn(conversation.id, [assistant.id], content);
}

export function switchBranch(nodeId: string, delta: number): void {
  const conversation = activeConversation();
  if (!conversation) return;
  const leaf = switchSibling(nodesOf(conversation.id), nodeId, delta);
  if (leaf) {
    conversation.activeLeafId = leaf;
    save(conversation);
  }
}

/** Continue the conversation from one of the side-by-side answers. */
export function chooseAnswer(nodeId: string): void {
  const conversation = activeConversation();
  if (!conversation) return;
  conversation.activeLeafId = latestLeaf(nodesOf(conversation.id), nodeId);
  save(conversation);
}

export function deleteMessage(nodeId: string): void {
  const conversation = activeConversation();
  if (!conversation) return;
  const removed = removeSubtree(nodesOf(conversation.id), nodeId);
  for (const id of chatNext.streaming) if (!removed.nodes.some((n) => n.id === id)) controllers.get(id)?.abort();
  setNodes(conversation.id, removed.nodes);
  touch(conversation, removed.activeLeafId);
  save(conversation);
}

export function stopConversation(conversationId?: string): void {
  const id = conversationId ?? chatNext.activeId;
  for (const nodeId of chatNext.streaming) {
    if (!id || chatNext.snapshot.nodes[id]?.some((n) => n.id === nodeId)) controllers.get(nodeId)?.abort();
  }
}

export function resolveApproval(id: string, allowed: boolean): void {
  approvalResolvers.get(id)?.(allowed);
}

function requestApproval(nodeId: string, signal: AbortSignal, request: Omit<PendingApproval, "id" | "nodeId">): Promise<boolean> {
  const id = uid("approval");
  chatNext.approvals = [...chatNext.approvals, { id, nodeId, ...request }];
  return new Promise<boolean>((resolve) => {
    const done = (allowed: boolean) => {
      approvalResolvers.delete(id);
      chatNext.approvals = chatNext.approvals.filter((a) => a.id !== id);
      signal.removeEventListener("abort", onAbort);
      resolve(allowed);
    };
    const onAbort = () => done(false);
    signal.addEventListener("abort", onAbort);
    approvalResolvers.set(id, done);
  });
}

function effectiveSystem(conversation: Conversation): string | undefined {
  const assistant = chatNext.snapshot.assistants.find((a) => a.id === conversation.assistantId);
  return conversation.system || assistant?.system || chatNext.snapshot.settings.systemPrompt;
}

function effectiveParams(conversation: Conversation): ChatSettings["params"] {
  const assistant = chatNext.snapshot.assistants.find((a) => a.id === conversation.assistantId);
  return mergeParams<ModelParams>(chatNext.snapshot.settings.params, assistant?.params, conversation.params);
}

async function autoTitle(conversationId: string, assistantId: string): Promise<void> {
  const conversation = liveConversation(conversationId);
  const answer = liveNode(conversationId, assistantId);
  if (!conversation || conversation.titled || !answer?.content || chatNext.snapshot.settings.autoTitle === false) return;
  const provider = chatNext.snapshot.providers.find((p) => p.id === answer.providerId);
  if (!provider || !answer.modelId) return;
  conversation.titled = true;
  const question = answer.parentId ? liveNode(conversationId, answer.parentId)?.content ?? "" : "";
  try {
    const { generateText } = await import("ai");
    const model = await createLanguageModel(provider, answer.modelId, await secrets.get(provider.secretRef), await platformFetch());
    const result = await generateText({
      model,
      instructions: TITLE_INSTRUCTIONS,
      prompt: `User: ${question.slice(0, 1500)}\n\nAssistant: ${answer.content.slice(0, 1500)}`,
      maxOutputTokens: 60,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(20_000),
    });
    const title = sanitizeTitle(result.text);
    if (title) conversation.title = title;
  } catch {
    /* keep the fallback title */
  }
  save(conversation);
}

async function generate(
  conversationId: string,
  assistantId: string,
  sources: SourceRef[],
  options: { continuing?: boolean } = {},
): Promise<void> {
  const conversation = liveConversation(conversationId);
  const node = liveNode(conversationId, assistantId);
  if (!conversation || !node) return;
  const baseText = options.continuing ? node.content : "";
  const baseReasoning = options.continuing ? node.reasoning ?? "" : "";
  const baseTools = options.continuing ? node.tools ?? [] : [];

  const controller = new AbortController();
  controllers.set(assistantId, controller);
  chatNext.streaming = [...chatNext.streaming, assistantId];
  let session: McpSession | null = null;

  const finish = (patch: Partial<MessageNode>) => {
    const live = liveNode(conversationId, assistantId);
    if (live) Object.assign(live, patch);
    chatNext.streaming = chatNext.streaming.filter((id) => id !== assistantId);
    controllers.delete(assistantId);
    const owner = liveConversation(conversationId);
    if (owner) {
      owner.updatedAt = Date.now();
      save(owner);
    }
  };

  const provider = chatNext.snapshot.providers.find((p) => p.id === node.providerId);
  if (!provider || !node.modelId) {
    finish({ status: "error", error: "no-provider" });
    return;
  }

  try {
    const fetchFn = await platformFetch();
    const [{ streamText, isStepCount }, model] = await Promise.all([
      import("ai"),
      createLanguageModel(provider, node.modelId, await secrets.get(provider.secretRef), fetchFn),
    ]);
    const caps = modelInfo(node)?.caps;
    const history = node.parentId ? pathTo(nodesOf(conversationId), node.parentId) : [];
    const settings = chatNext.snapshot.settings;
    const prompt = buildPrompt(history, {
      system: effectiveSystem(conversation),
      summary: conversation.summary,
      summaryUntil: conversation.summaryUntil,
      vision: caps?.vision ?? false,
      extra: [
        settings.memoryEnabled === false ? undefined : memoryInstructions(chatNext.snapshot.memories),
        searchInstructions(sources),
      ],
    });

    if (options.continuing) {
      prompt.messages.push({ role: "assistant", content: baseText }, { role: "user", content: CONTINUE_PROMPT });
    }

    let tools: ToolSet | undefined;
    const servers = chatNext.snapshot.mcpServers.filter((s) => s.enabled);
    if (caps?.tools && servers.length > 0) {
      const { connectMcp } = await import("../core/mcp.js");
      session = await connectMcp(servers, fetchFn, (request) => requestApproval(assistantId, controller.signal, request));
      for (const failure of session.failures) pushToast("warning", t("chatNext.mcpFailed", { name: failure.name, detail: failure.error }));
      if (Object.keys(session.tools).length > 0) tools = session.tools;
    }

    const params = effectiveParams(conversation);
    const result = streamText({
      model,
      instructions: prompt.instructions,
      messages: prompt.messages,
      abortSignal: controller.signal,
      temperature: params.temperature,
      maxOutputTokens: params.maxOutputTokens,
      topP: params.topP,
      maxRetries: 1,
      tools,
      stopWhen: tools ? isStepCount(6) : undefined,
      // Errors are delivered as `error` parts on fullStream.
      onError: () => {},
    });
    const outcome = await consumeStream(result.fullStream as AsyncIterable<StreamPart>, {
      onText: (delta) => {
        const live = liveNode(conversationId, assistantId);
        if (live) live.content += delta;
      },
      onReasoning: (delta) => {
        const live = liveNode(conversationId, assistantId);
        if (live) live.reasoning = (live.reasoning ?? "") + delta;
      },
      onTool: (record) => {
        const live = liveNode(conversationId, assistantId);
        if (!live) return;
        const list = live.tools ?? baseTools;
        const index = list.findIndex((t) => t.id === record.id);
        live.tools = index >= 0 ? list.map((t, i) => (i === index ? record : t)) : [...list, record];
      },
    });
    const merged = [...sources, ...outcome.sources.filter((s) => !sources.some((o) => o.url === s.url))];
    const allTools = [...baseTools, ...outcome.tools.filter((t) => !baseTools.some((b) => b.id === t.id))];
    finish({
      status: outcome.status,
      content: baseText + outcome.text,
      reasoning: baseReasoning + outcome.reasoning || undefined,
      reasoningMs: outcome.reasoningMs ?? node.reasoningMs,
      sources: merged.length > 0 ? merged : undefined,
      tools: allTools.length > 0 ? allTools : undefined,
      usage: outcome.usage,
      error: outcome.error,
      finishReason: outcome.finishReason,
    });
    if (outcome.status === "ok") void autoTitle(conversationId, assistantId);
  } catch (error) {
    finish({
      status: controller.signal.aborted ? "stopped" : "error",
      error: error instanceof MissingApiKeyError ? "no-key" : errorMessage(error),
    });
  } finally {
    await session?.close();
  }
}

/* ------------------------------------------------------------------ */
/* Providers & models                                                  */
/* ------------------------------------------------------------------ */

const KIND_DEFAULTS: Record<ProviderKind, { name: string; baseUrl: string }> = {
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  "openai-compatible": { name: "OpenAI-compatible", baseUrl: "" },
  anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  google: { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  ollama: { name: "Ollama", baseUrl: "http://localhost:11434" },
};

export function addProvider(kind: ProviderKind, preset?: { name: string; baseUrl: string }): ProviderConfig {
  const id = uid("provider");
  const defaults = preset ?? KIND_DEFAULTS[kind];
  const provider: ProviderConfig = {
    id,
    name: defaults.name,
    kind,
    baseUrl: defaults.baseUrl,
    secretRef: `provider:${id}`,
    models: [],
    enabled: true,
  };
  chatNext.snapshot.providers.push(provider);
  scheduleSave("meta");
  return provider;
}

export function saveProvider(provider: ProviderConfig): void {
  const index = chatNext.snapshot.providers.findIndex((p) => p.id === provider.id);
  if (index < 0) return;
  chatNext.snapshot.providers[index] = provider;
  repairChoice();
  scheduleSave("meta");
}

export async function deleteProvider(id: string): Promise<void> {
  const provider = chatNext.snapshot.providers.find((p) => p.id === id);
  chatNext.snapshot.providers = chatNext.snapshot.providers.filter((p) => p.id !== id);
  repairChoice();
  scheduleSave("meta");
  if (provider) {
    try {
      await secrets.remove(provider.secretRef);
    } catch {
      /* keychain unavailable */
    }
  }
  await refreshKeyStatus();
}

export async function setProviderKey(id: string, key: string): Promise<void> {
  const provider = chatNext.snapshot.providers.find((p) => p.id === id);
  if (!provider) return;
  await secrets.set(provider.secretRef, key.trim());
  await refreshKeyStatus();
}

export async function setWebSearchKey(key: string): Promise<void> {
  await secrets.set(WEB_SEARCH_SECRET_REF, key.trim());
  const ws = chatNext.snapshot.settings.webSearch;
  if (ws) ws.secretRef = key.trim() ? WEB_SEARCH_SECRET_REF : undefined;
  scheduleSave("meta");
  await refreshKeyStatus();
}

/** Fetch the provider's model list and merge it (keeps edited capabilities). */
export async function refreshModels(id: string): Promise<{ count: number; baseUrlFixed?: string }> {
  const provider = chatNext.snapshot.providers.find((p) => p.id === id);
  if (!provider) return { count: 0 };
  const result = await fetchModelIds($state.snapshot(provider), await secrets.get(provider.secretRef), await platformFetch());
  if (result.suggestedBaseUrl) provider.baseUrl = result.suggestedBaseUrl;
  provider.models = mergeModels(provider.models, result.ids);
  repairChoice();
  scheduleSave("meta");
  return { count: result.ids.length, baseUrlFixed: result.suggestedBaseUrl };
}

export function updateSettings(patch: Partial<ChatSettings>): void {
  Object.assign(chatNext.snapshot.settings, patch);
  scheduleSave("meta");
}

/* ------------------------------------------------------------------ */
/* Assistants, prompts, memory, MCP                                    */
/* ------------------------------------------------------------------ */

function upsert<T extends { id: string }>(list: T[], item: T): void {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

export function saveAssistant(assistant: Assistant): void {
  upsert(chatNext.snapshot.assistants, assistant);
  scheduleSave("meta");
}

export function deleteAssistant(id: string): void {
  chatNext.snapshot.assistants = chatNext.snapshot.assistants.filter((a) => a.id !== id);
  for (const conversation of chatNext.snapshot.conversations) {
    if (conversation.assistantId === id) {
      conversation.assistantId = undefined;
      save(conversation);
    }
  }
  scheduleSave("meta");
}

export function savePrompt(prompt: PromptTemplate): void {
  upsert(chatNext.snapshot.prompts, prompt);
  scheduleSave("meta");
}

export function deletePrompt(id: string): void {
  chatNext.snapshot.prompts = chatNext.snapshot.prompts.filter((p) => p.id !== id);
  scheduleSave("meta");
}

export function addMemory(text: string): void {
  const clean = text.trim();
  if (!clean) return;
  chatNext.snapshot.memories.push({ id: uid("mem"), text: clean.slice(0, 1000), createdAt: Date.now() });
  scheduleSave("meta");
}

export function deleteMemory(id: string): void {
  chatNext.snapshot.memories = chatNext.snapshot.memories.filter((m) => m.id !== id);
  scheduleSave("meta");
}

export function saveMcpServer(server: McpServerConfig): void {
  upsert(chatNext.snapshot.mcpServers, server);
  scheduleSave("meta");
}

export function deleteMcpServer(id: string): void {
  chatNext.snapshot.mcpServers = chatNext.snapshot.mcpServers.filter((s) => s.id !== id);
  scheduleSave("meta");
}

export async function testMcpServer(server: McpServerConfig): Promise<string[]> {
  const { probeMcp } = await import("../core/mcp.js");
  return probeMcp(server, await platformFetch());
}
