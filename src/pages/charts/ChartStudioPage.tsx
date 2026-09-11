import { useEffect, useMemo } from "react";
import {
  IconChartAreaLine,
  IconChartBar,
  IconChartBubble,
  IconChartDots3,
  IconChartPie,
  IconChartScatter,
  IconChevronRight,
  IconCircleCheckFilled,
  IconCopy,
  IconDeviceFloppy,
  IconDownload,
  IconExternalLink,
  IconFileSpreadsheet,
  IconFolder,
  IconLayoutGrid,
  IconMapPin,
  IconPlayerPlayFilled,
  IconRadar,
  IconSparkles,
  IconTopologyStar3,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { resourceDir } from "@tauri-apps/api/path";
import JSZip from "jszip";
import { loadChartPresets, saveChartPresets, type ChartPreset } from "@/lib/config";
import {
  legacyTemplateMigration,
  verifiedChartTemplates,
  type ChartTemplate,
} from "@/lib/charts/catalog";
import { cancelChartRun, installR, runChart } from "@/lib/charts/runner";
import { checkRscript, resetRscriptCache } from "@/shared/platform/r-runtime";
import { openInShell, joinPath } from "@/shared/platform/files";
import LoadingOverlay from "@/components/LoadingOverlay";
import { showToast } from "@/components/Toast";
import { useDropZone } from "@/hooks/useDropZone";
import { useLanguage } from "@/lib/i18n";
import type {
  ChartConfig,
  ChartResult,
  RunEvent,
  GgplotTheme,
  LegendPosition,
  PublicationPreset,
  PaletteId,
} from "@/features/charts/model";
import { useChartStudioState } from "@/features/charts/application/useChartStudioState";

function ChartTemplateIcon({
  template,
  size = 16,
}: {
  template: ChartTemplate;
  size?: number;
}) {
  const props = { size, stroke: 1.8 };
  switch (template.icon) {
    case "bar":
      return <IconChartBar {...props} />;
    case "line":
      return <IconChartAreaLine {...props} />;
    case "scatter":
      return <IconChartScatter {...props} />;
    case "distribution":
      return <IconChartDots3 {...props} />;
    case "pie":
      return <IconChartPie {...props} />;
    case "matrix":
      return <IconChartBubble {...props} />;
    case "network":
      return <IconTopologyStar3 {...props} />;
    case "radar":
      return <IconRadar {...props} />;
    default:
      return <IconMapPin {...props} />;
  }
}

const CHART_FAMILY_EN: Record<string, string> = {
  基础比较: "Basic comparison",
  趋势与关系: "Trends & relationships",
  分布: "Distribution",
  组成: "Composition",
  矩阵与层级: "Matrices & hierarchy",
  空间与网络: "Spatial & networks",
  高级图: "Advanced",
  流向图: "Flow diagrams",
  表格与集合: "Tables & sets",
};

const CHART_TEMPLATE_EN: Record<string, { name: string; description: string }> = {
  "bar-basic-ggplot2": {
    name: "Basic bar chart",
    description: "A basic ggplot2 bar chart from R Graph Gallery",
  },
  "line-basic-ggplot2": {
    name: "Basic line chart",
    description: "A basic ggplot2 line chart from R Graph Gallery",
  },
  "scatter-basic-ggplot2": {
    name: "Basic scatter plot",
    description: "A basic ggplot2 scatter plot from R Graph Gallery",
  },
  "histogram-basic-ggplot2": {
    name: "Basic histogram",
    description: "A basic ggplot2 histogram from R Graph Gallery",
  },
  "boxplot-basic-ggplot2": {
    name: "Basic box plot",
    description: "A basic ggplot2 box plot from R Graph Gallery",
  },
  "density-basic-ggplot2": {
    name: "Basic density plot",
    description: "A basic ggplot2 density plot from R Graph Gallery",
  },
  "violin-basic-ggplot2": {
    name: "Basic violin plot",
    description: "A basic ggplot2 violin plot from R Graph Gallery",
  },
  "pie-basic-ggplot2": {
    name: "Basic pie chart",
    description: "A basic ggplot2 pie chart from R Graph Gallery",
  },
  "heatmap-basic-ggplot2": {
    name: "Basic heatmap",
    description: "A basic ggplot2 heatmap from R Graph Gallery",
  },
  "radar-basic-ggplot2": {
    name: "Basic radar chart",
    description: "A basic radar chart in the R Graph Gallery style",
  },
  "area-basic-ggplot2": {
    name: "Basic area chart",
    description: "A basic area chart from R Graph Gallery",
  },
  "regression-basic-ggplot2": {
    name: "Regression scatter plot",
    description: "Scatter points with a linear trend band",
  },
  "lollipop-basic-ggplot2": {
    name: "Lollipop chart",
    description: "A clean ranking with lines and dots",
  },
  "donut-basic-ggplot2": {
    name: "Donut chart",
    description: "A hollow pie chart with room for a center annotation",
  },
  "circular-bar-basic-ggplot2": {
    name: "Circular bar chart",
    description: "Category bars arranged around a circle",
  },
  "grouped-bar-basic-ggplot2": {
    name: "Grouped bar chart",
    description: "Use color to compare bars across groups",
  },
  "stacked-bar-basic-ggplot2": {
    name: "Stacked bar chart",
    description: "Show totals and group composition",
  },
  "bubble-basic-ggplot2": {
    name: "Bubble chart",
    description: "Use point size for a third numeric dimension",
  },
  "correlogram-basic-ggplot2": {
    name: "Correlation matrix",
    description: "Inspect correlations among numeric variables",
  },
  "dendrogram-basic-ggplot2": {
    name: "Dendrogram",
    description: "Show hierarchical clustering of samples or variables",
  },
  "parallel-basic-ggplot2": {
    name: "Parallel coordinates",
    description: "Compare record profiles across multiple metrics",
  },
  "network-basic-ggplot2": {
    name: "Network graph",
    description: "Show a relationship network with nodes and links",
  },
  "sankey-basic-ggplot2": {
    name: "Sankey diagram",
    description: "Show flow and scale between categories",
  },
  "chord-basic-ggplot2": {
    name: "Chord diagram",
    description: "Show two-way connections between groups",
  },
  "map-points-basic-ggplot2": {
    name: "Longitude-latitude point map",
    description: "Plot locations and values in geographic coordinates",
  },
  "wordcloud-basic": {
    name: "Word cloud",
    description: "Emphasize keywords by frequency",
  },
  "venn-basic": {
    name: "Venn diagram",
    description: "Show intersections of two or three sets",
  },
  "connected-scatter-basic-ggplot2": {
    name: "Connected scatter plot",
    description: "Connect points to show the direction of change",
  },
  "slope-basic-ggplot2": {
    name: "Slope chart",
    description: "Compare the same object at two time points",
  },
  "table-basic": { name: "Data table", description: "Export a data table as an image" },
  "ridgeline-basic": {
    name: "Ridgeline plot",
    description: "Compare distribution shapes across groups",
  },
  "beeswarm-basic": {
    name: "Beeswarm plot",
    description: "Show every observation while avoiding overlap",
  },
  "waffle-basic": { name: "Waffle chart", description: "Use a grid to show composition" },
  "treemap-basic": {
    name: "Treemap",
    description: "Use area to show hierarchical composition",
  },
  "alluvial-basic": {
    name: "Alluvial diagram",
    description: "Track category flow across stages",
  },
  "upset-basic": {
    name: "UpSet plot",
    description: "Compare intersections across multiple sets",
  },
  "hexbin-basic": {
    name: "Hexbin density plot",
    description: "Aggregate many scatter points into hexagons",
  },
  "bubble-map-basic": {
    name: "Bubble map",
    description: "Use bubble size to show values at geographic points",
  },
  "choropleth-basic": {
    name: "Choropleth map",
    description: "Shade polygon areas by values",
  },
  "density2d-basic-ggplot2": {
    name: "2D density plot",
    description: "Use contours for density of two numeric variables",
  },
  "arc-basic": {
    name: "Arc diagram",
    description: "Show links between nodes along a baseline",
  },
  "edge-bundling-basic": {
    name: "Edge-bundling graph",
    description: "Bundle related links into curved paths",
  },
  "stacked-area-basic-ggplot2": {
    name: "Stacked area chart",
    description: "Show cumulative change of categories over time",
  },
  "streamchart-basic-ggplot2": {
    name: "Streamgraph",
    description: "Show composition trends with smooth flow bands",
  },
  "circular-packing-basic": {
    name: "Circle packing",
    description: "Use nested circles for hierarchy and scale",
  },
  "time-series-basic-ggplot2": {
    name: "Time-series chart",
    description: "Show continuous trends by date",
  },
  "connection-basic": {
    name: "Connection plot",
    description: "Show relationships between two node sets",
  },
  "cartogram-basic": {
    name: "Grid cartogram",
    description: "Use equal-area cells to compare regional values",
  },
  "dotplot-basic-ggplot2": {
    name: "Dot plot",
    description: "Compact comparison of category values with dots",
  },
  "cleveland-basic-ggplot2": {
    name: "Cleveland dot plot",
    description: "Compare category values across two groups",
  },
  "volcano-basic-ggplot2": {
    name: "Volcano plot",
    description: "Show fold change and significance together",
  },
  "ma-basic-ggplot2": {
    name: "MA plot",
    description: "Inspect expression level versus fold change",
  },
  "pca-basic-ggplot2": {
    name: "PCA plot",
    description: "Show overall sample differences using principal components",
  },
  "forest-basic-ggplot2": {
    name: "Forest plot",
    description: "Show estimates and confidence intervals",
  },
  "enrichment-dotplot-ggplot2": {
    name: "Enrichment dot plot",
    description: "Show pathway ratio, significance, and hit count",
  },
  "km-survival-ggplot2": {
    name: "Kaplan–Meier survival curve",
    description: "Show survival probability, censoring, and group differences",
  },
  "gsea-curve-ggplot2": {
    name: "GSEA enrichment curve",
    description: "Show running enrichment score through a ranked gene list",
  },
};

function localizedTemplate(template: ChartTemplate, language: "zh" | "en") {
  return language === "en"
    ? (CHART_TEMPLATE_EN[template.id] ?? {
        name: template.name,
        description: template.description,
      })
    : { name: template.name, description: template.description };
}

function localizedFamily(family: string, language: "zh" | "en") {
  return language === "en" ? (CHART_FAMILY_EN[family] ?? family) : family;
}

const publicationPresets: Record<
  PublicationPreset,
  {
    label: string;
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
> = {
  custom: {
    label: "自定义",
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
    label: "Nature 单栏 · 89 mm",
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
    label: "Nature 双栏 · 183 mm",
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
    label: "通用单栏 · 85 mm",
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
    label: "通用双栏 · 170 mm",
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

function bytesToDataUrl(bytes: Uint8Array, mime = "image/png") {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

const samples: Record<string, string> = {
  "bar-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "line-basic-ggplot2": "day,value\n1,8\n2,11\n3,9\n4,14\n5,17\n",
  "scatter-basic-ggplot2": "x,y\n1,2\n2,3\n3,2.5\n4,5\n5,4.5\n",
  "histogram-basic-ggplot2": "value\n4\n5\n6\n7\n7\n8\n9\n10\n11\n12\n",
  "boxplot-basic-ggplot2": "group,value\nA,5\nA,7\nA,6\nB,9\nB,11\nB,10\n",
  "density-basic-ggplot2": "value\n4\n5\n6\n6\n7\n7\n8\n9\n10\n11\n12\n",
  "violin-basic-ggplot2": "group,value\nA,5\nA,7\nA,6\nA,8\nB,9\nB,11\nB,10\nB,12\n",
  "pie-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "heatmap-basic-ggplot2":
    "row,col,value\nA,X,4\nA,Y,8\nA,Z,5\nB,X,7\nB,Y,3\nB,Z,9\nC,X,6\nC,Y,5\nC,Z,8\n",
  "radar-basic-ggplot2": "metric,value\n速度,8\n质量,7\n稳定性,9\n易用性,6\n扩展性,8\n",
  "area-basic-ggplot2": "day,value\n1,8\n2,11\n3,9\n4,14\n5,17\n",
  "regression-basic-ggplot2": "x,y\n1,2\n2,3\n3,2.5\n4,5\n5,4.5\n6,6\n",
  "lollipop-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "donut-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "circular-bar-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\nE,13\n",
  "grouped-bar-basic-ggplot2":
    "group,series,value\nA,一组,12\nA,二组,18\nB,一组,9\nB,二组,15\nC,一组,14\nC,二组,11\n",
  "stacked-bar-basic-ggplot2":
    "group,series,value\nA,一组,12\nA,二组,18\nB,一组,9\nB,二组,15\nC,一组,14\nC,二组,11\n",
  "bubble-basic-ggplot2": "x,y,size\n1,2,10\n2,3,16\n3,2.5,12\n4,5,24\n5,4.5,19\n",
  "correlogram-basic-ggplot2":
    "speed,quality,stability\n8,7,9\n7,8,8\n9,9,7\n6,7,8\n8,6,9\n",
  "dendrogram-basic-ggplot2":
    "speed,quality,stability\n8,7,9\n7,8,8\n9,9,7\n6,7,8\n8,6,9\n",
  "parallel-basic-ggplot2":
    "speed,quality,stability,usability\n8,7,9,6\n7,8,8,8\n9,9,7,7\n6,7,8,9\n8,6,9,7\n",
  "network-basic-ggplot2": "from,to,weight\nA,B,4\nA,C,2\nB,C,3\nC,D,5\nD,A,1\n",
  "sankey-basic-ggplot2":
    "from,to,value\n访问,注册,42\n访问,离开,18\n注册,购买,25\n注册,离开,17\n",
  "chord-basic-ggplot2": "from,to,value\n甲,乙,4\n甲,丙,2\n乙,丙,3\n丙,丁,5\n丁,甲,1\n",
  "map-points-basic-ggplot2":
    "longitude,latitude,value\n116.38,39.90,12\n121.47,31.23,19\n113.26,23.13,9\n114.06,22.54,15\n",
  "wordcloud-basic": "word,freq\n分析,42\n可视化,35\n数据,31\n实验,22\n结果,18\n",
  "venn-basic": "set,size\nA,12\nB,10\nAB,5\n",
  "connected-scatter-basic-ggplot2": "step,x,y\n1,1,2\n2,2,3\n3,3,2.5\n4,4,5\n5,5,4.5\n",
  "slope-basic-ggplot2": "group,before,after\nA,12,18\nB,19,15\nC,9,14\nD,15,17\n",
  "table-basic": "指标,数值\n速度,8\n质量,7\n稳定性,9\n易用性,6\n",
  "ridgeline-basic": "group,value\nA,5\nA,7\nA,6\nA,8\nB,9\nB,11\nB,10\nB,12\n",
  "beeswarm-basic": "group,value\nA,5\nA,7\nA,6\nA,8\nB,9\nB,11\nB,10\nB,12\n",
  "waffle-basic": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "treemap-basic": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "alluvial-basic":
    "stage1,stage2,stage3,value\n新客,注册,购买,25\n新客,注册,离开,17\n回访,购买,复购,18\n回访,购买,离开,12\n",
  "upset-basic": "A,B,C\n1,1,0\n1,1,1\n1,0,1\n0,1,1\n1,1,0\n",
  "hexbin-basic":
    "x,y\n1,2\n1.2,2.1\n1.1,1.9\n2,3\n2.1,3.2\n3,2.5\n3.1,2.6\n4,5\n4.2,4.8\n",
  "bubble-map-basic":
    "longitude,latitude,value\n116.38,39.90,12\n121.47,31.23,19\n113.26,23.13,9\n114.06,22.54,15\n",
  "choropleth-basic":
    'region,value,wkt\n甲区,12,"POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))"\n乙区,19,"POLYGON ((1 0, 2 0, 2 1, 1 1, 1 0))"\n丙区,9,"POLYGON ((0 1, 1 1, 1 2, 0 2, 0 1))"\n丁区,15,"POLYGON ((1 1, 2 1, 2 2, 1 2, 1 1))"\n',
  "density2d-basic-ggplot2":
    "x,y\n1,2\n1.2,2.1\n1.1,1.9\n2,3\n2.1,3.2\n3,2.5\n3.1,2.6\n4,5\n4.2,4.8\n",
  "arc-basic": "from,to\nA,B\nA,C\nB,C\nC,D\nD,A\n",
  "edge-bundling-basic": "from,to\nA,B\nA,C\nA,D\nB,C\nB,D\nC,D\n",
  "stacked-area-basic-ggplot2":
    "day,series,value\n1,一组,8\n1,二组,5\n2,一组,11\n2,二组,6\n3,一组,9\n3,二组,8\n4,一组,14\n4,二组,9\n5,一组,17\n5,二组,11\n",
  "streamchart-basic-ggplot2":
    "day,series,value\n1,一组,8\n1,二组,5\n2,一组,11\n2,二组,6\n3,一组,9\n3,二组,8\n4,一组,14\n4,二组,9\n5,一组,17\n5,二组,11\n",
  "circular-packing-basic": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "time-series-basic-ggplot2":
    "date,value\n2026-01-01,8\n2026-02-01,11\n2026-03-01,9\n2026-04-01,14\n2026-05-01,17\n",
  "connection-basic": "from,to\n北京,上海\n北京,广州\n上海,深圳\n广州,成都\n",
  "cartogram-basic": "region,value\n甲区,12\n乙区,19\n丙区,9\n丁区,15\n",
  "dotplot-basic-ggplot2": "group,value\nA,12\nB,19\nC,9\nD,15\n",
  "cleveland-basic-ggplot2": "group,before,after\nA,12,18\nB,19,15\nC,9,14\nD,15,17\n",
  "volcano-basic-ggplot2":
    "gene,log2FC,padj\nGene_A,2.8,0.0004\nGene_B,-2.3,0.0012\nGene_C,1.6,0.018\nGene_D,-1.4,0.031\nGene_E,0.4,0.42\nGene_F,-0.2,0.68\nGene_G,3.2,0.00008\nGene_H,-2.8,0.0003\n",
  "ma-basic-ggplot2":
    "gene,baseMean,log2FC,padj\nGene_A,120,2.1,0.002\nGene_B,35,-1.8,0.01\nGene_C,680,0.8,0.12\nGene_D,240,-0.9,0.08\nGene_E,42,1.4,0.03\nGene_F,920,-2.2,0.0007\nGene_G,150,0.1,0.85\nGene_H,310,1.9,0.004\n",
  "pca-basic-ggplot2":
    "sample,group,gene_A,gene_B,gene_C,gene_D,gene_E\nS1,对照,8,7,9,6,8\nS2,对照,7,8,8,7,9\nS3,对照,9,9,7,8,8\nS4,处理,3,4,2,5,3\nS5,处理,4,3,3,4,2\nS6,处理,2,5,4,3,4\n",
  "forest-basic-ggplot2":
    "term,estimate,low,high\n总体,1.42,1.15,1.76\n年龄,1.18,1.02,1.37\n治疗组,0.68,0.52,0.88\n生物标志物,1.91,1.36,2.68\n吸烟,1.27,0.96,1.68\n",
  "enrichment-dotplot-ggplot2":
    "term,geneRatio,padj,count\n细胞周期,0.42,0.0008,38\nDNA 修复,0.31,0.003,27\n免疫反应,0.26,0.009,24\n氧化磷酸化,0.22,0.018,19\n细胞凋亡,0.18,0.041,16\nRNA 剪接,0.14,0.083,12\n",
  "km-survival-ggplot2":
    "time,event,group\n3,1,对照\n5,0,对照\n7,1,对照\n8,0,对照\n10,1,对照\n4,1,处理\n6,1,处理\n9,0,处理\n11,1,处理\n13,0,处理\n",
  "gsea-curve-ggplot2":
    "rank,score,inSet\n1,2.8,1\n2,2.5,0\n3,2.2,0\n4,2.0,1\n5,1.8,0\n6,1.5,0\n7,1.2,0\n8,1.0,1\n9,0.8,0\n10,0.6,0\n11,0.3,0\n12,0.1,1\n13,-0.2,0\n14,-0.5,0\n15,-0.8,0\n",
};
const initial = (): ChartConfig => ({
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
});
const templateDefaults: Record<
  string,
  { x: string; y: string; group?: string; size?: string }
> = {
  "bar-basic-ggplot2": { x: "group", y: "value" },
  "line-basic-ggplot2": { x: "day", y: "value" },
  "scatter-basic-ggplot2": { x: "x", y: "y" },
  "histogram-basic-ggplot2": { x: "", y: "value" },
  "boxplot-basic-ggplot2": { x: "group", y: "value" },
  "density-basic-ggplot2": { x: "", y: "value" },
  "violin-basic-ggplot2": { x: "group", y: "value" },
  "pie-basic-ggplot2": { x: "group", y: "value" },
  "heatmap-basic-ggplot2": { x: "col", y: "row" },
  "radar-basic-ggplot2": { x: "metric", y: "value" },
  "area-basic-ggplot2": { x: "day", y: "value" },
  "regression-basic-ggplot2": { x: "x", y: "y" },
  "lollipop-basic-ggplot2": { x: "group", y: "value" },
  "donut-basic-ggplot2": { x: "group", y: "value" },
  "circular-bar-basic-ggplot2": { x: "group", y: "value" },
  "grouped-bar-basic-ggplot2": { x: "group", y: "value", group: "series" },
  "stacked-bar-basic-ggplot2": { x: "group", y: "value", group: "series" },
  "bubble-basic-ggplot2": { x: "x", y: "y", size: "size" },
  "correlogram-basic-ggplot2": { x: "", y: "" },
  "dendrogram-basic-ggplot2": { x: "", y: "" },
  "parallel-basic-ggplot2": { x: "", y: "" },
  "network-basic-ggplot2": { x: "from", y: "to" },
  "sankey-basic-ggplot2": { x: "from", y: "to", group: "value" },
  "chord-basic-ggplot2": { x: "from", y: "to", group: "value" },
  "map-points-basic-ggplot2": { x: "longitude", y: "latitude" },
  "wordcloud-basic": { x: "word", y: "freq" },
  "venn-basic": { x: "set", y: "size" },
  "connected-scatter-basic-ggplot2": { x: "x", y: "y" },
  "slope-basic-ggplot2": { x: "group", y: "before", group: "after" },
  "table-basic": { x: "", y: "" },
  "ridgeline-basic": { x: "group", y: "value" },
  "beeswarm-basic": { x: "group", y: "value" },
  "waffle-basic": { x: "group", y: "value" },
  "treemap-basic": { x: "group", y: "value" },
  "alluvial-basic": { x: "stage1", y: "stage2", group: "stage3", size: "value" },
  "upset-basic": { x: "", y: "" },
  "hexbin-basic": { x: "x", y: "y" },
  "bubble-map-basic": { x: "longitude", y: "latitude", size: "value" },
  "choropleth-basic": { x: "region", y: "value", size: "wkt" },
  "density2d-basic-ggplot2": { x: "x", y: "y" },
  "arc-basic": { x: "from", y: "to" },
  "edge-bundling-basic": { x: "from", y: "to" },
  "stacked-area-basic-ggplot2": { x: "day", y: "value", group: "series" },
  "streamchart-basic-ggplot2": { x: "day", y: "value", group: "series" },
  "circular-packing-basic": { x: "group", y: "value" },
  "time-series-basic-ggplot2": { x: "date", y: "value" },
  "connection-basic": { x: "from", y: "to" },
  "cartogram-basic": { x: "region", y: "value" },
  "dotplot-basic-ggplot2": { x: "group", y: "value" },
  "cleveland-basic-ggplot2": { x: "group", y: "before", group: "after" },
  "volcano-basic-ggplot2": { x: "log2FC", y: "padj", group: "gene" },
  "ma-basic-ggplot2": { x: "baseMean", y: "log2FC", group: "padj" },
  "pca-basic-ggplot2": { x: "", y: "", group: "group" },
  "forest-basic-ggplot2": { x: "term", y: "estimate", size: "low", group: "high" },
  "enrichment-dotplot-ggplot2": {
    x: "term",
    y: "geneRatio",
    group: "padj",
    size: "count",
  },
  "km-survival-ggplot2": { x: "time", y: "event", group: "group" },
  "gsea-curve-ggplot2": { x: "rank", y: "score", group: "inSet" },
};

export default function ChartStudioPage() {
  const { language } = useLanguage();
  const l = (zh: string, en: string) => (language === "en" ? en : zh);
  const templateCopy = (template: ChartTemplate) => localizedTemplate(template, language);
  const studio = useChartStudioState(initial, verifiedChartTemplates[0]);
  const {
    cfg,
    setCfg,
    family,
    setFamily,
    search,
    setSearch,
    presets,
    setPresets,
    running,
    setRunning,
    installingR,
    setInstallingR,
    cancelling,
    setCancelling,
    columns,
    setColumns,
    runStage,
    setRunStage,
    runProgress,
    setRunProgress,
    runEvents,
    setRunEvents,
    log,
    setLog,
    referenceImage,
    setReferenceImage,
    referenceLoadError,
    setReferenceLoadError,
    lastResult,
    setLastResult,
    rscriptFound,
    setRscriptFound,
  } = studio;
  /*
  const [family, setFamily] = useState("全部");
  const [search, setSearch] = useState("");
  const [presets, setPresets] = useState<ChartPreset[]>([]);
  const [running, setRunning] = useState(false);
  const [installingR, setInstallingR] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [runStage, setRunStage] = useState(0);
  const [runProgress, setRunProgress] = useState<number | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [log, setLog] = useState("选择图表并载入数据。");
  const [referenceImage, setReferenceImage] = useState("");
  const [referenceLoadError, setReferenceLoadError] = useState(false);
  const [lastResult, setLastResult] = useState<ChartResult | null>(null);
  const [rscriptFound, setRscriptFound] = useState<boolean | null>(null); */
  useEffect(() => {
    void loadChartPresets().then(setPresets);
    void homeDir().then((p) =>
      setCfg((v) => ({ ...v, outputDir: joinPath(p, "Mynx", "charts") })),
    );
  }, []);
  useEffect(() => {
    let active = true;
    void resourceDir()
      .then(async (dir) => {
        if (!active) return;
        setReferenceImage("");
        setReferenceLoadError(false);
        const { readFile } = await import("@tauri-apps/plugin-fs");
        const bytes = await readFile(
          joinPath(dir, "r", "chart-templates", cfg.template.id, "reference.png"),
        );
        if (active) setReferenceImage(bytesToDataUrl(bytes));
      })
      .catch(() => {
        if (active) {
          setReferenceImage("");
          setReferenceLoadError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [cfg.template.id]);
  useEffect(() => {
    let active = true;
    checkRscript()
      .then((result) => {
        if (active) setRscriptFound(result.found);
      })
      .catch(() => {
        if (active) setRscriptFound(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const recheckRscript = async () => {
    resetRscriptCache();
    setRscriptFound(null);
    try {
      const result = await checkRscript();
      setRscriptFound(result.found);
      showToast(
        result.found
          ? l("已检测到 Rscript", "Rscript detected")
          : l(
              "仍未找到 Rscript，请安装 R 后重试。",
              "Rscript was not found. Install R and retry.",
            ),
        result.found ? "success" : "error",
      );
    } catch {
      setRscriptFound(false);
      showToast(
        l("Rscript 检测失败，请稍后重试。", "Rscript check failed. Please retry."),
        "error",
      );
    }
  };
  const rscriptTag = () => {
    if (rscriptFound === null) {
      return (
        <span className="rx-tag" role="status">
          {l("Rscript 检测中…", "Checking Rscript…")}
        </span>
      );
    }
    return (
      <span
        className={`rx-tag rx-tag--clickable ${rscriptFound ? "rx-tag--ok" : "rx-tag--err"}`}
        role="button"
        tabIndex={0}
        title={l("点击重新检测", "Check again")}
        onClick={() => void recheckRscript()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") void recheckRscript();
        }}
      >
        {rscriptFound
          ? l("Rscript 就绪", "Rscript ready")
          : l("Rscript 未找到", "Rscript not found")}
      </span>
    );
  };
  const outputPath = lastResult?.path ?? "";
  const outputImage = useMemo(
    () =>
      outputPath && lastResult && ["png", "svg"].includes(lastResult.format)
        ? convertFileSrc(outputPath)
        : "",
    [lastResult, outputPath],
  );
  const families = useMemo(
    () => [
      "全部",
      ...Array.from(new Set(verifiedChartTemplates.map((item) => item.family))),
    ],
    [],
  );
  const visible = verifiedChartTemplates.filter(
    (item) =>
      (family === "全部" || item.family === family) &&
      (!search.trim() ||
        `${templateCopy(item).name} ${templateCopy(item).description} ${item.kind}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())),
  );
  const runState = cancelling
    ? "cancelling"
    : installingR
      ? "installing"
      : running
        ? "running"
        : runStage === 4
          ? "success"
          : runStage === -2
            ? "cancelled"
            : runStage === -1
              ? "error"
              : "idle";
  const runStatusLabel = (
    {
      running: l("正在生成", "Generating"),
      installing: l("正在安装 R", "Installing R"),
      cancelling: l("正在取消", "Cancelling"),
      success: l("已生成", "Generated"),
      cancelled: l("已取消", "Cancelled"),
      error: l("需要处理", "Needs attention"),
      idle: l("准备就绪", "Ready"),
    } as const
  )[runState];
  const runStatusCopy = (
    {
      running: l("正在生成，请稍候。", "Generating, please wait."),
      installing: l("正在安装 R，可以取消。", "Installing R; you can cancel."),
      cancelling: l(
        "正在取消，当前任务不会写入新结果。",
        "Cancelling; this task will not write a new result.",
      ),
      success: l("结果已保存。", "Result saved."),
      cancelled: l("本次未生成新结果。", "No new result was generated."),
      error: l(
        "请检查字段和数据格式后重试。",
        "Check fields and data format, then retry.",
      ),
      idle: l("载入示例或导入数据。", "Load an example or import data."),
    } as const
  )[runState];
  const runPercent = runStage === 4 ? 100 : Math.max(0, runProgress ?? 0);
  const runSteps = installingR
    ? [
        l("准备环境", "Prepare environment"),
        l("安装 R", "Install R"),
        l("重新检测", "Check again"),
        l("继续生成", "Continue"),
      ]
    : [
        l("检查环境", "Check environment"),
        l("读取数据", "Read data"),
        l("渲染图表", "Render chart"),
        l("保存结果", "Save result"),
      ];
  const runStageLabels: Record<string, string> = {
    environment: l("运行环境", "Environment"),
    data: l("数据准备", "Data preparation"),
    dependencies: l("依赖安装", "Dependencies"),
    render: l("图表渲染", "Chart rendering"),
    save: l("结果保存", "Result saved"),
    cancel: l("已取消", "Cancelled"),
    error: l("需要处理", "Needs attention"),
  };
  const showRunDetail = runState !== "idle";
  const currentResult = runState === "success";
  const resetRunStatus = () => {
    setRunStage(0);
    setRunProgress(null);
    setRunEvents([]);
  };
  const appendRunEvent = (event: RunEvent) => {
    setRunEvents((events) => {
      const latest = events[events.length - 1];
      if (latest?.message === event.message && latest.tone === event.tone) return events;
      return [...events, event].slice(-4);
    });
  };
  const change = <K extends keyof ChartConfig>(key: K, value: ChartConfig[K]) => {
    if (running) return;
    setCfg((v) => ({ ...v, [key]: value }));
    resetRunStatus();
  };
  const applyPublicationPreset = (presetId: PublicationPreset) => {
    if (running) return;
    const preset = publicationPresets[presetId];
    setCfg((value) => ({
      ...value,
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
      showGrid: presetId === "custom" ? value.showGrid : false,
      titleHjust: presetId === "custom" ? value.titleHjust : 0,
    }));
    resetRunStatus();
  };
  const selectTemplate = (item: ChartTemplate) => {
    if (running) return;
    const defaults = templateDefaults[item.id];
    setCfg((v) => ({
      ...v,
      template: item,
      x: defaults?.x ?? "",
      y: defaults?.y ?? "",
      group: defaults?.group ?? "",
      size: defaults?.size ?? "",
    }));
    resetRunStatus();
  };
  const profileFile = async (filePath: string): Promise<boolean> => {
    try {
      if (/\.(csv|tsv)$/i.test(filePath)) {
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        const text = await readTextFile(filePath);
        const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
        const detected = firstLine
          .split(/[,\t]/)
          .map((item) => item.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
        if (!detected.length) throw new Error("未找到表头");
        setColumns(detected);
        return true;
      }
      if (/\.(xlsx|xls)$/i.test(filePath)) {
        const { readFile } = await import("@tauri-apps/plugin-fs");
        const bytes = await readFile(filePath);
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
        const sheet = workbook.worksheets[0];
        const values = sheet?.getRow(1).values;
        const rowValues = Array.isArray(values) ? values : [];
        const detected = rowValues
          .slice(1)
          .map((value: unknown) => String(value ?? "").trim())
          .filter(Boolean);
        if (!detected.length) throw new Error("未找到表头");
        setColumns(detected);
        return true;
      }
      throw new Error("不支持的文件类型");
    } catch {
      setColumns([]);
      showToast(
        l(
          "未能读取数据表头，请确认首行是字段名称且文件未被占用。",
          "Could not read the data header. Make sure the first row contains field names and the file is not in use.",
        ),
        "error",
      );
      return false;
    }
  };
  const pickData = async () => {
    if (running) return;
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "数据文件", extensions: ["csv", "tsv", "xlsx", "xls"] }],
      });
      if (typeof picked === "string") {
        change("filePath", picked);
        await profileFile(picked);
      }
    } catch {
      showToast(
        l(
          "打开数据文件失败，请检查文件权限后重试。",
          "Could not open the data file. Check file permissions and retry.",
        ),
        "error",
      );
    }
  };
  const clearData = () => {
    if (running) return;
    change("filePath", "");
    setColumns([]);
  };
  const pickFolder = async () => {
    if (running) return;
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") change("outputDir", picked);
    } catch {
      showToast(
        l(
          "打开输出目录失败，请检查目录权限后重试。",
          "Could not open the output directory. Check directory permissions and retry.",
        ),
        "error",
      );
    }
  };
  const useDemo = async () => {
    if (running) return;
    try {
      const { tempDir } = await import("@tauri-apps/api/path");
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      const text = samples[cfg.template.id];
      const filePath = joinPath(await tempDir(), `mynx_${cfg.template.id}_sample.csv`);
      await writeFile(filePath, new TextEncoder().encode(text));
      change("filePath", filePath);
      setColumns(
        (text.split(/\r?\n/, 1)[0] ?? "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
      showToast(l("示例数据已载入", "Example data loaded"), "success");
    } catch {
      showToast(
        l(
          "示例数据写入失败，请检查临时文件夹权限后重试。",
          "Could not write example data. Check temporary-folder permissions and retry.",
        ),
        "error",
      );
    }
  };
  const downloadSample = async () => {
    try {
      const path = await save({
        defaultPath: `${cfg.template.id}-sample.csv`,
        filters: [{ name: "CSV 数据", extensions: ["csv"] }],
      });
      if (!path) return;
      const { writeFile } = await import("@tauri-apps/plugin-fs");
      await writeFile(path, new TextEncoder().encode(samples[cfg.template.id]));
      showToast(l("示例数据已保存", "Example data saved"), "success");
      if (
        window.confirm(
          l("同时保存 R 脚本和模板说明？", "Save the R script and template notes too?"),
        )
      )
        await downloadTemplate();
    } catch {
      showToast(
        l(
          "示例数据下载失败，请检查目标文件夹权限后重试。",
          "Could not download example data. Check the target-folder permissions and retry.",
        ),
        "error",
      );
    }
  };
  const handleDataDrop = async (paths: string[]) => {
    if (running) return;
    const dataPath = paths.find((path) => /\.(csv|tsv|xlsx|xls)$/i.test(path));
    if (!dataPath) {
      showToast(
        l("请拖入 CSV、TSV 或 Excel 数据文件。", "Drop a CSV, TSV, or Excel data file."),
        "info",
      );
      return;
    }
    change("filePath", dataPath);
    await profileFile(dataPath);
  };
  const { dropRef: dataDropRef, isDragOver: isDataDragOver } =
    useDropZone(handleDataDrop);
  const downloadTemplate = async () => {
    try {
      const path = await save({
        defaultPath: `${cfg.template.id}-template.zip`,
        filters: [{ name: "模板压缩包", extensions: ["zip"] }],
      });
      if (!path) return;
      const base = joinPath(await resourceDir(), "r", "chart-templates", cfg.template.id);
      const { readTextFile, writeFile } = await import("@tauri-apps/plugin-fs");
      const zip = new JSZip();
      for (const file of ["manifest.json", "sample.csv", "render.R", "README.zh-CN.md"]) {
        try {
          zip.file(file, await readTextFile(joinPath(base, file)));
        } catch {
          /* optional template metadata */
        }
      }
      await writeFile(path, await zip.generateAsync({ type: "uint8array" }));
      showToast(l("模板文件已保存", "Template file saved"), "success");
    } catch (error) {
      showToast(
        `模板下载失败：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  };
  const savePreset = async () => {
    const name = window.prompt(
      l("为这组参数命名", "Name this parameter set"),
      cfg.template.name,
    );
    if (!name?.trim()) return;
    const next = [
      {
        id: crypto.randomUUID(),
        name: name.trim(),
        config: { ...cfg, template: cfg.template.id },
        updatedAt: Date.now(),
      },
      ...presets,
    ];
    try {
      await saveChartPresets(next);
      setPresets(next);
      showToast(l("参数模板已保存", "Parameter preset saved"), "success");
    } catch {
      showToast(
        l(
          "参数保存失败，请检查本地存储权限后重试。",
          "Could not save the preset. Check local-storage permissions and retry.",
        ),
        "error",
      );
    }
  };
  const deletePreset = async (preset: ChartPreset) => {
    if (
      !window.confirm(l(`删除参数“${preset.name}”？`, `Delete preset “${preset.name}”?`))
    )
      return;
    const next = presets.filter((item) => item.id !== preset.id);
    try {
      await saveChartPresets(next);
      setPresets(next);
      showToast(l("参数模板已删除", "Parameter preset deleted"), "success");
    } catch {
      showToast(
        l("参数删除失败，请稍后重试。", "Could not delete the preset. Retry later."),
        "error",
      );
    }
  };
  const exportPresets = async () => {
    try {
      const path = await save({
        defaultPath: "mynx-chart-presets.json",
        filters: [{ name: "参数文件", extensions: ["json"] }],
      });
      if (!path) return;
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, JSON.stringify(presets, null, 2));
      showToast(l("参数已导出", "Presets exported"), "success");
    } catch {
      showToast(
        l(
          "参数导出失败，请检查目标文件夹权限后重试。",
          "Could not export presets. Check the target-folder permissions and retry.",
        ),
        "error",
      );
    }
  };
  const importPresets = async () => {
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "参数文件", extensions: ["json"] }],
      });
      if (typeof picked !== "string") return;
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const raw = JSON.parse(await readTextFile(picked));
      if (!Array.isArray(raw)) throw new Error("参数文件格式不正确");
      const valid = raw
        .filter(
          (item): item is ChartPreset =>
            item &&
            typeof item.id === "string" &&
            typeof item.name === "string" &&
            item.config &&
            typeof item.config === "object" &&
            verifiedChartTemplates.some(
              (template) =>
                template.id === (item.config as Record<string, unknown>).template,
            ),
        )
        .map((item) => ({ ...item, updatedAt: Number(item.updatedAt) || Date.now() }));
      const next = [
        ...valid,
        ...presets.filter((old) => !valid.some((item) => item.id === old.id)),
      ];
      await saveChartPresets(next);
      setPresets(next);
      showToast(
        l(`已导入 ${valid.length} 条参数`, `${valid.length} presets imported`),
        "success",
      );
    } catch (error) {
      showToast(
        `导入失败：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  };
  const importConfigSidecar = async () => {
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "出图参数清单", extensions: ["json"] }],
      });
      if (typeof picked !== "string") return;
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const raw = JSON.parse(await readTextFile(picked)) as {
        config?: Record<string, unknown>;
      };
      if (!raw.config || typeof raw.config !== "object")
        throw new Error("没有找到可用的图表参数");
      const savedId = String(raw.config.template ?? "");
      const migratedId = legacyTemplateMigration[savedId] ?? savedId;
      const template = verifiedChartTemplates.find((item) => item.id === migratedId);
      if (!template) throw new Error("参数清单中的模板在当前版本不可用");
      setCfg({ ...initial(), ...raw.config, template } as ChartConfig);
      resetRunStatus();
      showToast(
        l(
          `已恢复“${template.name}”的出图参数`,
          `Chart settings for “${template.name}” restored`,
        ),
        "success",
      );
    } catch (error) {
      showToast(
        `参数清单读取失败：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  };
  const loadPreset = (preset: ChartPreset) => {
    if (running) return;
    const saved = preset.config as Record<string, unknown>;
    const savedId = String(saved.template ?? "");
    const migratedId = legacyTemplateMigration[savedId] ?? savedId;
    const template =
      verifiedChartTemplates.find((t) => t.id === migratedId) ??
      verifiedChartTemplates[0];
    setCfg({ ...initial(), ...saved, template } as ChartConfig);
    resetRunStatus();
    showToast(
      template.id === savedId
        ? `已载入“${preset.name}”`
        : `“${preset.name}”已切换到对应图表模板`,
      "info",
    );
  };
  const localizeEvent = (message: string) => {
    const [code, value] = message.split(":", 2);
    const labels: Record<string, string> = {
      "environment.checking": "正在检查图表环境",
      "data.reading": "正在读取数据",
      "render.running": "正在生成图表",
      "save.complete": "图表已保存",
      "deps.install": "正在安装 R 包",
    };
    return labels[code] ? `${labels[code]}${value ? `：${value}` : ""}` : message;
  };
  const localizeError = (message: string) => {
    if (message === "CHART_RUN_CANCELLED" || message === "R_INSTALL_CANCELLED")
      return "已取消本次图表生成。";
    if (message.startsWith("MISSING_PACKAGE:"))
      return `缺少 R 包 ${message.slice("MISSING_PACKAGE:".length)}。请勾选“允许按需安装缺少的 R 包”后重试。`;
    if (message.startsWith("PACKAGE_INSTALL_FAILED:"))
      return `R 包 ${message.slice("PACKAGE_INSTALL_FAILED:".length)} 安装失败。请检查网络或 CRAN 镜像后重试。`;
    if (message.includes("TEMPLATE_RESOURCE_INCOMPLETE"))
      return "模板资源不完整，请重新安装或更新应用。";
    if (message.includes("OUTPUT_FILE_MISSING"))
      return "R 已运行，但没有找到输出文件，请检查数据列和参数。";
    return message;
  };
  const copyLog = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(log);
      else {
        const area = document.createElement("textarea");
        area.value = log;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.focus();
        area.select();
        const copied = document.execCommand("copy");
        area.remove();
        if (!copied) throw new Error("clipboard unavailable");
      }
      showToast(l("诊断信息已复制", "Diagnostics copied"), "success");
    } catch {
      showToast(
        l(
          "复制失败，请展开详细日志后手动复制",
          "Copy failed. Expand the detailed log and copy it manually.",
        ),
        "error",
      );
    }
  };
  const copySourceNote = async () => {
    const template = cfg.template;
    const note = `图表模板：${template.name}\n来源：R Graph Gallery（${template.galleryUrl}）${template.sourceRepoPath ? `\n源文件：${template.sourceRepoPath}` : ""}`;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(note);
      showToast(l("来源说明已复制", "Source note copied"), "success");
    } catch {
      showToast(
        l(
          "复制来源说明失败，请手动复制页脚链接。",
          "Could not copy the source note. Copy the footer link manually.",
        ),
        "error",
      );
    }
  };
  const openResult = async () => {
    try {
      await openInShell(outputPath);
    } catch {
      showToast(
        l(
          "无法打开结果文件，请确认文件仍在原位置。",
          "Could not open the result file. Make sure it is still in its original location.",
        ),
        "error",
      );
    }
  };
  const copySvgSource = async () => {
    if (!lastResult || lastResult.format !== "svg") return;
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const svg = await readTextFile(lastResult.path);
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(svg);
      showToast(
        l(
          "SVG 源码已复制，可粘贴到矢量编辑器",
          "SVG source copied; paste it into a vector editor.",
        ),
        "success",
      );
    } catch {
      showToast(
        l(
          "复制 SVG 失败，请直接打开结果文件。",
          "Could not copy SVG. Open the result file directly.",
        ),
        "error",
      );
    }
  };
  const exportResultPackage = async () => {
    if (!lastResult) return;
    try {
      const { readFile, writeFile } = await import("@tauri-apps/plugin-fs");
      const zip = new JSZip();
      const outputBytes = await readFile(lastResult.path);
      const outputName =
        lastResult.path.split(/[\\/]/).pop() || `mynx-result.${lastResult.format}`;
      zip.file(outputName, outputBytes);
      if (cfg.template.status === "verified") {
        try {
          const resources = await resourceDir();
          const templateDir = joinPath(
            resources,
            "r",
            "chart-templates",
            cfg.template.id,
          );
          for (const file of ["manifest.json", "render.R", "README.zh-CN.md"]) {
            zip.file(`template/${file}`, await readFile(joinPath(templateDir, file)));
          }
        } catch {
          // 模板资源在开发预览环境可能不随前端资源目录提供，结果本身仍可导出。
        }
      }
      zip.file("README.txt", "Mynx 科研绘图结果包\n包含图表文件和模板说明。\n");
      const archive = await zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
      });
      const target = await save({
        defaultPath: joinPath(cfg.outputDir, "mynx-figure-package.zip"),
        filters: [{ name: "ZIP 结果包", extensions: ["zip"] }],
      });
      if (typeof target !== "string") return;
      await writeFile(target, archive);
      showToast(l("结果包已导出", "Result package exported"), "success");
    } catch (error) {
      showToast(
        `结果包导出失败：${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  };
  const requestCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      if (!(await cancelChartRun())) {
        setCancelling(false);
        showToast(
          l(
            "当前任务已经结束，请稍候查看结果。",
            "The current task has finished; check the result shortly.",
          ),
          "info",
        );
        return;
      }
    } catch {
      setCancelling(false);
      showToast(
        l(
          "取消请求未能发送，请稍后重试。",
          "Could not send the cancellation request. Retry later.",
        ),
        "error",
      );
      return;
    }
    setLog((v) => `${v}\n正在取消本次生成…`.trim());
    appendRunEvent({ message: "正在取消本次生成", tone: "info", stage: "cancel" });
    showToast(l("正在取消图表生成", "Cancelling chart generation"), "info");
  };
  const generate = async () => {
    if (cfg.template.status !== "verified") {
      showToast(
        l(
          "该模板暂不可用，请选择其他图表模板。",
          "This template is unavailable. Choose another chart template.",
        ),
        "info",
      );
      return;
    }
    if (!cfg.filePath) {
      showToast(
        l("请先导入数据，或使用内置示例", "Import data or use a built-in example first"),
        "info",
      );
      return;
    }
    const fixedColumns = [
      "correlogram",
      "dendrogram",
      "parallel",
      "table",
      "upset",
      "pca",
    ].includes(cfg.template.kind);
    const requiresGroup = [
      "grouped_bar",
      "stacked_bar",
      "stacked_area",
      "streamchart",
      "alluvial",
      "enrichment",
      "gsea",
    ].includes(cfg.template.kind);
    const requiresSize = ["bubble", "bubble_map", "alluvial", "enrichment"].includes(
      cfg.template.kind,
    );
    if (columns.length > 0) {
      const required: Array<[string, string, boolean]> = [
        ["X / 分类列", cfg.x, !fixedColumns],
        ["Y / 数值列", cfg.y, !fixedColumns],
        ["分组 / 颜色列", cfg.group, requiresGroup],
        ["大小 / 权重列", cfg.size, requiresSize],
      ];
      const missing = required.find(([, value, requiredRole]) => requiredRole && !value);
      const unknown = required.find(([, value]) => value && !columns.includes(value));
      if (missing) {
        showToast(
          l(`请先填写${missing[0]}`, `Please fill in ${missing[0]} first`),
          "info",
        );
        return;
      }
      if (unknown) {
        showToast(
          l(
            `${unknown[0]}“${unknown[1]}”不在当前数据中，请从已识别字段中选择`,
            `${unknown[0]} “${unknown[1]}” is not in the current data. Choose a recognized field`,
          ),
          "info",
        );
        return;
      }
    }
    setRunning(true);
    setInstallingR(false);
    setCancelling(false);
    setRunStage(0);
    setRunProgress(0);
    setRunEvents([{ message: "正在检查图表环境", tone: "info", stage: "environment" }]);
    setLog(l("正在检查环境", "Checking environment"));
    const run = () =>
      runChart(
        {
          filePath: cfg.filePath,
          outputDir: cfg.outputDir,
          template: cfg.template.id,
          kind: cfg.template.kind,
          galleryUrl: cfg.template.galleryUrl,
          sourceRepoPath: cfg.template.sourceRepoPath,
          x: cfg.x,
          y: cfg.y,
          group: cfg.group,
          size: cfg.size,
          title: cfg.title,
          subtitle: cfg.subtitle,
          caption: cfg.caption,
          plotTag: cfg.plotTag,
          color: cfg.color,
          format: cfg.format,
          width: cfg.width,
          height: cfg.height,
          dpi: cfg.dpi,
          ggTheme: cfg.ggTheme,
          baseSize: cfg.baseSize,
          fontFamily: cfg.fontFamily,
          showLegend: cfg.showLegend,
          legendPosition: cfg.legendPosition,
          showGrid: cfg.showGrid,
          showTitle: cfg.showTitle,
          titleSize: cfg.titleSize,
          titleHjust: cfg.titleHjust,
          axisTextSize: cfg.axisTextSize,
          axisTitleSize: cfg.axisTitleSize,
          publicationPreset: cfg.publicationPreset,
          palette: cfg.palette,
          paletteReverse: cfg.paletteReverse,
          pointSize: cfg.pointSize,
          lineWidth: cfg.lineWidth,
          barWidth: cfg.barWidth,
          alpha: cfg.alpha,
          axisLineWidth: cfg.axisLineWidth,
          gridLineWidth: cfg.gridLineWidth,
          panelBorder: cfg.panelBorder,
          showRawPoints: cfg.showRawPoints,
          showStats: cfg.showStats,
          statTest: cfg.statTest,
          pAdjustMethod: cfg.pAdjustMethod,
          heatmapClusterRows: cfg.heatmapClusterRows,
          heatmapClusterCols: cfg.heatmapClusterCols,
          heatmapScale: cfg.heatmapScale,
          installMissing: cfg.installMissing,
          verified: cfg.template.status === "verified",
        },
        (line) => {
          try {
            const event = JSON.parse(line) as {
              stage?: string;
              message?: string;
              progress?: number | null;
            };
            const stageIndex =
              { environment: 0, data: 1, dependencies: 1, render: 2, save: 3 }[
                event.stage ?? ""
              ] ?? 0;
            setRunStage((current) => Math.max(current, stageIndex));
            if (typeof event.progress === "number") setRunProgress(event.progress);
            const message = localizeEvent(event.message ?? line);
            appendRunEvent({
              message,
              tone: event.stage === "save" ? "success" : "info",
              stage: event.stage ?? "environment",
            });
            setLog((v) => `${v}\n${message}`.trim());
          } catch {
            setLog((v) => `${v}\n${line}`.trim());
          }
        },
      );
    const safeRun = async () => {
      try {
        return await run();
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };
    let res = await safeRun();
    if (
      !res.ok &&
      res.error?.includes("尚未安装 R") &&
      window.confirm(
        l(
          "生成图表需要 R。现在通过 Windows 包管理器安装 R 吗？",
          "R is required to generate charts. Install it now through the Windows package manager?",
        ),
      )
    ) {
      setInstallingR(true);
      appendRunEvent({
        message: l("正在安装 R", "Installing R"),
        tone: "info",
        stage: "dependencies",
      });
      const installed = await installR((line) =>
        setLog((v) => `${v}\n${localizeEvent(line)}`.trim()),
      );
      setInstallingR(false);
      res = installed.ok ? await safeRun() : { ok: false, error: installed.error };
    }
    setRunning(false);
    setCancelling(false);
    if (res.ok && res.output) {
      const result = {
        path: res.output,
        templateId: cfg.template.id,
        templateName: cfg.template.name,
        format: cfg.format,
      } satisfies ChartResult;
      setLastResult(result);
      setRunStage(4);
      setRunProgress(100);
      setLog(
        (v) =>
          `${v}\n${l("完成：图表和参数清单已保存。", "Done: chart and settings manifest saved.")}`,
      );
      appendRunEvent({
        message: l("图表和参数清单已保存", "Chart and settings manifest saved"),
        tone: "success",
        stage: "save",
      });
      showToast(l("图表已生成", "Chart generated"), "success");
    } else {
      const wasCancelled =
        res.error === "CHART_RUN_CANCELLED" || res.error === "R_INSTALL_CANCELLED";
      const message = localizeError(res.error ?? "生成失败");
      setRunStage(wasCancelled ? -2 : -1);
      setRunProgress(null);
      appendRunEvent({
        message,
        tone: wasCancelled ? "cancelled" : "error",
        stage: wasCancelled ? "cancel" : "error",
      });
      showToast(message, wasCancelled ? "info" : "error");
    }
  };
  return (
    <div className="page-shell page-shell--wide chart-studio unified-page unified-page--chart">
      <LoadingOverlay
        visible={running}
        variant="live"
        text={
          cancelling
            ? l("正在取消图表任务…", "Cancelling chart task…")
            : installingR
              ? l("正在安装 R…", "Installing R…")
              : `${l("正在用 R 生成图表…", "Generating chart with R…")}${runProgress !== null ? ` ${Math.round(runProgress)}%` : ""}`
        }
        progress={installingR || cancelling ? null : runProgress}
        onCancel={() => {
          void requestCancel();
        }}
        cancelLabel={
          cancelling ? l("正在取消…", "Cancelling…") : l("取消生成", "Cancel generation")
        }
        cancelDisabled={cancelling}
      />
      <div className="panel-header">
        <div className="panel-icon" style={{ background: "#ff9f0a" }}>
          <IconChartDots3 size={18} color="white" />
        </div>
        <div className="panel-title">
          <h2>{l("科研绘图", "Scientific plotting")}</h2>
          <p>
            {l(
              "导入数据，按设定版式完成图形与导出",
              "Import data and export formatted figures",
            )}
          </p>
        </div>
        <div className="panel-actions">
          {rscriptTag()}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={savePreset}
            disabled={running}
          >
            <IconDeviceFloppy size={15} />
            {l("保存参数", "Save preset")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void importPresets()}
            disabled={running}
          >
            <IconUpload size={14} />
            {l("导入参数", "Import presets")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void importConfigSidecar()}
            disabled={running}
            title={l(
              "加载某次出图自动保存的 JSON 参数清单",
              "Load the JSON settings saved with a chart result",
            )}
          >
            <IconUpload size={14} />
            {l("加载出图参数", "Load chart settings")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void exportPresets()}
            disabled={running}
          >
            <IconDownload size={14} />
            {l("导出参数", "Export presets")}
          </button>
        </div>
      </div>
      <div className="chart-studio__notice">
        <IconSparkles size={16} />
        <span>
          {l(
            "按需准备 R 环境；只安装当前图形需要的依赖。",
            "Prepare R on demand; only dependencies required by the current chart are installed.",
          )}
        </span>
      </div>
      <div className="chart-studio__layout">
        <aside className="card chart-studio__catalog">
          <div className="card-title">
            {l("图表模板", "Chart templates")}{" "}
            <small className="chart-studio__result-count">
              {visible.length}/{verifiedChartTemplates.length}
            </small>
          </div>
          <div className="chart-studio__search">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={l("搜索图表名称或用途", "Search chart names or uses")}
              aria-label={l("搜索图表模板", "Search chart templates")}
              disabled={running}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label={l("清空搜索", "Clear search")}
                disabled={running}
              >
                <IconX size={13} />
                {l("清空", "Clear")}
              </button>
            )}
          </div>
          <div className="chart-studio__families">
            {families.map((name) => (
              <button
                type="button"
                key={name}
                onClick={() => setFamily(name)}
                className={family === name ? "active" : ""}
                aria-pressed={family === name}
                disabled={running}
              >
                {localizedFamily(name, language)}
              </button>
            ))}
          </div>
          <div className="chart-studio__templates">
            {visible.length ? (
              visible.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  title={`${l("选择", "Select ")}${templateCopy(item).name}`}
                  className={cfg.template.id === item.id ? "selected" : ""}
                  onClick={() => selectTemplate(item)}
                  aria-pressed={cfg.template.id === item.id}
                  disabled={running}
                >
                  <i className="chart-studio__template-icon" aria-hidden="true">
                    <ChartTemplateIcon template={item} />
                  </i>
                  <span>
                    <strong>{templateCopy(item).name}</strong>
                    <small>{templateCopy(item).description}</small>
                  </span>
                  <IconChevronRight size={14} />
                </button>
              ))
            ) : (
              <div className="chart-studio__empty">
                {l(
                  "没有匹配的模板，试试“分布”“地图”或“关系”。",
                  "No templates match. Try distribution, map, or relationship.",
                )}
              </div>
            )}
          </div>
        </aside>
        <section className="chart-studio__work">
          <div className="card">
            <div className="card-title">
              <IconFileSpreadsheet size={15} />
              {l("数据与输出", "Data & output")}
            </div>
            <div className="card-body">
              <div
                ref={dataDropRef}
                className={`chart-studio__data-file file-display${isDataDragOver ? " file-display--drag" : ""}`}
              >
                <div className="file-icon chart-studio__data-file-icon">
                  <IconFileSpreadsheet size={18} color="white" stroke={1.75} />
                </div>
                <div className="file-info">
                  <div className="file-name">
                    {cfg.filePath
                      ? cfg.filePath.split(/[\\/]/).pop()
                      : l("未选择文件", "No file selected")}
                  </div>
                  <div className="file-path">
                    {cfg.filePath ||
                      l("拖入 CSV、TSV 或 Excel 文件", "Drop a CSV, TSV, or Excel file")}
                  </div>
                </div>
                {isDataDragOver && (
                  <span className="drop-hint">{l("释放以导入", "Drop to import")}</span>
                )}
              </div>
              <div className="chart-studio__data-actions btn-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={pickData}
                  disabled={running}
                >
                  <IconUpload size={14} />
                  {l("导入数据", "Import data")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={useDemo}
                  disabled={running}
                >
                  <IconSparkles size={14} />
                  {l("使用示例", "Use example")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={downloadSample}
                  disabled={running}
                >
                  <IconDownload size={14} />
                  {l("下载 CSV", "Download CSV")}
                </button>
                {cfg.filePath && (
                  <button
                    type="button"
                    className="btn btn-ghost chart-studio__clear-data"
                    onClick={clearData}
                    disabled={running}
                  >
                    {l("清空", "Clear")}
                  </button>
                )}
              </div>
              <div className="form-row chart-studio__mapping-row">
                <div className="form-group">
                  <label htmlFor="chart-x">
                    {l("X / 分类列", "X / category column")}
                  </label>
                  <input
                    id="chart-x"
                    value={cfg.x}
                    onChange={(e) => change("x", e.target.value)}
                    placeholder="如 group"
                    disabled={running}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="chart-y">{l("Y / 数值列", "Y / value column")}</label>
                  <input
                    id="chart-y"
                    value={cfg.y}
                    onChange={(e) => change("y", e.target.value)}
                    placeholder="如 value"
                    disabled={running}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="chart-group">
                    {l("分组 / 颜色列（可选）", "Group / color column (optional)")}
                  </label>
                  <input
                    id="chart-group"
                    value={cfg.group}
                    onChange={(e) => change("group", e.target.value)}
                    placeholder="如 treatment"
                    disabled={running}
                  />
                </div>
                {["bubble", "bubble_map", "map", "choropleth", "alluvial"].includes(
                  cfg.template.kind,
                ) && (
                  <div className="form-group">
                    <label htmlFor="chart-size">
                      {cfg.template.kind === "choropleth"
                        ? l("空间几何列（WKT）", "Spatial geometry column (WKT)")
                        : cfg.template.kind === "alluvial"
                          ? l("流量数值列", "Flow value column")
                          : l("大小 / 权重列（可选）", "Size / weight column (optional)")}
                    </label>
                    <input
                      id="chart-size"
                      value={cfg.size}
                      onChange={(e) => change("size", e.target.value)}
                      placeholder={
                        cfg.template.kind === "choropleth"
                          ? "如 wkt"
                          : cfg.template.kind === "alluvial"
                            ? "如 value"
                            : "如 size 或 value"
                      }
                      disabled={running}
                    />
                  </div>
                )}
              </div>
              <div className="chart-studio__file-row chart-studio__output-row">
                <div>
                  <strong>{l("输出文件夹", "Output folder")}</strong>
                  <small>{cfg.outputDir}</small>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={pickFolder}
                  disabled={running}
                >
                  <IconFolder size={14} />
                  {l("选择位置", "Choose location")}
                </button>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-title">
              <span className="chart-studio__selected-icon">
                <ChartTemplateIcon template={cfg.template} size={17} />
              </span>
              {templateCopy(cfg.template).name}{" "}
              <span className="chart-studio__kind">
                {localizedFamily(cfg.template.family, language)}
              </span>
            </div>
            <div className="card-body">
              <p className="chart-studio__description">
                {templateCopy(cfg.template).description}
                {l(
                  "。设置字段和外观后生成。",
                  ". Set the fields and appearance, then generate.",
                )}
              </p>
              {(referenceImage || referenceLoadError) && (
                <div className="chart-studio__reference">
                  <div>
                    <strong>{l("参考效果", "Reference")}</strong>
                  </div>
                  {referenceImage ? (
                    <img
                      src={referenceImage}
                      alt={`${templateCopy(cfg.template).name} ${l("参考图", "reference")}`}
                      loading="lazy"
                      onError={() => {
                        setReferenceImage("");
                        setReferenceLoadError(true);
                      }}
                    />
                  ) : (
                    <a
                      className="chart-studio__reference-fallback"
                      href={cfg.template.galleryUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {l(
                        "本地参考图暂时无法读取，打开参考页面",
                        "Local reference image is unavailable; open reference page",
                      )}
                      <IconExternalLink size={13} />
                    </a>
                  )}
                </div>
              )}
              <div className="form-row chart-studio__text-fields">
                <div className="form-group">
                  <label htmlFor="chart-title">{l("图表标题", "Chart title")}</label>
                  <input
                    id="chart-title"
                    value={cfg.title}
                    onChange={(e) => change("title", e.target.value)}
                    placeholder={l("留空则自动命名", "Leave blank for automatic naming")}
                    disabled={running}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="chart-subtitle">
                    {l("副标题（可选）", "Subtitle (optional)")}
                  </label>
                  <input
                    id="chart-subtitle"
                    value={cfg.subtitle}
                    onChange={(e) => change("subtitle", e.target.value)}
                    placeholder={l(
                      "例如：处理组与对照组的差异",
                      "e.g. Difference between treatment and control",
                    )}
                    disabled={running}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="chart-caption">
                    {l("图注（可选）", "Caption (optional)")}
                  </label>
                  <input
                    id="chart-caption"
                    value={cfg.caption}
                    onChange={(e) => change("caption", e.target.value)}
                    placeholder={l(
                      "例如：数据为均值 ± 标准误",
                      "e.g. Values are mean ± SEM",
                    )}
                    disabled={running}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="chart-plot-tag">
                    {l("面板标记（可选）", "Panel tag (optional)")}
                  </label>
                  <input
                    id="chart-plot-tag"
                    value={cfg.plotTag}
                    onChange={(e) => change("plotTag", e.target.value)}
                    placeholder={l("例如：A", "e.g. A")}
                    maxLength={8}
                    disabled={running}
                  />
                </div>
              </div>
              <div className="form-row chart-studio__visual-options">
                <div className="form-group">
                  <label htmlFor="chart-color">{l("主颜色", "Primary color")}</label>
                  <input
                    id="chart-color"
                    type="color"
                    value={cfg.color}
                    onChange={(e) => change("color", e.target.value)}
                    disabled={running}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="chart-format">{l("导出格式", "Export format")}</label>
                  <select
                    id="chart-format"
                    value={cfg.format}
                    onChange={(e) =>
                      change("format", e.target.value as ChartConfig["format"])
                    }
                    disabled={running}
                  >
                    <option value="png">{l("PNG（位图）", "PNG (raster)")}</option>
                    <option value="tiff">
                      {l("TIFF（投稿位图）", "TIFF (publication raster)")}
                    </option>
                    <option value="svg">{l("SVG（矢量）", "SVG (vector)")}</option>
                    <option value="pdf">{l("PDF（矢量）", "PDF (vector)")}</option>
                    <option value="eps">{l("EPS（矢量）", "EPS (vector)")}</option>
                  </select>
                </div>
              </div>
              <div className="form-row chart-studio__publication-row">
                <div className="form-group">
                  <label htmlFor="chart-publication-preset">
                    {l("论文规格", "Publication preset")}
                  </label>
                  <select
                    id="chart-publication-preset"
                    value={cfg.publicationPreset}
                    onChange={(e) =>
                      applyPublicationPreset(e.target.value as PublicationPreset)
                    }
                    disabled={running}
                  >
                    {Object.entries(publicationPresets).map(([id, preset]) => (
                      <option key={id} value={id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <small className="form-hint">
                    {l(
                      "按最终排版宽度设置，生成后仍可微调。",
                      "Set by final layout width; you can refine it after generation.",
                    )}
                  </small>
                </div>
              </div>
              <div className="form-row form-row--three">
                <div className="form-group">
                  <label htmlFor="chart-width">{l("宽度（英寸）", "Width (in)")}</label>
                  <input
                    id="chart-width"
                    type="number"
                    min="2"
                    max="30"
                    step="0.5"
                    value={cfg.width}
                    onChange={(e) =>
                      change("width", Math.max(2, Number(e.target.value) || 8))
                    }
                    disabled={running}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="chart-height">{l("高度（英寸）", "Height (in)")}</label>
                  <input
                    id="chart-height"
                    type="number"
                    min="2"
                    max="30"
                    step="0.5"
                    value={cfg.height}
                    onChange={(e) =>
                      change("height", Math.max(2, Number(e.target.value) || 5))
                    }
                    disabled={running}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="chart-dpi">
                    {l("PNG 清晰度（DPI）", "PNG resolution (DPI)")}
                  </label>
                  <input
                    id="chart-dpi"
                    type="number"
                    min="72"
                    max="600"
                    step="12"
                    value={cfg.dpi}
                    onChange={(e) =>
                      change(
                        "dpi",
                        Math.min(600, Math.max(72, Number(e.target.value) || 180)),
                      )
                    }
                    disabled={running}
                  />
                </div>
              </div>
              <div className="chart-studio__appearance">
                <div className="chart-studio__appearance-title">
                  {l("ggplot 外观", "ggplot appearance")}
                </div>
                <div className="chart-studio__appearance-grid">
                  <div className="form-group">
                    <label htmlFor="chart-gg-theme">{l("主题", "Theme")}</label>
                    <select
                      id="chart-gg-theme"
                      value={cfg.ggTheme}
                      onChange={(e) => change("ggTheme", e.target.value as GgplotTheme)}
                      disabled={running}
                    >
                      <option value="auto">{l("模板默认", "Template default")}</option>
                      <option value="minimal">Minimal</option>
                      <option value="bw">{l("黑白（BW）", "Black & white (BW)")}</option>
                      <option value="classic">Classic</option>
                      <option value="light">Light</option>
                      <option value="gray">Gray</option>
                      <option value="dark">Dark</option>
                      <option value="void">Void</option>
                      <option value="linedraw">Line draw</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-font-family">{l("字体", "Font")}</label>
                    <select
                      id="chart-font-family"
                      value={cfg.fontFamily}
                      onChange={(e) => change("fontFamily", e.target.value)}
                      disabled={running}
                    >
                      <option value="sans">{l("无衬线", "Sans serif")}</option>
                      <option value="serif">{l("衬线", "Serif")}</option>
                      <option value="mono">{l("等宽", "Monospace")}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-palette">{l("配色", "Palette")}</label>
                    <select
                      id="chart-palette"
                      value={cfg.palette}
                      onChange={(e) => change("palette", e.target.value as PaletteId)}
                      disabled={running}
                    >
                      <option value="npg">NPG</option>
                      <option value="jama">JAMA</option>
                      <option value="lancet">Lancet</option>
                      <option value="okabe-ito">Okabe–Ito</option>
                      <option value="viridis">Viridis</option>
                      <option value="gray">{l("灰度", "Grayscale")}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-base-size">
                      {l("基础字号", "Base font size")}
                    </label>
                    <input
                      id="chart-base-size"
                      type="number"
                      min="8"
                      max="32"
                      step="1"
                      value={cfg.baseSize}
                      onChange={(e) =>
                        change(
                          "baseSize",
                          Math.min(32, Math.max(8, Number(e.target.value) || 12)),
                        )
                      }
                      disabled={running}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-legend-position">
                      {l("图例位置", "Legend position")}
                    </label>
                    <select
                      id="chart-legend-position"
                      value={cfg.showLegend ? cfg.legendPosition : "none"}
                      onChange={(e) => {
                        const value = e.target.value as LegendPosition;
                        change("legendPosition", value);
                        change("showLegend", value !== "none");
                      }}
                      disabled={running}
                    >
                      <option value="right">{l("右侧", "Right")}</option>
                      <option value="left">{l("左侧", "Left")}</option>
                      <option value="top">{l("上方", "Top")}</option>
                      <option value="bottom">{l("下方", "Bottom")}</option>
                      <option value="none">{l("不显示", "Hidden")}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-title-size">
                      {l("标题字号", "Title font size")}
                    </label>
                    <input
                      id="chart-title-size"
                      type="number"
                      min="8"
                      max="32"
                      step="1"
                      value={cfg.titleSize}
                      onChange={(e) =>
                        change(
                          "titleSize",
                          Math.min(32, Math.max(8, Number(e.target.value) || 14)),
                        )
                      }
                      disabled={running}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-title-align">
                      {l("标题对齐", "Title alignment")}
                    </label>
                    <select
                      id="chart-title-align"
                      value={String(cfg.titleHjust)}
                      onChange={(e) => change("titleHjust", Number(e.target.value))}
                      disabled={running}
                    >
                      <option value="0">{l("左对齐", "Left")}</option>
                      <option value="0.5">{l("居中", "Center")}</option>
                      <option value="1">{l("右对齐", "Right")}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-axis-text-size">
                      {l("刻度字号", "Tick font size")}
                    </label>
                    <input
                      id="chart-axis-text-size"
                      type="number"
                      min="7"
                      max="24"
                      step="1"
                      value={cfg.axisTextSize}
                      onChange={(e) =>
                        change(
                          "axisTextSize",
                          Math.min(24, Math.max(7, Number(e.target.value) || 10)),
                        )
                      }
                      disabled={running}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-axis-title-size">
                      {l("坐标轴字号", "Axis title size")}
                    </label>
                    <input
                      id="chart-axis-title-size"
                      type="number"
                      min="7"
                      max="24"
                      step="1"
                      value={cfg.axisTitleSize}
                      onChange={(e) =>
                        change(
                          "axisTitleSize",
                          Math.min(24, Math.max(7, Number(e.target.value) || 11)),
                        )
                      }
                      disabled={running}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-point-size">{l("点大小", "Point size")}</label>
                    <input
                      id="chart-point-size"
                      type="number"
                      min="0.5"
                      max="12"
                      step="0.1"
                      value={cfg.pointSize}
                      onChange={(e) =>
                        change(
                          "pointSize",
                          Math.min(12, Math.max(0.5, Number(e.target.value) || 2.6)),
                        )
                      }
                      disabled={running}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-line-width">{l("线宽", "Line width")}</label>
                    <input
                      id="chart-line-width"
                      type="number"
                      min="0.1"
                      max="6"
                      step="0.1"
                      value={cfg.lineWidth}
                      onChange={(e) =>
                        change(
                          "lineWidth",
                          Math.min(6, Math.max(0.1, Number(e.target.value) || 0.8)),
                        )
                      }
                      disabled={running}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-alpha">{l("透明度", "Opacity")}</label>
                    <input
                      id="chart-alpha"
                      type="number"
                      min="0.05"
                      max="1"
                      step="0.05"
                      value={cfg.alpha}
                      onChange={(e) =>
                        change(
                          "alpha",
                          Math.min(1, Math.max(0.05, Number(e.target.value) || 0.8)),
                        )
                      }
                      disabled={running}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-axis-line-width">
                      {l("轴线宽度", "Axis line width")}
                    </label>
                    <input
                      id="chart-axis-line-width"
                      type="number"
                      min="0"
                      max="3"
                      step="0.05"
                      value={cfg.axisLineWidth}
                      onChange={(e) =>
                        change(
                          "axisLineWidth",
                          Math.min(3, Math.max(0, Number(e.target.value) || 0.45)),
                        )
                      }
                      disabled={running}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="chart-grid-line-width">
                      {l("网格线宽度", "Grid line width")}
                    </label>
                    <input
                      id="chart-grid-line-width"
                      type="number"
                      min="0"
                      max="2"
                      step="0.05"
                      value={cfg.gridLineWidth}
                      onChange={(e) =>
                        change(
                          "gridLineWidth",
                          Math.min(2, Math.max(0, Number(e.target.value) || 0.25)),
                        )
                      }
                      disabled={running}
                    />
                  </div>
                </div>
                <div className="chart-studio__appearance-toggles">
                  <label>
                    <input
                      type="checkbox"
                      checked={cfg.showGrid}
                      onChange={(e) => change("showGrid", e.target.checked)}
                      disabled={running}
                    />
                    {l("显示网格线", "Show grid lines")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={cfg.showTitle}
                      onChange={(e) => change("showTitle", e.target.checked)}
                      disabled={running}
                    />
                    {l("显示标题", "Show title")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={cfg.paletteReverse}
                      onChange={(e) => change("paletteReverse", e.target.checked)}
                      disabled={running}
                    />
                    {l("反转配色", "Reverse palette")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={cfg.panelBorder}
                      onChange={(e) => change("panelBorder", e.target.checked)}
                      disabled={running}
                    />
                    {l("显示面板边框", "Show panel border")}
                  </label>
                </div>
                <div className="chart-studio__stats-options">
                  <span className="chart-studio__stats-title">
                    {l("统计标注（分组分布图）", "Statistics (group distributions)")}
                  </span>
                  <label>
                    <input
                      type="checkbox"
                      checked={cfg.showRawPoints}
                      onChange={(e) => change("showRawPoints", e.target.checked)}
                      disabled={running}
                    />
                    {l("原始点", "Raw points")}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={cfg.showStats}
                      onChange={(e) => change("showStats", e.target.checked)}
                      disabled={running}
                    />
                    {l("组间 P 值", "Between-group P values")}
                  </label>
                  <select
                    value={cfg.statTest}
                    onChange={(e) =>
                      change("statTest", e.target.value as ChartConfig["statTest"])
                    }
                    disabled={running}
                    aria-label={l("统计检验", "Statistical test")}
                  >
                    <option value="wilcox.test">Wilcoxon</option>
                    <option value="t.test">{l("t 检验", "t test")}</option>
                  </select>
                  <select
                    value={cfg.pAdjustMethod}
                    onChange={(e) =>
                      change(
                        "pAdjustMethod",
                        e.target.value as ChartConfig["pAdjustMethod"],
                      )
                    }
                    disabled={running}
                    aria-label={l("多重比较校正", "Multiple-comparison adjustment")}
                  >
                    <option value="holm">{l("Holm 校正", "Holm adjustment")}</option>
                    <option value="bonferroni">Bonferroni</option>
                    <option value="BH">Benjamini–Hochberg</option>
                    <option value="none">{l("不校正", "No adjustment")}</option>
                  </select>
                </div>
                {(cfg.template.kind === "heatmap" ||
                  cfg.template.kind === "correlogram") && (
                  <div className="chart-studio__heatmap-options">
                    <span className="chart-studio__stats-title">
                      {l("热图设置", "Heatmap settings")}
                    </span>
                    <select
                      value={cfg.heatmapScale}
                      onChange={(e) =>
                        change(
                          "heatmapScale",
                          e.target.value as ChartConfig["heatmapScale"],
                        )
                      }
                      disabled={running}
                      aria-label={l("热图标准化方式", "Heatmap scaling")}
                    >
                      <option value="none">{l("不标准化", "No scaling")}</option>
                      <option value="row">{l("按行标准化", "Scale rows")}</option>
                      <option value="column">{l("按列标准化", "Scale columns")}</option>
                    </select>
                    <label>
                      <input
                        type="checkbox"
                        checked={cfg.heatmapClusterRows}
                        onChange={(e) => change("heatmapClusterRows", e.target.checked)}
                        disabled={running}
                      />
                      {l("行聚类", "Cluster rows")}
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={cfg.heatmapClusterCols}
                        onChange={(e) => change("heatmapClusterCols", e.target.checked)}
                        disabled={running}
                      />
                      {l("列聚类", "Cluster columns")}
                    </label>
                  </div>
                )}
              </div>
              <label className="chart-studio__check">
                <input
                  type="checkbox"
                  checked={cfg.installMissing}
                  onChange={(e) => change("installMissing", e.target.checked)}
                  disabled={running}
                />
                {l(
                  "允许按需安装缺少的 R 包（仅本次所需）",
                  "Allow installation of missing R packages (only for this run)",
                )}
              </label>
              <button
                type="button"
                className="btn btn-primary btn-full"
                disabled={running}
                onClick={generate}
              >
                <IconPlayerPlayFilled size={15} />
                {l("生成", "Generate")} {templateCopy(cfg.template).name}
              </button>
            </div>
          </div>
          <section
            className={`card chart-studio__run-card chart-studio__run-card--${runState}`}
            aria-label={l("图表生成状态", "Chart generation status")}
            aria-busy={running}
          >
            <div className="chart-studio__run-heading">
              <div className="chart-studio__run-title">
                <span className="chart-studio__run-icon">
                  {runState === "success" ? (
                    <IconCircleCheckFilled size={18} />
                  ) : runState === "error" || runState === "cancelled" ? (
                    <IconX size={18} />
                  ) : (
                    <IconChartDots3 size={18} />
                  )}
                </span>
                <div>
                  <h3>{l("图表生成", "Chart generation")}</h3>
                  <p>
                    {templateCopy(cfg.template).name} · {runStatusCopy}
                  </p>
                </div>
              </div>
              <span className="chart-studio__run-badge">{runStatusLabel}</span>
            </div>
            {showRunDetail ? (
              <>
                <div
                  className={`chart-studio__run-progress${installingR ? " chart-studio__run-progress--indeterminate" : ""}`}
                  role="progressbar"
                  aria-label={l("图表生成进度", "Chart generation progress")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={installingR ? undefined : Math.round(runPercent)}
                  aria-valuetext={
                    installingR
                      ? l("正在安装 R", "Installing R")
                      : `${Math.round(runPercent)}%`
                  }
                >
                  <span style={installingR ? undefined : { width: `${runPercent}%` }} />
                </div>
                <ol
                  className="chart-studio__run-steps"
                  aria-label={l("生成步骤", "Generation steps")}
                >
                  {runSteps.map((label, index) => {
                    const state = installingR
                      ? index === 0
                        ? "done"
                        : index === 1
                          ? "current"
                          : "pending"
                      : runStage === 4 || runStage > index
                        ? "done"
                        : running && runStage === index
                          ? "current"
                          : "pending";
                    return (
                      <li
                        key={label}
                        className={`chart-studio__run-step chart-studio__run-step--${state}`}
                      >
                        <i>{state === "done" ? "✓" : index + 1}</i>
                        <span>{label}</span>
                      </li>
                    );
                  })}
                </ol>
                <div
                  className="chart-studio__event-list"
                  role="log"
                  aria-label={l("生成运行记录", "Generation activity")}
                  aria-live="polite"
                  aria-atomic="false"
                  aria-relevant="additions text"
                >
                  {[...runEvents].reverse().map((event, index) => {
                    return (
                      <div
                        className={`chart-studio__event chart-studio__event--${event.tone}`}
                        key={`${event.message}-${index}`}
                      >
                        <span className="chart-studio__event-dot" />
                        <div>
                          <strong>{event.message}</strong>
                          <small>
                            {index === 0
                              ? l("最新状态 · ", "Latest · ")
                              : l("本次生成 · ", "This run · ")}
                            {runStageLabels[event.stage] ??
                              l("科研绘图", "Scientific plotting")}
                          </small>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <details className="chart-studio__details">
                  <summary>{l("查看技术日志", "View technical log")}</summary>
                  <pre>{log}</pre>
                </details>
              </>
            ) : (
              <div className="chart-studio__run-empty">
                <IconSparkles size={15} />
                <span>
                  {l(
                    "生成后，这里会显示进度、运行记录和结果状态。",
                    "After generation, progress, activity, and result status appear here.",
                  )}
                </span>
              </div>
            )}
          </section>
          {presets.length > 0 && (
            <div className="card">
              <div className="card-title">{l("已保存的参数", "Saved presets")}</div>
              <div className="chart-studio__presets">
                {presets.map((preset) => (
                  <div className="chart-studio__preset" key={preset.id}>
                    <button
                      type="button"
                      onClick={() => loadPreset(preset)}
                      disabled={running}
                    >
                      <IconUpload size={13} />
                      <span>{preset.name}</span>
                      <small>{l("载入", "Load")}</small>
                    </button>
                    <button
                      type="button"
                      className="chart-studio__preset-delete"
                      onClick={() => void deletePreset(preset)}
                      aria-label={`${l("删除", "Delete ")}${preset.name}`}
                      disabled={running}
                    >
                      <IconTrash size={14} />
                      {l("删除", "Delete")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {columns.length > 0 && (
            <div className="chart-studio__columns" aria-live="polite">
              {l("已识别字段：", "Detected columns:")}
              {columns.map((column) => (
                <button
                  key={column}
                  type="button"
                  onClick={() =>
                    !cfg.x
                      ? change("x", column)
                      : !cfg.y
                        ? change("y", column)
                        : !cfg.group
                          ? change("group", column)
                          : [
                                "bubble",
                                "bubble_map",
                                "map",
                                "choropleth",
                                "alluvial",
                              ].includes(cfg.template.kind) && !cfg.size
                            ? change("size", column)
                            : change("group", column)
                  }
                  disabled={running}
                >
                  <IconLayoutGrid size={12} />
                  {column}
                </button>
              ))}
            </div>
          )}
          <div className="chart-studio__template-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadTemplate}
              disabled={running}
            >
              <IconDownload size={14} />
              {l("下载模板（CSV + R）", "Download template (CSV + R)")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void copyLog()}
            >
              <IconCopy size={13} />
              {l("复制诊断信息", "Copy diagnostics")}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void copySourceNote()}
            >
              <IconCopy size={13} />
              {l("复制来源说明", "Copy source note")}
            </button>
          </div>
          {outputPath && lastResult && (
            <div className="card chart-studio__result">
              <div className="card-title">
                <IconCircleCheckFilled size={15} />
                {currentResult
                  ? l("最近生成结果", "Latest result")
                  : l("上一次可用结果", "Previous available result")}{" "}
                <span className="chart-studio__kind">
                  {language === "en"
                    ? (CHART_TEMPLATE_EN[lastResult.templateId]?.name ??
                      lastResult.templateName)
                    : lastResult.templateName}
                </span>
              </div>
              <div className="card-body">
                {!currentResult && (
                  <p className="chart-studio__result-note">
                    {l(
                      "本次没有产生新的图表，下面保留的是之前成功生成的结果。",
                      "No new chart was created in this run. The previous successful result is retained below.",
                    )}
                  </p>
                )}
                {outputImage ? (
                  <img
                    src={outputImage}
                    alt={`${language === "en" ? (CHART_TEMPLATE_EN[lastResult.templateId]?.name ?? lastResult.templateName) : lastResult.templateName} ${l("生成结果", "result")}`}
                    loading="lazy"
                  />
                ) : (
                  <p className="chart-studio__result-note">
                    {lastResult.format.toUpperCase()}{" "}
                    {l(
                      "文件已生成，可用外部软件打开或插入论文。",
                      "The file was created. Open it in another app or insert it into a manuscript.",
                    )}
                  </p>
                )}
                <small title={outputPath}>{outputPath}</small>
                <small className="chart-studio__result-note">
                  {l(
                    "同目录已保存可复现参数清单（JSON）。",
                    "A reproducible JSON settings file is saved in the same folder.",
                  )}
                </small>
                <button
                  type="button"
                  className="btn btn-secondary btn-full"
                  onClick={() => void openResult()}
                >
                  <IconFolder size={14} />
                  {l("打开结果文件", "Open result file")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-full"
                  onClick={() => void exportResultPackage()}
                >
                  <IconDownload size={14} />
                  {l(
                    "导出结果包（图表 + 模板说明）",
                    "Export result package (chart + template notes)",
                  )}
                </button>
                {lastResult.format === "svg" && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-full"
                    onClick={() => void copySvgSource()}
                  >
                    <IconCopy size={14} />
                    {l("复制 SVG 源码", "Copy SVG source")}
                  </button>
                )}
              </div>
            </div>
          )}
          <footer className="chart-studio__credit">
            {l("图表来源：", "Chart source:")}{" "}
            <a href={cfg.template.galleryUrl} target="_blank" rel="noreferrer">
              R Graph Gallery
            </a>
            。
            <a
              href="https://r-graph-gallery.com/all-graphs"
              target="_blank"
              rel="noreferrer"
            >
              <IconExternalLink size={13} />
              {l("浏览全部示例", "Browse all examples")}
            </a>
            {l(
              "。官方示例代码与数据版权按原项目许可执行。",
              ". Example code and data remain subject to their original licenses.",
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
