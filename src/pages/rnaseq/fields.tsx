/**
 * RNA-seq 页面复用控件 — 全部按 mynx 设计体系(Tahoe 圆角阶梯 / --ease 过渡 / tabler 图标)。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconInfoCircle } from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";

const FIELD_LABELS_EN: Record<string, string> = {
  正方形: "Square",
  十字辅助线: "Crosshair",
  标签吸附: "Repel labels",
  标签内容: "Label content",
  "PCA 高变基因数": "PCA highly variable genes",
  最多基因数: "Maximum genes",
  行排序: "Row order",
  栅格化热图: "Rasterize heatmap",
  文库深度: "Library size",
  检测基因数: "Detected genes",
  表达分布: "Expression distribution",
  相关性热图: "Correlation heatmap",
  距离热图: "Distance heatmap",
  分组配色: "Group palette",
  柱图宽度: "Bar-plot width",
  柱图最小高度: "Minimum bar-plot height",
  每样本高度: "Height per sample",
  相关性图宽度: "Correlation-plot width",
  相关性图高度: "Correlation-plot height",
  距离图宽度: "Distance-plot width",
  距离图高度: "Distance-plot height",
  分组: "Group",
  样本: "Sample",
  无: "None",
  点大小: "Point size",
  点透明度: "Point opacity",
  点形状: "Point shape",
  "X 轴范围(min)": "X-axis range (min)",
  "X 轴范围(max)": "X-axis range (max)",
  "Y 轴范围(min)": "Y-axis range (min)",
  "Y 轴范围(max)": "Y-axis range (max)",
  显示所有基因: "Show all genes",
  "聚类数 k": "Number of clusters k",
  标记基因标签: "Marker-gene labels",
  "列名(分组)": "Column names (groups)",
  列名旋转角: "Column-label angle",
  "行名(基因名)": "Row names (genes)",
  热图配色: "Heatmap palette",
  "Z-score 下限": "Z-score minimum",
  "Z-score 上限": "Z-score maximum",
  "Cluster 注释": "Cluster annotation",
  "Cluster 配色": "Cluster palette",
  显示基因名: "Show gene names",
  显示分组名: "Show group names",
  基因名旋转角: "Gene-label angle",
  "标注 top N": "Annotate top N",
  标签大小: "Label size",
  阈值线: "Threshold lines",
  副标题: "Subtitle",
  标注策略: "Annotation strategy",
  "显著 top-N": "Significant top-N",
  仅标记基因: "Marker genes only",
  "top-N + 标记基因": "Top-N + marker genes",
  不标注: "No annotation",
  标上调: "Label upregulated",
  标下调: "Label downregulated",
  "p 值上限": "P-value limit",
  最大集合数: "Maximum sets",
  "LOESS 趋势线": "LOESS trend line",
  "X 轴文字旋转": "X-axis label angle",
  异常值大小: "Outlier size",
  箱线宽度: "Box width",
  箱体透明度: "Box opacity",
  柱子排列: "Bar arrangement",
  堆叠: "Stacked",
  并排: "Dodged",
  柱子宽度: "Bar width",
  显示数值: "Show values",
  "显示前 N 个": "Show top N",
  基因名斜体: "Italic gene names",
  聚类方法: "Clustering method",
  悬挂高度: "Hanging height",
  坐标轴字号: "Axis font size",
  物种: "Species",
  人类: "Human",
  小鼠: "Mouse",
  大鼠: "Rat",
  "p 值阈值": "P-value threshold",
  "q 值阈值": "Q-value threshold",
  "显示前 N 条": "Show top N terms",
  着色依据: "Color by",
  按数据库: "By database",
  "按 GO 本体": "By GO ontology",
  基因数: "Gene count",
  数据库: "Databases",
  "GO 本体": "GO ontology",
  上下调方向: "Up/down direction",
  "NES 连续着色": "Continuous NES color",
  "Running 图数": "Running plots",
  透明度: "Opacity",
  列数: "Columns",
  分组依据: "Group by",
  按样本: "By sample",
  按分组: "By group",
  "宽度(inches)": "Width (inches)",
  "高度(inches)": "Height (inches)",
  右: "Right",
  左: "Left",
  上: "Top",
  下: "Bottom",
  垂直: "Vertical",
  水平: "Horizontal",
  左对齐: "Left",
  居中: "Center",
  右对齐: "Right",
  "auto(theme 自带)": "Auto (theme default)",
  默认: "Default",
  "热图行标注;也用于火山图标注与小提琴图默认基因":
    "Heatmap row labels; also used for volcano labels and default violin genes",
  "绘制前从表达矩阵剔除(如线粒体/低质量基因);也作用于整体热图":
    "Remove from the expression matrix before plotting (e.g. mitochondrial/low-quality genes); also affects the global heatmap",
  "绘制前从表达矩阵剔除;也作用于 PCA":
    "Remove from the expression matrix before plotting; also affects PCA",
  "标注策略选「仅标记基因 / top-N + 标记基因」时使用;也用于整体热图与小提琴图":
    "Used for Marker genes only / Top-N + marker genes; also used by the global heatmap and violin plot",
  "上方「目标基因」留空时按此列表绘制;也用于整体热图与火山图标注":
    "Used when Target genes above is empty; also used by the global heatmap and volcano labels",
  "不过滤,显示全部基因": "No filtering; show all genes",
  防极端值压扁图: "Prevent extreme values from compressing the plot",
  "DESeq2 plotMA 标配": "Standard for DESeq2 plotMA",
  "每比较每库额外的 running-score 图":
    "Additional running-score plots per comparison and database",
  "默认 theme_bw": "Default theme_bw",
  "theme_*(base_size=)": "theme_*(base_size=)",
};

/** 未显式传入 hint 的图形参数也提供简明的、可悬浮阅读的科研说明。 */
const DEFAULT_FIELD_HINTS: Record<string, string> = {
  正方形: "锁定等宽高画布，适合 PCA、MDS 和火山图的横向比较。",
  十字辅助线: "在 0 坐标处绘制虚线，便于判断样本或效应量的方向。",
  标签吸附: "自动避让重叠标签；样本或基因较多时建议开启。",
  标签内容: "选择显示分组、样本名或不显示标签，不影响统计计算。",
  点大小: "仅调整散点的视觉大小，不改变数据值或显著性。",
  点透明度: "较低透明度更适合高密度散点，可减少遮挡。",
  点形状: "ggplot 点形状编号；仅在不按分组使用形状时生效。",
  "X 轴范围(min)": "留空自动计算；手动设置用于统一多张图的横坐标范围。",
  "X 轴范围(max)": "留空自动计算；手动设置用于统一多张图的横坐标范围。",
  "Y 轴范围(min)": "留空自动计算；手动设置用于统一多张图的纵坐标范围。",
  "Y 轴范围(max)": "留空自动计算；手动设置用于统一多张图的纵坐标范围。",
  "聚类数 k": "整体热图的行聚类数；用于视觉分区，不会重新做差异检验。",
  标记基因标签: "在热图中标出目标基因；标签过多会降低可读性。",
  "列名(分组)": "显示热图列的分组名称；关闭可让样本较多时画面更紧凑。",
  列名旋转角: "调整热图列标签角度，避免名称较长时相互遮挡。",
  "行名(基因名)": "显示热图的基因名称；大基因集通常建议关闭。",
  热图配色: "选择低—中—高表达的连续色阶；不改变 Z-score 或原始表达值。",
  "Z-score 下限": "显示色阶的下限；截断极低值以提升主体基因的对比度。",
  "Z-score 上限": "显示色阶的上限；截断极高值以提升主体基因的对比度。",
  "Cluster 注释": "在热图旁显示自动聚类分组，便于解释共同表达模块。",
  "Cluster 配色": "仅改变热图聚类注释条的颜色。",
  显示所有基因: "跳过 DEG 候选筛选绘制全基因热图；基因很多时可读性会下降。",
  "PCA 高变基因数": "仅用于 PCA：选取方差最高的基因；0 或留空表示使用所有变换后的基因。",
  最多基因数: "候选 DEG 超出此数时按最小 FDR、再按效应量取前列基因；0 表示不限制。",
  行排序: "设置热图基因行的自动顺序。手动排序文件存在时会优先采用手动顺序。",
  栅格化热图: "将热图主体作为位图写入 PDF，可减小超大图体积；关闭可保留可编辑矢量色块。",
  文库深度: "导出每个样本进入分析的原始计数总和。",
  检测基因数: "导出每个样本中原始 count 大于 0 的基因数量。",
  表达分布: "导出变换表达值的箱线图，用于检查样本分布是否异常。",
  相关性热图: "导出样本间 Pearson 相关性热图。",
  距离热图: "导出样本间欧氏距离热图。",
  分组配色: "仅改变 QC 图中各分组的显示颜色。",
  柱图宽度: "文库深度、检测基因数和表达分布图的导出宽度（英寸）。",
  柱图最小高度: "QC 柱图的最小导出高度（英寸）。",
  每样本高度: "QC 图随样本数增长的高度（英寸/样本），与最小高度取较大值。",
  相关性图宽度: "样本相关性热图导出宽度（英寸）。",
  相关性图高度: "样本相关性热图导出高度（英寸）。",
  距离图宽度: "样本距离热图导出宽度（英寸）。",
  距离图高度: "样本距离热图导出高度（英寸）。",
  "标注 top N": "每张火山图标注最显著的基因数；过多标签会相互遮挡。",
  标签大小: "仅调整图中文字的字号。",
  阈值线: "显示当前 log2FC 与 FDR 判定阈值，便于读者识别显著区域。",
  副标题: "显示阈值或统计摘要；不影响主标题与分析结果。",
  标注策略: "决定火山图标注最显著基因、目标基因，或两者并集。",
  标上调: "控制是否显示上调基因的标签。",
  标下调: "控制是否显示下调基因的标签。",
  上调颜色: "只改变上调显著基因的颜色。",
  下调颜色: "只改变下调显著基因的颜色。",
  不显著颜色: "只改变未达阈值基因的颜色。",
  "LOESS 趋势线": "添加局部回归趋势线以辅助观察 MA 图的系统性偏移。",
  "宽度(inches)": "导出画布宽度；期刊通常以英寸或毫米规定图宽。",
  "高度(inches)": "导出画布高度；与宽度共同决定字体和点的相对大小。",
  显示: "控制该图例或元素是否显示，不删除任何分析结果。",
  位置: "设置图例在画布中的位置。",
  图例标题: "设置颜色或形状图例的标题。",
  标题字号: "调整主标题字号。",
  文字字号: "调整图例或坐标文本字号。",
  轴标题颜色: "调整坐标轴标题的颜色。",
  刻度颜色: "调整坐标轴刻度文字的颜色。",
  刻度字号: "调整坐标轴刻度文字的字号。",
  透明度: "调整图层透明度；数值越低，重叠数据越容易辨认。",
  颜色: "选择该图层或类别的显示颜色。",
  显示数值: "在柱形图上显示计数或数值。",
  "显示前 N 个": "限制条形图显示的基因数，按当前排序取前 N 个。",
  "显示前 N 条": "限制富集结果显示的条目数。",
  基因名斜体: "按常用生物医学排版将基因符号设为斜体。",
  最大集合数: "Venn 图最多支持的集合数量；集合过多建议改用 UpSet 图。",
};

