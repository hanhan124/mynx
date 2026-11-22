/**
 * Normalises an AI SDK `fullStream` into chat-next events. Pure over an
 * async iterable, so it is unit-tested with fake streams (no network).
 * Only the part shapes used here are typed; unknown parts are ignored.
 */
import type { SourceRef, TokenUsage, ToolCallRecord } from "./types.js";

export type StreamPart =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-start" }
  | { type: "reasoning-delta"; text: string }
  | { type: "reasoning-end" }
  | { type: "source"; sourceType: string; url?: string; title?: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; output: unknown }
  | { type: "tool-error"; toolCallId: string; error: unknown }
  | {
      type: "finish";
      finishReason?: string;
      totalUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        outputTokenDetails?: { reasoningTokens?: number };
      };
    }
  | { type: "error"; error: unknown }
  | { type: "abort" }
  | { type: string };

export interface StreamHandlers {
  onText?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onSource?: (source: SourceRef) => void;
  onTool?: (record: ToolCallRecord) => void;
}

export interface StreamOutcome {
  status: "ok" | "stopped" | "error";
  text: string;
  reasoning: string;
  reasoningMs?: number;
  sources: SourceRef[];
  tools: ToolCallRecord[];
  usage?: TokenUsage;
  error?: string;
  finishReason?: string;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const nested = record.message ?? (record.error as Record<string, unknown> | undefined)?.message;
    if (typeof nested === "string" && nested) return nested;
  }
  return "unknown error";
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message));
}

export async function consumeStream(
  stream: AsyncIterable<StreamPart>,
  handlers: StreamHandlers = {},
  now: () => number = () => Date.now(),
): Promise<StreamOutcome> {
  let text = "";
  let reasoning = "";
  let reasoningMs = 0;
  let reasoningStartedAt: number | null = null;
  let usage: TokenUsage | undefined;
  let status: StreamOutcome["status"] = "ok";
  let failure: string | undefined;
  let finishReason: string | undefined;
  const sources: SourceRef[] = [];
  const tools: ToolCallRecord[] = [];

  const upsertTool = (id: string, patch: Partial<ToolCallRecord>) => {
    let record = tools.find((t) => t.id === id);
    if (!record) tools.push((record = { id, name: "tool", input: undefined, status: "running" }));
    Object.assign(record, patch);
    handlers.onTool?.({ ...record });
  };

  const closeReasoning = () => {
    if (reasoningStartedAt !== null) {
      reasoningMs += Math.max(0, now() - reasoningStartedAt);
      reasoningStartedAt = null;
    }
  };

  try {
    for await (const part of stream) {
      switch (part.type) {
        case "text-delta": {
          const delta = (part as { text: string }).text ?? "";
          if (!delta) break;
          closeReasoning();
          text += delta;
          handlers.onText?.(delta);
          break;
        }
        case "reasoning-start":
          if (reasoningStartedAt === null) reasoningStartedAt = now();
          break;
        case "reasoning-delta": {
          const delta = (part as { text: string }).text ?? "";
          if (reasoningStartedAt === null) reasoningStartedAt = now();
          reasoning += delta;
          if (delta) handlers.onReasoning?.(delta);
          break;
        }
        case "reasoning-end":
          closeReasoning();
          break;
        case "source": {
          const source = part as { sourceType: string; url?: string; title?: string };
          if (source.sourceType === "url" && source.url && /^https?:\/\//i.test(source.url)) {
            if (!sources.some((existing) => existing.url === source.url)) {
              const ref = { title: source.title || source.url, url: source.url, snippet: "" };
              sources.push(ref);
              handlers.onSource?.(ref);
            }
          }
          break;
        }
        case "tool-call": {
          const call = part as Extract<StreamPart, { type: "tool-call" }>;
          upsertTool(call.toolCallId, { name: call.toolName, input: call.input, status: "running" });
          break;
        }
        case "tool-result": {
          const result = part as Extract<StreamPart, { type: "tool-result" }>;
          upsertTool(result.toolCallId, { output: result.output, status: "done" });
          break;
        }
        case "tool-error": {
          const result = part as Extract<StreamPart, { type: "tool-error" }>;
          const message = errorMessage(result.error);
          upsertTool(result.toolCallId, { error: message, status: /denied/i.test(message) ? "denied" : "error" });
          break;
        }
        case "finish": {
          const finish = part as Extract<StreamPart, { type: "finish" }>;
          finishReason = finish.finishReason;
          const total = finish.totalUsage;
          if (total) {
            usage = {
              inputTokens: total.inputTokens,
              outputTokens: total.outputTokens,
              reasoningTokens: total.outputTokenDetails?.reasoningTokens,
            };
          }
          break;
        }
        case "error": {
          const error = (part as { error: unknown }).error;
          if (isAbort(error)) {
            status = "stopped";
          } else {
            status = "error";
            failure = errorMessage(error);
          }
          break;
        }
        case "abort":
          if (status !== "error") status = "stopped";
          break;
        default:
          break;
      }
    }
  } catch (error) {
    if (isAbort(error)) {
      if (status !== "error") status = "stopped";
    } else {
      status = "error";
      failure = errorMessage(error);
    }
  }
  closeReasoning();
  return {
    status,
    text,
    reasoning,
    reasoningMs: reasoning ? reasoningMs : undefined,
    sources,
    tools,
    usage,
    error: failure,
    finishReason,
  };
}
