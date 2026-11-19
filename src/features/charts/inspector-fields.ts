import type { ChartRunConfig } from "../../lib/contracts/generated/charts/ChartRunConfig.js";
import { DEFAULT_TEMPLATE } from "./catalog.js";

/**
 * Inspector field definitions + config defaults for the chart studio.
 *
 * Ported from legacy `src/lib/charts/inspector-fields.ts` (defaults, number
 * clamping, legend toggle) plus the page-level field layout — it is
 * form-generation data (keys / kinds / options / ranges), not styling.
 */

/** Config fields owned by the inspector; run-only fields are derived. */
export type ChartConfigDraft = Omit<
  ChartRunConfig,
  "kind" | "galleryUrl" | "sourceRepoPath" | "verified"
>;

export type GgplotTheme =
  | "auto"
  | "minimal"
  | "bw"
  | "classic"
  | "light"
  | "gray"
  | "dark"
  | "void"
  | "linedraw";
export type LegendPosition = "right" | "left" | "top" | "bottom" | "none";
export type PublicationPreset =
  | "custom"
  | "nature-single"
  | "nature-double"
  | "general-single"
  | "general-double";
export type PaletteId = "npg" | "jama" | "lancet" | "okabe-ito" | "viridis" | "gray";

/** Default chart-studio configuration. Single source for both the initial
 * state and the preset-load merge, so defaults stay testable. */
