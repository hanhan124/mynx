import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsDoc } from "../lib/contracts/generated/settings/SettingsDoc.js";

const mocks = vi.hoisted(() => ({
  settingsLoad: vi.fn(),
  settingsSave: vi.fn(),
}));

vi.mock("./tauri.js", () => ({
  setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
  settingsLoad: mocks.settingsLoad,
  settingsSave: mocks.settingsSave,
}));

import { setLanguage, toggleLanguage } from "./state.svelte";

function makeSettings(language: "zh" | "en"): SettingsDoc {
  return {
    v: 1,
    theme: "pearl",
    alwaysOnTop: false,
    chartColor: "#3C9FDF",
    language,
    searchEngine: "google",
    homeHeaderHeight: 180,
    imageConverterOptions: {},
    chartStudioPresets: [],
    weatherEnabled: false,
    weatherConfigured: true,
    weatherCity: null,
  } as unknown as SettingsDoc;
}

describe("app settings persistence", () => {
  beforeEach(() => {
    let stored = makeSettings("zh");
    mocks.settingsLoad.mockReset();
    mocks.settingsSave.mockReset();
    mocks.settingsLoad.mockImplementation(async () => stored);
    mocks.settingsSave.mockImplementation(async (next: unknown) => {
      stored = next as SettingsDoc;
    });
    setLanguage("zh");
  });

  it("persists rapid language toggles in order through SQLite", async () => {
    toggleLanguage();
    toggleLanguage();

    await vi.waitFor(() => expect(mocks.settingsSave).toHaveBeenCalledTimes(2));

    const savedLanguages = mocks.settingsSave.mock.calls.map(
      ([doc]) => (doc as SettingsDoc).language,
    );
    expect(savedLanguages).toEqual(["en", "zh"]);
  });
});
