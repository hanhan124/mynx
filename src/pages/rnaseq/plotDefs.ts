/**
 * 绘图导出的静态定义 — 图类型 / 调色板 / 发表尺寸预设 / ggplot 主题。
 */
import type { ComponentType } from "react";
import {
  IconChartDots,
  IconGrid4x4,
  IconLayoutGrid,
  IconChartScatter,
  IconCircleDot,
  IconChartLine,
  IconChartHistogram,
  IconChartBar,
  IconTags,
  IconBinaryTree,
  IconFlask,
  IconActivity,
  IconChartArea,
  IconMountain,
} from "@tabler/icons-react";

/** Icon component type compatible with @tabler/icons-react. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconType = ComponentType<any>;

export type PlotDim = "group" | "comparison" | "both";

export interface PlotGroupDef {
  id: string;
  label: string;
  desc: string;
  icon: IconType;
  dim: PlotDim;
  color: string;
}

export const PLOT_GROUPS: PlotGroupDef[] = [
  {
    id: "pca",
    label: "PCA 图",
    desc: "主成分分析·样本聚类",
    icon: IconChartDots,
    dim: "group",
    color: "#0a84ff",
  },
  {
    id: "heatmap",
    label: "整体热图",
    desc: "候选基因表达热图",
    icon: IconGrid4x4,
    dim: "group",
    color: "#ff375f",
  },
  {
    id: "select_heatmap",
    label: "选定基因热图",
    desc: "功能簇基因热图",
    icon: IconLayoutGrid,
    dim: "group",
    color: "#af52de",
  },
  {
    id: "volcano",
    label: "火山图",
    desc: "每比较·差异分布",
    icon: IconChartScatter,
    dim: "comparison",
    color: "#5e5ce6",
  },
  {
    id: "venn",
    label: "Venn 图",
    desc: "样本/比较交集",
    icon: IconCircleDot,
    dim: "both",
    color: "#30d158",
  },
  {
    id: "ma",
    label: "MA 图",
    desc: "每比较·表达 vs FC",
    icon: IconChartLine,
    dim: "comparison",
    color: "#ff9f0a",
  },
  {
    id: "boxplot",
    label: "箱线图",
    desc: "表达分布",
    icon: IconChartHistogram,
    dim: "group",
    color: "#32d74b",
  },
  {
    id: "deg_bar",
    label: "DEG 柱状图",
    desc: "每比较·上下调计数",
    icon: IconChartBar,
    dim: "comparison",
    color: "#ff375f",
  },
  {
    id: "top_genes",
    label: "Top 基因图",
    desc: "每比较·显著基因条形",
    icon: IconTags,
    dim: "comparison",
    color: "#a2845e",
  },
  {
    id: "dendrogram",
    label: "树状图",
    desc: "样本聚类树",
    icon: IconBinaryTree,
    dim: "group",
    color: "#0a84ff",
  },
  {
    id: "enrich",
    label: "富集条形图",
    desc: "GO/KEGG ORA",
    icon: IconFlask,
    dim: "comparison",
    color: "#30d158",
  },
  {
    id: "gsea",
    label: "GSEA 点图",
    desc: "基因集富集",
    icon: IconActivity,
    dim: "comparison",
    color: "#5e5ce6",
  },
  {
    id: "violin",
    label: "小提琴图",
    desc: "单基因表达分布",
    icon: IconChartArea,
    dim: "group",
    color: "#af52de",
  },
  {
    id: "density",
    label: "密度图",
    desc: "表达密度曲线",
    icon: IconMountain,
    dim: "group",
    color: "#32d74b",
  },
];

/** 卡片 id → 输出文件名前缀(R 端 save_plot/save_ggplot 命名规则) */
export const PLOT_FILE_PREFIX: Record<string, string[]> = {
  pca: ["pca."],
  heatmap: ["heatmap."],
  select_heatmap: ["heatmap_selected_genes"],
  volcano: ["volcano_"],
  venn: ["venn"],
  ma: ["ma_"],
  boxplot: ["expression_boxplot"],
  deg_bar: ["deg_barplot"],
  top_genes: ["top_genes_"],
  dendrogram: ["sample_dendrogram"],
  enrich: ["enrich_"],
  gsea: ["gsea_"],
  violin: ["violin."],
  density: ["density."],
};

