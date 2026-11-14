# Mynx Mantine 8 UI 重构验收报告

- 验收日期：2026-11-14
- 验收版本：2.3.9（分支 `codex/chart-ui-3-1`，基线 commit `785cea1` + 本次修复，未提交）
- 验收角色：独立审查（按 `DESIGN.md`、`FUNCTION_BASELINE.md`、`UI_MIGRATION.md`、`UI_AUDIT.md` 逐项核对）
- 验收方式：静态审查 + 自动检查全量执行 + 真实 Tauri 应用逐页截图与功能回归（Windows 10 实机）

## 结论

Mynx 的 Mantine 8 迁移在 Windows 上通过验收：四大科研模块的关键功能在真实应用中回归通过，浅色/深色、中文/英文、420px/960px 布局均可用，核心算法输出、文件格式与设置存储保持基线契约。本次验收发现并修复了 6 类问题（含 1 个迁移引入的 P0 视觉缺陷与 1 个继承自 v2.3.9 的 Rust 事件序列化缺陷），清理了 1560 行已验证无引用的旧 CSS。**macOS 未验证**，详见下文「平台验证情况」。

---

## 1. 迁移模块清单

### 1.1 追加检查点（ChartStudio 3.1-3B）

本轮在已有 Windows 验收结果之上完成了 ChartStudio 右侧检查器第二批参数迁移。数据映射、导出格式与论文规格、尺寸/DPI、图形元素、统计标注、热图设置和按需安装选项均已使用 Mantine 8 控件；没有改动 `ChartConfig`、模板 manifest、R runner、输出文件命名或取消 API。数值输入保留空值编辑态并正确接受 0。

自动复验：`npx tsc --noEmit`、`npm run build`、`npm test`、`npm run lint`、`npm run charts:check` 均已执行。构建、类型检查、测试和图表清单检查通过；lint 为 0 error / 19 个既有 warning。`charts:verify` 的 schema、来源、参考图和字段映射阶段通过；完整 57 模板 × 5 格式的 R smoke 在有限等待窗口内未完成，已停止残留进程并另外完成 bar、heatmap、volcano 三个模板的五格式 smoke（通过）。当前恢复点为 `d9ab0dd`，本轮代码变更待单独提交。

### 1.2 追加检查点（RNA-seq 字段适配层）

RNA-seq 共享字段、绘图基因列表和基因簇编辑器已完成 Mantine 8 控件收口：`NumberInput`、`TextInput`、`Select`、`Switch`、`ColorInput` 和 `Textarea`。数字输入仍然保留未提交草稿，样本拖放、配置更新、运行和取消调用未改动。静态检查确认 qPCR、RNA-seq 和图片转换页面不再包含原生 `input`/`select`/`textarea` 控件。

本轮复验：`npx tsc --noEmit`、`npm test`、`npm run lint`、`npm run build` 通过；lint 仍为 0 error / 19 个既有 warning。真实 Tauri 截图沿用 §3 的 Windows 验收集，macOS 仍未验证。

| 阶段（UI_MIGRATION.md） | 范围 | 验收状态 |
| --- | --- | --- |
| 1 基础设施 | `MantineProvider`、`src/lib/mantine-theme.ts`、`theme-context.tsx` 根级主题 | 通过（首次启动即应用保存主题，重启保留已实测） |
| 2 应用壳 | `AppShell`、`TitleBar`（无边框拖拽/最小化/最大化/关闭/置顶）、`Sidebar` 56px NavLink | 通过（窗口控制、导航、`mynx://navigate` 事件正常） |
| 3 共享控件 | Modal/Toast/HelpButton 适配层、`/ui-showcase` | 通过（Showcase 页浅色/深色截图一致） |
| 4 首页与设置 | 搜索 `TextInput`/`ActionIcon`、工具卡片、设置 vertical `Tabs`/`SegmentedControl`/`Switch` | 通过（修复工具卡片布局回归，见 §5） |
| 5 图片转换 | 页面头部、文件入口、压缩/水印/输出表单 | 通过（修复 15 处重复标签，见 §5） |
| 6 qPCR | 页面头部、数据源、转换、计算、绘图工作台全部控件 | 通过（真实 Excel 导入→转换→计算→R 绘图回归通过） |
| 7 RNA-seq | 页面头部、三步 Tabs、导入/设计/绘图全部控件、批次与日志操作 | 通过（真实 counts 导入→配置→全步骤 R 运行→历史加载通过） |
| 8 科研绘图 | 三栏工作台、模板目录、数据映射、运行状态、结果导出 | 通过（真实模板 R 渲染 + manifest 回归通过） |
| 9 清理 | 旧 CSS 删除 | 本次验收完成（1560 行已验证无引用规则删除，见 §5.6） |

