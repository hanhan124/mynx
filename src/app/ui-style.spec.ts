import { describe, expect, it } from "vitest";
import { DEFAULT_UI_STYLE, normalizeUiStyle, UI_STYLES } from "./ui-style.svelte";

describe("normalizeUiStyle", () => {
  it("accepts the four style ids", () => {
    for (const style of UI_STYLES) {
      expect(normalizeUiStyle(style)).toBe(style);
    }
    expect(UI_STYLES).toHaveLength(4);
  });

  it("is case-insensitive", () => {
    expect(normalizeUiStyle("Liquid-Glass")).toBe("liquid-glass");
    expect(normalizeUiStyle("MEMPHIS-POP")).toBe("memphis-pop");
  });

  it("falls back to the minimal-linear default", () => {
    expect(DEFAULT_UI_STYLE).toBe("minimal-linear");
    expect(normalizeUiStyle(null)).toBe(DEFAULT_UI_STYLE);
    expect(normalizeUiStyle(undefined)).toBe(DEFAULT_UI_STYLE);
    expect(normalizeUiStyle("")).toBe(DEFAULT_UI_STYLE);
    expect(normalizeUiStyle("pearl")).toBe(DEFAULT_UI_STYLE);
    expect(normalizeUiStyle("neo-brutalist")).toBe(DEFAULT_UI_STYLE);
  });
});
