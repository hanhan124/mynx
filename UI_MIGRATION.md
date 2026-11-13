# Mynx Mantine 8 分阶段迁移计划

## 迁移目标

把现有页面统一到 Mantine 8 组件、主题和布局系统，同时保留原有功能入口、数据契约、用户文件、配置、R/Rust 运行器和 Tauri 原生能力。每一阶段都有可回滚的边界，页面迁移不会直接改动算法和后端服务。

## 固定原则

- 所有 `@mantine/*` 包保持同一 8.x 小版本
- React、React DOM、Vite、Tauri、R、Rust 版本保持现状
- 继续使用 `@tabler/icons-react`
- 先建立适配层，再替换页面，最后删除旧 CSS
- 每次只迁移一个可验证入口
- UI 改造不改变 Excel、CSV、JSON、图片、R 参数和结果目录格式
- 运行中的任务保持可取消，已生成结果保持可加载
- 中英文都要通过同一套布局和回归截图验收

## 阶段总览

| 阶段 | 内容 | 主要文件 | 退出条件 |
| --- | --- | --- | --- |
| 0 | 基线冻结和运行快照 | `FUNCTION_BASELINE.md`、`tests/acceptance/*`、`scripts/*` | 基线命令和手工路径有记录 |
| 1 | Mantine 8 基础设施 | `package.json`、`src/main.tsx`、`src/lib/mantine-theme.ts`、`src/lib/theme-context.tsx`、`src/styles/global.css` | 已完成 Provider、主题、字体、颜色、组件默认值和首屏主题初始化 |
| 2 | 应用壳和导航 | `src/App.tsx`、`src/components/TitleBar.tsx`、`src/components/Sidebar.tsx` | 已完成 AppShell、Tauri 标题栏适配、导航 Tooltip 和主内容区 |
| 3 | 共享控件适配层 | `src/components/ui/*`、`src/components/Toast.tsx`、`src/components/Modal.tsx`、`src/pages/UiShowcasePage.tsx` | 基础规则已通过主题默认值和 Showcase 固化，业务适配器待后续页面迁移使用 |
| 4 | 首页、设置和通用反馈 | `src/pages/Home.tsx`、`src/pages/SettingsPage.tsx`、`src/components/*` | 主题、语言、设置持久化和帮助入口正常 |
| 5 | 图片转换工作台 | `src/pages/image/*` | Rust 事件、缩略图、取消、结果和输出目录不变 |
| 6 | qPCR 工作台 | `src/pages/qPCR/*`、`src/lib/qpcr-*` | Excel 结果、图表和 R 绘图回归通过 |
| 7 | RNA-seq 工作台 | `src/pages/rnaseq/*`、`src/pages/rnaseq/store.tsx` | R 引擎、历史结果和取消回归通过 |
| 8 | 科研绘图工作室 | `src/pages/charts/*`、`src/features/charts/*` | 模板 schema、R 渲染、预览和打包回归通过 |
| 9 | 清理和发布验收 | `src/styles/*`、`package.json`、发布脚本 | 旧 CSS 可删除项清零，双平台验收完成 |

## 阶段 0  基线冻结

### 工作内容

1. 记录 Node、npm、React、Tauri、R、Rust 和操作系统版本。
2. 运行 `npm run build`、`npm run lint`、`npm test`、`npm run test:rust`、`npm run test:r:engine`。
3. 用固定 fixture 完成 qPCR、RNA-seq、科研绘图和图片转换的正常、失败、取消和历史加载路径。
4. 保存关键输出摘要、错误日志、输出文件名和可比较的数值字段。
5. 记录主题、中文、英文、最小窗口和默认窗口截图。

### 阻断条件

基线命令失败、输入输出无法复现、取消后进程仍存活、历史目录无法加载时，先修复基线或记录明确的现有缺陷，不能进入页面迁移。

## 阶段 1  Mantine 8 基础设施

状态为已完成首轮实现，后续页面迁移继续复用本阶段产物。

### 已完成内容

1. 安装并锁定 `@mantine/core@8.3.18` 和 `@mantine/hooks@8.3.18`。
2. 在 `src/main.tsx` 引入 `@mantine/core/styles.css` 和根级 `MantineProvider`。
3. 在 `src/lib/mantine-theme.ts` 集中定义科学蓝色板、语义色、字体、间距、圆角、阴影、断点和 Button、ActionIcon、Input、Select、Modal、Tabs、Table、Menu、Notification 默认值。
4. 在 `src/lib/theme-context.tsx` 读取 `loadConfig()`，将 `system` 映射为 Mantine light/dark，并继续写入旧 `data-theme` 供尚未迁移页面使用。Mantine 使用无持久化 color scheme manager，主题偏好只有 Mynx Store 负责。
5. 移除全局 active 缩放和宽泛 focus box-shadow，避免覆盖 Mantine 组件交互。
6. 增加 `/ui-showcase`，覆盖正常、hover、focus、disabled、loading、错误、通知、进度、Modal、Tabs、Menu 和 Table。

