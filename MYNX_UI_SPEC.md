# Mynx UI 规范

## 文档状态

- 版本：1.0
- 适用范围：Mynx Scientific Workbench 的 React、Mantine 8、Tauri 内容区和共享样式
- 权威来源：`src/lib/mantine-theme.ts` 定义令牌；本文件定义使用规则；`UI_AUDIT.md` 定义当前问题；`UI_MIGRATION.md` 定义迁移顺序
- 功能边界：UI 迁移不得改变 R、Rust、Excel、图表模板、文件命名、Tauri capability、取消 API 或用户配置 key

## 设计目标

Mynx 是现代科研工作台。页面优先为数据导入、参数核对、运行状态、结果浏览和导出提供清晰且连续的工作区。视觉层级依靠间距、边框、字重、对齐和语义色建立；图表、表格和日志保持高对比度和足够空间。

### 不可变原则

1. Mantine 8 是主要控件系统，所有 `@mantine/*` 包保持同一 8.x 小版本。
2. 图标只使用 `@tabler/icons-react`；图标按钮必须有 `aria-label` 和可见焦点。
3. 主题状态只有 `ThemeProvider` 管理，页面不能自行调用 `loadConfig()` 建立主题状态。
4. 用户输入的路径、样本名、基因名、组名和字段名原样传递；显示层只负责截断、换行和复制。
5. 长时间任务在 idle、running、success、error、cancelled 状态下都有文字和可见控件；取消始终调用原有取消 API。

## 颜色令牌

### 语义色

颜色来自 `src/lib/mantine-theme.ts` 的 Mantine 色板。业务页面使用语义色名，不直接新增页面级主色。

| 语义 | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| primary | `scientificBlue.6` | `scientificBlue.5` | 主操作、焦点、进度、选中 |
| cyan | `scientificCyan.6` | `scientificCyan.5` | 图片转换、文件导入 |
| purple | `scientificPurple.6` | `scientificPurple.5` | RNA-seq、结果图 |
| orange | `scientificOrange.6` | `scientificOrange.5` | ChartStudio、提示和 Beta |
| success | `scientificGreen.6` | `scientificGreen.5` | 完成、有效、通过 |
| error | `scientificRed.6` | `scientificRed.5` | 失败、删除、危险操作 |
| warning | `scientificOrange.6` | `scientificOrange.5` | 需要注意但可继续 |

### Surface 层级

| 层级 | Pearl / light | Graphite / dark |
| --- | --- | --- |
| app background | `#F6F8FB` | `#171B22` |
| shell / navbar | `#EEF2F7` | `#1D232D` |
| work surface | `#FFFFFF` | `#202733` |
| floating surface | `#FFFFFF` | `#27303D` |
| divider | `#DCE3EC` | `#343F4D` |
| primary text | `#1C2733` | `#F0F4F8` |
| secondary text | `#5C6B7A` | `#AAB6C4` |

`system` 继续根据 `prefers-color-scheme` 解析为 `pearl` 或 `graphite`。旧 `data-theme` 变量同步机制在所有页面迁移完成前必须保留。

## Typography

- 字体：`Inter, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`
- 等宽字体：`IBM Plex Mono, "SFMono-Regular", Consolas, monospace`
- 字号等级：11px 辅助信息、12px 标签与列表、13px 正文和默认控件、15px 小标题、18px 页面标题、22px 主标题
- 正文行高 `1.45`；标签和说明 `1.35`；日志和代码 `1.5`
- 页面标题使用 700；正文 400/500；表头和区块标题 600
- 数值、DPI、尺寸、路径、R 日志和基因名使用等宽字体或 `font-variant-numeric: tabular-nums`
- 中英文共用同一字号和行高，英文长词允许换行或省略，不通过缩小字号解决溢出

## Layout 和尺寸

基础间距为 4px。Mantine spacing 令牌如下：`xxs=2`、`xs=4`、`sm=8`、`md=12`、`lg=16`、`xl=24`、`2xl=32`。

