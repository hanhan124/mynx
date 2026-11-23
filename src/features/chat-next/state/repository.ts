/**
 * Storage adapters for chat-next.
 *
 * - Desktop (Tauri): SQLite via `chat_store_*` commands, API keys in the OS
 *   keychain via `chat_secret_*`. Writes are incremental: only conversations
 *   that changed are rewritten.
 * - Browser preview / tests: one localStorage snapshot, keys in memory.
 *
 * Chat-next owns its providers and settings. The legacy chat config is read
 * only to seed them on first open. Once its API keys are safely in the OS
 * keychain they are removed from that localStorage entry.
 */
import { invoke } from "@tauri-apps/api/core";
import {
  CHAT_STORE_VERSION,
  emptySnapshot,
  type ChatSettings,
  type ChatSnapshot,
  type Conversation,
  type MessageNode,
} from "../core/types.js";
import { LEGACY_CONFIG_KEY, LEGACY_MIGRATION_MARKER, LEGACY_SESSIONS_KEY, migrateLegacy } from "../core/migrate.js";

/** localStorage key of the browser-preview snapshot (also phase-0 data). */
export const SNAPSHOT_KEY = "mynx-chat-next-snapshot";
const KEYS_MIGRATED_MARKER = "mynx-chat-next-keys-v1";
const META_KEYS = ["folders", "assistants", "providers", "prompts", "memories", "mcpServers", "settings"] as const;

export interface SnapshotChanges {
  conversations: string[];
  deleted: string[];
  meta: boolean;
}

export interface ChatRepository {
  load(): Promise<ChatSnapshot | null>;
  save(snapshot: ChatSnapshot, changes: SnapshotChanges): Promise<void>;
}

export interface SecretStore {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  remove(ref: string): Promise<void>;
}

function read(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    /* quota or storage unavailable: keep the in-memory state */
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Drop temporary chats and their nodes before persisting. */
export function persistable(snapshot: ChatSnapshot): ChatSnapshot {
  const kept = snapshot.conversations.filter((conversation) => !conversation.temporary);
  const ids = new Set(kept.map((conversation) => conversation.id));
  return {
    ...snapshot,
    conversations: kept,
    nodes: Object.fromEntries(Object.entries(snapshot.nodes).filter(([id]) => ids.has(id))),
  };
}

function arrayOr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function parseSnapshot(json: string | null): ChatSnapshot | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<ChatSnapshot>;
    if (parsed.version !== CHAT_STORE_VERSION || !Array.isArray(parsed.conversations)) return null;
    return {
      ...emptySnapshot(),
      conversations: parsed.conversations,
      nodes: parsed.nodes && typeof parsed.nodes === "object" ? parsed.nodes : {},
      folders: arrayOr(parsed.folders),
      assistants: arrayOr(parsed.assistants),
      providers: arrayOr(parsed.providers),
      prompts: arrayOr(parsed.prompts),
      memories: arrayOr(parsed.memories),
      mcpServers: arrayOr(parsed.mcpServers),
      settings: parsed.settings ?? { params: {} },
    };
  } catch {
    return null;
  }
}

/** SQLite dump (opaque documents) → snapshot. Exported for tests. */
export interface ChatDump {
  conversations: unknown[];
  nodes: Record<string, unknown[]>;
  meta: Record<string, unknown>;
}

export function snapshotFromDump(dump: ChatDump): ChatSnapshot | null {
  const conversations = dump.conversations.filter(
    (c): c is Conversation => typeof c === "object" && c !== null && typeof (c as Conversation).id === "string",
  );
  if (conversations.length === 0 && Object.keys(dump.meta).length === 0) return null;
  const nodes: Record<string, MessageNode[]> = {};
  for (const conversation of conversations) {
    nodes[conversation.id] = (dump.nodes[conversation.id] ?? []) as MessageNode[];
  }
  const settings = dump.meta.settings;
  return {
    ...emptySnapshot(),
    conversations,
    nodes,
    folders: arrayOr(dump.meta.folders),
    assistants: arrayOr(dump.meta.assistants),
    providers: arrayOr(dump.meta.providers),
    prompts: arrayOr(dump.meta.prompts),
    memories: arrayOr(dump.meta.memories),
    mcpServers: arrayOr(dump.meta.mcpServers),
    settings: settings && typeof settings === "object" ? (settings as ChatSettings) : { params: {} },
  };
}