### Mantine 8 API 白名单

允许使用 `MantineProvider`、`createTheme`、`AppShell`、`Container`、`Stack`、`Group`、`Grid`、`SimpleGrid`、`Flex`、`ScrollArea`、`Paper`、`Card`、`Button`、`ActionIcon`、`UnstyledButton`、`NavLink`、`Tooltip`、`Badge`、`ThemeIcon`、`TextInput`、`NumberInput`、`Textarea`、`Select`、`NativeSelect`、`MultiSelect`、`ColorInput`、`Switch`、`SegmentedControl`、`Tabs`、`Stepper`、`Accordion`、`Alert`、`Progress`、`Loader`、`LoadingOverlay`、`Modal`、`Drawer`、`Table`、`Image`、`Menu`、`Divider`、`Collapse` 和 `CopyButton`。

需要查阅版本文档后再使用的 API，必须在 PR 说明中标明 Mantine 8 页面。代码审查禁止把 Mantine 9 示例直接复制到项目。

## 阶段 2  应用壳和导航

状态为已完成首轮实现。

### 已完成内容

- `TitleBar` 继续负责无边框窗口的拖拽区、置顶、最小化、最大化和关闭
- `AppShell` 负责 navbar、main、header 的尺寸和响应式状态
- `Sidebar` 使用 Mantine `NavLink` 和 Tabler 图标
- 路由和导航仍由 `src/lib/tools.tsx` 生成
- `HashRouter`、Tauri `mynx://navigate`、`mynx://help`、`mynx://about` 和 `mynx://toggle-language` 事件保持
- `AppShell.Navbar` 固定 56px，使用 `breakpoint: "0px"` 保证 420px 窗口仍显示导航
- `TitleBar` 继续位于 AppShell 外层，确保 `data-tauri-drag-region` 不与主内容滚动区重叠

### 验证路径

从原生菜单、侧栏、首页卡片和历史 `/tiff` 入口分别打开页面。确认 Tauri 窗口拖拽、窗口控制、菜单事件、焦点和返回首页都正常。

## 阶段 3  共享控件适配层

建议建立以下轻量组件，组件只包装 Mantine，不持有业务状态。

| 组件 | 作用 |
| --- | --- |
| `PageHeader` | 图标、标题、说明、状态和帮助 |
| `TaskStatus` | idle、running、success、error、cancelled |
| `FieldGroup` | 标签、说明、错误、字段间距 |
| `FilePickerField` | 路径显示、选择、拖放、清空 |
| `ActionRow` | 主操作、次操作和取消 |
| `DataTable` | 表头、数字对齐、横向滚动和长文本 |
| `EmptyState` | 空文件、空结果、依赖缺失 |
| `LogPanel` | 等宽日志、级别颜色、自动滚动和复制 |
| `HelpButton` adapter | 保留当前 children render API |
| `Modal` adapter | 保留当前 open、onClose、title、wide API |
| `Toast` adapter | 保留 `showToast(message, tone)` API |

先让旧页面通过适配层使用 Mantine，再逐页替换原生 DOM。这样可以保持服务调用点不动。

## 阶段 3.1  科研绘图视觉样板

状态为 3.1-2 代码迁移完成，自动检查通过。Tauri 实际点击和截图验收待人工完成。

### 固定基线

- `src/lib/charts/catalog.ts` 当前提供 86 个模板，其中 50 个为 `verified`，36 个为 `draft`。
- `npm run charts:check` 当前通过，包含 57 个有效参考图、57 个字段映射和 47 个唯一 R Graph Gallery 页面。
- 页面入口为 `/charts`，由 `src/lib/tools.tsx` 懒加载 `src/pages/charts/ChartStudioPage.tsx`。
- 状态继续由 `useChartStudioState` 管理，类型继续使用 `ChartConfig`、`ChartResult` 和 `RunEvent`。
- 绘图继续调用 `runChart`、`cancelChartRun` 和 `installR`，R 入口继续为 `src-tauri/r/chart_runner.R`。
- 输出文件名继续使用 `mynx-<template>.<format>`，并在同目录保存 JSON 参数清单。

### 3.1-1 页面骨架与模板目录

