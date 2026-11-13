# Mynx Mantine 8 设计规范

## 文档状态

- 目标版本为 Mynx 2.3.x 的前端统一迁移方案
- 设计系统固定在 Mantine 8，所有示例 API 按 `@mantine/core@8.x` 编写
- 本阶段只建立规则、架构边界和验收标准
- qPCR、RNA-seq、科研绘图、图片转换的计算、文件格式、R/Rust 调用和 Tauri 能力保持原有契约

基础设施阶段已完成首轮接入。当前代码已经安装 Mantine 8.3.18、在根级挂载 `MantineProvider` 和 `ThemeProvider`、使用 Mantine `AppShell` 承载导航与主内容，并提供 `/ui-showcase` 组件展示页。Mantine 的 color scheme manager 使用无持久化适配器，主题偏好只有 Mynx Store 负责。科研业务页面仍等待后续阶段迁移。

## 设计语言

Mynx 采用 Modern Scientific Workbench。界面服务于数据读取、参数核对、运行状态、结果浏览和导出。视觉层级依靠空间、边框、字重和语义色建立，科研结果区域保持安静和高对比度。

### 设计原则

1. **数据优先**。表格、图像、日志、参数值获得最多的可用空间。
2. **任务连续**。用户在同一工作区完成导入、配置、运行、取消、结果查看和再次导出。
3. **状态可见**。运行中、已完成、可继续、需要修复、已取消都使用明确的文字和 Mantine 状态组件表达。
4. **密度可控**。默认紧凑，复杂参数用分组、折叠面板和分栏组织。
5. **平台协调**。保留 Tauri 无边框窗口和原生菜单，在内容区使用一致的 Mantine 组件。
6. **语言对齐**。中英文使用同一布局约束，文本长度变化不能破坏表格、按钮和导航。
7. **结果可追溯**。运行参数、输出目录、日志和历史结果入口始终可访问。

## Mantine 8 基线

### 依赖策略

建议增加以下依赖，并保持同一小版本。

```json
{
  "@mantine/core": "^8.3.18",
  "@mantine/hooks": "^8.3.18"
}
```

可按页面需要增加 `@mantine/notifications`、`@mantine/dropzone` 或 `@mantine/modals`。第一阶段优先使用 Core 自带组件，已有 `Toast`、`Modal` 和拖放逻辑先通过适配层接入，待功能基线稳定后再决定是否替换实现。

当前项目使用 React 18.2.0、React DOM 18.2.0、Vite 5.4.x、React Router 6.23.0 和 Tauri 2.11.5。Mantine 8.3.18 的 peer dependency 支持 React 18 或 React 19，因此不需要升级 React、Vite、Tauri、R 或 Rust。Mantine 9 需要 React 19.2 或更高版本，后续开发禁止混用 Mantine 9 API。

Mantine 8 的初始化使用 `MantineProvider`、`createTheme` 和 `@mantine/core/styles.css`。项目是 Vite SPA，不需要为 SSR 增加 `ColorSchemeScript`。主题切换继续由 `src/lib/config.ts` 的 Tauri Store 负责持久化。

### 主题入口

推荐的组件层级如下。

```tsx
import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import { mynxTheme } from '@/lib/mantine-theme';

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <MantineProvider theme={mynxTheme} defaultColorScheme="light">
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </MantineProvider>
  </React.StrictMode>,
);
```

实际实现时使用项目已有命名习惯，建议将主题文件命名为 `src/lib/mantine-theme.ts`。`useTheme` 应提升为根级 `ThemeProvider` 或 `App` 内的单一控制点，让应用启动时就读取 `loadConfig()` 并设置 Mantine 的 light/dark 状态。设置页只负责修改该状态，不能独立创建新的主题状态。

### 色彩令牌

主色采用科学蓝，强调操作、链接、导航选中和运行进度。图表页面保留橙色，RNA-seq 保留紫色，qPCR 使用蓝色，图片转换使用青蓝色。颜色只从主题令牌或 Mantine `theme.colors` 读取。