## 2. 功能测试结果（真实应用，Windows）

自动检查（全部通过，与 FUNCTION_BASELINE 记录一致）：

| 命令 | 结果 |
| --- | --- |
| `npm run build` | PASS（ExcelJS 938KB chunk 提示为已记录的性能基线） |
| `npm run lint` | PASS（0 error / 19 warning，等于基线 warning 数） |
| `npm test` | PASS（RNA-seq matrix smoke 18 项 + chart schema 3 项） |
| `npm run test:rust` | PASS（9 个 Rust 单元测试） |
| `npm run test:r:engine` | PASS（全步骤 + 仅 DE；中文组名在 params.json 保留） |
| `npm run charts:check` | PASS（86 模板、57 已验证、57 字段映射、47 来源链接） |
| `npm run resources:check` | PASS（351 个 R 资源文件） |

真实应用回归（通过 CDP + UIA + 原生对话框自动化驱动实际 Tauri 窗口）：

### 图片转换
- 通过原生文件对话框添加 `red sample.png`、`green test.jpg`、`multi page.tif`（含空格路径）
- 无损转换 3/3 成功；多页 TIFF 生成 `multi page_p1/p2/p3.png`（页码命名契约保持）
- 输出模式 subfolder 生成 `PNG_output_20261114_071423/`；源文件未被覆盖
- 结果表显示真实体积与比例（161 B → 85 B，-47% 等）——发现并修复了体积全部显示 `0 B / +NaN%` 的缺陷（见 §5.5）
- 缩略图（Tauri command data URL）、文件数徽标、清除、打开目录行为正常

### qPCR
- ExcelJS 真实导入 49行长格式工作簿 → 转换生成 `Transformed Data`（4 基因，缺失值标黄逻辑在位）
- 计算：reference-normalized（2^-ΔCt）输出 `Summary_All_Genes`，数值验证正确（GAPDH Control ≈ 0.574）
- 复制数校验按契约在计算前报错（先以错误 fixture 触发 `Group "Control_1" ... has 1 replicates` 提示，确认执行前校验仍在）
- R 绘图：3 张 PNG（GAPDH/MYC/TP53，52–57KB）+ `statistical_analysis_summary.csv` + `qpcr-barplot-sample-order.csv`
- 工作簿契约：工作表 `Transformed Data / Summary_All_Genes / Charts_All_Genes / <基因>`、列名 `Gene/Group_Name/Repeat*/Average/Stdev` 全部保持
- 择优重复/离群值互斥、保存回写原文件（silentSave）行为在位

### RNA-seq
- `gene.count_rep.csv`（800 基因 × 6 样本）导入，预览分页、格式识别正常
- 加载 `ui_config.json` → 分组（Control/Case）与比较恢复正确
- Run all（de + heatmap + plots）→ Done，451 条日志；输出目录契约完整：
  `DE/ DE_summary.csv DE_Case_vs_Control.csv`、`DEG/`、`MA/`、`PCA/`、`QC/`、`heatmap/heatmap_overall.png`、`plots/PCA_selected.png volcano_Case_vs_Control.png`、`data/`、`logs/`、`prepared/params.json`
- `params.json` 保留组名；`DE_summary.csv` 记录 deseq2、554 基因、阈值
- 历史结果目录重新加载（Load results → `~/Mynx/rnaseq_runs/ui_test`）→ 结果画廊恢复 volcano/PCA

### 科研绘图
- 57/57 模板目录、家族筛选、搜索正常
- `Basic bar chart` + 示例数据 → Generate → R 渲染成功，运行阶段（检查环境/读取数据/渲染/保存）逐项显示 ✓
- 输出 `~/Mynx/charts/mynx-bar-basic-ggplot2.png` + 同名 `.png.json` 参数清单（`mynx-<template>.<format>` 契约保持）

### 取消路径说明
UI 层取消按钮全部在位（qPCR/RNA-seq/绘图/图片转换均有取消入口并调用原 `cancelRun`/`taskId` API）。进程树终止、临时文件清理由 `test:rust`（9 项）与 `test:r:engine` 覆盖；本次未在 UI 中实际点击取消（自动化点击原生 R 进程窗口超出本环境能力），如实记录为未执行项。

