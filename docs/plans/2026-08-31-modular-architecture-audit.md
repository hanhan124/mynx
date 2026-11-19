# Mynx 工程化与模块化改造 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> 上行为计划模板约定；当前环境没有该名称的技能。执行时使用实际可用的 executing-plans 技能，不假设不存在的工具。本轮仅审查和编写计划，未执行改造。

**Goal:** 保持现有计算语义、数据格式、界面功能和安装升级兼容性，通过渐进改造降低耦合、修复可靠性缺口，并建立可执行回归与性能基线。

**Architecture:** 保留 React + Tauri + 外部 R 的模块化单体。前端按功能组织，纯计算与平台操作隔离；Rust 逐步统一任务生命周期、受控文件访问和窗口服务；R 保留独立进程与现有输入输出契约，逐步提取显式依赖的分析模块。

**Tech Stack:** React 18、TypeScript strict、Vite 5、Tauri 2、Rust、R、ExcelJS、现有 Node/R 检查脚本。首阶段不升级主框架、不引入数据库、微服务、常驻 R 服务或大型状态框架。

---

## 1. 审查范围与结论

日期：2026-08-31。对象：`D:/vibe_coding/mynx` 当前工作区，包括大量未提交的新增绘图、搜索和界面改动；不是仅针对 HEAD 或已发布版本。

覆盖项目目录、主应用与安装器配置、路由与工具注册、qPCR 导入/转换/计算/导出链、TIFF 平台脚本、RNA-seq 导入/状态/运行/结果复用、科研绘图配置/模板/运行、搜索 WebView、设置/更新/拖放、R 主入口和部分模板、打包与发布检查。大型界面、模板集合主要按职责与调用链审查，未逐行审定全部模板的统计方法；未对所有真实用户数据做结果验算。

结论：**已有工程化基础，但尚未形成可靠的模块边界和回归闭环；适合渐进治理，不适合推倒重写。**

| 维度 | 当前判断 | 依据 |
|---|---|---|
| 技术栈与总体形态 | 合理，保留 | 本地科研工具无需服务化；R 外部进程将重计算与界面隔离 |
| 工程化 | 部分完成 | strict、锁文件、lint、发布流水线已有；PR 质量门禁和全功能回归不足 |
| 模块化 | 外层清晰、内部集中 | 工具注册、页面懒加载、qPCR lib 已有；绘图大页面、RNA-seq 大 Context、Rust 单文件仍集中 |
| 解耦 | 尚不充分 | 绘图直接依赖 RNA-seq 的 R 定位和文件工具；UI 直接拼 Shell、直接操作文件 |
| 可靠性 | 优先补齐 | 安装资源遗漏、异步失败收口、目录旧状态、权限与调用不一致、参数传输遗漏 |
| 轻量化 | 有基础，无运行时实测结论 | 路由分包有效；全量矩阵重复解析、宽 Context 更新值得优化；未测 RSS/冷启动 |

应保留的资产：`src/lib/tools.tsx` 注册表、已有懒加载、qPCR 业务分离、RNA-seq RDS 缓存与按步骤加载依赖、独立绘图模板结构、更新签名配置、主窗口与远程搜索内容 WebView 的权限隔离意图。

## 2. 验证记录

以下“通过”仅代表对应检查，不等于全功能正常。

| 检查 | 结果 |
|---|---|
| 主应用 `npx --no-install tsc --noEmit` | 通过 |
| 主应用 `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` | 通过 |
| 安装器 `tsc --noEmit -p installer/tsconfig.json` 与 `cargo check --locked --offline --manifest-path installer/src-tauri/Cargo.toml` | 通过；这不包含资源同步/安装实测，不推翻资源清单遗漏结论 |
| Vite 生产构建（独立临时输出目录，未运行改写版本的 prebuild） | 通过；存在大分块和混合静态/动态导入警告 |
| `npm run lint` | 失败：1 error、31 warnings；错误位于 SearchWindow effect 同步设置状态 |
| `npm run charts:check` | 通过，但仅验证当前本地清单、文件和已有报告；不是重新视觉验收 |
| `Rscript scripts/chart-runtime-smoke.R` | 通过；存在 locale 与 aes_string 弃用警告 |
| 原说明 `node --experimental-strip-types scripts/rnaseq-matrix-smoke.ts` | 失败：matrix.ts 的无扩展名 `./io` 无法由 Node 直接解析 |
| 同一 RNA-seq 脚本经已有 esbuild 内存打包后执行 | 19 项断言通过；未改源文件。这说明测试入口有问题，不代表算法测试失败 |
| 4 个模板 × 5 格式抽样生成 | bar、heatmap、volcano、km-survival，PNG/SVG/PDF/TIFF/EPS，20 次通过；仅检查进程成功、产物存在与最小大小 |
| Windows 安装器资源清单只读对照 | R 资源目录 347 个文件；硬编码嵌入清单 3 个，缺少 344 个 |