| 令牌 | 浅色值 | 深色值 | 使用范围 |
| --- | --- | --- | --- |
| `scientificBlue` | `#2169D3` | `#6EA8FF` | 主操作、焦点、进度、链接 |
| `scientificCyan` | `#087F8C` | `#55D6E0` | 图片转换、文件导入 |
| `scientificPurple` | `#7654C6` | `#B69CFF` | RNA-seq、基因簇、结果图 |
| `scientificOrange` | `#B86200` | `#FFB454` | 科研绘图、警告、Beta |
| `scientificGreen` | `#167A4A` | `#65D99B` | 完成、有效、通过 |
| `scientificRed` | `#C92A2A` | `#FF7B7B` | 错误、失败、删除 |

Mantine 色板每个颜色提供 10 个 shade。主色按钮优先使用 `scientificBlue.6`，浅色背景使用 `.0` 或 `.1`，边框使用 `.2`，文本使用灰阶而不是彩色。图表绘图颜色仍由业务配置和 R 脚本决定，主题色只用于 UI。

### 背景和边界

| 层级 | 浅色 | 深色 |
| --- | --- | --- |
| 应用背景 | `#F6F8FB` | `#171B22` |
| 侧栏与标题栏 | `#EEF2F7` | `#1D232D` |
| 工作区表面 | `#FFFFFF` | `#202733` |
| 浮层 | `#FFFFFF` | `#27303D` |
| 分隔线 | `#DCE3EC` | `#343F4D` |
| 主文本 | `#1C2733` | `#F0F4F8` |
| 次文本 | `#5C6B7A` | `#AAB6C4` |
| 弱文本 | `#8290A0` | `#7F8B99` |

阴影只保留 Mantine `xs`、`sm` 和 `md` 三档。默认卡片使用边框，浮层和可拖出的面板才使用阴影。渐变只用于状态提示条，结果图和参数面板不使用大面积渐变。

### 字体和排版

```ts
fontFamily: 'Inter, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif'
fontFamilyMonospace: 'IBM Plex Mono, "SFMono-Regular", Consolas, monospace'
```

数字、路径、R 日志、基因名和文件名使用等宽字体。中文和英文共享同一字号与行高令牌。

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `xs` | 11px | 辅助说明、表头、状态 |
| `sm` | 12px | 表单标签、次要按钮、列表 |
| `md` | 13px | 正文、默认控件 |
| `lg` | 15px | 页面小标题、关键数值 |
| `xl` | 18px | 页面标题 |
| `2xl` | 22px | 首页和工作区主标题 |

默认正文行高为 1.45，表单标签与说明为 1.35，日志和代码为 1.5。页面标题使用 700 字重，正文使用 400 或 500，数据表头使用 600。

### 间距和尺寸

Mantine spacing 采用 4px 基础网格。

| 令牌 | 值 | 典型用途 |
| --- | --- | --- |
| `xxs` | 2px | 图标和短标签 |
| `xs` | 4px | 相关文字、紧凑行 |
| `sm` | 8px | 控件组内间距 |
| `md` | 12px | 表单组、卡片内层 |
| `lg` | 16px | 卡片内边距、列间距 |
| `xl` | 24px | 页面边距、主区块间距 |
| `2xl` | 32px | 首页标题区、工作流分隔 |

默认控件高度为 32px，紧凑表格行高为 32px，普通按钮为 32px，主要操作按钮为 36px，标题栏为 40px，导航栏宽度为 56px。复杂参数页允许 28px 紧凑控件，但必须有清晰的标签和焦点环。

### 圆角和焦点

`xs` 为 4px，`sm` 为 6px，`md` 为 8px，`lg` 为 10px，`xl` 为 14px。主卡片使用 `md` 或 `lg`，输入框和按钮使用 `sm` 或 `md`，状态徽章使用 `xl`。

键盘焦点使用 2px 主色环并保留 2px 外间距。删除、取消、关闭按钮必须有可见的 hover、focus、disabled 状态。图标按钮必须提供 `aria-label` 和 Mantine `Tooltip`。

## 全局布局

### 应用壳

保留 Tauri `decorations: false`、窗口拖拽区域、最小化、最大化、关闭、置顶和原生菜单。内容区迁移为 Mantine `AppShell` 的等价布局。