状态为代码迁移完成，自动检查通过。已检查运行中的 Tauri 页面结构，点击交互、窗口尺寸和截图验收待人工完成。

目标是建立可独立验证的 Mantine 工作台外框和左侧模板目录。

允许修改的文件：

- `src/pages/charts/ChartStudioPage.tsx`
- `src/styles/pages.css` 中与 `.chart-studio` 相关的局部规则，或新增 `src/pages/charts/ChartStudioPage.module.css`
- 必要的中英文文案位于 `src/lib/i18n.tsx`

迁移内容：

- 使用 Mantine `Stack`、`Group`、`Paper`、`ScrollArea`、`TextInput`、`NavLink` 和 `Badge` 组织页面头部与左侧目录。
- 保留模板家族筛选、搜索、模板选择、模板计数、Tabler Icons 和运行中禁用状态。
- 保留 `selectTemplate`、`setFamily`、`setSearch` 和 `useChartStudioState` 的调用边界。

验收标准：

- `/charts` 路由、懒加载和返回首页行为正常。
- 模板搜索、家族筛选、模板切换和 50 个 verified 模板显示正常。
- 中文、英文、浅色、深色和 420px、960px 窗口布局可用。
- 键盘可以聚焦搜索框和模板项，禁用状态与运行状态清晰。
- 不修改任何 `src/lib/charts`、`src/features/charts`、`src-tauri/r`、模板资源和输出逻辑。

### 3.1-2 数据映射与参数检查器

本次完成三栏工作区结构。数据导入、参数控件和绘图调用继续使用现有实现，后续再按本节逐项迁移。

基础设施补验收：修复 AppShell 主内容区被全局 `overflow: hidden` 阻断的问题；无边框 Tauri 窗口继续使用自定义标题栏，并改用官方 `isTauri()` 运行时检测，确保最小化、最大化和关闭控件在 dev 与打包环境中可见。

视觉复验结果：已在运行中的 Tauri 窗口检查 1440、1280 和 960 宽度。1440、1280 保持左侧模板目录、中央工作区和右侧参数区；960 自动堆叠为单列，目录、数据、参数和运行入口仍可通过页面滚动访问。模板目录存在独立滚动条，页面滚动条与其同时出现时属于两个独立滚动容器。首页、qPCR、RNA-seq 和设置页面均已执行滚轮滚动检查。设置入口因 Navbar 高度计算超出窗口底部的问题已修复。浅色、深色、跟随系统和中英文切换已实际检查。窗口最小化、最大化按钮已实际点击并恢复，关闭按钮已确认存在并保留为终止操作。960px 当前没有显式 Drawer/Tabs 折叠按钮，后续可作为响应式增强项。

滚动补验收：第三栏参数检查器曾被 `.unified-page--chart .card { overflow: hidden; }` 覆盖，导致面板内容超出后只能依赖页面滚动。现已为检查器建立明确的视口高度、独立 `overflow-y: auto` 和滚动边界，并在运行中的 Tauri 窗口实际滚动到 `ggplot`、统计和生成控件区域；截图确认右栏内部滚动条可见，页面滚动仍保持独立。960px 单列断点继续使用页面自然滚动。

操作分组补验收：下载模板已放到“数据与输出”卡片的输出位置行，复制诊断信息收进“图表生成”状态标题栏，复制来源说明作为来源页脚内联操作。三项操作按数据准备、运行诊断和来源引用分组，避免按钮形成孤立的大块区域。

目标是把数据导入、字段映射、输出目录和图形参数迁移到 Mantine 表单布局。

迁移内容：

- 使用 `TextInput`、`NumberInput`、`Select`、`ColorInput`、`Switch` 和 `Tabs`。
- 保留 CSV、TSV、XLSX、XLS、拖放导入、字段识别、输出目录、论文规格、ggplot 外观、统计标注和热图参数。
- 保留 `profileFile`、`pickData`、`handleDataDrop`、`pickFolder`、`applyPublicationPreset` 和 `change` 的业务调用。

验收标准：

- 所有 `ChartConfig` 字段仍能读写，字段类型和默认值不变。
- 缺少字段、未知字段和不支持文件类型的提示保持。
- 运行中表单禁用、焦点态、错误态和中英文布局通过检查。
- 不改变 `ChartConfig`、R 参数 JSON 或模板字段映射。

### 3.1-3 预览、运行状态与结果导出

目标是完成中央图表预览、统一工具栏、运行状态和结果区。

迁移内容：