export function createInitialChartConfig(): ChartConfigDraft {
  return {
    template: DEFAULT_TEMPLATE.id,
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

/** Converts a number-input change into the config value.
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

/* ---------------------------------------------------------------------------
 * Inspector sections (form-generation data driving the right-hand panel).
 * ------------------------------------------------------------------------- */

export type InspectorFieldKind = "text" | "number" | "select" | "switch" | "color";

export interface InspectorFieldDef {
  key: keyof ChartConfigDraft & string;
  kind: InspectorFieldKind;
  /** i18n key for the field label. */
  labelKey: string;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  /** Select options: `{ value, i18n label key }` or a literal label. */
  options?: ReadonlyArray<{ value: string; labelKey?: string; label?: string }>;
  /** Only show for these template kinds (defaults to always). */
  kinds?: ReadonlyArray<string>;
}

export interface InspectorSectionDef {
  id: string;
  titleKey: string;
  fields: InspectorFieldDef[];
}

export const GG_THEME_OPTIONS = [
  { value: "auto", labelKey: "charts.themeAuto" },
  { value: "minimal", label: "Minimal" },
  { value: "bw", labelKey: "charts.themeBw" },
  { value: "classic", label: "Classic" },
  { value: "light", label: "Light" },
  { value: "gray", label: "Gray" },
  { value: "dark", label: "Dark" },
  { value: "void", label: "Void" },
  { value: "linedraw", label: "Line draw" },
] as const;

export const FONT_OPTIONS = [
  { value: "sans", labelKey: "charts.fontSans" },
  { value: "serif", labelKey: "charts.fontSerif" },
  { value: "mono", labelKey: "charts.fontMono" },
] as const;

export const LEGEND_POSITION_OPTIONS = [
  { value: "right", labelKey: "charts.legendRight" },
  { value: "left", labelKey: "charts.legendLeft" },
  { value: "top", labelKey: "charts.legendTop" },
  { value: "bottom", labelKey: "charts.legendBottom" },
] as const;

export const FORMAT_OPTIONS = [
  { value: "png", labelKey: "charts.formatPng" },
  { value: "tiff", labelKey: "charts.formatTiff" },
  { value: "svg", labelKey: "charts.formatSvg" },
  { value: "pdf", labelKey: "charts.formatPdf" },
  { value: "eps", labelKey: "charts.formatEps" },
] as const;

export const PALETTE_OPTIONS = [
  { value: "npg", label: "NPG" },
  { value: "jama", label: "JAMA" },
  { value: "lancet", label: "Lancet" },
  { value: "okabe-ito", label: "Okabe–Ito" },
  { value: "viridis", label: "Viridis" },
  { value: "gray", labelKey: "charts.paletteGray" },
] as const;

export const STAT_TEST_OPTIONS = [
  { value: "wilcox.test", label: "Wilcoxon" },
  { value: "t.test", labelKey: "charts.statTTest" },
] as const;

export const P_ADJUST_OPTIONS = [
  { value: "holm", labelKey: "charts.adjustHolm" },
  { value: "bonferroni", label: "Bonferroni" },
  { value: "BH", label: "Benjamini–Hochberg" },
  { value: "none", labelKey: "charts.adjustNone" },
] as const;

export const HEATMAP_SCALE_OPTIONS = [
  { value: "none", labelKey: "charts.heatmapScaleNone" },
  { value: "row", labelKey: "charts.heatmapScaleRow" },
  { value: "column", labelKey: "charts.heatmapScaleColumn" },
] as const;

export const TITLE_HJUST_OPTIONS = [
  { value: "0", labelKey: "charts.alignLeft" },
  { value: "0.5", labelKey: "charts.alignCenter" },
  { value: "1", labelKey: "charts.alignRight" },
] as const;

export const HEATMAP_KINDS = ["heatmap", "correlogram"] as const;

export const INSPECTOR_SECTIONS: InspectorSectionDef[] = [
  {
    id: "appearance",
    titleKey: "charts.sectionAppearance",
    fields: [
      { key: "ggTheme", kind: "select", labelKey: "charts.ggTheme", options: GG_THEME_OPTIONS },
      { key: "baseSize", kind: "number", labelKey: "charts.baseSize", min: 8, max: 32, step: 1 },
      { key: "fontFamily", kind: "select", labelKey: "charts.fontFamily", options: FONT_OPTIONS },
      { key: "showLegend", kind: "switch", labelKey: "charts.showLegend" },
      {
        key: "legendPosition",
        kind: "select",
        labelKey: "charts.legendPosition",
        options: LEGEND_POSITION_OPTIONS,
      },
      { key: "showGrid", kind: "switch", labelKey: "charts.showGrid" },
      { key: "panelBorder", kind: "switch", labelKey: "charts.panelBorder" },
      {
        key: "axisLineWidth",
        kind: "number",
        labelKey: "charts.axisLineWidth",
        min: 0,
        max: 3,
        step: 0.05,
      },
      {
        key: "gridLineWidth",
        kind: "number",
        labelKey: "charts.gridLineWidth",
        min: 0,
        max: 2,
        step: 0.05,
      },
      {
        key: "axisTextSize",
        kind: "number",
        labelKey: "charts.axisTextSize",
        min: 7,
        max: 24,
        step: 1,
      },
      {
        key: "axisTitleSize",
        kind: "number",
        labelKey: "charts.axisTitleSize",
        min: 7,
        max: 24,
        step: 1,
      },
    ],
  },
  {
    id: "titles",
    titleKey: "charts.sectionTitles",
    fields: [
      { key: "title", kind: "text", labelKey: "charts.title" },
      { key: "subtitle", kind: "text", labelKey: "charts.subtitle" },
      { key: "caption", kind: "text", labelKey: "charts.caption" },
      { key: "plotTag", kind: "text", labelKey: "charts.plotTag", maxLength: 8 },
      { key: "showTitle", kind: "switch", labelKey: "charts.showTitle" },
      { key: "titleSize", kind: "number", labelKey: "charts.titleSize", min: 8, max: 32, step: 1 },
      {
        key: "titleHjust",
        kind: "select",
        labelKey: "charts.titleAlign",
        options: TITLE_HJUST_OPTIONS,
      },
    ],
  },
  {
    id: "layout",
    titleKey: "charts.sectionLayout",
    fields: [
      { key: "format", kind: "select", labelKey: "charts.format", options: FORMAT_OPTIONS },
      {
        key: "publicationPreset",
        kind: "select",
        labelKey: "charts.publicationPreset",
        options: [
          { value: "custom", labelKey: "charts.presetCustom" },
          { value: "nature-single", labelKey: "charts.presetNatureSingle" },
          { value: "nature-double", labelKey: "charts.presetNatureDouble" },
          { value: "general-single", labelKey: "charts.presetGeneralSingle" },
          { value: "general-double", labelKey: "charts.presetGeneralDouble" },
        ],
      },
      { key: "width", kind: "number", labelKey: "charts.width", min: 2, max: 30, step: 0.5 },
      { key: "height", kind: "number", labelKey: "charts.height", min: 2, max: 30, step: 0.5 },
      { key: "dpi", kind: "number", labelKey: "charts.dpi", min: 72, max: 600, step: 12 },
    ],
  },
  {
    id: "style",
    titleKey: "charts.sectionStyle",
    fields: [
      { key: "color", kind: "color", labelKey: "charts.primaryColor" },
      { key: "palette", kind: "select", labelKey: "charts.palette", options: PALETTE_OPTIONS },
      { key: "paletteReverse", kind: "switch", labelKey: "charts.paletteReverse" },
      { key: "pointSize", kind: "number", labelKey: "charts.pointSize", min: 0.5, max: 12, step: 0.1 },
      { key: "lineWidth", kind: "number", labelKey: "charts.lineWidth", min: 0.1, max: 6, step: 0.1 },
      { key: "barWidth", kind: "number", labelKey: "charts.barWidth", min: 0.1, max: 2, step: 0.05 },
      { key: "alpha", kind: "number", labelKey: "charts.alpha", min: 0.05, max: 1, step: 0.05 },
      { key: "showRawPoints", kind: "switch", labelKey: "charts.showRawPoints" },
      { key: "showStats", kind: "switch", labelKey: "charts.showStats" },
      { key: "statTest", kind: "select", labelKey: "charts.statTest", options: STAT_TEST_OPTIONS },
      {
        key: "pAdjustMethod",
        kind: "select",
        labelKey: "charts.pAdjustMethod",
        options: P_ADJUST_OPTIONS,
      },
    ],
  },
  {
    id: "heatmap",
    titleKey: "charts.sectionHeatmap",
    fields: [
      {
        key: "heatmapScale",
        kind: "select",
        labelKey: "charts.heatmapScale",
        options: HEATMAP_SCALE_OPTIONS,
      },
      { key: "heatmapClusterRows", kind: "switch", labelKey: "charts.heatmapClusterRows" },
      { key: "heatmapClusterCols", kind: "switch", labelKey: "charts.heatmapClusterCols" },
    ],
  },
];

/* ---------------------------------------------------------------------------
 * Publication presets (legacy page-level table; applied on preset select).
 * ------------------------------------------------------------------------- */

export interface PublicationPresetValues {
  labelKey: string;
  width: number;
  height: number;
  dpi: number;
  fontFamily: string;
  baseSize: number;
  titleSize: number;
  axisTextSize: number;
  axisTitleSize: number;
  color: string;
  ggTheme: GgplotTheme;
}

export const publicationPresets: Record<PublicationPreset, PublicationPresetValues> = {
  custom: {
    labelKey: "charts.presetCustom",
    width: 8,
    height: 5,
    dpi: 300,
    fontFamily: "sans",
    baseSize: 11,
    titleSize: 14,
    axisTextSize: 10,
    axisTitleSize: 11,
    color: "#0A84FF",
    ggTheme: "bw",
  },
  "nature-single": {
    labelKey: "charts.presetNatureSingle",
    width: 3.5,
    height: 2.65,
    dpi: 600,
    fontFamily: "sans",
    baseSize: 8,
    titleSize: 9,
    axisTextSize: 7,
    axisTitleSize: 8,
    color: "#2F5597",
    ggTheme: "bw",
  },
  "nature-double": {
    labelKey: "charts.presetNatureDouble",
    width: 7.2,
    height: 4.9,
    dpi: 600,
    fontFamily: "sans",
    baseSize: 8,
    titleSize: 9,
    axisTextSize: 7,
    axisTitleSize: 8,
    color: "#2F5597",
    ggTheme: "bw",
  },
  "general-single": {
    labelKey: "charts.presetGeneralSingle",
    width: 3.35,
    height: 2.55,
    dpi: 600,
    fontFamily: "sans",
    baseSize: 8,
    titleSize: 9,
    axisTextSize: 7,
    axisTitleSize: 8,
    color: "#1F4E79",
    ggTheme: "bw",
  },
  "general-double": {
    labelKey: "charts.presetGeneralDouble",
    width: 6.7,
    height: 4.8,
    dpi: 600,
    fontFamily: "sans",
    baseSize: 8,
    titleSize: 9,
    axisTextSize: 7,
    axisTitleSize: 8,
    color: "#1F4E79",
    ggTheme: "bw",
  },
};

/** Applies a publication preset onto the draft (legacy behavior: non-custom
 * presets disable the grid and left-align the title). */
export function applyPublicationPresetValues(
  draft: ChartConfigDraft,
  presetId: PublicationPreset,
): ChartConfigDraft {
  const preset = publicationPresets[presetId];
  return {
    ...draft,
    publicationPreset: presetId,
    width: preset.width,
    height: preset.height,
    dpi: preset.dpi,
    fontFamily: preset.fontFamily,
    baseSize: preset.baseSize,
    titleSize: preset.titleSize,
    axisTextSize: preset.axisTextSize,
    axisTitleSize: preset.axisTitleSize,
    color: preset.color,
    ggTheme: preset.ggTheme,
    showGrid: presetId === "custom" ? draft.showGrid : false,
    titleHjust: presetId === "custom" ? draft.titleHjust : 0,
  };
}
