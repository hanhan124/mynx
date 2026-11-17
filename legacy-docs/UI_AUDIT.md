# Mynx 当前 UI 审计

## 审计范围和证据

本审计读取了真实源码、样式、Tauri 配置、R/Rust 运行器、测试脚本和发布配置。主要入口如下。

| 区域 | 真实源码 |
| --- | --- |
| 应用入口与路由 | `src/main.tsx`、`src/App.tsx`、`src/lib/tools.tsx` |
| 导航与窗口 | `src/components/Sidebar.tsx`、`src/components/TitleBar.tsx` |
| 主题与设置 | `src/lib/theme.ts`、`src/lib/config.ts`、`src/hooks/useTheme.ts`、`src/pages/SettingsPage.tsx` |
| qPCR | `src/pages/qPCR/*`、`src/lib/qpcr-*`、`src/lib/excel-io.ts`、`src/lib/chart-gen.ts` |
| RNA-seq | `src/pages/rnaseq/*`、`src/pages/rnaseq/store.tsx`、`src/lib/rnaseq/*` |
| 科研绘图 | `src/pages/charts/ChartStudioPage.tsx`、`src/features/charts/*`、`src/lib/charts/*` |
| 图片转换 | `src/pages/image/*`、`src/lib/image-convert.ts`、`src-tauri/src/services/image_convert.rs` |
| 原生能力 | `src-tauri/src/lib.rs`、`src-tauri/src/commands/*`、`src-tauri/tauri.conf.json` |
| 回归与发布 | `tests/acceptance/functional-matrix.md`、`scripts/*`、`package.json` |

### 运行和构建快照

- React 18.2.0、React DOM 18.2.0
- Vite 5.4.21、TypeScript 5.4.x、React Router 6.23.0
- Tauri 2.11.5，Rust edition 2021
- R/Rust 运行器已支持取消、日志流、Unicode 路径和历史结果加载
- 当前前端有 76 个源码文件，主页面文件中 `ChartStudioPage.tsx` 约 2879 行，`QpcrPlotter.tsx` 约 2249 行，`PlotsStep.tsx` 约 1521 行
- 当前样式文件约 180KB，`pages.css`、`rnaseq.css` 和 `components.css` 各自包含大量页面及组件规则
- 工具注册表有 4 个路由，科研绘图目录当前有 57 个已验证模板
- 当前 `npm run build` 通过，Vite 报告 ExcelJS 约 938KB 和若干超过 500KB 的 chunk
- 当前 `npm run lint` 通过，存在 18 个 warning，主要是 Fast Refresh 导出和 React Hook 依赖
- 当前 `npm test` 通过，包含 RNA-seq matrix smoke 和 chart schema smoke
- 当前 `npm run test:rust` 通过，9 个 Rust 单元测试通过并有 2 个 `unused_mut` warning
- 当前 `npm run test:r:engine` 通过，全步骤和仅 DE 步骤均通过

## 页面与功能清单

### 应用级页面

| 页面 | 路由 | 当前实现 | 核心行为 |
| --- | --- | --- | --- |
| 首页 | `/` | `Home.tsx` | 工具搜索、搜索引擎选择、天气、工具入口、顶部高度拖拽 |
| 设置 | `/settings` | `SettingsPage.tsx` | 主题、语言、窗口置顶、帮助、官网、关于 |
| qPCR | `/qpcr` | `QpcrPage.tsx` | Excel 导入、转换、计算、Excel 图表、R 绘图 |
| RNA-seq | `/rnaseq` | `RnaSeqPage.tsx` | Counts 导入、分组、差异分析、结果图和历史目录 |
| 科研绘图 | `/charts` | `ChartStudioPage.tsx` | 模板目录、字段映射、参数配置、R 渲染、结果打包 |
| 图片转 PNG | `/image` | `ImageConvertPage.tsx` | 批量导入、压缩、水印、转换、结果表 |

`/tiff` 通过路由重定向到 `/image`，这是兼容历史入口的行为。

### 当前共享组件

`TitleBar`、`Sidebar`、`AppMark`、`ThemePicker`、`LanguageSwitcher`、`Modal`、`AboutModal`、`HelpButton`、`LoadingOverlay`、`Toast`、`UpdateNotification`、`WeatherWidget`。这些组件由多套 CSS 类名控制，只有部分组件使用相同的尺寸和圆角令牌。

## 主要问题

优先级使用 P0 到 P3，P0 表示迁移前必须先处理的功能或一致性风险。