- 使用 Mantine `Paper`、`Alert`、`Progress`、`Loader`、`Button`、`ActionIcon` 和 `Table` 组织预览与运行状态。
- 保留参考图、PNG/SVG 预览、PDF/TIFF/EPS 文件结果、诊断日志、取消、打开结果、SVG 源码复制和 ZIP 结果包导出。
- 保留 `runChart`、`cancelChartRun`、`openResult`、`copySvgSource` 和 `exportResultPackage` 的调用。

验收标准：

- idle、running、installing、success、error、cancelled 状态均可观察。
- Rscript 缺失、依赖缺失、字段错误、取消和结果文件缺失均有明确反馈。
- 基础柱状图、火山图、PCA、热图、Venn、表格和一个高级模板通过图表回归。
- 运行输出、参数清单、ZIP 包、预览路径和取消后的临时文件行为保持。

### 3.1 完成条件

- `npm run build`、`npm run lint`、`npm test` 和 `npm run charts:check` 通过。
- 至少保存浅色、深色、中文、英文、420px、960px 和运行中状态截图。
- 通过科研绘图功能基线后，单独提交一个可回退 Git commit。
- 3.1 期间禁止修改 R/Rust 计算逻辑、模板资源、Tauri capability、RNA-seq 文件和无关页面。

## 阶段 4  首页、设置和通用反馈

### 首页

1. 用 `SimpleGrid` 替换工具卡片网格。
2. 用 `Menu` 替换搜索引擎浮层。
3. 用 `Paper`、`ThemeIcon`、`Badge` 和 `ActionIcon` 替换自定义卡片按钮。
4. 保留搜索引擎、首页高度和外部浏览器跳转。

### 设置

1. 先将主题状态移到根级，再迁移 Settings 页面。
2. 用 vertical `Tabs` 或 `NavLink` 替换自定义 tablist。
3. 用 `SegmentedControl`、`Switch` 和 `UnstyledButton` 替换自定义控件。
4. 保留 `config.json` key、菜单广播和官网链接。

### 通用反馈

将 About、Help、Update、LoadingOverlay 和 Toast 统一到 Mantine overlay 与状态语义。保留原有文本 key 和调用函数，迁移后再考虑 `@mantine/notifications`。

## 阶段 5  图片转换

### 页面切分

1. `FileDropPanel` 负责拖放和文件列表。
2. `CompressionPanel` 负责 lossless、lossy、level、colors、dither。
3. `WatermarkPanel` 负责 text/image、字体、字号、颜色、透明度、背景、位置和缩放。
4. `OutputPanel` 负责 subfolder、alongside、custom。
5. `ConversionResultTable` 负责事件汇总和打开目录。

### 功能保护

页面只改变 `ImageConvertPage` 和子组件。`src/lib/image-convert.ts`、Tauri commands、Rust service、事件字段和多页 TIFF 文件命名保持不动。每个转换任务必须通过原有 `taskId` 取消。

## 阶段 6  qPCR 工作台

### 6.0 页面头部与数据源控件（进行中）

- 页面头部已使用 Mantine `Group`、`Stack`、`Text` 和 `ThemeIcon` 统一标题、说明和帮助入口的对齐方式。
- 文件打开、清除和工作表选择已切换到 Mantine `Button`、`Group` 和 `Select`，继续复用原有 Excel 读取、拖放、工作表状态和错误提示逻辑。
- 转换和计算的主操作已切换到 Mantine `Button`，保留原有禁用、进度和错误状态。
- 计算方法、对照组、重复次数和参考基因已切换到 Mantine `Select`，保留原有字段值、自动识别和运行中禁用逻辑。
- 重复处理策略和图表颜色已切换到 Mantine `Select`、`ColorInput`，保留择优重复、离群值阈值和配置持久化行为。
- qPCR 绘图工作区的数据文件、工作表、输出目录、设置导入导出和运行按钮已切换到 Mantine `Button`、`Select`，保留 `runQpcrPlot`、取消和 Rscript 检测边界。
- 图表类型切换、预览重置、打开结果目录和取消运行已切换到 Mantine `Button`，保留柱状图/热图状态和运行反馈。
- 图表参数面板的开关和颜色字段已切换到 Mantine `Switch`、`ColorInput`，保留统计、聚类、配色和导出参数。
- 柱状图文件与版式参数的输出前缀、基因、格式、DPI、宽高已切换到 Mantine `TextInput`、`Select`、`NumberInput`，保留原有 `BarSettings` 更新逻辑。
- 柱状图坐标轴标题以及热图输出前缀、格式、颜色范围和基础字号已切换到 Mantine 表单控件，保留原有预览和导出参数。
- 热图 PNG/PDF 的 DPI、宽高参数已切换到 Mantine `Select`、`NumberInput`，保留输出格式和尺寸契约。
- `npx tsc --noEmit` 已通过；运行态、Excel 文件选择和工作表切换仍需在 Tauri 窗口中人工检查。