export function filePlotId(name: string): string | null {
  for (const [id, prefixes] of Object.entries(PLOT_FILE_PREFIX)) {
    if (prefixes.some((p) => name.startsWith(p))) return id;
  }
  return null;
}

// ── 分类调色板(ggsci paletteer) ──
export const PALETTES: { id: string; label: string; colors: string[] }[] = [
  {
    id: "category10_d3",
    label: "D3 10 色",
    colors: [
      "#1f77b4",
      "#ff7f0e",
      "#2ca02c",
      "#d62728",
      "#9467bd",
      "#8c564b",
      "#e377c2",
      "#7f7f7f",
      "#bcbd22",
      "#17becf",
    ],
  },
  {
    id: "npg",
    label: "NPG 2020",
    colors: [
      "#E64B35",
      "#4DBBD5",
      "#00A087",
      "#3C5488",
      "#F39B7F",
      "#8491B4",
      "#91D1C2",
      "#DC0000",
      "#7E6148",
      "#B09C85",
    ],
  },
  {
    id: "jco",
    label: "JCO",
    colors: [
      "#0073C2",
      "#EFC000",
      "#868686",
      "#CD534C",
      "#7AA6DC",
      "#003C67",
      "#8F7700",
      "#3B3B3B",
      "#A73030",
      "#4A6990",
    ],
  },
  {
    id: "nejm",
    label: "NEJM",
    colors: [
      "#BC3C29",
      "#0072B5",
      "#E18727",
      "#20854E",
      "#7876B1",
      "#6F99AD",
      "#FFDC91",
      "#EE4C97",
      "#44A6C6",
      "#7F7F7F",
    ],
  },
  {
    id: "lancet",
    label: "Lancet",
    colors: [
      "#00468B",
      "#ED0000",
      "#42B540",
      "#0099B4",
      "#925E9F",
      "#FDAF91",
      "#AD002A",
      "#ADB6B6",
      "#1B1919",
    ],
  },
  {
    id: "startrek",
    label: "Star Trek",
    colors: ["#CC0C00", "#5C88DA", "#84BD00", "#FFCD00", "#7C878E", "#00B5E2", "#00AF66"],
  },
  {
    id: "simpsons",
    label: "Simpsons",
    colors: [
      "#F99B45",
      "#EF3E2C",
      "#66CC99",
      "#6799CC",
      "#E5E5E5",
      "#5C9AD6",
      "#A67C52",
      "#FFCC33",
    ],
  },
];

/** 热图渐变色板(grDevices 连续色阶) */
export const HEAT_PALETTES: { id: string; label: string; gradient: string }[] = [
  {
    id: "Blue-Red 2",
    label: "蓝-红(默认)",
    gradient: "linear-gradient(to right, #2166ac, #f7f7f7, #b2182b)",
  },
  {
    id: "RdBu",
    label: "RdBu 红-蓝",
    gradient: "linear-gradient(to right, #ca0020, #f7f7f7, #0571b0)",
  },
  {
    id: "Viridis",
    label: "Viridis",
    gradient: "linear-gradient(to right, #440154, #21918c, #fde725)",
  },
  {
    id: "Inferno",
    label: "Inferno",
    gradient: "linear-gradient(to right, #000004, #bb3754, #fcffa4)",
  },
  {
    id: "Magma",
    label: "Magma",
    gradient: "linear-gradient(to right, #000004, #8c2981, #fcfdbf)",
  },
  {
    id: "Plasma",
    label: "Plasma",
    gradient: "linear-gradient(to right, #0d0887, #cc4778, #f0f921)",
  },
  {
    id: "Spectral",
    label: "Spectral",
    gradient: "linear-gradient(to right, #9e0142, #f5d96b, #5e4fa2)",
  },
];