未完成：主应用真实 WebView 端到端、真实 R 差异分析结果验算、全 57 个独立模板重新生成并人工审图、TIFF 跨平台/多帧验收、Windows 安装升级卸载实测、macOS 真机验证、冷启动/内存/交互延迟基准。

构建分块（压缩后文件大小，不是进程内存）：入口约 253.17 kB，RNA-seq 168.62 kB，ChartStudio 87.61 kB，ExcelJS 938.41 kB；全局 CSS 114.99 kB。ExcelJS 已独立分块，不应将 938 kB 全算作首页负担，也不能仅凭分块警告断言界面卡顿。

### 对日志判断的复核

审查中曾假设 Shell 默认事件不带换行，但追到当前锁定的 `tauri-plugin-shell 2.3.5` 与 `tauri-utils 2.9.3` 源码后，确认底层保留换行。**撤回“默认日志全部无法处理”的判断。** 无换行事件模拟只证明无换行尾行的边界风险。正常带换行日志不据此判为故障。

## 3. 需要先处理的具体问题

### P1-01 安装资源清单与新增绘图功能脱节

证据：[安装器资源清单](D:/vibe_coding/mynx/installer/src-tauri/src/install.rs:20)、[同步检查](D:/vibe_coding/mynx/scripts/sync-installer-payload.cjs:61)。

清单只嵌入 runner.R、enrich.R、gsea.R；新增 chart_runner.R、chart_runtime.R 和模板资源未登记。按现有同步脚本逻辑，完整安装构建会在清单对照时报错；绕过它编译的安装器又不会释放缺失资源。不能以主应用 cargo check 通过代替可交付验收。

### P1-02 子进程启动、结束和取消不是统一的可靠状态机

证据：[RNA-seq runner](D:/vibe_coding/mynx/src/lib/rnaseq/runner.ts:270)、[TIFF runner](D:/vibe_coding/mynx/src/lib/tiff-convert.ts:360)、[图表 runner](D:/vibe_coding/mynx/src/lib/charts/runner.ts:185)。

- RNA-seq 与 TIFF 对 `spawn()` 的 Promise rejection 没有完整 catch；外围同步 try/catch 捕获不到异步拒绝，任务 promise 可能一直未完成。
- 图表/R 安装先 await spawn，再订阅 close/error，存在极快退出的时序窗口。
- 取消在 PID/Child 尚未取得时存在竞态；图表使用模块全局 Child 与取消标志，重入/跨页面生命周期缺少明确约束。
- 图表页面 generate 没有覆盖整条操作链的 try/finally；准备阶段写临时文件等异常可能令 running 不复位。
- RNA-seq stdout/stderr 共用行缓冲，无换行尾行没有 flush；应作为边界测试处理，不夸大为正常日志流故障。

### P1-03 调用能力与 Tauri 配置不一致

证据：[capabilities](D:/vibe_coding/mynx/src-tauri/capabilities/default.json)、[安装 R 与取消](D:/vibe_coding/mynx/src/lib/charts/runner.ts:57)、[图表预览](D:/vibe_coding/mynx/src/pages/charts/ChartStudioPage.tsx:604)、[配置](D:/vibe_coding/mynx/src-tauri/tauri.conf.json)。

- `installR()` 使用 `winget`，但执行范围只登记 powershell/bash。
- `Child.kill()` 调用存在，但主窗口未授权 `shell:allow-kill`；这影响图表取消及 Unix RNA-seq 取消。
- 预览使用 convertFileSrc，配置仅在 CSP 放行 asset，没有启用 assetProtocol 和定义读取 scope；这是打包环境预览风险。
- 当前 Shell 任意参数、HOME 递归文件访问以及文件访问失败后回退 Shell 的方式，意味着能力边界并非注释所说的最小集。后续应以受控原生服务承接，不能简单扩大所有权限。

