import { describe, expect, it } from "vitest";
import {
  consumePendingPrompt,
  consumeSettingsRequest,
  legacyConfigured,
  queuePendingPrompt,
  requestChatSettings,
  resolveSubmitIntent,
} from "./handoff.js";

describe("resolveSubmitIntent (home search box routing)", () => {
  const tools = [
    { route: "/charts", title: "科研绘图" },
    { route: "/qpcr", title: "qPCR 分析" },
    { route: "/image", title: "图片转 PNG" },
    { route: "/rnaseq", title: "RNA-seq 分析" },
  ];

  it("routes an exact tool-title hit to the tool page, even when chat is configured", () => {
    expect(resolveSubmitIntent("qPCR 分析", tools, true)).toEqual({ kind: "tool", route: "/qpcr" });
    expect(resolveSubmitIntent("/charts", tools, true)).toEqual({ kind: "tool", route: "/charts" });
  });

  it("routes to chat only when configured and no tool matched", () => {
    expect(resolveSubmitIntent("解释 Ct 值", tools, true)).toEqual({ kind: "chat" });
    expect(resolveSubmitIntent("解释 Ct 值", tools, false)).toEqual({ kind: "search" });
  });

  it("is a no-op for empty or whitespace-only queries", () => {
    expect(resolveSubmitIntent("", tools, true)).toEqual({ kind: "none" });
    expect(resolveSubmitIntent("   ", tools, true)).toEqual({ kind: "none" });
  });
});

describe("chat handoff", () => {
  it("hands a pending prompt over exactly once", () => {
    queuePendingPrompt("  hello  ");
    expect(consumePendingPrompt()).toBe("hello");
    expect(consumePendingPrompt()).toBeNull();
    queuePendingPrompt("   ");
    expect(consumePendingPrompt()).toBeNull();
  });

  it("hands a settings request over exactly once", () => {
    requestChatSettings();
    expect(consumeSettingsRequest()).toBe(true);
    expect(consumeSettingsRequest()).toBe(false);
  });

  it("detects a usable legacy config", () => {
    expect(legacyConfigured(JSON.stringify({ providers: [{ baseUrl: "https://a", model: "m" }] }))).toBe(true);
    expect(legacyConfigured(JSON.stringify({ baseUrl: "https://a", model: "m" }))).toBe(true);
    expect(legacyConfigured(JSON.stringify({ providers: [{ baseUrl: "https://a", model: "" }] }))).toBe(false);
    expect(legacyConfigured("{oops")).toBe(false);
    expect(legacyConfigured(null)).toBe(false);
  });
});

describe("router", () => {
  it("serves the chat at /chat and redirects the preview route", async () => {
    const { router, routeTitleKey } = await import("../../lib/router.svelte.js");
    expect(router.parse("/chat")).toBe("/chat");
    expect(router.parse("/chat-next")).toBe("/chat");
    expect(routeTitleKey("/chat")).toBe("chat.title");
  });
});
