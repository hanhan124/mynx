import { describe, expect, it } from "vitest";
import { dictionaries, t, localizeErrorMessage } from "./i18n.svelte";
import { setLanguage } from "./state.svelte";

describe("i18n dictionaries", () => {
  it("has identical key sets for zh and en", () => {
    const zhKeys = Object.keys(dictionaries.zh).sort();
    const enKeys = Object.keys(dictionaries.en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("has no empty translations", () => {
    for (const dict of [dictionaries.zh, dictionaries.en]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `empty value for ${key}`).not.toBe("");
      }
    }
  });

  it("has more than the legacy dictionary size (shell keys added)", () => {
    expect(Object.keys(dictionaries.zh).length).toBeGreaterThan(278);
  });
});

describe("t interpolation", () => {
  it("interpolates named values in zh", () => {
    setLanguage("zh");
    expect(t("imgconv.fileCount", { count: 3 })).toBe("3 个文件");
    expect(t("imgconv.summary", { ok: 4, failed: 1 })).toBe(
      "4 个成功，1 个失败",
    );
  });

  it("interpolates named values in en", () => {
    setLanguage("en");
    expect(t("imgconv.fileCount", { count: 3 })).toBe("3 files");
    expect(t("update.available", { version: "3.1.0" })).toBe(
      "New version v3.1.0 available",
    );
    setLanguage("zh");
  });

  it("keeps missing placeholders visible", () => {
    setLanguage("zh");
    expect(t("imgconv.pages")).toBe("{count} 页");
    expect(t("imgconv.pages", { other: 1 })).toBe("{count} 页");
  });

  it("falls back to zh and then the raw key", () => {
    setLanguage("en");
    // Key exists only in zh (legacy en dictionary keeps the zh string).
    expect(t("language.switchToChinese")).toBe("切换到中文");
    expect(t("nonexistent.key")).toBe("nonexistent.key");
    setLanguage("zh");
  });
});

describe("localizeErrorMessage", () => {
  it("maps known zh compute errors to en", () => {
    expect(
      localizeErrorMessage("未找到 Cq/Ct 列", "en"),
    ).toBe("Cq/Ct column was not found");
  });

  it("returns the original message for zh", () => {
    expect(localizeErrorMessage("未找到 Cq/Ct 列", "zh")).toBe(
      "未找到 Cq/Ct 列",
    );
  });
});
