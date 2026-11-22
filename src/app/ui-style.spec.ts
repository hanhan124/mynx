import { describe, expect, it } from "vitest";
import { DEFAULT_UI_STYLE, normalizeUiStyle, UI_STYLES } from "./ui-style.svelte";

describe("normalizeUiStyle", () => {
  it("accepts the five style ids", () => {
    for (const style of UI_STYLES) {
      expect(normalizeUiStyle(style)).toBe(style);
    }
    expect(UI_STYLES).toHaveLength(5);
    expect(UI_STYLES[0]).toBe("macos");
  });

  it("is case-insensitive", () => {
    expect(normalizeUiStyle("Liquid-Glass")).toBe("liquid-glass");
    expect(normalizeUiStyle("MEMPHIS-POP")).toBe("memphis-pop");
    expect(normalizeUiStyle("MacOS")).toBe("macos");
  });

  it("falls back to the macos default", () => {
    expect(DEFAULT_UI_STYLE).toBe("macos");
    expect(normalizeUiStyle(null)).toBe(DEFAULT_UI_STYLE);
    expect(normalizeUiStyle(undefined)).toBe(DEFAULT_UI_STYLE);
    expect(normalizeUiStyle("")).toBe(DEFAULT_UI_STYLE);
    expect(normalizeUiStyle("pearl")).toBe(DEFAULT_UI_STYLE);
    expect(normalizeUiStyle("neo-brutalist")).toBe(DEFAULT_UI_STYLE);
  });
});
