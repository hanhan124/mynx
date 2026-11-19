# R Graph Gallery 图表工作台一致性改造 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把图表工作台改造成可验证、可复现、对用户友好的 R 图表模板库：每个可见模板均能用对应示例数据生成与 R Graph Gallery 基础示例一致的图，并可查看或下载完整模板。

**Architecture:** 使用“模板清单 + 每模板资源包 + 分类型 R 渲染器 + 统一任务执行器”的结构。模板清单只发布已经通过官方参考图视觉回归的模板；示例数据、默认参数、R 代码、来源链接和依赖列表随应用保存，运行时只安装当前模板缺失的包。

**Tech Stack:** React 18、TypeScript、Tauri 2、R / ggplot2、Tauri Store、Vitest、React Testing Library、PNG 视觉差异测试。

---

## 1. 范围与验收定义

R Graph Gallery 当前包含 400+ 示例、接近 50 个图表类型。实施分两层：

1. **基础类型层（首要交付）**：官网首页列出的每个图表类型至少提供一个与官网基础教程一致的模板。
2. **示例变体层（持续扩展）**：同一类型下的官网高级示例作为独立模板加入，沿用相同的质量门槛。

“与官网一致”的可测试定义：

- 模板记录包含唯一的官网示例 URL、官方仓库源文件位置和许可/署名信息。
- 使用模板自带数据与默认参数，输出的布局、几何对象、映射、色板、标注和主题与参考图一致。
- PNG 输出通过视觉回归；允许抗锯齿和字体渲染造成的小幅像素差异，不允许图形类型、数据映射或布局不同。
- PNG、SVG 和交互式 HTML 按模板能力声明，不提供无法正确生成的格式。
- 所有可点击模板必须通过自动化生成测试；未通过的模板不进入“可用”列表。

## 2. 用户体验方案

### 主界面

采用三栏工作区：

- 左栏：分类、搜索、收藏、最近使用和模板完成状态。
- 中栏：模板卡片网格，显示真实参考缩略图、名称、数据要求、输出类型、所需 R 包。
- 右栏：模板详情与参数配置，顶部固定实时预览，下方是字段映射和外观参数。

模板详情提供四个明确动作：

- **使用示例数据**：立即载入模板内置数据并展示前 20 行。
- **下载示例数据**：导出 CSV/XLSX 到用户选择的位置。
- **下载完整模板**：导出 ZIP，包含示例数据、`params.json`、可独立运行的 R 脚本和中文 README。
- **使用我的数据**：导入后自动识别列类型，按模板 schema 推荐字段映射，并在缺失必要列时就地说明。

页面底部持续显示：“图表类型、示例代码与参考图来自 R Graph Gallery”，并提供当前模板原始页面和项目许可链接。

### 运行日志重新设计

把当前 `<pre>` 文本框替换为“任务状态卡”：

- 顶部：模板图标、任务名称、总进度、用时、取消/重试按钮。
- 中部：五步状态条——检查环境、准备数据、安装依赖、生成图表、保存结果。
- 事件列表：时间、状态图标、用户可读消息；技术输出默认折叠在“查看详细日志”。
- 完成态：缩略图、文件路径、打开图片、打开文件夹、再次编辑、复制 R 代码。
- 错误态：给出问题、原因和下一步，保留“一键重试”和“复制诊断信息”。
- 空态不再显示日志文字，改为轻量说明和最近一次成功任务。

所有状态需支持键盘访问、明显焦点、屏幕阅读器状态播报，并符合现有明暗主题。

## 3. 数据与模板结构

每个模板目录使用以下结构：

```text
src-tauri/r/chart-templates/<template-id>/
  manifest.json
  render.R
  sample.csv
  defaults.json
  reference.png
  README.zh-CN.md
```

`manifest.json` 至少包含：

```json
{
  "id": "bar-basic-ggplot2",
  "name": "基础柱状图",
  "family": "ranking",
  "sourceUrl": "https://r-graph-gallery.com/...",
  "sourceRepoPath": "...",
  "engine": "ggplot2",
  "packages": ["ggplot2"],
  "outputs": ["png", "svg"],
  "dataSchema": {
    "category": { "types": ["string", "factor"], "required": true },
    "value": { "types": ["number"], "required": true }
  }
}
```

不要再用一个 `kind` 分支近似生成多个不同图。每个模板拥有自己的 `render.R`；只有读取、输出设备、字体、错误格式和包安装逻辑由共享运行时提供。

## 4. 实施任务

### Task 1: 建立官网图表清单与质量门槛

**Files:**
- Create: `docs/chart-gallery-inventory.json`
- Create: `scripts/validate-chart-inventory.mjs`
- Modify: `package.json`

**Steps:**

