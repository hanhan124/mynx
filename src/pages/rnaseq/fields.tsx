/**
 * RNA-seq 页面复用控件 — 全部按 mynx 设计体系(Tahoe 圆角阶梯 / --ease 过渡 / tabler 图标)。
 */
import React, { useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";

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
      <label>{label}</label>
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
      {hint && <small className="rx-field-hint">{hint}</small>}
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
      <label>{label}</label>
      <input
        type="text"
        value={value ?? ""}
        placeholder={placeholder ?? ""}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <small className="rx-field-hint">{hint}</small>}
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
  return (
    <div className="rx-field">
      <label>{label}</label>
      <select
        value={value as string}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <small className="rx-field-hint">{hint}</small>}
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
      <label>{label}</label>
      <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        className={`rx-switch${checked ? " on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="rx-switch-knob" />
      </button>
      {hint && <small className="rx-field-hint">{hint}</small>}
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
  return (
    <div className="rx-field rx-field--color">
      <label>{label}</label>
      <div className="rx-color-row">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value : "#888888"}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="rx-color-hex">{value ?? "默认"}</span>
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
  return <h4 className="rx-section-label">{children}</h4>;
}