/** Cluster 注释配色(离散分类) */
export const CLUSTER_PALETTES: { id: string; label: string; colors: string[] }[] = [
  {
    id: "npg",
    label: "NPG",
    colors: ["#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F", "#8491B4"],
  },
  {
    id: "Catppuccin Mocha",
    label: "Catppuccin Mocha",
    colors: ["#f38ba8", "#fab387", "#a6e3a1", "#74c7ec", "#cba6f7", "#f5c2e7"],
  },
  {
    id: "jco",
    label: "JCO",
    colors: ["#0073C2", "#EFC000", "#868686", "#CD534C", "#7AA6DC"],
  },
  {
    id: "lancet",
    label: "Lancet",
    colors: ["#00468B", "#ED0000", "#42B540", "#0099B4", "#925E9F"],
  },
  {
    id: "category10_d3",
    label: "D3 10 色",
    colors: ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd"],
  },
];

/** 发表尺寸预设(单位英寸) */
export const PUB_PRESETS = [
  {
    id: "nature_sc",
    label: "Nature 单栏",
    journal: "Nature",
    span: "单栏",
    desc: "89 mm 宽 · 投稿常用",
    w: 3.5,
    h: 5,
    accent: "#0a84ff",
  },
  {
    id: "nature_dc",
    label: "Nature 双栏",
    journal: "Nature",
    span: "双栏",
    desc: "183 mm 宽 · 全幅图",
    w: 7,
    h: 5,
    accent: "#30d158",
  },
  {
    id: "science",
    label: "Science 双栏",
    journal: "Science",
    span: "双栏",
    desc: "17.5 cm 宽",
    w: 6.9,
    h: 6,
    accent: "#af52de",
  },
  {
    id: "cell",
    label: "Cell 1.5 栏",
    journal: "Cell",
    span: "1.5 栏",
    desc: "11.4 cm 宽",
    w: 4.5,
    h: 6.85,
    accent: "#ff375f",
  },
  {
    id: "generic",
    label: "通用 7×5",
    journal: "通用",
    span: "双栏",
    desc: "多数期刊可接受",
    w: 7,
    h: 5,
    accent: "#ff9f0a",
  },
] as const;

/** ggplot 原生主题 */
export const GG_THEMES = [
  { id: "bw", label: "theme_bw", desc: "白底 + 边框(默认·发表常用)" },
  { id: "classic", label: "theme_classic", desc: "轴线经典,无网格" },
  { id: "minimal", label: "theme_minimal", desc: "极简,轻网格" },
  { id: "gray", label: "theme_gray", desc: "ggplot2 默认灰底" },
  { id: "light", label: "theme_light", desc: "浅色网格线" },
  { id: "linedraw", label: "theme_linedraw", desc: "黑线清晰" },
  { id: "dark", label: "theme_dark", desc: "深色背景" },
  { id: "void", label: "theme_void", desc: "无坐标轴/网格" },
];

/** 走 build_theme 的图(展示 ggplot 主题选项) */
export const GGPLOT_PLOT_IDS = new Set([
  "pca",
  "volcano",
  "ma",
  "boxplot",
  "deg_bar",
  "top_genes",
  "enrich",
  "gsea",
  "violin",
  "density",
]);

export function isGgplotPlot(id: string | null | undefined): boolean {
  return !!id && GGPLOT_PLOT_IDS.has(id);
}

export const ALL_DBS = ["GO", "KEGG", "Reactome", "WikiPathways"];
export const ALL_ONT = ["BP", "CC", "MF"];

export function plotLabel(id: string | null): string {
  return PLOT_GROUPS.find((p) => p.id === id)?.label ?? id ?? "";
}