export const localRepository: ChatRepository = {
  load: async () => parseSnapshot(read(SNAPSHOT_KEY)),
  save: async (snapshot) => write(SNAPSHOT_KEY, JSON.stringify(persistable(snapshot))),
};

export const sqliteRepository: ChatRepository = {
  async load() {
    return snapshotFromDump(await invoke<ChatDump>("chat_store_load"));
  },
  async save(snapshot, changes) {
    for (const id of changes.deleted) {
      await invoke("chat_store_delete_conversation", { id });
    }
    for (const id of changes.conversations) {
      const conversation = snapshot.conversations.find((c) => c.id === id);
      if (!conversation || conversation.temporary) continue;
      await invoke("chat_store_put_conversation", { conversation, nodes: snapshot.nodes[id] ?? [] });
    }
    if (changes.meta) {
      for (const key of META_KEYS) {
        await invoke("chat_store_put_meta", { key, value: snapshot[key] });
      }
    }
  },
};

/** Keychain on desktop (legacy keys as a read fallback); memory elsewhere. */
function secretStore(legacy: Record<string, string>): SecretStore {
  const tauri = isTauri();
  const memory: Record<string, string> = {};
  // Legacy keys are a fallback only until they were copied into the keychain;
  // afterwards a key the user cleared must stay cleared.
  const legacyFallback = (ref: string) => (read(KEYS_MIGRATED_MARKER) === "1" ? undefined : legacy[ref]);
  return {
    async get(ref) {
      if (!tauri) return memory[ref] ?? legacy[ref];
      try {
        const stored = await invoke<string | null>("chat_secret_get", { name: ref });
        if (stored) return stored;
      } catch {
        /* keychain unavailable */
      }
      return legacyFallback(ref);
    },
    async set(ref, value) {
      if (!value) {
        await this.remove(ref);
        return;
      }
      if (tauri) await invoke("chat_secret_set", { name: ref, value });
      else memory[ref] = value;
    },
    async remove(ref) {
      delete memory[ref];
      delete legacy[ref];
      if (tauri) await invoke("chat_secret_delete", { name: ref });
    },
  };
}

function allChanges(snapshot: ChatSnapshot): SnapshotChanges {
  return { conversations: snapshot.conversations.map((c) => c.id), deleted: [], meta: true };
}

/**
 * Open the store. First open seeds from the phase-0 preview snapshot, else
 * from the legacy chat. Providers/settings seed from the legacy config only
 * while chat-next has none of its own. Legacy keys are copied into the
 * keychain once and never deleted.
 */