Tauri 官方说明：[Shell 权限](https://v2.tauri.app/zh-cn/plugin/shell/)、[convertFileSrc 要求](https://v2.tauri.app/reference/javascript/api/namespacecore/)、[资源协议作用域](https://v2.tauri.app/security/asset-protocol/)。结论同时与当前本地配置、依赖实现交叉核对。

### P1-04 历史结果目录校验读取旧状态

证据：[store.tsx](D:/vibe_coding/mynx/src/pages/rnaseq/store.tsx:483)。

`browseAnalysisDir` / `loadFromPath` 先 setAnalysisDir，再调用当前闭包的 validateDir；后者读取本轮旧 analysisDir。首次加载可能验证空路径，随后切换可能验证上一次路径。useAutoDetect 同样先更新状态再调用依赖旧状态的 checkResult。改为显式参数传递，不能用延时掩盖。

### P1-05 热图参数在 UI → runner 契约中丢失

证据：[页面配置与发送](D:/vibe_coding/mynx/src/pages/charts/ChartStudioPage.tsx:1172)、[ChartRunConfig](D:/vibe_coding/mynx/src/lib/charts/runner.ts:8)、[热图渲染器](D:/vibe_coding/mynx/src-tauri/r/chart-templates/heatmap-basic-ggplot2/render.R:5)。

页面定义和展示 heatmapScale、heatmapClusterRows、heatmapClusterCols，R 也读取它们，但 ChartRunConfig 与 generate 的参数构造未传递这些字段。操作界面不等于参数生效，需要端到端参数契约测试。

### P1-06 qPCR 保存失败仍可能进入后续图表流程

证据：[QpcrPage](D:/vibe_coding/mynx/src/pages/qPCR/QpcrPage.tsx:46)。silentSave 返回 boolean，但计算完成链忽略结果继续按磁盘文件生成图表；存在基于旧文件继续运行的风险。当前保存直接写回所选文件，后续要明确原文件保护、备份和失败恢复策略，不在架构重构中擅自改变科学计算规则。

### P2-01 多份模板事实源和“通过”的含义不统一

catalog.ts、各 manifest、docs inventory、页面字段映射、R smoke 的模板列表分别维护。当前 inventory 报 50 个 verified，而模板目录/报告报 57 个，仍然整体检查通过。`check-chart-visual-report` 只核对报告中的存在标记，没有当前源码/示例指纹、像素阈值或人工批准结果；不能宣称视觉等价已通过。

更重要的是 `.gitignore` 忽略整个 docs，`git ls-files docs` 为空，而检查脚本依赖其中 JSON。新克隆环境不能依靠本机这些文件复现检查。

### P2-02 分层与性能热点

- ChartStudioPage 集中配置、翻译、文件画像、预设、执行、导出、预览和界面。
- RNA-seq Provider 集中导入、运行、日志、每秒计时、配置和结果源；同一 Context 消费者会随 value 更新而更新。影响程度需 profiler 量化。
- 图表 runner 依赖 RNA-seq runner/io，公共基础设施被某个功能拥有，未来容易反向依赖。
- `importPage` 每次分页、搜索都全量读取和解析 CSV；异步读文件不代表解析不阻塞界面。
- Rust lib.rs 混合窗口/标签状态、内嵌 JS、天气、错误、更新兼容、启动注册。
- R runner.R 的近两千行使用大量顶层配置/运行对象；仅拆 source 文件仍可能保留隐式全局耦合。
- 搜索为每个标签创建 WebView，切换只 hide；没有标签资源预算/回收策略，需多标签内存基准。
- useDropZone 异步订阅完成前若组件卸载，cleanup 无法处理晚到 unlisten；应纳入生命周期测试。

### P2-03 平台与发布行为需要单独验收

TIFF Windows 脚本未见多帧遍历，与 README 的多页支持声明存在差距；Unix 水印路径没有等价使用全部透明度/背景参数，水印失败后的结果统计也需核对。安装器在 async 命令中执行同步复制/等待，对目标目录资源先删后写且缺少完整事务回滚。上述不建议与大范围目录迁移混在一次提交。

## 4. 目标边界与设计决策（均为 Proposed）

```text
React app 壳层：路由、主题、语言、全局错误边界
  ├─ features/qpcr       UI → application → 纯计算/工作簿适配
  ├─ features/rnaseq     UI → application → 矩阵与结果领域逻辑
  ├─ features/charts     UI → application → 模板契约与配置
  ├─ features/tiff       UI → application → 转换请求
  └─ features/search    UI → typed IPC
             ↓ 仅通过公开接口
shared/platform：files / process / settings / preview / events
             ↓
Rust：commands（薄入口） → services（tasks/files/search/weather）
             ↓
Rscript / TIFF 平台适配器 / 用户选择的文件 / 系统 WebView
```

1. **ADR-001：保留模块化单体。** 不拆微服务、不新增数据库；降低部署负担。代价是仍需明确内部依赖规则，不能靠目录名保证边界。
2. **ADR-002：任务逐步归 Rust 管理。** 先修复 TS runner 行为并建立适配接口，再迁移原生任务服务。好处是跨路由生命周期、取消与文件授权更一致；代价是新增 IPC/事件契约和两平台进程树实现。第一轮不迁移科研算法。
3. **ADR-003：模板 manifest 为唯一事实源。** 前端 catalog、检查清单和打包清单从它生成或派生，专用复杂参数仍保留专用组件。代价是需要生成器一致性检查；不要建万能表单引擎。
4. **ADR-004：先基线后优化。** 大数据解析优先 Worker/缓存，R 保持按需进程；是否增加其他运行时只由测量决定。代价是 Worker 数据传递和缓存失效需要显式设计。

## 5. 分阶段实施任务

所有路径以 `D:/vibe_coding/mynx` 为根。下列新文件是建议目标，不是已存在文件。每个任务按“加回归 → 确认暴露问题 → 最小实现 → 完整回归 → 独立提交”执行；不要为测试框架不可执行的状态强行声称 RED/GREEN。

### 阶段 A：可回归、可交付的基线（约 2–3 人日）

#### Task 1：建立测试入口与可复现输入

Files：修改 [package.json](D:/vibe_coding/mynx/package.json)、[eslint.config.js](D:/vibe_coding/mynx/eslint.config.js)、[.gitignore](D:/vibe_coding/mynx/.gitignore)；新增 `D:/vibe_coding/mynx/vitest.config.ts`、`D:/vibe_coding/mynx/tests/fixtures/`、`D:/vibe_coding/mynx/.github/workflows/ci.yml`。

1. 将现有 19 项矩阵断言和 3 项 schema 断言接入统一 `npm test`，测试直接导入真实业务实现。
2. 明确受版本管理的清单位置；推荐 `src-tauri/r/chart-templates` 保存源契约，报告作为 CI 产物；不直接取消对所有私人 docs 的忽略。
3. 给 qPCR 准备可手算的最小工作簿样例，固定当前转换、缺失标记、内参、相对对照、择优重复和异常值规则。
4. CI 在 PR 上执行 `npm ci`、`npm run lint`、`npm test -- --run`、`npm run build`、`cargo check --locked --manifest-path src-tauri/Cargo.toml`；Windows 加安装器检查，R 环境加冒烟。
5. 先修复 lint error，再按真实含义处理警告；不批量禁用 Hooks 规则。

验收：全新克隆无需本机 docs 即可运行检查；用故意错误验证门禁确实失败。

#### Task 2：冻结功能与性能验收矩阵

Files：新增 `D:/vibe_coding/mynx/tests/acceptance/functional-matrix.md`、`D:/vibe_coding/mynx/tests/benchmarks/README.md`。

1. 为四项科研工具、搜索、主题/语言、拖放、更新、安装/卸载列出正常/失败/取消/切页用例。
2. 记录样本哈希、应用版本、R/package 版本；科研结果比较字段和值，不比较含时间戳的 xlsx 整体二进制。
3. 记录冷启动、空闲 RSS、首个工具进入时间、5万行矩阵导入/翻页、日志密集场景、10个搜索标签的内存及关闭回收。
4. 暂定回归门槛：同环境冷启动/RSS 不比基线增加超过 10%；已缓存矩阵翻页 p95 目标 100ms 以内。此为拟定目标，须根据基线确认，不是当前达成值。

### 阶段 B：修复功能可靠性缺口（约 3–5 人日）

#### Task 3：修复安装器资源完整性

Files：修改 [sync-installer-payload.cjs](D:/vibe_coding/mynx/scripts/sync-installer-payload.cjs)、[installer build.rs](D:/vibe_coding/mynx/installer/src-tauri/build.rs)、[install.rs](D:/vibe_coding/mynx/installer/src-tauri/src/install.rs)；新增 `D:/vibe_coding/mynx/scripts/check-installer-resources.mjs`。

1. 先写纯只读清单检查，当前应报告新增资源缺失。
2. 从唯一资源清单生成 Rust 嵌入列表到 OUT_DIR，或生成版本化资源归档；保留安装目标相对路径。
3. 对比源文件、嵌入清单、安装释放结果的路径集合和哈希，不只比较字符串存在。
4. 使用 `npm run installer:build` 验证交付链；只在隔离测试目录/虚拟机安装，验证科研绘图入口可访问全部资源。

验收：增加或删除一个模板不再手改 Rust 数百项清单；缺资源会在构建前失败。

#### Task 4：修复任务状态和权限契约

Files：修改三个现有 runner 与 [default.json](D:/vibe_coding/mynx/src-tauri/capabilities/default.json)、[tauri.conf.json](D:/vibe_coding/mynx/src-tauri/tauri.conf.json)；新增 `D:/vibe_coding/mynx/src/shared/platform/process.ts` 与对应测试。

1. Mock 同步/异步 spawn 失败、spawn 前取消、极快退出、非零退出、无换行尾行、并发请求；验证每个任务只完成一次。
2. 先注册所有事件再启动；显式 await/catch spawn；所有完成路径进入统一 settle/finally，临时文件清理不遮蔽原错误。
3. stdout/stderr 分别缓冲并 flush；保留实际依赖的换行行为兼容，不依据错误假设删除正常处理逻辑。
4. 仅授权必需 kill 和固定 winget 命令参数；安装 R 仍需要用户确认。为预览定义最小 asset scope 或统一采用受控文件读取路径。
5. 生成图表准备阶段异常也复位 running；sidecar 保存失败显示“部分成功”，不可静默后提示全部保存。
6. Windows 与 macOS 真机验证取消后进程/子进程和临时资源回收；未启动成功不能保持运行中。

验收：`npm test -- --run` 的进程矩阵通过，真实 Tauri 中取消/失败/预览可用；远程内容 WebView 不获得本地文件/进程能力。

#### Task 5：修复目录状态、热图参数与保存链

Files：修改 [RNA store](D:/vibe_coding/mynx/src/pages/rnaseq/store.tsx)、[ChartStudioPage](D:/vibe_coding/mynx/src/pages/charts/ChartStudioPage.tsx)、[ChartRunConfig](D:/vibe_coding/mynx/src/lib/charts/runner.ts)、[QpcrPage](D:/vibe_coding/mynx/src/pages/qPCR/QpcrPage.tsx)；新增对应 `*.test.ts` / `*.test.tsx`。

1. 回归用例：首次载入目录 A、紧接目录 B、手动转自动、加载配置并恢复历史结果；断言校验收到的是本次路径。
2. 将校验改为显式 `validateDir(path, options)`；所有影响查询的配置作为参数传递，不等待 setState 生效。
3. 为热图生成请求添加三字段，测试 UI 配置 → 参数 JSON → R 消费的完整映射；行/列聚类开关和 scale 使用能产生差异的样本。
4. 保存失败立即停止依赖磁盘新结果的后续步骤，错误提示不与成功提示共存；固定既有工作表/结果语义。

验收：上述回归先失败后通过，qPCR 基准数值与正常保存行为不变。

### 阶段 C：明确模块边界（约 4–6 人日）

#### Task 6：公共平台层不再归某个业务功能所有

Files：新增 `D:/vibe_coding/mynx/src/shared/platform/files.ts`、`r-runtime.ts`、`settings.ts`、`errors.ts`；迁移 [rnaseq/io.ts](D:/vibe_coding/mynx/src/lib/rnaseq/io.ts) 与 R 定位功能，调整各调用者。

1. 写路径、编码、中文/空格/引号、跨磁盘、拒绝权限、缺文件的适配层测试。
2. 公共平台层只提供文件/R 环境等能力，不依赖 pages 或具体科研业务；保留旧导出转发以小步迁移。
3. 增加依赖限制：features 不跨功能引用内部实现；UI 不直接拼接 Shell；shared 不导入 features。
4. Windows 文件权限失败不得无区别吞掉并执行 Shell，区分拒绝权限、路径不存在、解析失败。

验收：charts 不再依赖 rnaseq 内部 runner/io；无行为变化，旧调用者逐个迁移。

#### Task 7：拆分科研绘图页面和 RNA-seq 状态

Files：新增 `D:/vibe_coding/mynx/src/features/charts/{components,model,application}/`、`D:/vibe_coding/mynx/src/features/rnaseq/{model,application}/`；修改现有页面与 store。

1. 先提取配置类型、默认值、运行请求构造器和预设迁移，再提取模板浏览、数据导入、参数、运行反馈、预览与导出组件。
2. RNA-seq 拆为配置、导入、任务进度、结果源四个订阅域；业务规则成为纯函数，通知/对话框留在 UI/application。
3. 每秒计时与日志仅更新对应视图；日志限量并按短时间窗批量刷新。
4. 对新旧界面做截图/交互比对；保存并加载旧配置；拖放订阅晚到时也应释放。
5. 不为缩短行数创建大量只转发 props 的文件；边界按职责和独立测试价值决定。

验收：代表性日志压力下参数区没有无关频繁渲染；原有各控件行为和配置兼容。

#### Task 8：Rust 薄命令入口与跨路由任务服务

Files：修改 [lib.rs](D:/vibe_coding/mynx/src-tauri/src/lib.rs)；新增 `D:/vibe_coding/mynx/src-tauri/src/{commands,services,tasks}/`、`error.rs`、`search/content.js`。

1. 先纯机械提取 search/weather/update_compat/error，lib.rs 仅注册插件、状态和命令；内嵌 JS 用 include_str 保留行为。
2. 定义 typed taskId、状态枚举、进度事件与错误码；Rust 执行器用固定可执行文件和参数数组，不接受任意 Shell 字符串。
3. 任务注册表记录进程、所属功能、输出目录和最后状态；取消幂等；明确启动超时与正常长计算的区别。
4. 页面切换可以继续任务并重新订阅，窗口退出提供明确处理策略；不可仅把 Child 放到另一个全局变量。
5. 逐一迁移 charts、RNA-seq、TIFF，保留适配接口直到回归通过；不同时修改 R 算法。

验收：`cargo test --manifest-path src-tauri/Cargo.toml`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets` 与两平台生命周期验收通过；记录新权限面。

### 阶段 D：R 契约与模板单一来源（约 3–5 人日）

#### Task 9：统一模板定义、生成清单和验证语义

Files：修改 [catalog.ts](D:/vibe_coding/mynx/src/lib/charts/catalog.ts)、[schema.ts](D:/vibe_coding/mynx/src/lib/charts/schema.ts)、模板 manifest、检查脚本；新增 `D:/vibe_coding/mynx/scripts/generate-chart-catalog.mjs`。

1. 把资源目录 manifest 设为事实源，生成前端 catalog/字段角色清单；翻译和迁移规则可独立但必须验证引用。
2. 校验各集合双向相等、状态/输出格式/默认值一致，禁止 50/57 不一致仍通过。
3. 对每个可见设置测试请求字段覆盖；schema 对错误类型返回 validation error，而非内部 TypeError。
4. 区分“可运行”“输出格式正确”“视觉人工批准”；报告加入源/示例/依赖指纹，过期报告不能当本次验证。
5. `npm run charts:check` 不依赖私有 docs；R smoke 从 manifest 枚举，不再手写模板数组。

验收：一个新模板只需一个定义入口；字段遗漏、资源遗漏、过期报告均可被检测。

#### Task 10：R runner 按职责提取，保留数值语义

Files：修改 [runner.R](D:/vibe_coding/mynx/src-tauri/r/runner.R)；新增 `D:/vibe_coding/mynx/src-tauri/r/modules/{config,io,deg,plots,cache}.R` 与 `D:/vibe_coding/mynx/tests/r/` 基准。

1. 先冻结输入参数、输出表名、列名、基因排序、阈值和随机种子；记录 R 与包版本。
2. 先提纯函数，再拆配置、DEG、绘图、缓存；函数显式接收 cfg/data/result，不用 source 顺序或全局赋值传依赖。
3. 加 params schemaVersion 与旧版本迁移；缓存键至少考虑数据身份、分组/比较、引擎、核心分析参数与相关版本。
4. 固定小数据分别比对 DESeq2/edgeR/单重复分支；浮点允许范围需按算法确认，不能随意设大阈值。
5. 图像验证基于固定数据/设备/字体，避免把官方不同示例的像素距离当科学正确性判断。

验收：结构改变前后科研数值与导出契约一致；失败时保留已完成产物并输出可定位诊断。

### 阶段 E：轻量化与交付闭环（约 3–5 人日）

#### Task 11：按基准优化矩阵、Excel 和搜索资源

Files：修改 [matrix.ts](D:/vibe_coding/mynx/src/lib/rnaseq/matrix.ts)、[excel-io.ts](D:/vibe_coding/mynx/src/lib/excel-io.ts)、搜索服务和 feature 样式；新增 `D:/vibe_coding/mynx/src/features/rnaseq/workers/matrix.worker.ts`。

1. Worker 做纯解析/归一化；文件访问保持平台层，传 transferable 数据避免大字符串反复复制。
2. 以路径/修改时间/大小及必要指纹识别缓存，一次解析后分页/搜索；加入内存上限和失效规则。
3. 量化后再迁移 Excel 大操作；保留 ExcelJS，不因文件大就换不兼容库。
4. 搜索多标签测试后制定上限/可选回收策略，不能无提示销毁含用户输入的页面；关闭标签清理缩放状态。
5. 页面 CSS 随功能加载；保持主题变量共享。主 Rust release 优化参数做体积/启动 A/B 比较后再决定。

验收：同数据、同机器对比基线；首屏不提前加载 R/Excel 重任务；无新内存泄漏。

#### Task 12：安装升级、平台一致性与最终回归

Files：修改 installer 安装服务、[TIFF converter](D:/vibe_coding/mynx/src/lib/tiff-convert.ts)、[release.yml](D:/vibe_coding/mynx/.github/workflows/release.yml)、[README](D:/vibe_coding/mynx/README.md)。

1. 安装同步阻塞工作移到 blocking 执行域；在隔离测试根验证 staging → 校验 → 替换/回滚，错误不吞掉。
2. TIFF 建立单页/多页、Unicode 路径、损坏输入、水印失败、透明度/质量参数回归；先确定多页输出命名契约再实现补齐。
3. 卸载按应用拥有的文件清单清理，拒绝危险目录；测试不触碰用户真实数据或系统安装。
4. Windows/macOS 完整功能矩阵、安装升级、配置兼容、失败恢复全部签收后才发布。
5. 文档准确标注实验功能与平台限制；更新签名保持有效，不在重构中改动密钥策略。

验收：不是“能打包”，而是安装后所有资源可用、旧数据可读、错误可恢复、卸载不伤用户文件。

## 6. 工期、顺序与回滚

各阶段合计 **15–24 人日**，另预留跨平台联调与修复缓冲 3–5 人日，总计粗估 **18–29 人日**。按一名熟悉项目的工程师、有两平台测试环境估算；不含新的科研算法、完整统计学认证和环境采购。阶段 A/B 约 5–8 人日，优先解决能否稳定验证和交付；其余可以迭代分批完成。

依赖顺序：Task 1/2 → Task 3/4/5 → Task 6/7/8 → Task 9/10 → Task 11/12。部分准备可以交错，但不得在基线未建立前大规模移动代码。

- 每一任务独立审查/提交；目录迁移、逻辑修复、算法调整分开。
- 不重置或覆盖现有未提交工作；开始执行前由用户确认当前改动的保存方式，再确定工作分支/工作树基点。
- 接口迁移保留短期旧导出适配；保持 route、配置键、历史输出目录和表名兼容。
- 回归失败仅撤销该任务自己的提交；禁止全仓 reset 清掉用户变更。
- UI 或文件格式有意变化需单独确认，不能借“解耦”改变功能。

## 7. 本轮交付边界

本轮没有修复或重构业务代码，也没有安装 R 包、运行安装/卸载或触发发布。仅完成代码审查、编译/检查、有限样例验证并新增此计划。Code 技能用于验证边界；architecture-designer 用于模块边界与 Proposed ADR；writing-plans 用于按文件、测试和验收拆分任务。由于本轮只是审查，未创建工作树或启动实现会话。

构建检查产物保留在 `D:/vibe_coding/mynx/.audit-dist-20260831`（清理请求被工具策略阻止，未删除）；R 样例输出位于系统临时目录。本计划位于当前被 Git 忽略的 docs 下，是本地交付文档，不会自动随提交分发。
