/**
 * Lightweight bridge between the rest of the app and the chat page.
 * No AI SDK / store imports: the home page and settings page load this
 * without pulling in the chat chunk.
 */
import { LEGACY_CONFIG_KEY } from "./core/migrate.js";

const READY_KEY = "mynx-chat-ready";

let pendingPrompt: string | null = null;
let pendingSettings = false;

/** Home search box → chat: send this as the first message of a new chat. */
export function queuePendingPrompt(prompt: string): void {
  pendingPrompt = prompt.trim() || null;
}

export function consumePendingPrompt(): string | null {
  const prompt = pendingPrompt;
  pendingPrompt = null;
  return prompt;
}

/** App settings → chat: open the chat settings sheet on arrival. */
export function requestChatSettings(): void {
  pendingSettings = true;
}

export function consumeSettingsRequest(): boolean {
  const requested = pendingSettings;
  pendingSettings = false;
  return requested;
}

function read(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The chat store records whether at least one model is usable. */
export function setChatReadyHint(ready: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(READY_KEY, ready ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

/** True when a legacy chat config has a provider with an address and a model. */
export function legacyConfigured(json: string | null): boolean {
  if (!json) return false;
  try {
    const config = JSON.parse(json) as {
      baseUrl?: unknown;
      model?: unknown;
      providers?: Array<{ baseUrl?: unknown; model?: unknown }>;
    };
    const usable = (entry: { baseUrl?: unknown; model?: unknown } | undefined) =>
      Boolean(entry && String(entry.baseUrl ?? "").trim() && String(entry.model ?? "").trim());
    return (Array.isArray(config.providers) && config.providers.some(usable)) || usable(config);
  } catch {
    return false;
  }
}

/** Whether the home search box may hand a sentence to the chat. */
export function isChatConfigured(): boolean {
  const hint = read(READY_KEY);
  if (hint !== null) return hint === "1";
  // Chat never opened yet: the first open imports the legacy config.
  return legacyConfigured(read(LEGACY_CONFIG_KEY));
}

export type SubmitIntent =
  | { kind: "none" }
  | { kind: "tool"; route: string }
  | { kind: "chat" }
  | { kind: "search" };

/** Home search box routing: tool hit → tool page, else chat when configured, else web search. */
export function resolveSubmitIntent(
  query: string,
  tools: Array<{ route: string; title: string }>,
  configured: boolean,
): SubmitIntent {
  const trimmed = query.trim();
  if (!trimmed) return { kind: "none" };
  const needle = trimmed.toLowerCase();
  const hit = tools.find(
    (tool) => tool.title.toLowerCase().includes(needle) || tool.route.toLowerCase().includes(needle),
  );
  if (hit) return { kind: "tool", route: hit.route };
  return configured ? { kind: "chat" } : { kind: "search" };
}
