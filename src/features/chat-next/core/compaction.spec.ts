import { describe, expect, it } from "vitest";
import { compactionPlan, compactionTranscript, estimatePathTokens, mergeParams } from "./helpers.js";
import { buildPrompt } from "./request.js";
import { consumeStream, type StreamPart } from "./stream.js";
import type { MessageNode, Role } from "./types.js";

let seq = 0;
function node(role: Role, content: string, extra: Partial<MessageNode> = {}): MessageNode {
  seq += 1;
  return { id: `n${seq}`, conversationId: "c", parentId: null, role, content, createdAt: seq, status: "ok", ...extra };
}

function linear(count: number): MessageNode[] {
  seq = 0;
  return Array.from({ length: count }, (_, i) => node(i % 2 === 0 ? "user" : "assistant", `m${i + 1}`));
}

describe("summary windowing in buildPrompt", () => {
  it("replaces the summarised part of the path with the summary", () => {
    const path = linear(8);
    const built = buildPrompt(path, { summary: "S", summaryUntil: path[3]!.id });
    expect(built.messages.map((m) => m.content)).toEqual(["m5", "m6", "m7", "m8"]);
    expect(built.instructions).toBe("Summary of the earlier conversation:\nS");
  });

  it("ignores the summary on a branch that does not contain its cut node", () => {
    const path = linear(4);
    const built = buildPrompt(path, { summary: "S", summaryUntil: "elsewhere" });
    expect(built.messages).toHaveLength(4);
    expect(built.instructions).toBeUndefined();
  });

  it("keeps the legacy behaviour when no cut node is recorded", () => {
    const built = buildPrompt(linear(2), { summary: "legacy" });
    expect(built.messages).toHaveLength(2);
    expect(built.instructions).toContain("legacy");
  });
});

describe("compactionPlan", () => {
  it("folds everything but the recent messages", () => {
    const path = linear(10);
    const plan = compactionPlan(path, undefined, 4);
    expect(plan?.older.map((n) => n.content)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(plan?.until).toBe(path[5]!.id);
  });

  it("continues after an earlier summary and refuses tiny folds", () => {
    const path = linear(10);
    expect(compactionPlan(path, path[5]!.id, 4)).toBeNull();
    expect(compactionPlan(path, path[1]!.id, 4)?.older.map((n) => n.content)).toEqual(["m3", "m4", "m5", "m6"]);
    expect(compactionPlan(linear(5), undefined, 4)).toBeNull();
  });

  it("builds a transcript with the earlier summary first", () => {
    const text = compactionTranscript("old", [node("user", "q", { attachments: [{ id: "a", name: "x.csv", mime: "text/csv", size: 1, kind: "text" }] }), node("assistant", "a")]);
    expect(text).toBe("Earlier summary:\nold\n\nUser: q [file: x.csv]\nAssistant: a");
  });

  it("estimates the prompt size after the summary", () => {
    const path = linear(4);
    expect(estimatePathTokens(path)).toBe(4);
    expect(estimatePathTokens(path, path[1]!.id, "abcdefgh")).toBe(2 + 2);
  });
});

describe("mergeParams", () => {
  it("lets later layers win but never with unset values", () => {
    expect(mergeParams({ temperature: 0.2, maxOutputTokens: 100 }, { temperature: undefined }, { maxOutputTokens: 50 })).toEqual({
      temperature: 0.2,
      maxOutputTokens: 50,
    });
    expect(mergeParams(undefined, { topP: Number.NaN })).toEqual({});
  });
});

describe("finish reason", () => {
  it("is reported so truncated answers can be continued", async () => {
    async function* parts(): AsyncGenerator<StreamPart> {
      yield { type: "text-delta", text: "abc" };
      yield { type: "finish", finishReason: "length" };
    }
    expect((await consumeStream(parts())).finishReason).toBe("length");
  });
});
