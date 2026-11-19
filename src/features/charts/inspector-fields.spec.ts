import { describe, expect, it } from "vitest";
import {
  applyLegendToggle,
  applyPublicationPresetValues,
  clampInspectorNumber,
  createInitialChartConfig,
  type ChartConfigDraft,
} from "./inspector-fields.js";
import { DEFAULT_TEMPLATE } from "./catalog.js";

// Ported from legacy `inspector-fields.test.ts` (3.1-3A inspector value
// contract): defaults unchanged, 0 is a valid value, empty input commits
// nothing, preset round-trips preserve every parameter.
const isExactly = (value: unknown, expected: unknown) =>
  value === expected && typeof value === typeof expected;

const BATCH_A_FIELDS = [
  "title",
  "subtitle",
  "caption",
  "plotTag",
  "color",
  "ggTheme",
  "baseSize",
  "fontFamily",
  "showLegend",
  "legendPosition",
  "palette",
  "paletteReverse",
  "showTitle",
  "titleSize",
  "titleHjust",
  "axisTextSize",
  "axisTitleSize",
] as const;

describe("createInitialChartConfig (defaults snapshot)", () => {
  it("keeps title text empty", () => {
    const cfg = createInitialChartConfig();
    expect(cfg.title).toBe("");
    expect(cfg.subtitle).toBe("");
    expect(cfg.caption).toBe("");
    expect(cfg.plotTag).toBe("");
  });

  it("keeps the legacy appearance values", () => {
    const cfg = createInitialChartConfig();
    expect(isExactly(cfg.color, "#0A84FF")).toBe(true);
    expect(isExactly(cfg.ggTheme, "bw")).toBe(true);
    expect(isExactly(cfg.baseSize, 12)).toBe(true);
    expect(isExactly(cfg.fontFamily, "sans")).toBe(true);
    expect(isExactly(cfg.palette, "npg")).toBe(true);
    expect(isExactly(cfg.paletteReverse, false)).toBe(true);
    expect(isExactly(cfg.showLegend, true)).toBe(true);
    expect(isExactly(cfg.legendPosition, "right")).toBe(true);
    expect(isExactly(cfg.showTitle, true)).toBe(true);
    expect(isExactly(cfg.titleSize, 14)).toBe(true);
    expect(isExactly(cfg.titleHjust, 0.5)).toBe(true);
    expect(isExactly(cfg.axisTextSize, 10)).toBe(true);
    expect(isExactly(cfg.axisTitleSize, 11)).toBe(true);
  });

  it("keeps the layer and export values", () => {
    const cfg = createInitialChartConfig();
    expect(isExactly(cfg.format, "png")).toBe(true);
    expect(isExactly(cfg.width, 8)).toBe(true);
    expect(isExactly(cfg.height, 5)).toBe(true);
    expect(isExactly(cfg.dpi, 180)).toBe(true);
    expect(isExactly(cfg.pointSize, 2.6)).toBe(true);
    expect(isExactly(cfg.lineWidth, 0.8)).toBe(true);
    expect(isExactly(cfg.barWidth, 0.72)).toBe(true);
    expect(isExactly(cfg.alpha, 0.8)).toBe(true);
    expect(isExactly(cfg.axisLineWidth, 0.45)).toBe(true);
    expect(isExactly(cfg.gridLineWidth, 0.25)).toBe(true);
    expect(isExactly(cfg.panelBorder, false)).toBe(true);
    expect(isExactly(cfg.showGrid, true)).toBe(true);
    expect(isExactly(cfg.installMissing, true)).toBe(true);
    expect(isExactly(cfg.publicationPreset, "custom")).toBe(true);
    expect(isExactly(cfg.showRawPoints, true)).toBe(true);
    expect(isExactly(cfg.showStats, false)).toBe(true);
    expect(isExactly(cfg.statTest, "wilcox.test")).toBe(true);
    expect(isExactly(cfg.pAdjustMethod, "holm")).toBe(true);
    expect(isExactly(cfg.heatmapClusterRows, true)).toBe(true);
    expect(isExactly(cfg.heatmapClusterCols, true)).toBe(true);
    expect(isExactly(cfg.heatmapScale, "none")).toBe(true);
  });

  it("starts on the first verified template with the default mapping", () => {
    const cfg = createInitialChartConfig();
    expect(isExactly(cfg.template, DEFAULT_TEMPLATE.id)).toBe(true);
    expect(isExactly(cfg.x, "group")).toBe(true);
    expect(isExactly(cfg.y, "value")).toBe(true);
    expect(isExactly(cfg.group, "")).toBe(true);
    expect(isExactly(cfg.size, "")).toBe(true);
    expect(typeof cfg.baseSize).toBe("number");
    expect(typeof cfg.titleHjust).toBe("number");
    expect(typeof cfg.showLegend).toBe("boolean");
    expect(typeof cfg.title).toBe("string");
  });
});