export function localizeFieldText(
  value: string | undefined,
  language: string,
): string | undefined {
  if (language !== "en" || !value) return value;
  return FIELD_LABELS_EN[value] ?? value;
}

/**
 * Keep the form compact while leaving the scientific meaning of every setting
 * one hover (or keyboard focus) away.  This is deliberately shared by all
 * field types so a parameter never has an orphaned, space-consuming caption.
 */
function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  const { language } = useLanguage();
  const helpRef = useRef<HTMLSpanElement>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPosition, setHelpPosition] = useState({ left: 12, top: 12 });
  const fallbackHint =
    DEFAULT_FIELD_HINTS[label] ?? "仅调整此图的展示方式，不改变差异分析的统计结果。";
  const localizedHint = localizeFieldText(hint ?? fallbackHint, language);
  const placeHelp = useCallback(() => {
    const rect = helpRef.current?.getBoundingClientRect();
    if (!rect) return;
    const maxWidth = Math.min(272, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left - 8, window.innerWidth - maxWidth - 12));
    // Typical help text is shorter than 120 px. Prefer the space above near the lower viewport edge.
    const top =
      rect.bottom + 8 + 120 > window.innerHeight
        ? Math.max(12, rect.top - 128)
        : rect.bottom + 8;
    setHelpPosition({ left, top });
  }, []);
  useEffect(() => {
    if (!helpOpen) return;
    placeHelp();
    window.addEventListener("resize", placeHelp);
    window.addEventListener("scroll", placeHelp, true);
    return () => {
      window.removeEventListener("resize", placeHelp);
      window.removeEventListener("scroll", placeHelp, true);
    };
  }, [helpOpen, placeHelp]);
  return (
    <label className="rx-field-label">
      <span>{localizeFieldText(label, language)}</span>
      {localizedHint && (
        <span
          ref={helpRef}
          className="rx-field-help"
          tabIndex={0}
          aria-label={localizedHint}
          onMouseEnter={() => {
            placeHelp();
            setHelpOpen(true);
          }}
          onMouseLeave={() => setHelpOpen(false)}
          onFocus={() => {
            placeHelp();
            setHelpOpen(true);
          }}
          onBlur={() => setHelpOpen(false)}
        >
          <IconInfoCircle size={14} stroke={1.9} aria-hidden="true" />
          {helpOpen &&
            createPortal(
              <span
                className="rx-field-tooltip rx-field-tooltip--portal"
                role="tooltip"
                style={{ left: helpPosition.left, top: helpPosition.top }}
              >
                {localizedHint}
              </span>,
              document.body,
            )}
        </span>
      )}
    </label>
  );
}