| 优先级 | 问题 | 证据 | 影响 | 处理方向 |
| --- | --- | --- | --- | --- |
| P0 | 主题初始化不是根级状态 | `useTheme` 只在 `SettingsPage` 使用，`App` 没有主题 Provider | 首次打开应用时可能还没有应用保存的 `data-theme`，设置页和首屏状态来源分裂 | 建立根级主题控制点，保留 Store key 和旧值归一化 |
| P0 | 计算和 UI 共用大型页面文件 | qPCR 绘图约 2249 行，科研绘图约 2879 行，RNA-seq 绘图步骤约 1521 行 | 样式迁移容易触碰运行状态、配置契约和取消逻辑 | 先拆 UI 壳、字段组和结果视图，服务函数保持原路径 |
| P1 | 原生控件和自定义控件混用 | 页面存在大量原生 `input`、`select`、`button`，并有 `fields.tsx` 自定义字段层 | 尺寸、焦点、错误态和键盘行为不统一 | 用 Mantine 表单组件建立字段适配层，逐页替换 |
| P1 | 按钮样式重复实现 | `.btn`、`.btn-primary`、`.qpcr-run-btn`、`.settings-link-row` 等并存 | 同一操作在不同页有不同高度、字重、边框和 disabled 反馈 | 统一 `Button`、`ActionIcon`、`UnstyledButton` 语义 |
| P1 | 卡片和表单分组重复实现 | `card`、`card-title`、`card-body`、`form-group`、`form-row` 在多个页面重复 | 视觉表面过多，间距变化影响信息密度 | 迁移为 `Paper/Card` 加 `Stack/Group/Grid`，保留少量业务专用样式 |
| P1 | 样式层级分散 | `global.css` 引入 `themes.css`、`layout.css`、`pages.css`、`components.css`、`rnaseq.css`、`unified.css`、`golden-gate.css` | 选择器覆盖关系难以预测，页面局部修正会影响别的模块 | Mantine theme 管基础令牌，CSS Modules 管页面布局，逐步删除旧规则 |
| P1 | 工作流入口不一致 | qPCR 使用卡片并排，RNA-seq 使用自定义 segmented control，科研绘图使用三栏旧布局，图片转换使用双卡片 | 用户难以判断当前步骤、运行状态和结果位置 | 统一 PageHeader、Step/Tab、Status、Result 区域 |
| P1 | 运行状态反馈在多处自行拼装 | LoadingOverlay、Toast、notice、badge、tag 和日志区各自实现 | 运行中、取消和失败的语义不一致 | 建立 `TaskStatus` 适配组件，底层保留原回调和取消 API |
| P1 | 复杂参数缺少统一折叠策略 | qPCR 绘图有大量参数网格，RNA-seq 使用多种自定义折叠，科研绘图字段密集 | 低分辨率窗口首屏信息拥挤，长中文标签易截断 | Mantine `Accordion`、`Tabs`、`ScrollArea` 统一复杂参数收纳 |
| P2 | 自定义 Modal 未统一焦点和尺寸 | `src/components/Modal.tsx` 自行处理 overlay、body 和关闭按钮 | 教程、关于、图像放大和帮助的行为略有差异 | 先保留调用 API，内部迁移 Mantine `Modal` 和 `Drawer` |
| P2 | 中英文文案覆盖不完整 | RNA-seq 部分错误和 Rscript 操作文案直接写在页面中 | 语言切换后出现中英文混杂，长文本也未统一测量 | 新增文案全部进入 `i18n.tsx`，页面只使用 key |
| P2 | 导航默认只有图标 | `Sidebar.tsx` 使用 48px 图标栏，名称主要依靠 title | 新用户需要悬停才能理解模块，键盘和触摸使用成本高 | 默认 56px rail，宽窗口显示短标签，窄窗口保留 Tooltip |
| P2 | 首页和工作区的宽度规则重复 | `page-shell`、`page-shell--wide`、`unified-page`、`content-max` 多层覆盖 | 页面宽度和留白不容易预测 | 统一 `AppShell.Main`、`Container` 和页面密度令牌 |
| P2 | 表格语义样式重复 | qPCR、RNA-seq、图片结果各有表格 CSS | 表头、数字对齐、横向滚动和长文本策略不一致 | 建立 `DataTable` 约定，按数据类型配置列对齐 |
| P3 | 主题和业务颜色仍依赖 CSS 自定义变量 | `themes.css` 中有 Apple 风格变量和多套 shadow、gradient、radius | 迁移时会产生 Mantine 变量与旧变量并存 | 先做映射层，再移除未使用变量 |
| P3 | 构建 chunk 偏大 | Vite 报告 ExcelJS 938KB，另有超过 500KB chunk | 首次加载成本和页面间资源边界不理想 | 保持页面 lazy import，评估 ExcelJS worker 或更细的 manualChunks |

## 重复 UI 实现清单

### 表面和间距

- `.card` 在 qPCR、RNA-seq、科研绘图和图片转换中有不同 padding、shadow 和 header 高度
- `.panel-header`、`.panel-title` 和 `.panel-actions` 在统一样式与页面样式中重复覆盖
- `.form-group`、`.form-row`、`.qpcr-setting-grid`、`.rx-param-grid` 都表达字段布局
- `btn-row`、`qpcr-button-row`、`rx-project-menu-actions` 和图表工具栏各自设置 gap、wrap 和对齐

### 控件