export async function openSnapshot(repository: ChatRepository = isTauri() ? sqliteRepository : localRepository): Promise<{
  snapshot: ChatSnapshot;
  secrets: SecretStore;
  imported: number | null;
  repository: ChatRepository;
}> {
  const legacyConfig = read(LEGACY_CONFIG_KEY);
  const fromConfig = migrateLegacy(null, legacyConfig);
  const secrets = secretStore({ ...fromConfig.secrets });

  let snapshot = await repository.load();
  let imported: number | null = null;
  let fresh = false;
  if (!snapshot) {
    const preview = repository === localRepository ? null : parseSnapshot(read(SNAPSHOT_KEY));
    if (preview) {
      snapshot = preview;
    } else {
      const migrated = migrateLegacy(read(LEGACY_SESSIONS_KEY), legacyConfig);
      snapshot = migrated.snapshot;
      imported = migrated.report.conversations;
    }
    fresh = true;
    write(LEGACY_MIGRATION_MARKER, String(Date.now()));
  }

  if (snapshot.providers.length > 0 && !snapshot.settings.legacySeeded) {
    snapshot = { ...snapshot, settings: { ...snapshot.settings, legacySeeded: true } };
    fresh = true;
  } else if (!snapshot.settings.legacySeeded && fromConfig.snapshot.providers.length > 0) {
    snapshot = {
      ...snapshot,
      providers: fromConfig.snapshot.providers,
      settings: {
        ...fromConfig.snapshot.settings,
        ...snapshot.settings,
        defaultProviderId: snapshot.settings.defaultProviderId ?? fromConfig.snapshot.settings.defaultProviderId,
        defaultModelId: snapshot.settings.defaultModelId ?? fromConfig.snapshot.settings.defaultModelId,
        systemPrompt: snapshot.settings.systemPrompt ?? fromConfig.snapshot.settings.systemPrompt,
        webSearch: snapshot.settings.webSearch ?? fromConfig.snapshot.settings.webSearch,
        legacySeeded: true,
      },
    };
    fresh = true;
  }
  if (fresh) await repository.save(snapshot, allChanges(snapshot));

  if (isTauri() && read(KEYS_MIGRATED_MARKER) !== "1") {
    let ok = true;
    for (const [ref, value] of Object.entries(fromConfig.secrets)) {
      try {
        const existing = await invoke<string | null>("chat_secret_get", { name: ref });
        if (!existing) await invoke("chat_secret_set", { name: ref, value });
      } catch {
        ok = false; // keychain unavailable: the legacy config still holds the key
      }
    }
    if (ok) write(KEYS_MIGRATED_MARKER, "1");
  }
  if (isTauri() && read(KEYS_MIGRATED_MARKER) === "1") scrubLegacySecrets();
  return { snapshot, secrets, imported, repository };
}

/**
 * Remove API keys from the legacy chat config in localStorage. Only called
 * after every key was copied into the keychain; the rest of the config
 * (providers, models, prompts) stays readable for the one-time import.
 */
export function scrubLegacySecrets(): void {
  const json = read(LEGACY_CONFIG_KEY);
  if (!json) return;
  try {
    const config: unknown = JSON.parse(json);
    if (!config || typeof config !== "object") return;
    let changed = false;
    const strip = (entry: unknown): void => {
      if (entry && typeof entry === "object" && "apiKey" in entry) {
        delete (entry as Record<string, unknown>).apiKey;
        changed = true;
      }
    };
    const record = config as Record<string, unknown>;
    strip(record);
    if (Array.isArray(record.providers)) record.providers.forEach(strip);
    strip(record.webSearch);
    if (changed) write(LEGACY_CONFIG_KEY, JSON.stringify(record));
  } catch {
    /* unreadable legacy config: leave it untouched */
  }
}

/* ------------------------------------------------------------------ */
/* Small UI-side persistence (drafts, layout)                          */
/* ------------------------------------------------------------------ */

const DRAFTS_KEY = "mynx-chat-next-drafts";
const LAYOUT_KEY = "mynx-chat-next-layout";

export function loadDrafts(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(read(DRAFTS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveDrafts(drafts: Record<string, string>): void {
  const kept = Object.fromEntries(Object.entries(drafts).filter(([, text]) => text.trim()).slice(-50));
  write(DRAFTS_KEY, JSON.stringify(kept));
}

export function loadLayout(): { sidebarOpen: boolean } {
  try {
    const parsed = JSON.parse(read(LAYOUT_KEY) ?? "{}") as { sidebarOpen?: unknown };
    return { sidebarOpen: parsed.sidebarOpen !== false };
  } catch {
    return { sidebarOpen: true };
  }
}

export function saveLayout(layout: { sidebarOpen: boolean }): void {
  write(LAYOUT_KEY, JSON.stringify(layout));
}
