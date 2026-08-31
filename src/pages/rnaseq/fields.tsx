/**
 * RNA-seq 页面复用控件 — 全部按 mynx 设计体系(Tahoe 圆角阶梯 / --ease 过渡 / tabler 图标)。
 */
import React, { useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { useLanguage } from "@/lib/i18n";

const FIELD_LABELS_EN: Record<string, string> = {
  "正方形": "Square", "十字辅助线": "Crosshair", "标签吸附": "Repel labels", "标签内容": "Label content",
  "分组": "Group", "样本": "Sample", "无": "None", "点大小": "Point size", "点透明度": "Point opacity",
  "点形状": "Point shape", "X 轴范围(min)": "X-axis range (min)", "X 轴范围(max)": "X-axis range (max)",
  "Y 轴范围(min)": "Y-axis range (min)", "Y 轴范围(max)": "Y-axis range (max)", "显示所有基因": "Show all genes",
  "聚类数 k": "Number of clusters k", "标记基因标签": "Marker-gene labels", "列名(分组)": "Column names (groups)",
  "列名旋转角": "Column-label angle", "行名(基因名)": "Row names (genes)", "热图配色": "Heatmap palette",
  "Z-score 下限": "Z-score minimum", "Z-score 上限": "Z-score maximum", "Cluster 注释": "Cluster annotation",
  "Cluster 配色": "Cluster palette", "显示基因名": "Show gene names", "显示分组名": "Show group names",
  "基因名旋转角": "Gene-label angle", "标注 top N": "Annotate top N", "标签大小": "Label size",
  "阈值线": "Threshold lines", "副标题": "Subtitle", "标注策略": "Annotation strategy", "显著 top-N": "Significant top-N",
  "仅标记基因": "Marker genes only", "top-N + 标记基因": "Top-N + marker genes", "不标注": "No annotation",
  "标上调": "Label upregulated", "标下调": "Label downregulated", "p 值上限": "P-value limit", "最大集合数": "Maximum sets",
  "LOESS 趋势线": "LOESS trend line", "X 轴文字旋转": "X-axis label angle", "异常值大小": "Outlier size",
  "箱线宽度": "Box width", "箱体透明度": "Box opacity", "柱子排列": "Bar arrangement", "堆叠": "Stacked", "并排": "Dodged",
  "柱子宽度": "Bar width", "显示数值": "Show values", "显示前 N 个": "Show top N", "基因名斜体": "Italic gene names",
  "聚类方法": "Clustering method", "悬挂高度": "Hanging height", "坐标轴字号": "Axis font size", "物种": "Species",
  "人类": "Human", "小鼠": "Mouse", "大鼠": "Rat", "p 值阈值": "P-value threshold", "q 值阈值": "Q-value threshold",
  "显示前 N 条": "Show top N terms", "着色依据": "Color by", "按数据库": "By database", "按 GO 本体": "By GO ontology",
  "基因数": "Gene count", "数据库": "Databases", "GO 本体": "GO ontology", "上下调方向": "Up/down direction",
  "NES 连续着色": "Continuous NES color", "Running 图数": "Running plots", "透明度": "Opacity", "列数": "Columns",
  "分组依据": "Group by", "按样本": "By sample", "按分组": "By group", "宽度(inches)": "Width (inches)",
  "高度(inches)": "Height (inches)", "右": "Right", "左": "Left", "上": "Top", "下": "Bottom", "垂直": "Vertical",
  "水平": "Horizontal", "左对齐": "Left", "居中": "Center", "右对齐": "Right", "auto(theme 自带)": "Auto (theme default)",
  "默认": "Default",
  "热图行标注;也用于火山图标注与小提琴图默认基因": "Heatmap row labels; also used for volcano labels and default violin genes",
  "绘制前从表达矩阵剔除(如线粒体/低质量基因);也作用于整体热图": "Remove from the expression matrix before plotting (e.g. mitochondrial/low-quality genes); also affects the global heatmap",
  "绘制前从表达矩阵剔除;也作用于 PCA": "Remove from the expression matrix before plotting; also affects PCA",
  "标注策略选「仅标记基因 / top-N + 标记基因」时使用;也用于整体热图与小提琴图": "Used for Marker genes only / Top-N + marker genes; also used by the global heatmap and violin plot",
  "上方「目标基因」留空时按此列表绘制;也用于整体热图与火山图标注": "Used when Target genes above is empty; also used by the global heatmap and volcano labels",
  "不过滤,显示全部基因": "No filtering; show all genes",
  "防极端值压扁图": "Prevent extreme values from compressing the plot",
  "DESeq2 plotMA 标配": "Standard for DESeq2 plotMA",
  "每比较每库额外的 running-score 图": "Additional running-score plots per comparison and database",
  "默认 theme_bw": "Default theme_bw",
  "theme_*(base_size=)": "theme_*(base_size=)",
};

export function localizeFieldText(value: string | undefined, language: string): string | undefined {
  if (language !== "en" || !value) return value;
  return FIELD_LABELS_EN[value] ?? value;
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
  const { language } = useLanguage();
  return (
    <div className="rx-field">
      <label>{localizeFieldText(label, language)}</label>
      <input
        type="number"
        value={value ?? ""}
        step={step}
        min={min}
        max={max}
        placeholder={localizeFieldText(placeholder, language) ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? undefined : Number(v));
        }}
      />
      {hint && <small className="rx-field-hint">{localizeFieldText(hint, language)}</small>}
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
  const { language } = useLanguage();
  return (
    <div className="rx-field rx-field--wide">
      <label>{localizeFieldText(label, language)}</label>
      <input
        type="text"
        value={value ?? ""}
        placeholder={localizeFieldText(placeholder, language) ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <small className="rx-field-hint">{localizeFieldText(hint, language)}</small>}
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
      <label>{localizeFieldText(label, language)}</label>
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
      {hint && <small className="rx-field-hint">{localizeFieldText(hint, language)}</small>}
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
  const { language } = useLanguage();
  return (
    <div className="rx-field">
      <label>{localizeFieldText(label, language)}</label>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        className={`rx-switch${checked ? " on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="rx-switch-knob" />
      </button>
      {hint && <small className="rx-field-hint">{localizeFieldText(hint, language)}</small>}
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const { language } = useLanguage();
  return (
    <div className="rx-field rx-field--color">
      <label>{localizeFieldText(label, language)}</label>
      <div className="rx-color-row">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value : "#888888"}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="rx-color-hex">{value ?? (language === "en" ? "Default" : "默认")}</span>
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
  const text = typeof children === "string" ? localizeFieldText(children, language) : children;
  return <h4 className="rx-section-label">{text}</h4>;
}