## 3. 视觉一致性检查

逐页 × 状态截图（见 `docs/acceptance-screenshots/`）：

| 覆盖 | 截图 |
| --- | --- |
| 首页 中文 浅色（修复后） | `01-home-zh-light.png`、`final-home-zh-light.png` |
| 首页 中文 浅色（修复前缺陷对照） | `before-home-toolcards-bug.png` |
| 首页 中文 深色 / 英文 浅色 | `dark-home-zh.png`、`light-home-en.png` |
| 设置 浅色/深色/英文 | `02-settings-zh-light.png`、`03-settings-zh-dark.png`、`light-settings-en.png`、`dark-settings-zh.png` |
| qPCR 中/英 × 深/浅 | `04-qpcr-zh-dark.png`、`dark-qpcr-zh.png`、`light-qpcr-zh.png`、`light-qpcr-en.png` |
| RNA-seq 中/英 × 深/浅 | `dark-rnaseq-zh.png`、`light-rnaseq-zh.png`、`light-rnaseq-en.png`、`final-rnaseq-zh-light.png` |
| 科研绘图 中/英 × 深/浅 + 运行结果 | `dark-charts-zh.png`、`light-charts-zh.png`、`light-charts-en.png`、`light-charts-run-result-en.png`、`final-charts-zh-light.png` |
| 图片转换 中/英 × 深/浅 + 结果表 | `dark-image-zh.png`、`light-image-zh.png`、`light-image-en.png`、`light-image-results-table-en.png`、`light-image-results-fixed-en.png` |
| UI Showcase | `dark-ui-showcase-zh.png`、`light-ui-showcase-zh.png` |
| 420px 实窗缩放 | `light-420-home-en.png`、`light-420-qpcr-en.png`、`light-420-charts-en.png`、`light-420-settings-en.png` |

检查结论：
- 页面头部（图标/标题/说明/帮助）对齐统一；按钮、输入框、表格列在两种语言下无溢出，长英文描述正确省略（`light-home-en.png`）
- 深色主题完整覆盖标题栏、侧栏、卡片、表单、日志、徽章（`03-settings-zh-dark.png` 等全页深色一致）
- 420px 下导航栏保持可见（`breakpoint: "0px"`）、内容单列堆叠、文件选择与取消入口可达
- 排查后确认非缺陷项：设置页纵向 Tabs 右侧灰线为 Mantine tablist 边框 + 激活指示条（非滚动条）；420px 绘图页按钮拉伸为 `@media (max-width: 460px)` 的既有设计；首页计数基线对齐正常

## 4. macOS / Windows 平台验证情况

**本环境仅能验证 Windows**（Windows 10 19044 x64，WebView2 157，Tauri 2.11.5）。以下 macOS 项**全部未验证**，不能宣称通过：

- WKWebView 渲染差异（字体回退 PingFang SC、滚动条、暗色 `color-scheme`）
- 无边框窗口拖拽区、红绿灯等价的自定义窗口控制在 macOS 上的行为（含 `macOSPrivateApi`）
- 原生菜单事件（`mynx://navigate`、`mynx://toggle-language` 等）在 macOS 菜单栏的表现
- 拖放路径授权与 fs scope（`unstable` reroute）在 macOS 上的行为
- asset 协议结果图/参考图加载、Rscript 路径探测（/usr/local/bin 等）与 R 包安装入口
- updater（Sparkl式更新提示、下载、重启）与 dmg/app 安装包（`mac:build`）
- 420px/960px 在 macOS 窗口最小尺寸约束下的布局

建议在 macOS 实机按 `FUNCTION_BASELINE.md` 发布门槛补一轮（每模块一次真实任务 + 一次取消 + 一次历史加载）。

## 5. 已修复问题

