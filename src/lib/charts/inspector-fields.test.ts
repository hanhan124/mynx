import type { ChartConfig } from "@/features/charts/model";
import {
  applyLegendToggle,
  clampInspectorNumber,
  createInitialChartConfig,
} from "./inspector-fields.ts";

// 可由未来的 Vitest 直接复用；保持无副作用，避免把测试框架带入生产包。
// 覆盖 3.1-3A 属性检查器参数迁移中的值转换契约：
// 默认值不变、0 不被当作空值、空输入不提交默认值、预设往返不丢参数。
const batchAFields = [
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

const isExactly = (value: unknown, expected: unknown) =>
  value === expected && typeof value === typeof expected;

export const chartInspectorTestCases = {
  defaultsKeepTitleTextEmpty: () => {
    const cfg = createInitialChartConfig();
    return (
      cfg.title === "" &&
      cfg.subtitle === "" &&
      cfg.caption === "" &&
      cfg.plotTag === ""
    );
  },
  defaultsKeepAppearanceValues: () => {
    const cfg = createInitialChartConfig();
    return (
      isExactly(cfg.color, "#0A84FF") &&
      isExactly(cfg.ggTheme, "bw") &&
      isExactly(cfg.baseSize, 12) &&
      isExactly(cfg.fontFamily, "sans") &&
      isExactly(cfg.palette, "npg") &&
      isExactly(cfg.paletteReverse, false) &&
      isExactly(cfg.showLegend, true) &&
      isExactly(cfg.legendPosition, "right") &&
      isExactly(cfg.showTitle, true) &&
      isExactly(cfg.titleSize, 14) &&
      isExactly(cfg.titleHjust, 0.5) &&
      isExactly(cfg.axisTextSize, 10) &&
      isExactly(cfg.axisTitleSize, 11)
    );
  },
  defaultsKeepTypesAndTemplate: () => {
    const cfg = createInitialChartConfig();
    return (
      typeof cfg.baseSize === "number" &&
      typeof cfg.titleHjust === "number" &&
      typeof cfg.titleSize === "number" &&
      typeof cfg.showLegend === "boolean" &&
      typeof cfg.paletteReverse === "boolean" &&
      typeof cfg.title === "string" &&
      typeof cfg.template.id === "string" &&
      cfg.template.id.length > 0
    );
  },
  clampKeepsValidZero: () => clampInspectorNumber(0, 0, 1) === 0,
  clampKeepsFractionalZeroString: () => clampInspectorNumber("0", 8, 32) === 8,
  clampEmptyInputReturnsNull: () =>
    clampInspectorNumber("", 8, 32) === null &&
    clampInspectorNumber(null, 8, 32) === null &&
    clampInspectorNumber(undefined, 8, 32) === null,
  clampNonNumericInputReturnsNull: () => clampInspectorNumber("abc", 8, 32) === null,
  clampPassesInRangeValue: () =>
    clampInspectorNumber(12, 8, 32) === 12 && clampInspectorNumber("15", 8, 32) === 15,
  clampClampsOutOfRangeValue: () =>
    clampInspectorNumber(40, 8, 32) === 32 && clampInspectorNumber(1, 8, 32) === 8,
  legendToggleKeepsPositionWhenTurningOff: () => {
    const next = applyLegendToggle({ showLegend: true, legendPosition: "left" }, false);
    return next.showLegend === false && next.legendPosition === "left";
  },
  legendToggleKeepsPositionWhenTurningOn: () => {
    const next = applyLegendToggle({ showLegend: false, legendPosition: "bottom" }, true);
    return next.showLegend === true && next.legendPosition === "bottom";
  },
  legendToggleNormalizesStaleNone: () => {
    const next = applyLegendToggle({ showLegend: true, legendPosition: "none" }, true);
    return next.showLegend === true && next.legendPosition === "right";
  },
  presetRoundtripPreservesBatchFields: () => {
    const edited: ChartConfig = {
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
    // 模拟预设保存（saveChartPresets 走 JSON 序列化）再按 loadPreset 的合并方式恢复
    const saved = JSON.parse(JSON.stringify({ ...edited, template: edited.template.id }));
    const merged = { ...createInitialChartConfig(), ...saved } as ChartConfig;
    return batchAFields.every((field) => {
      const savedValue = (saved as Record<string, unknown>)[field];
      const mergedValue = merged[field] as unknown;
      return savedValue === mergedValue && typeof savedValue === typeof mergedValue;
    });
  },
  presetRoundtripKeepsEmptyStringOverDefault: () => {
    // 空字符串是合法的用户输入（如清空标题），合并默认值时不得被覆盖或丢类型
    const saved = JSON.parse(
      JSON.stringify({ ...createInitialChartConfig(), title: "" }),
    );
    const merged = { ...createInitialChartConfig(), ...saved } as ChartConfig;
    return merged.title === "" && typeof merged.title === "string";
  },
};