| 元素 | 规则 |
| --- | --- |
| title bar | 40px，保留 Tauri drag region 和窗口控制 |
| nav rail | 56px，420px 窗口仍显示图标导航并用 Tooltip 提供名称 |
| default control | 32px；主要操作可用 36px |
| compact table row | 32px |
| input/button radius | `sm` / 6px |
| panel radius | `md` / 8px；大型工作面板最多 `lg` / 10px |
| page content | 默认 24px 外边距，宽屏内容最大 1280px |
| focus ring | 2px primary ring，外间距 2px |

页面布局使用 CSS Grid、Flexbox、Mantine `Group`、`Stack` 和 `ScrollArea`。复杂科研页面保留业务所需的网格，不强制压成卡片列表，也不引入第二套停靠布局框架。

## 组件契约

### 表单和按钮

- 默认 `Button`、`ActionIcon`、`TextInput`、`NumberInput`、`Select` 使用 theme 的 `sm` 尺寸和 `sm` 圆角。
- 数值输入使用 `NumberInput` 的 `min/max/step`；空字符串只保留编辑草稿，不能用 `||` 把 0 改成默认值。
- `Select` 的空值和 `null` 由调用方明确处理；业务字段的字符串/数字语义保持不变。
- 运行中字段必须 `disabled`，主操作使用 `loading` 或明确 running 状态；取消按钮调用现有取消函数。
- 危险操作使用 `color="scientificRed"` 或对应语义色，并配合 Tooltip 或确认文案。

### 数据、结果和日志

- 表格使用 Mantine `Table`，数字列右对齐或使用 tabular numerals，路径和长文本支持横向滚动、截断和复制。
- 运行状态使用 `Badge`、`Alert`、`Progress`、`Loader` 或共享状态组件；不能只用颜色表达状态。
- 日志使用等宽字体 `ScrollArea`，保留复制和滚动边界。
- 空状态说明下一步动作；错误状态说明原因和可恢复操作。

### 工作区

- ChartStudio：左侧模板目录、中央数据/预览/运行、右侧独立滚动检查器；宽屏三栏，960px 以下自然堆叠。
- qPCR：数据源、转换、计算、绘图四个区域，结果和预览保持足够宽度。
- RNA-seq：导入、设计、绘图三步工作流；样本分组拖放、未提交数字草稿、运行和取消状态不能因拆分组件而丢失。
- 图片转换：左文件列表、右参数与结果；拖放、批处理、TIFF 页码命名、输出目录和取消契约不变。

## 响应式验收

- 420px：导航、文件选择、取消、错误和主要输出入口可达；内容可以自然纵向滚动。
- 960px：参数和结果分区可通过滚动访问；ChartStudio 目录、检查器和运行状态不被裁剪。
- 1280/1440px：工作区优先扩展数据预览、图表画布和结果表，检查器保持可读宽度。
- 中文、英文、浅色、深色、键盘焦点、禁用、错误、加载和取消状态都要检查。
- macOS 未运行时不得标记为已验证；Windows Tauri 验收记录在 `UI_ACCEPTANCE_REPORT.md`。

## CSS 架构

- `src/lib/mantine-theme.ts` 是颜色、字体、间距、圆角、阴影、断点和组件默认值的唯一入口。
- `src/styles/global.css` 只保留 reset、基础字体、滚动条和应用壳必要映射。
- 页面布局优先 CSS Modules、Mantine `styles` 或 `classNames`；旧 CSS 只有在页面回归后才能删除。
- `golden-gate.css` 不再作为新的全局补丁层；已有兼容规则按页面迁移逐步退役。
- 不通过增加阴影、渐变或卡片数量解决层级问题。结果图、参数检查器和表格不使用大面积玻璃拟态。

## 质量门槛

提交前按改动范围运行：

```text
npx tsc --noEmit
npm run build
npm run lint
npm test
npm run test:rust
npm run test:r:engine
npm run charts:check
npm run resources:check
```

不存在的脚本不标记为通过；自动构建成功不替代真实 Tauri 交互验收。功能边界和回归路径以 `FUNCTION_BASELINE.md` 为准。
