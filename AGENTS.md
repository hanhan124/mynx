# Mynx 开发约束（3.x — Tauri 2 + Svelte 5 + Rust）

## 设计权威

新应用位于 `mynx-next/`，架构权威是 `mynx-next/docs/ARCHITECTURE_NEXT.md`，
任务协议是 `mynx-next/docs/TASK_PROTOCOL.md`，兼容矩阵是
`mynx-next/docs/COMPATIBILITY_MATRIX.md`，UI 令牌是
`mynx-next/docs/UI_SPEC_NEXT.md`，功能保护范围以根目录 `FUNCTION_BASELINE.md`
为准，发布流程以 `mynx-next/docs/RELEASE_NEXT.md` 为准。

旧应用（仓库根目录 `src/` + `src-tauri/`）保留为 legacy reference；
旧 React/Mantine 规则整理在 `legacy-docs/`（DESIGN.md / UI_AUDIT.md /
UI_MIGRATION.md / MYNX_UI_SPEC.md），只对 legacy 树有效，不再约束新应用。

## 技术栈

- Tauri 2（=2.11.5，运行时栈版本与 legacy lock 对齐）；Rust workspace 位于
  `mynx-next/src-tauri`（contracts/jobs/core/image/qpcr/rnaseq/charts）
- 前端 Svelte 5（runes 状态）+ TypeScript + Vite 6 + Tailwind CSS 4
- 无头组件用 Bits UI；图标只用 `@tabler/icons-svelte`（深路径导入）；
  不引入 Lucide、Heroicons 或第二套图标系统
- 表格用 TanStack Table Svelte 适配器；大数据量用 TanStack Virtual
- 不使用 React、Mantine、React Router、Electron/Qt/Wails

## 分层规则

- 前端只调用 `src/app/tauri.ts` 的类型化 client；feature 页 = presentation
  （Svelte 组件）+ state（`.svelte.ts` runes 模块）
- Rust 分层：commands（薄适配）→ contracts → jobs → feature crates →
  platform adapters；契约类型定义在 `mynx-contracts`，TS 绑定由 ts-rs 生成
  到 `mynx-next/src/lib/contracts/generated/`（勿手改；用
  `TS_RS_EXPORT_DIR=…/mynx-next/src/lib/contracts/generated cargo test -p
  mynx-contracts --lib` 重新生成），JSON Schema 由 export_schemas 测试导出到
  `mynx-next/contracts/`
- 不在 Rust 与 TypeScript 中复制维护业务类型；前端 contract 类型一律 import
  生成文件
- 长任务全部注册 `JobManager`（idle/running/success/error/cancelled 状态机、
  协作取消 + 硬杀钩子）；日志走 Tauri Channel；全局通知走 `mynx://` 事件
- 业务数学（qPCR 计算、counts 规范化、Excel 图表 XML、图片编解码）只在
  Rust；qPCR ExcelJS worker 是哑渲染兼容层，禁止在 worker 里写业务规则
- serde_json 启用 preserve_order（组顺序敏感）；RnaSeqConfig/params.json
  的字段名与默认值是 R 引擎契约，不得改动

## 图标与交互

- 图标按钮必须有 `aria-label`，危险操作用语义色 + 确认
- 所有运行任务显示 idle、running、success、error、cancelled 状态
- 取消必须调用真实取消 API（tasks_cancel / 任务取消钩子），不能卸载组件模拟
- 长文本、路径、基因名允许省略、换行或复制（.mynx-truncate / CopyableText）
- 视觉风格遵循 UI_SPEC_NEXT：平面、1px 边框、无渐变/玻璃拟态/装饰阴影

## 核心功能边界

UI 改造不能改变以下内容（详细矩阵见 COMPATIBILITY_MATRIX.md）。

- qPCR 计算、工作表、输出列、填补色、Excel 原生图表 XML 和 R 绘图参数
- RNA-seq 输入格式、params.json 字段、R/Rust 调用、输出目录、历史结果和取消
- 科研绘图模板目录、manifest、字段映射、R 渲染、输出格式、预设和 ZIP 导出
- 图片转换格式、压缩策略、水印、输出位置、页码命名、事件顺序和取消
- Tauri capability、fs scope、shell allowlist、原生菜单、窗口行为和 updater
- legacy config key（theme/alwaysOnTop/chartColor/chartStudioPresets/
  imageConverterOptions）与用户文件兼容性

## 状态和数据

- 不在 Svelte 模板/render 中执行文件读写、R 进程或长时间计算
- 设置持久化走 SQLite（settings_load/settings_save）；核心业务不再用
  localStorage
- 新增文案同时写入 `src/app/i18n.svelte.ts` 中文与英文词典（测试锁定键
  奇偶一致）
- 用户输入的路径、样本名、基因名和组名原样传递，显示层只处理视觉省略
- 历史结果与旧配置读取保持向后兼容（prepared/params.json、config.json 迁移）

## 验证要求

提交前按改动范围执行（根级命令已指向 mynx-next）：

```text
npm run build
npm run typecheck   # svelte-check
npm run lint
npm test            # vitest
npm run test:rust   # cargo test --locked（mynx-next workspace）
npm run test:r:engine
```

涉及图表、资源或发布时补充 charts:check / charts:verify / resources:check /
check:release。页面改动至少检查浅色、深色、跟随系统、中文、英文、420px、
960px、1280px、1440px、键盘焦点和运行中状态。涉及文件、R、Rust 或 Tauri 的
改动必须执行 FUNCTION_BASELINE.md 对应回归路径。

## 代码风格

- Svelte 5 runes（$state/$derived/$effect）；不用 legacy store（writable）
- `onclick` 语法；`$props()`；保持严格类型与可读命名
- 复用已有服务与方法，不为一次性视觉包装引入多层抽象
- 避免把业务判断塞入通用 UI 组件
- 不为迁移改写算法、默认值、R 脚本或 Rust 处理流程
- 不提交未使用依赖、图标、CSS 变量或组件
- 不通过增加阴影、渐变和卡片数量解决层级问题

## 审查清单

- 是否只用 Svelte 5 + Mantine-free API（Mantine 禁止出现在 mynx-next）
- 是否保留 Tabler Icons（Svelte 版深路径导入）
- 是否保留路由、配置 key、数据格式和用户文件兼容
- 是否保留 R/Rust 调用、日志、取消和历史加载
- 是否新增了中英文文案
- 是否提供焦点、禁用、错误、运行和取消状态
- 是否通过相关自动检查和手工回归
- 是否更新了对应设计或基线文档