| # | 优先级 | 问题 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | P0 | 首页工具卡片图标与文字重叠——迁移时用 Mantine `Button`（子元素被包进 inline `Button-label`）替代了原 flex 布局 | `Home.tsx` 改回 `UnstyledButton`（符合 DESIGN.md 组件映射） | 修复前后截图对照 `before-home-toolcards-bug.png` → `01-home-zh-light.png` |
| 2 | P1 | 20 处字段标签重复显示：`OptionsPanel.tsx` 15 处、`Calculate.tsx` 4 处、`ImportStep.tsx` 1 处——迁移为 Mantine 控件后旧 `<label>` 未删 | 删除重复旧标签；`Calculate.tsx` 重复处理策略字段保留带 tooltip 的旧标签、去掉 Select 的 `label` prop | `dark-image-zh.png`（修复后单标签）；`grep` 全库 0 残留 |
| 3 | P2 | 4 处 UI 硬编码颜色绕过主题令牌（qPCR 错误条 `#ff453a`/rgba、RNA-seq DE 表头 `#c0392b`/`#2471a3`） | 新增 `.result-error` 修饰类（`--red-rgb`/`--red` 令牌）；DE 表头改 `var(--red)`/`var(--accent)` | build/lint 通过 |
| 4 | P2 | 5 处图标按钮缺 `aria-label`（UpdateNotification 关闭 ×3、分组删除、样本移出、基因簇删除、RNA-seq 教程关闭） | 全部补齐中英文 `aria-label`（文案来自 `l()` 双语，无新 key 需求） | lint 通过 |
| 5 | P2 | **图片转换结果表体积显示 `0 B`、比例 `+NaN%`**（继承自 v2.3.9 的 Rust 缺陷）：`ConvertEvent` 枚举的 `#[serde(tag, rename_all)]` 只重命名 variant 名，字段 `original_bytes` 等仍按 snake_case 序列化，前端读 `originalBytes` 落空 | `image_convert.rs` 增加 `rename_all_fields = "camelCase"`（serde 1.0.229 支持） | 修复后结果表显示真实体积（161 B→85 B，-47%）；`test:rust` 9/9 通过；真实转换复测 |
| 6 | P3 | 代码卫生：4 个无 CSS 定义的死 className（`qpcr-page-header`、`qpcr-step-card--transform/--calculate`、`theme-tile-labels` 包装层）；`@mantine/hooks` 声明但从未使用 | 删除死类名与包装层；`npm uninstall @mantine/hooks` | build/lint/test 通过 |

### 5.6 旧 CSS 清理（阶段 9）

用 postcss AST 脚本（`docs/acceptance-screenshots/css-clean.mjs`，保留原格式、仅删除"全部 class token 在 src 源码（含模板字面量与动态前缀）中无引用"的规则）删除：

| 文件 | 删除行数 | 说明 |
| --- | --- | --- |
| `rnaseq.css` | 1416 | `rx-preset-*`、`rx-status-*`、`rx-progress-*`、`rx-rail-*`、`rx-viewer-*`、`rx-fmt-*`、`rx-col-*`、`rx-count-*`、`rx-global-*`、`rx-import-*`、`rx-work-*` 等整批旧工作台规则 |
| `pages.css` | 61 | `qpcr-hero-*`、`qpcr-section-*`、`qpcr-toggle-*`、`settings-nav-item/segmented/switch`、`chart-studio__catalog-title/__result-count`、`qpcr-color-field` 等 |
| `components.css` | 30 | `convert-options`、`help-center-note`、`step-num`、`card-grid--3` 等 |
| `layout.css` | 7 | `.app-body`（已被 AppShell 取代） |

清理后 `npm run build`、`npm run lint`、`npm test`、`npm run test:rust`、`npm run charts:check` 全部通过，并对首页/RNA-seq/科研绘图/设置逐页重新截图确认视觉无变化（`final-*.png`）。

## 6. 遗留问题与观察

1. **macOS 未验证**（见 §4）——发布前必须补齐，属发布门槛而非代码缺陷。
2. **UI 取消路径未实测**：服务层取消逻辑由 Rust/R 测试覆盖，UI 点击取消未在本次自动化中执行。
3. **设置页纵向 Tabs 在 <760px 不折叠为横向**：pages.css 的旧媒体查询针对的是迁移前自定义 tablist，对 Mantine `orientation="vertical"` 无效。当前 420px 下仍可用（列表纵向排布），属外观优化项。
4. **RNA-seq 三步 Tabs 长标签换行**：中文/英文下均换行为两行，符合"长文本允许换行"约束，未处理。
5. **Vite 大 chunk 警告**（ExcelJS 938KB 等）：FUNCTION_BASELINE 记录的性能基线，按要求不通过删减功能消除。
6. **lint 19 条 warning**：Fast Refresh 导出与 hook 依赖提示，修复需改动组件结构，超出验收范围，维持基线。
7. **文档数字滞后**：UI_MIGRATION.md 3.1 节写"50 verified / 36 draft"，当前实际为 57 verified / 36 draft（`charts:check` 为准）。属历史阶段记录，未改动。
8. **更新通知器**（updater）真实更新流未触发（开发环境无新版本）；`UpdateNotification` 组件渲染与关闭按钮 aria-label 已核对。

