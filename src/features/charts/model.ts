import type { ChartTemplate } from "@/lib/charts/catalog";

export type GgplotTheme = "auto" | "minimal" | "bw" | "classic" | "light" | "gray" | "dark" | "void" | "linedraw";
export type LegendPosition = "right" | "left" | "top" | "bottom" | "none";
export type PublicationPreset = "custom" | "nature-single" | "nature-double" | "general-single" | "general-double";
export type PaletteId = "npg" | "jama" | "lancet" | "okabe-ito" | "viridis" | "gray";

export type ChartConfig = {
  template: ChartTemplate; filePath: string; outputDir: string;
  x: string; y: string; group: string; size: string;
  title: string; subtitle: string; caption: string; plotTag: string; color: string;
  format: "png" | "svg" | "pdf" | "tiff" | "eps"; width: number; height: number; dpi: number;
  ggTheme: GgplotTheme; baseSize: number; fontFamily: string; showLegend: boolean;
  legendPosition: LegendPosition; showGrid: boolean; showTitle: boolean; titleSize: number;
  titleHjust: number; axisTextSize: number; axisTitleSize: number; installMissing: boolean;
  publicationPreset: PublicationPreset; palette: PaletteId; paletteReverse: boolean;
  pointSize: number; lineWidth: number; barWidth: number; alpha: number; axisLineWidth: number;
  gridLineWidth: number; panelBorder: boolean; heatmapClusterRows: boolean;
  heatmapClusterCols: boolean; heatmapScale: "none" | "row" | "column";
  showRawPoints: boolean; showStats: boolean; statTest: "t.test" | "wilcox.test";
  pAdjustMethod: "none" | "holm" | "bonferroni" | "BH";
};

export type ChartResult = { path: string; templateId: string; templateName: string; format: ChartConfig["format"] };
export type RunEvent = { message: string; tone: "info" | "success" | "error" | "cancelled"; stage: string };