```text
┌──────────────────────── 40px title bar ────────────────────────┐
├─ 56px nav rail ─┬──────────── scrollable workspace ────────────┤
│ home             │ PageHeader                                   │
│ qPCR             │ status / stepper                             │
│ RNA-seq          │ content                                      │
│ charts           │ results                                      │
│ PNG              │                                               │
│ settings         │                                               │
└─────────────────┴───────────────────────────────────────────────┘
```

`TitleBar` 保留为平台适配组件，`Sidebar` 已接入 Mantine `AppShell.Navbar`、`Tooltip` 和 `UnstyledButton`。导航数据继续来自 `src/lib/tools.tsx`，路由、首页工具卡片和侧栏保持单一来源。

工作区使用 `AppShell.Main`、`ScrollArea` 和页面级 `Container`。宽屏页面最大宽度为 1280px，qPCR、RNA-seq 和科研绘图使用流式两栏布局。低于 900px 时参数栏堆叠，低于 640px 时侧栏收缩为仅图标并通过 Tooltip 提供名称。

### 页面头部

统一使用 `Group`、`ThemeIcon`、`Stack`、`Title`、`Text`、`Badge` 和 `ActionIcon`。页面头部包含图标、标题、说明、运行环境状态和帮助入口。标题区固定最小高度，长中文或英文说明最多两行。

### 内容层级

页面分为工作流层、参数层、运行层和结果层。每层最多使用一个主要表面。复杂表单使用 `Paper withBorder` 或 `Card`，状态提示使用 `Alert`，结果区使用 `Table`、`ScrollArea`、`Image` 或自有 SVG 预览。空状态使用 `Center`、`Stack` 和 `ThemeIcon`，避免单独的大卡片堆叠。

## 组件映射

| 当前实现 | Mantine 8 目标 | 迁移约束 |
| --- | --- | --- |
| `.btn`, `.btn-primary` | `Button`, `ActionIcon` | 统一 `size`、`radius`、`leftSection`、`loading` |
| `.form-group` 和原生 `input` | `TextInput`, `NumberInput`, `Textarea` | 保留字段名、校验和数据类型 |
| 原生 `select` | `Select`, `NativeSelect`, `MultiSelect` | 数据契约保持字符串和数值语义 |
| `.settings-switch` | `Switch` | 保留 alwaysOnTop 持久化和事件广播 |
| `.settings-segmented` | `SegmentedControl` | 保留中英文值 `zh`、`en` |
| `.rx-steps` | `Stepper` 或 `Tabs` | 当前步骤、可用条件和完成标记保持 |
| `.card` | `Paper`, `Card`, `Accordion` | 页面只保留有信息价值的表面 |
| `.modal-*` | `Modal`, `Drawer` | 帮助、关于、教程支持 Escape 和焦点回收 |
| `.notice`, `.result-success` | `Alert`, `Badge` | 语义颜色和文本必须保留 |
| `.imgconv-table`, `.rx-table` | `Table.ScrollContainer`, `Table` | 允许横向滚动，长路径省略并可复制 |
| `.btn-row`, flex 工具栏 | `Group`, `Stack`, `Flex` | 中英文长文本允许换行 |
| 自定义 Toast | `notifications` 适配层 | 先保留 `showToast` API，迁移时不改调用点 |
| `HelpButton`、`Modal` | `ActionIcon`、`Modal` | 保留教程内容与快捷入口 |
| Tabler Icons | `@tabler/icons-react` | 继续使用单一图标系统 |

Mantine 的 `styles`、`classNames` 和 CSS Modules 只用于组件局部布局。全局 CSS 只保留 reset、Tauri 拖拽区、滚动条、图表预览和业务不可避免的绘图样式。

## 页面设计方案

### 首页

- 顶部保留 Mynx 标识、搜索框和天气信息
- 工具卡片改为 `SimpleGrid` 或响应式 `Grid`
- 搜索引擎选择使用 `Menu` 和 `Menu.Item`，保留搜索引擎 localStorage 键
- 工具卡片使用 `UnstyledButton` 加 `Paper`，图标使用 `ThemeIcon`，Beta 使用 `Badge`
- 首页分隔拖拽器保留当前高度持久化键 `mynx-home-header-height`
- 空结果使用 `Alert` 或 `Center`，不改变搜索后跳转系统浏览器的行为