export function NumField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  hint,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <div className="rx-field">
      <FieldLabel label={label} hint={hint} />
      <input
        type="number"
        value={value ?? ""}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? undefined : Number(v));
        }}
      />
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="rx-field rx-field--wide">
      <FieldLabel label={label} hint={hint} />
      <input
        type="text"
        value={value ?? ""}
        placeholder={placeholder ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: T | undefined;
  onChange: (v: T) => void;
  options: { value: T; label: string; desc?: string }[];
  hint?: string;
}) {
  const { language } = useLanguage();
  return (
    <div className="rx-field">
      <FieldLabel label={label} hint={hint} />
      <select
        value={value as string}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {localizeFieldText(o.label, language)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** macOS 风格开关 */
export function SwitchField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean | undefined;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="rx-field">
      <FieldLabel label={label} hint={hint} />
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-label={label}
        className={`rx-switch${checked ? " on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="rx-switch-knob" />
      </button>
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const { language } = useLanguage();
  return (
    <div className="rx-field rx-field--color">
      <FieldLabel label={label} hint={hint} />
      <div className="rx-color-row">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value : "#888888"}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="rx-color-hex">
          {value ?? localizeFieldText("默认", language)}
        </span>
      </div>
    </div>
  );
}

/** 勾选芯片组(组/比较/数据库多选) */
export function CheckChips<T extends string>({
  options,
  selected,
  onToggle,
  renderLabel,
  emptyTip,
}: {
  options: T[];
  selected: T[];
  onToggle: (v: T) => void;
  renderLabel?: (v: T) => string;
  emptyTip?: string;
}) {
  if (options.length === 0 && emptyTip) {
    return <div className="rx-empty-tip">{emptyTip}</div>;
  }
  return (
    <div className="rx-chips">
      {options.map((v) => {
        const on = selected.includes(v);
        return (
          <button
            key={v}
            type="button"
            className={`rx-chip${on ? " on" : ""}`}
            onClick={() => onToggle(v)}
          >
            <span className="rx-chip-check" aria-hidden="true">
              {on ? "✓" : ""}
            </span>
            {renderLabel ? renderLabel(v) : v}
          </button>
        );
      })}
    </div>
  );
}

/** 折叠面板(带旋转箭头动画) */
export function Collapse({
  title,
  subtitle,
  defaultOpen = false,
  right,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rx-collapse${open ? " open" : ""}`}>
      <CollapseToggle onClick={() => setOpen(!open)}>
        <span className="rx-collapse-arrow">
          <IconChevronDown size={14} stroke={2} />
        </span>
        <span className="rx-collapse-title">{title}</span>
        {subtitle && <small className="rx-collapse-sub">{subtitle}</small>}
        {right && (
          <span className="rx-collapse-right" onClick={(e) => e.stopPropagation()}>
            {right}
          </span>
        )}
      </CollapseToggle>
      {open && <div className="rx-collapse-body">{children}</div>}
    </div>
  );
}

/**
 * 折叠面板头。用 div 而非 button:头部常嵌「刷新/应用」等按钮,
 * button 嵌 button 是无效 HTML(React validateDOMNesting 警告)。
 */
export function CollapseToggle({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="rx-collapse-toggle"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {children}
    </div>
  );
}

/** 参数网格内的区块标题 */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  const { language } = useLanguage();
  const text =
    typeof children === "string" ? localizeFieldText(children, language) : children;
  return <h4 className="rx-section-label">{text}</h4>;
}