describe("clampInspectorNumber", () => {
  it("keeps valid zero (0 is a value, not empty)", () => {
    expect(clampInspectorNumber(0, 0, 1)).toBe(0);
  });

  it("coerces numeric strings", () => {
    expect(clampInspectorNumber("0", 8, 32)).toBe(8);
    expect(clampInspectorNumber("15", 8, 32)).toBe(15);
  });

  it("returns null for empty or non-numeric input", () => {
    expect(clampInspectorNumber("", 8, 32)).toBeNull();
    expect(clampInspectorNumber(null, 8, 32)).toBeNull();
    expect(clampInspectorNumber(undefined, 8, 32)).toBeNull();
    expect(clampInspectorNumber("abc", 8, 32)).toBeNull();
  });

  it("clamps out-of-range values", () => {
    expect(clampInspectorNumber(40, 8, 32)).toBe(32);
    expect(clampInspectorNumber(1, 8, 32)).toBe(8);
  });
});

describe("applyLegendToggle", () => {
  it("keeps the position when turning off", () => {
    const next = applyLegendToggle({ showLegend: true, legendPosition: "left" }, false);
    expect(next.showLegend).toBe(false);
    expect(next.legendPosition).toBe("left");
  });

  it("keeps the position when turning on", () => {
    const next = applyLegendToggle({ showLegend: false, legendPosition: "bottom" }, true);
    expect(next.showLegend).toBe(true);
    expect(next.legendPosition).toBe("bottom");
  });

  it("normalizes a stale none position to right", () => {
    const next = applyLegendToggle({ showLegend: true, legendPosition: "none" }, true);
    expect(next.showLegend).toBe(true);
    expect(next.legendPosition).toBe("right");
  });
});

describe("applyPublicationPresetValues", () => {
  it("applies the nature-single device values", () => {
    const next = applyPublicationPresetValues(createInitialChartConfig(), "nature-single");
    expect(next.publicationPreset).toBe("nature-single");
    expect(next.width).toBe(3.5);
    expect(next.height).toBe(2.65);
    expect(next.dpi).toBe(600);
    expect(next.baseSize).toBe(8);
    expect(next.titleSize).toBe(9);
    expect(next.axisTextSize).toBe(7);
    expect(next.color).toBe("#2F5597");
    expect(next.showGrid).toBe(false);
    expect(next.titleHjust).toBe(0);
  });

  it("keeps user grid/title settings on the custom preset", () => {
    const draft = { ...createInitialChartConfig(), showGrid: true, titleHjust: 0.5 };
    const next = applyPublicationPresetValues(draft, "custom");
    expect(next.publicationPreset).toBe("custom");
    expect(next.showGrid).toBe(true);
    expect(next.titleHjust).toBe(0.5);
    expect(next.dpi).toBe(300);
  });
});

describe("preset round-trip (merge over defaults)", () => {
  const edited: ChartConfigDraft = {
    ...createInitialChartConfig(),
    title: "Fig. 1",
    subtitle: "处理组 vs 对照组",
    caption: "",
    plotTag: "A",
    color: "#123ABC",
    ggTheme: "classic",
    baseSize: 9,
    fontFamily: "serif",
    showLegend: false,
    legendPosition: "bottom",
    palette: "lancet",
    paletteReverse: true,
    showTitle: false,
    titleSize: 18,
    titleHjust: 0,
    axisTextSize: 7,
    axisTitleSize: 24,
  };

  it("preserves every batch-A field through a JSON round-trip", () => {
    // Simulate a preset save (JSON serialize) + loadPreset merge behavior.
    const saved = JSON.parse(JSON.stringify({ ...edited, template: edited.template }));
    const merged = { ...createInitialChartConfig(), ...saved } as ChartConfigDraft;
    for (const field of BATCH_A_FIELDS) {
      const savedValue = (saved as Record<string, unknown>)[field];
      const mergedValue = merged[field] as unknown;
      expect(mergedValue).toBe(savedValue);
      expect(typeof mergedValue).toBe(typeof savedValue);
    }
  });

  it("keeps an empty string over the default (clearing a title is valid)", () => {
    const saved = JSON.parse(
      JSON.stringify({ ...createInitialChartConfig(), title: "" }),
    );
    const merged = { ...createInitialChartConfig(), ...saved } as ChartConfigDraft;
    expect(merged.title).toBe("");
    expect(typeof merged.title).toBe("string");
  });
});
