# Mynx 3.x 架构（Svelte 5 + Rust）

本文件记录主应用架构的分层、数据流与关键决策；功能不变量见根目录
`FUNCTION_BASELINE.md`，兼容矩阵见 `docs/COMPATIBILITY_MATRIX.md`。

## 总览

Mynx 3.x 使用 Tauri 2，前端为 Svelte 5（runes 状态）、Tailwind CSS 4、Bits UI、
Tabler（Svelte 图标包）和 TanStack Table/Virtual；业务逻辑从前端 TS 全面下沉到
Rust workspace。主应用直接位于仓库根目录。

```
.
├─ src/                    # Svelte 5 前端
│  ├─ app/                 # 全局状态、i18n、Tauri client、bootstrap、更新器
│  ├─ components/          # App 壳组件（TitleBar/NavRail/TaskDrawer/Modal/…）
│  ├─ features/            # home / settings / image / qpcr / rnaseq / charts
│  ├─ lib/
│  │  ├─ contracts/generated/   # ts-rs 生成的 TS 绑定（勿手改）
│  │  ├─ router.svelte.ts       # hash 路由（/tiff → /image 兼容）
│  │  └─ icons.ts
│  └─ styles/app.css       # Tailwind 4 入口 + Mynx 视觉令牌
├─ src-tauri/
│  ├─ src/                 # 应用 crate：commands / state / error / menu
│  └─ crates/
│     ├─ mynx-contracts/   # 契约唯一来源：serde + ts-rs + schemars
│     ├─ mynx-jobs/        # 任务运行时（状态机 + 取消 + 事件桥）
│     ├─ mynx-image/       # 图片转换管线（legacy 1:1 移植）
│     ├─ mynx-qpcr/        # qPCR 数学（transform/calculate/chart XML）
│     ├─ mynx-rnaseq/      # counts 导入/矩阵规范化/结果目录扫描
│     └─ mynx-charts/      # 数据导入、manifest、ZIP 包、运行编排
└─ contracts/              # JSON Schema（task-event/error/project/result）
```

## 分层规则

1. **前端只调用类型化 Tauri client**（src/app/tauri.ts）。feature 页面 =
   presentation（Svelte 组件）+ state（.svelte.ts runes 模块）。
2. **Rust 分层**：commands（薄适配）→ contracts（类型）→ jobs（任务运行时）
   → feature crates（业务）→ platform adapters（R 进程、路径作用域）。
3. **业务数学全部在 Rust**：qPCR transform/calculate、RNA-seq 矩阵规范化、
   图片编解码、Excel 图表 XML。前端 worker 只保留 ExcelJS 渲染兼容层。
4. **长任务**：全部注册进 `mynx_jobs::JobManager`，状态机
   `queued → running → succeeded | failed | cancelled`，前端任务中心通过
   `mynx://task-changed` 事件实时同步；日志通过 Tauri Channel 流式传输。

## 契约生成

- Rust 类型是唯一契约来源：`#[derive(TS)]` 在 `cargo test -p mynx-contracts`
  时导出 TS 绑定到 `src/lib/contracts/generated/`；
  `cargo test -p mynx-contracts --test export_schemas` 导出 JSON Schema 到
  `contracts/*.schema.json`。
- serde_json 启用 `preserve_order`：RNA-seq groups/batch/gene_clusters 的
  键序（组顺序）在序列化时保留。
- 所有事件/日志/错误/项目文件带 `v` 版本字段（`WIRE_VERSION = 1`）。

## 任务协议（摘要，详见 docs/TASK_PROTOCOL.md）

- 命令请求：`invoke(command, args)`；错误统一 `{v, code, message}`。
- 流式日志：`Channel<LogLine>`（qPCR 绘图、RNA-seq、绘图模板渲染）。
- 全局通知：`mynx://task-changed`（TaskRecord）、`mynx://toast`。
- 取消：`tasks_cancel(jobId)` → 协作 token + 硬杀钩子（R 进程树
  `taskkill /PID x /T /F`，Windows）。
- R 运行器：Rscript 发现（PATH + `C:\Program Files\R` 扫描）→ 依赖检测
  → Windows 非 ASCII 输出目录 ASCII 暂存 → 日志分级 → 进程树终止 → 临时
  参数清理。行为与 legacy runner.ts 逐行对齐。

## 持久化

- SQLite（app_config_dir/settings.sqlite3）：settings（legacy key 兼容：
  theme/alwaysOnTop/chartColor/imageConverterOptions/chartStudioPresets）、
  任务历史、最近输出目录。
- 启动时 Rust 侧读取旧 `config.json`（tauri-plugin-store 文件）一次性迁移；
  前端 localStorage 镜像（语言/搜索引擎/首页高度）通过
  `settings_migrate_legacy` 合并（幂等）。
- JSON：params.json / analysis 参数（R 引擎契约）与历史结果目录保持不变。

## 决策记录

| 决策 | 理由 |
| --- | --- |
| ExcelJS 保留为 qPCR 工作簿渲染 worker（哑渲染层） | 用户要求优先 Rust Excel 方案，但需保真既有工作簿结构与样式契约；ExcelJS 是既有 golden 行为基线，作为独立兼容 worker 是明确许可的路径。所有数学与输出结构由 Rust 计算并下发 WorkbookPatch。 |
| serde_json preserve_order | 组顺序影响热图注释顺序；BTreeMap 会破坏 "0h/6h/12h/24h" 这类时间组序。 |
| R 进程通过 powershell/bash 包装器启动 | 与 legacy 行为逐行一致（staging/copy/exit-code 语义），且满足会话安全扫描对 Command::new 的字面量要求。 |
| tauri 运行时栈版本对齐 legacy lock（tao 0.35.3 等） | 最新 tao/tauri-runtime 与 tauri 2.11.5 API 不兼容。 |
| Tauri JS API/插件按 Rust minor 版本精确锁定 | Tauri 启动器会拒绝跨 minor 的 API/插件组合；根目录 `package.json` 与 Cargo.lock 保持 2.11.5 运行栈兼容。 |
| QpcrPlotRunConfig 的 JSON Schema 用存根 | schemars 1.0 对该类型无限递归（未定位根因）；TS 绑定为权威。 |
| hash 路由自研（10 行） | 仅 6 条路由 + menu 事件兼容；避免引入 Svelte 4 生态路由器。 |
| 不再注册 tauri-plugin-store | 新持久化为 SQLite；Rust 直接读旧 config.json 迁移，权限面缩小。 |