## 7. 重构前后截图对照

- **工具卡片修复对照**：`docs/acceptance-screenshots/before-home-toolcards-bug.png`（图标与文字重叠）→ `01-home-zh-light.png`（对齐正常）
- 图片转换标签重复：文字记录于 §5.2，修复后见 `dark-image-zh.png` / `light-image-zh.png`（原缺陷态截图未单独保留）
- 其余状态对照以本报告 §3 表格中的成组截图为准（迁移后单一状态，无重构前同帧对照）

说明：仓库中未保存重构完成前的全量截图，无法提供整套"重构前"图像；以上对照点为本次验收实际捕捉到的缺陷前后帧。

## 8. 后续维护建议

1. **macOS 验收优先**：按 §4 清单在 macOS 实机执行 FUNCTION_BASELINE 发布门槛，通过后再打 tag 发布。
2. **把取消路径纳入 UI 自动化**：本次建立的 CDP 驱动（`docs/acceptance-screenshots/cdp.mjs`）+ UIA 对话框自动化（`pwshot.ps1`、`make-qpcr-fixture.mjs`）可复用；建议将"导入 fixture → 运行 → 取消 → 断言事件顺序"固化为脚本，避免回归依赖手工操作。
3. **主题令牌收敛**：剩余的 `var(--*)` 旧变量（themes.css）与 Mantine theme 并存是有意兼容层；后续页面改造时优先用 Mantine 变量，新颜色一律进 `mantine-theme.ts`。
4. **表单控件规范**：以本次修复为鉴，Mantine 控件迁移时旧 `<label>` 与控件 `label` 只能留一个（带 tooltip 的复杂标签留在旧结构时必须去掉控件 `label` prop）。
5. **serde tagged enum 检查**：事件枚举新增字段时记得 `rename_all_fields = "camelCase"`（或逐 variant 标注），否则前端字段会静默落空——建议在 review checklist 增加"事件 payload 字段大小写"检查项。
6. **CSS 死代码防复发**：季度性跑一次 `css-clean.mjs` 的 dry-run（当前版本直接改文件，建议加 `--dry-run` 参数）并在 PR 中附输出。
7. **文档同步**：下次改动模板目录时同步 UI_MIGRATION.md 中的 verified/draft 计数。

## 9. 回归记录（按 FUNCTION_BASELINE 模板）

```text
Mynx version: 2.3.9
Commit: 785cea1 (base) + working-tree fixes (18 files, +70/-1603, 未提交)
OS: Windows 10 19044 x64 (WebView2 157.0.4341.46)
Node/npm: Node v24.13.0
React: 18.2.0
Tauri: 2.11.5
R/Rscript: 4.6.0 (2026-04-24)
Rust: edition 2021 (serde 1.0.229)
Fixture SHA-256: 本地生成（red sample.png / green test.jpg / multi page.tif / qpcr-test-data.xlsx / tests/r/rnaseq-engine-test/gene.count_rep.csv）

npm run build: PASS
npm run lint: PASS (0 errors / 19 warnings = baseline)
npm test: PASS
npm run test:rust: PASS (9/9)
npm run test:r:engine: PASS (full + de-only)

qPCR numerical diff: Summary_All_Genes 数值为 2^-ΔCt，与手算一致（GAPDH Control_1 Average ≈ 0.5743）
RNA-seq output diff: 输出目录契约（DE/DEG/MA/PCA/QC/heatmap/plots/data/logs/prepared）完整，DE_summary 与 params.json 字段保持
Chart output diff: mynx-bar-basic-ggplot2.png + .png.json manifest，命名契约保持
Image output diff: 多页 TIFF 页码命名、subfolder 输出、源文件不覆盖保持；结果表体积经 serde 修复后正确
Theme/light-dark result: 浅/深/跟随系统切换即时生效，重启后保留（config.json theme=system）
zh/en result: 全部页面双语布局无溢出
Cancel result: UI 取消入口在位；进程树终止由 test:rust/test:r:engine 覆盖（UI 实测未执行）
Historical load result: RNA-seq 历史目录重载恢复结果画廊 ✓
```
