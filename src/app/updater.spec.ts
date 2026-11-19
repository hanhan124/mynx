import { describe, expect, it } from "vitest";
import { downloadPercent, formatBytes } from "./updater.svelte.js";

describe("updater download display", () => {
  it("formats byte counts for the progress banner", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("calculates bounded percent or returns indeterminate when total is unknown", () => {
    expect(downloadPercent(25, 100)).toBe(25);
    expect(downloadPercent(150, 100)).toBe(100);
    expect(downloadPercent(50, null)).toBeNull();
  });
});