1. 从官网首页与官方 GitHub 仓库建立图表类型/基础示例清单，记录 source URL、仓库路径、输出能力和依赖。
2. 编写清单校验：ID 唯一、URL 合法、来源必填、基础类型覆盖率可统计。
3. 添加 `npm run charts:inventory`，失败时输出缺失字段和模板 ID。
4. 先将当前 36 个近似模板标记为 `draft`，不得计入可用模板。
5. 运行校验并保存首份覆盖率报告。

### Task 2: 定义模板 manifest 与参数 schema

**Files:**
- Create: `src/lib/charts/types.ts`
- Create: `src/lib/charts/schema.ts`
- Create: `src/lib/charts/schema.test.ts`
- Modify: `src/lib/charts/catalog.ts`

**Steps:**

1. 为数据角色、参数控件、输出格式、依赖和来源定义严格 TypeScript 类型。
2. 先写无来源、无数据 schema、重复 ID 必须失败的测试。
3. 实现运行时 manifest 校验和中文错误信息。
4. 将 `catalog.ts` 改为读取已验证 manifest，不再硬编码近似 `kind` 映射。
5. 运行单元测试与类型检查。

### Task 3: 建立共享 R 模板运行时

**Files:**
- Create: `src-tauri/r/chart_runtime.R`
- Modify: `src-tauri/r/chart_runner.R`
- Create: `scripts/chart-runtime-smoke.R`

**Steps:**

1. 把参数解析、包检测、设备创建、进度事件、错误序列化和结果清单移入共享运行时。
2. 规定结构化日志协议：每行 JSON，包含 `timestamp`、`stage`、`level`、`message`、`progress`。
3. `chart_runner.R` 只负责校验 manifest、载入模板的 `render.R` 并调用统一入口。
4. 为 CSV、TSV、XLSX、空数据、错误列类型和不可写输出目录编写 smoke test。
5. 验证未运行模板不会触发包下载。

### Task 4: 迁移第一批高频基础图

**Files:**
- Create: `src-tauri/r/chart-templates/bar-basic-ggplot2/*`
- Create: `src-tauri/r/chart-templates/line-basic-ggplot2/*`
- Create: `src-tauri/r/chart-templates/scatter-basic-ggplot2/*`
- Create: `src-tauri/r/chart-templates/histogram-basic-ggplot2/*`
- Create: `src-tauri/r/chart-templates/boxplot-basic-ggplot2/*`

**Steps for each template:**

1. 从官方仓库核对原始 R 代码和示例数据。
2. 保存来源、数据、默认参数和参考 PNG。
3. 只改造输入/输出接口，不改变图形语义和默认视觉参数。
4. 运行模板并生成实际 PNG/SVG。
5. 与 `reference.png` 做视觉回归并记录差异阈值。
6. 通过后将 manifest 状态从 `draft` 改为 `verified`。

### Task 5: 按官网分类完成基础类型迁移

**Files:**
- Create: `src-tauri/r/chart-templates/<template-id>/*`
- Modify: `docs/chart-gallery-inventory.json`

**Batch order:**

1. 分布：violin、density、histogram、boxplot、ridgeline、beeswarm。
2. 相关：scatter、heatmap、correlogram、bubble、connected scatter、2D density。
3. 排名：barplot、radar、wordcloud、parallel、lollipop、circular barplot、table。
4. 组成：grouped/stacked bar、treemap、doughnut、pie、dendrogram、circular packing、waffle。
5. 演化：line、area、stacked area、streamchart、time series。
6. 地图：map、choropleth、hexbin map、cartogram、connection、bubble map。
7. 流与网络：chord、network、sankey、arc、edge bundling。

每批完成后必须运行整批生成、manifest 校验、依赖隔离和视觉回归；不允许以通用柱状图/散点图替代特殊图形。

### Task 6: 示例数据查看与下载

**Files:**
- Create: `src/lib/charts/sample-data.ts`
- Create: `src/pages/charts/SampleDataPanel.tsx`
- Create: `src/pages/charts/SampleDataPanel.test.tsx`
- Modify: `src/pages/charts/ChartStudioPage.tsx`

**Steps:**

1. 实现按模板读取内置示例并推断列类型。
2. 增加前 20 行数据表、列类型徽标、行列数量和数据说明。
3. 实现“使用示例数据”和“下载示例数据”。
4. 实现“下载完整模板”ZIP 导出，包含数据、参数、R 脚本、README 和来源说明。
5. 测试取消保存、目标已存在、Unicode 文件名和只读目录。

### Task 7: 用户数据字段映射与即时验证

**Files:**
- Create: `src/lib/charts/data-profiler.ts`
- Create: `src/pages/charts/FieldMappingPanel.tsx`
- Create: `src/pages/charts/FieldMappingPanel.test.tsx`
- Modify: `src/pages/charts/ChartStudioPage.tsx`

**Steps:**

