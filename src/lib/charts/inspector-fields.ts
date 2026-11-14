// Relative import so the node smoke tests can load this module directly
// (catalog.ts is dependency-free; the model import below is type-only and erased).
import { verifiedChartTemplates } from "./catalog.ts";
import type { ChartConfig, LegendPosition } from "@/features/charts/model";

/** Default chart-studio configuration. Single source for both the initial
 * state and the preset-load merge, so defaults stay testable. */
export function createInitialChartConfig(): ChartConfig {
  return {
    template: verifiedChartTemplates[0],
    filePath: "",
    outputDir: "",
    x: "group",
    y: "value",
    group: "",
    size: "",
    title: "",
    subtitle: "",
    caption: "",
    plotTag: "",
    color: "#0A84FF",
    format: "png",
    width: 8,
    height: 5,
    dpi: 180,
    ggTheme: "bw",
    baseSize: 12,
    fontFamily: "sans",
    showLegend: true,
    legendPosition: "right",
    showGrid: true,
    showTitle: true,
    titleSize: 14,
    titleHjust: 0.5,
    axisTextSize: 10,
    axisTitleSize: 11,
    installMissing: true,
    publicationPreset: "custom",
    palette: "npg",
    paletteReverse: false,
    pointSize: 2.6,
    lineWidth: 0.8,
    barWidth: 0.72,
    alpha: 0.8,
    axisLineWidth: 0.45,
    gridLineWidth: 0.25,
    panelBorder: false,
    heatmapClusterRows: true,
    heatmapClusterCols: true,
    heatmapScale: "none",
    showRawPoints: true,
    showStats: false,
    statTest: "wilcox.test",
    pAdjustMethod: "holm",
  };
}

/** Converts a Mantine NumberInput change into the config value.
 * Returns null when the user cleared the field mid-edit (the caller must
 * keep the previous value instead of committing a fallback default).
 * Valid numbers — including 0 — are clamped into [min, max]. */
export function clampInspectorNumber(
  raw: number | string | null | undefined,
  min: number,
  max: number,
): number | null {
  if (raw === "" || raw === null || raw === undefined) return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

/** Pairs the legend switch with the position select. The R runner hides the
 * legend whenever showLegend is false, so switching on with a stale "none"
 * position normalizes to "right" to keep the UI and the config consistent. */
export function applyLegendToggle(
  state: { showLegend: boolean; legendPosition: LegendPosition },
  show: boolean,
): { showLegend: boolean; legendPosition: LegendPosition } {
  if (show && state.legendPosition === "none") {
    return { showLegend: true, legendPosition: "right" };
  }
  return { showLegend: show, legendPosition: state.legendPosition };
}