### 设置

- 使用 `AppShell` 内的二级 `Tabs orientation="vertical"` 或 `NavLink`
- 外观使用 `SegmentedControl` 或 `Radio.Group`，三种主题继续为 `system`、`graphite`、`pearl`
- 语言使用 `SegmentedControl`，值继续为 `zh`、`en`
- 窗口置顶使用 `Switch`，保留 `saveAlwaysOnTop` 和 `mynx://always-on-top`
- 支持入口使用 `List` 风格的 `UnstyledButton`，保留帮助、官网和关于

### qPCR 工作台

布局固定为四个区域。

1. **数据源区**。`FileButton` 或 `Button` 选择 Excel，`Select` 选择工作表，文件名和路径使用 `Paper` 显示。
2. **数据转换区**。使用 `Card`、步骤编号、执行按钮和结果状态。保留转置、缺失值标黄和 `Transformed Data` 工作表。
3. **qPCR 计算区**。使用 `Grid` 排列重复次数、参考基因、方法、对照组、择优重复和离群值参数。互斥规则使用 `Alert` 和字段禁用状态表达。
4. **绘图区**。使用 `Tabs` 切换柱状图和热图，左侧参数 `ScrollArea`，右侧预览和运行状态。Rscript 检测、取消、导入导出设置、输出目录和统计文件入口保持。

结果区需要显示计算方法、基因数、输出文件夹、统计文件和错误日志。表格和预览区域允许独立滚动，运行时使用 `LoadingOverlay` 与 `Progress`。

### RNA-seq 工作台

采用 `Stepper` 三步布局。

1. **数据导入**。文件选择、格式识别、计数矩阵预览、清洗警告和输出目录组成一个导入工作区。预览使用可滚动表格，列名和行数固定在状态区。
2. **分组与分析**。左侧管理样本组和批次，右侧配置 DESeq2/edgeR、过滤、阈值、比较和无重复参数。复杂参数使用 `Accordion`。
3. **绘图导出**。结果目录、DE 汇总、热图、PCA、火山图和结果画廊集中展示。单图放大使用 `Modal`，历史结果使用目录选择和最近运行列表。

顶部固定显示 Rscript 状态、当前运行名、结果目录和运行状态。日志使用等宽字体的 `ScrollArea`，取消后保留已生成文件和可继续加载的历史目录。

### 科研绘图工作室

采用三栏工作台。

- 左栏为图表家族和模板目录，使用 `NavLink`、`ScrollArea`、搜索和模板状态徽章
- 中栏为数据映射与参数表单，使用 `Tabs`、`Accordion`、`TextInput`、`Select`、`NumberInput`、`ColorInput` 和 `SegmentedControl`
- 右栏为参考图、实时预览、运行日志、输出路径和导出结果

模板目录继续来自 `src/lib/charts/catalog.ts`，当前有 57 个已验证模板。输入继续支持 CSV、TSV、XLSX、XLS，输出继续支持 PNG、SVG、PDF、TIFF、EPS。Rscript 检测、安装、取消、预设、模板包导入导出和结果压缩包入口保持。

### 图片转换

采用两栏布局。

- 左栏为拖放文件区、缩略图列表、文件数量、添加文件、添加文件夹和清空
- 右栏为压缩、水印、输出位置和转换操作
- 转换中使用 `LoadingOverlay` 或顶部 `Progress`，结果使用可滚动 `Table`
- 失败项使用 `Alert` 或 `Tooltip` 展示原因，成功率和节省体积使用 `Group` 和 `Badge`

保留所有当前输入格式、无损与有损模式、优化强度、颜色数、抖动、水印文字或图片、九宫格位置、输出模式、取消和打开输出目录行为。

## 主题、语言和数据持久化

### 主题

- `config.json` 中的 `theme` 继续使用 `system`、`graphite`、`pearl`
- `normalizeTheme` 继续兼容历史值 `dark` 和 `light`
- 主题初始化移到根级，避免只有打开设置页后才写入 `data-theme`
- `system` 通过 `matchMedia('(prefers-color-scheme: dark)')` 同步 Mantine color scheme
- 主题切换不修改 Excel、CSV、结果目录、模板预设和转换设置