- 原生 `button` 和 `.btn` 是主要操作控件
- `Toggle`、`SwitchField`、`.settings-switch` 和多个 `role="switch"` 具有相似交互
- `select`、`SelectField`、自定义颜色字段和 `ColorField` 分别控制值、标签和错误态
- `Modal`、教程弹层和图像放大弹层共存

### 状态

- `.notice`、`.rx-beta-note`、`.rx-rscript-notice`、`.qpcr-rscript-notice`、`.result-success` 表达相近的提示语义
- `rx-tag`、`qpcr-rscript-status`、`Badge` 风格各自独立
- LoadingOverlay、按钮文字、Toast 和日志同时反馈同一运行任务

## 页面级审计

### 首页和设置

- 首页功能完整，搜索和高度拖拽有持久化键，迁移时要保留 `localStorage` 行为
- 搜索引擎菜单是自定义浮层，需迁移为 Mantine `Menu` 并保留外部点击关闭、键盘选择和 logo fallback
- 设置页的主题切换逻辑与全局主题状态分离，是当前最高风险点
- 设置页使用自定义 tablist、segmented control 和 switch，迁移后可直接映射 Mantine `Tabs`、`SegmentedControl` 和 `Switch`

### qPCR

- 文件选择、工作表选择、转换和计算已经有明确步骤，但当前视觉依赖多层 CSS
- `Calculate.tsx` 同时处理方法、对照组、重复数、参考基因、图表颜色、择优重复和离群值参数，字段迁移必须逐个对照
- `QpcrPlotter.tsx` 约 2249 行，包含柱状图和热图的全部设置、预览、Rscript 检测、运行、取消、设置导入导出和输出目录
- 预览区域与参数区需要独立滚动，避免 Mantine `Card` 或 `ScrollArea` 改变数据区域高度
- ExcelJS 和 `chart-gen.ts` 不应因 UI 组件替换而改变工作表名、单元格填补色、方法字符串或图表 XML

### RNA-seq

- 当前页面是三步向导，步骤可跳转但需要数据文件、DE 结果和结果图等前置条件
- `store.tsx` 集中管理配置、导入、Rscript、运行、日志、历史结果和配置文件，迁移时应只替换展示层
- `ImportStep.tsx` 需要同时呈现输入格式、预览、警告、缓存后的 CSV 和输出目录
- `DesignStep.tsx` 有样本组、批次、比较和结果摘要，适合拆成 Mantine `Accordion` 与 `Table`
- `PlotsStep.tsx` 有大量参数、基因簇编辑器、画廊和放大预览，适合拆为参数侧栏与结果主区
- 历史目录加载必须继续识别 `prepared/params.json` 和 `DE_summary.csv`

### 科研绘图

- `ChartStudioPage.tsx` 同时承担模板目录、数据读入、字段映射、参数配置、R 依赖、运行日志、结果预览和打包
- 目录、设置、结果的三栏层级合理，但当前控件和卡片样式由页面 CSS 大量覆盖
- 57 个模板共享同一 `ChartConfig` 和 manifest 结构，UI 迁移应围绕 schema 和 state hook，不复制模板逻辑
- SVG 预览、PNG 下载、ZIP 导出和参考图片加载均依赖 Tauri asset 协议或文件路径，Mantine `Image` 只做显示层适配

### 图片转换

- `ImageConvertPage.tsx` 已经把导入、缩略图、选项、转换、取消、结果表分为可识别区域
- `OptionsPanel.tsx` 有 16 个原生 select 和多组水印字段，迁移时应按压缩、水印、输出三组折叠
- Rust 服务支持多页 TIFF、Unicode 路径、无损和有损、字体缺失时跳过水印、取消和结果事件，UI 只能改变展示方式
- 文件缩略图是 Tauri command 返回的 data URL，不能用浏览器网络请求替代

## 风险分区

### 高风险

- 主题启动时序和 `SettingsPage` 局部状态
- qPCR Excel 工作簿写回与图表注入
- RNA-seq params.json 字段完整性、输出目录和取消进程树
- Tauri 拖放路径授权、文件作用域和 Unicode 临时目录
- Rust 图片转换事件顺序、页码命名和源文件不覆盖

### 中风险

- 模板目录 schema、预设、参考图和 ZIP 导出
- 自定义 Modal、Toast、HelpButton 的调用兼容
- Rscript 安装、依赖检测和错误日志呈现
- 页面缩放、长英文、中文字体和 420px 窗口

### 低风险

- 页面标题、图标背景、卡片边框、圆角、阴影和 hover 动效
- 首页工具卡片与设置页导航的视觉调整

## 迁移前结论

当前项目的核心能力边界清楚，前端 UI 层与数据处理层已经通过 `src/lib`、`src/features`、Tauri command 和 R runner 分开。迁移工作应从全局 Provider、导航和共享控件开始，再逐页替换展示层。qPCR 绘图、RNA-seq 结果画廊和科研绘图工作室应在服务层完全冻结后再动布局。
