import { describe, expect, it } from "vitest";
import {
  beginChartNavigation,
  endChartNavigation,
  formatChartNavigationDiagnostics,
  getChartNavigationDiagnostics,
  recordChartNavigationStage,
} from "./chart-navigation-timings.js";

describe("chart navigation diagnostics", () => {
  it("keeps bounded, route-relative timing samples without user data", () => {
    const sampleId = beginChartNavigation();
    expect(sampleId).not.toBeNull();
    recordChartNavigationStage(sampleId, "routeUpdated", "hash-router");
    recordChartNavigationStage(sampleId, "visibleFrame");
    endChartNavigation(sampleId);

    const diagnostics = getChartNavigationDiagnostics();
    const sample = diagnostics?.samples.find((entry) => entry.id === sampleId);
    expect(diagnostics?.retention).toBe("current-process-memory");
    expect(sample?.stages.routeUpdated?.source).toBe("hash-router");
    expect(sample?.stages.visibleFrame?.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(formatChartNavigationDiagnostics()).not.toContain("C:\\");
  });

  it("retains only the latest 20 samples", () => {
    let lastId: number | null = null;
    for (let index = 0; index < 21; index += 1) {
      lastId = beginChartNavigation();
      recordChartNavigationStage(lastId, "routeUpdated");
      endChartNavigation(lastId);
    }

    const samples = getChartNavigationDiagnostics()?.samples ?? [];
    expect(samples).toHaveLength(20);
    expect(samples.at(-1)?.id).toBe(lastId);
  });
});