### 语言

- `LanguageProvider` 继续作为唯一翻译入口
- 页面标题、按钮、字段标签、状态、错误、教程和原生菜单事件保持同一语言状态
- 新增 UI 文案必须同时加入 `zh` 与 `en` 字典
- 路径、基因名、样本名、R 日志和导出文件内容遵循现有英文或用户输入规则

### 用户数据

保持 `src/lib/config.ts` 现有 key。

| key | 作用 |
| --- | --- |
| `theme` | 主题偏好 |
| `alwaysOnTop` | 窗口置顶 |
| `chartColor` | qPCR 原生 Excel 图表颜色 |
| `chartStudioPresets` | 科研绘图预设 |
| `imageConverterOptions` | 图片转换选项 |
| `mynx-theme` | 主题启动兼容缓存 |
| `mynx-search-engine` | 首页搜索引擎 |
| `mynx-home-header-height` | 首页顶部高度 |

RNA-seq 历史结果继续读取 `prepared/params.json`，输出目录继续包含 `DE`、`heatmap`、`plots`、`data`、`logs` 和 `prepared`。qPCR Excel 工作簿、工作表名、黄色填补标记、汇总表和原生 Excel 图表保持兼容。

## 迁移约束

1. 使用 `@mantine/core` 8.x API，代码审查时禁止出现 Mantine 9 迁移文档中的 API。
2. 保留 `@tabler/icons-react`，不引入 Lucide、Heroicons 或另一套图标系统。
3. 先做组件适配和页面替换，再删除旧 CSS。每个阶段都能通过原有入口运行。
4. Mantine 只负责 UI 层。ExcelJS、JSZip、R/Rust、Tauri plugin、路径作用域、取消和资源复制逻辑保持在现有服务层。
5. 不把长时间任务放进 React render，不通过 UI 重写算法。
6. CSS Modules 只承载页面布局和不可避免的业务预览样式，主题令牌集中在 Mantine theme。
7. 所有异步任务必须有 running、success、error 和 cancelled 状态。
8. 用户输入的路径、样本名、基因名和组名原样传递，显示层只做省略和复制。

## 基础设施阶段实现文件

- `src/lib/mantine-theme.ts` 集中定义 Mantine 8 颜色、字号、间距、圆角、阴影、断点和组件默认值
- `src/lib/theme-context.tsx` 统一 Mantine color scheme、旧 `data-theme` 兼容变量和 Tauri Store 持久化
- `src/hooks/useTheme.ts` 保持原有导入路径并转发到根级主题上下文
- `src/components/Sidebar.tsx` 使用 Mantine Tooltip 和 UnstyledButton，保留 Tabler Icons 和 Tauri 路由行为
- `src/App.tsx` 使用 Mantine AppShell，保留自定义 Tauri TitleBar、原生菜单事件和现有路由
- `src/pages/UiShowcasePage.tsx` 和 `src/pages/UiShowcasePage.module.css` 提供可独立访问的基础控件状态展示
- `src/main.tsx` 引入 `@mantine/core/styles.css` 并挂载根级 Provider

## 设计验收

- 首次启动直接得到保存的主题，无需访问设置页
- 中文和英文切换后页面头部、按钮、字段、表格、教程和状态没有溢出
- 420px 最小窗口可以访问导航、文件选择和取消操作
- 960px 默认窗口可同时查看主要参数和结果区域
- 深色主题下表格、图像预览、日志和焦点环仍有足够对比度
- qPCR、RNA-seq、科研绘图和图片转换的现有入口、输入、输出和取消行为不变
- `npm run build`、`npm run lint`、`npm test`、`npm run test:rust` 和 `npm run test:r:engine` 通过

## 参考

- [Mantine 8 Getting started](https://v8.mantine.dev/getting-started/)
- [Mantine 8 Core package](https://v8.mantine.dev/core/package/)
- [Mantine 7.x to 8.x migration](https://mantine.dev/guides/7x-to-8x/)
- [Mantine 8.x to 9.x migration](https://mantine.dev/guides/8x-to-9x/)