### 页面切分

1. `QpcrPageHeader`
2. `QpcrSourcePanel`
3. `QpcrTransformPanel`
4. `QpcrCalculatePanel`
5. `QpcrPlotWorkspace`
6. `QpcrPlotSettings`、`QpcrPlotPreview`、`QpcrPlotRunStatus`

### 迁移规则

- 先迁移文件选择和工作表选择，再迁移转换和计算字段
- qPCR 计算参数逐项对照 `Calculate.tsx` 和 `src/lib/qpcr-calculate.ts`
- 柱状图和热图设置按照现有 `BarSettings`、`HeatmapSettings` 类型迁移
- 预览使用 Mantine 布局，R config 仍由现有 `makeConfig` 生成
- 保存 xlsx、写回图表、R 绘图和取消操作完成基线后再删除旧 CSS

## 阶段 7  RNA-seq 工作台

### 页面切分

1. `RnaSeqPageHeader`
2. `RnaSeqStepper`
3. `ImportWorkspace`
4. `DesignWorkspace`
5. `ResultWorkspace`
6. `RunStatusPanel`
7. `ResultGallery`
8. `HistoryRunPicker`

### 迁移规则

- `RnaSeqProvider` 和 `store.tsx` 先冻结，不在视觉迁移阶段重写状态机
- `RnaSeqConfig` 与 R 引擎 params.json 字段保持一一对应
- 导入缓存、矩阵格式识别、分组和批次映射保持原数据结构
- 运行日志和取消通过原 `RunHandle`、`runR`、`cancelRun`
- 历史结果继续读取 `prepared/params.json`、`DE/DE_summary.csv` 和各图像目录

## 阶段 8  科研绘图工作室

### 页面切分

1. `ChartCatalogPanel`
2. `ChartTemplatePicker`
3. `ChartDataPanel`
4. `ChartAppearancePanel`
5. `ChartPreviewPanel`
6. `ChartRunPanel`
7. `ChartPresetMenu`

### 迁移规则

- `useChartStudioState` 继续持有配置和预设
- 模板 manifest 和 `validateTemplateManifest` 不因 UI 迁移而变更
- 输入文件、Rscript 检测、模板资源、结果输出和 ZIP 导出保持原 runner
- 右侧结果预览需要同时覆盖 SVG、PNG、参考图和错误日志
- 57 个模板至少抽样验证基础柱状图、热图、火山图、PCA、Venn、表格和一个高级模板

## 阶段 9  清理和发布验收

### 删除顺序

1. 记录旧 CSS 规则仍被哪些组件使用
2. 迁移完一个页面后删除该页面独有的旧选择器
3. 共享适配层稳定后删除重复 `.btn`、`.form-group`、`.card` 规则
4. 保留 Tauri、图表预览和不可替代的业务 CSS
5. 清理未使用的 CSS 变量、重复 keyframes 和旧主题 shadow

### 发布门槛

- Windows 和 macOS 各执行一次真实任务、一次取消、一次历史结果加载
- qPCR 数值、工作表、图表和保存文件通过人工比较
- RNA-seq DE、heatmap、PCA、volcano 和日志输出通过契约 smoke
- 科研绘图模板、输出格式和 ZIP 资源通过 schema 与 R smoke
- 图片转换单页、多页、Unicode 路径、水印、输出模式和取消通过 Rust tests 与手工验证
- `npm run build`、`npm run lint`、`npm test`、`npm run test:rust`、`npm run test:r:engine` 通过

## 回滚方案

- 每个阶段独立提交，提交说明包含页面范围和功能基线结果
- 适配层保留旧调用签名，页面失败时可把路由切回旧组件
- 旧 CSS 在页面验收通过前保留
- 不回滚用户的 `config.json`、Excel、CSV、结果目录或模板资源
- 发现数据或算法变化时立即停止 UI 迁移，恢复上一阶段页面并重新生成基线

## Definition of Done

一个页面完成迁移需要满足以下条件。

- 页面使用 Mantine 8 主题和共享控件
- 所有控件拥有中英文文案、焦点态、禁用态和错误态
- 页面在浅色、深色、中文、英文、420px 和 960px 条件下通过检查
- 运行、取消、失败、历史加载和输出目录行为与基线一致
- 页面不再依赖已删除的旧 CSS 规则
- 代码审查确认没有引入 Mantine 9 API、第二套图标或业务算法改动