1. 导入后分析列名、类型、缺失值、唯一值数量和范围。
2. 根据模板 schema 自动推荐映射，但允许用户更改。
3. 在生成前给出阻断错误和非阻断建议。
4. 为地图、网络、桑基、时间序列等特殊数据结构提供专用字段说明。
5. 覆盖空文件、混合类型、中文列名和超大文件测试。

### Task 8: 重构图表浏览与详情界面

**Files:**
- Create: `src/pages/charts/ChartCatalog.tsx`
- Create: `src/pages/charts/ChartTemplateCard.tsx`
- Create: `src/pages/charts/ChartTemplateDetail.tsx`
- Modify: `src/pages/charts/ChartStudioPage.tsx`
- Modify: `src/styles/pages.css`

**Steps:**

1. 将当前单文件页面拆成目录、卡片、详情、数据和运行区域。
2. 使用真实参考缩略图；图片加载失败时显示本地图形图标。
3. 增加搜索、分类、收藏、最近使用和“仅显示已安装依赖”筛选。
4. 为 loading、empty、error、offline 和未验证模板设计完整状态。
5. 在 960×540、窄窗口、明暗主题下做截图验收。

### Task 9: 重做运行状态与日志

**Files:**
- Create: `src/lib/charts/run-events.ts`
- Create: `src/pages/charts/ChartRunPanel.tsx`
- Create: `src/pages/charts/ChartRunPanel.test.tsx`
- Modify: `src/lib/charts/runner.ts`
- Modify: `src/styles/pages.css`

**Steps:**

1. 解析共享 R 运行时输出的 JSON 事件，未知文本归入详细日志。
2. 实现五步进度、阶段图标、百分比、耗时和取消状态。
3. 实现成功结果卡和错误恢复卡。
4. 详细日志支持展开、搜索、复制和导出诊断文件。
5. 状态变化使用 `aria-live`，所有操作支持键盘和焦点环。
6. 测试成功、缺少 R、包安装失败、R 代码错误、用户取消和输出失败。

### Task 10: 参数预设与完整模板管理

**Files:**
- Modify: `src/lib/config.ts`
- Create: `src/lib/charts/presets.ts`
- Create: `src/pages/charts/PresetManager.tsx`
- Create: `src/lib/charts/presets.test.ts`

**Steps:**

1. 给预设增加 schema 版本、模板版本和兼容迁移。
2. 支持重命名、复制、删除、导入和导出。
3. 模板升级时保留仍有效的字段并提示不兼容参数。
4. 测试损坏预设、旧版本迁移和重复名称。

### Task 11: 按需安装 R 与依赖

**Files:**
- Modify: `src/lib/charts/runner.ts`
- Create: `src/pages/charts/DependencyDialog.tsx`
- Create: `src/lib/charts/dependencies.test.ts`

**Steps:**

1. 运行前只计算当前模板缺失的 R 包。
2. 对话框列出将下载的 R/包、用途和大致数量，用户确认后才安装。
3. 缓存已安装状态，支持失败重试和更换 CRAN 镜像。
4. macOS/Linux 不调用 Windows 安装器，提供匹配平台的明确引导。
5. 验证浏览模板和查看示例不会安装任何内容。

### Task 12: 视觉回归、端到端和发布门禁

**Files:**
- Create: `scripts/chart-visual-regression.mjs`
- Create: `scripts/chart-e2e-smoke.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/*`

**Steps:**

1. 为所有 `verified` 模板生成 PNG 并和参考图比较。
2. 给字体差异、透明背景和抗锯齿设定统一容差。
3. 端到端覆盖：选模板 → 查看示例 → 下载数据 → 生成 → 打开结果 → 保存/恢复参数。
4. 增加 `charts:validate`、`charts:smoke`、`charts:visual` 三个命令。
5. CI 中任何 verified 模板失败即阻止发布。
6. 最终手工检查所有按钮、快捷键、明暗主题和窄窗口。

## 5. 完成标准

- 官网首页基础图表类型清单覆盖率 100%。
- 所有对用户可见的模板状态均为 `verified`。
- 每个模板都有可查看、可使用、可下载的示例数据。
- 每个模板都有独立 R 实现、默认参数、来源 URL、参考图和视觉回归结果。
- 没有特殊图表被通用柱状图或散点图替代。
- 运行日志具有清晰阶段、进度、错误恢复和结果操作。
- 未点击生成时不安装 R 或任何 R 包。
- TypeScript、单元测试、R smoke、视觉回归和端到端测试全部通过。

## 6. 建议实施节奏

按“基础设施 → 5 个高频模板 → UI/日志 → 全类型迁移 → 发布门禁”推进。先用 5 个模板验证架构与视觉回归阈值，再批量扩展；这样每一批都能交付真实可用的模板，而不会累积大量看似存在但实际不正确的按钮。
