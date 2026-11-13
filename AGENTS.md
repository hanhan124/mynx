# Mynx 开发约束

## 设计权威

Mynx 的统一 UI 规范以 `DESIGN.md` 为准，当前问题以 `UI_AUDIT.md` 为准，迁移顺序以 `UI_MIGRATION.md` 为准，功能保护范围以 `FUNCTION_BASELINE.md` 为准。任何前端改动都要先确认对应页面、状态和文件契约。

## Mantine 版本

- 只使用 Mantine 8 API，所有 `@mantine/*` 包保持同一 8.x 小版本
- 不能混入 Mantine 9 API、示例或依赖
- React 18.2.0、Vite、Tauri、R 和 Rust 版本保持当前版本，除非用户明确要求升级
- 根级使用 `MantineProvider` 和集中式 `createTheme`
- 主题状态必须通过 `src/lib/theme-context.tsx` 的 `ThemeProvider` 提供，页面不能各自调用 `loadConfig()` 创建主题状态
- `src/lib/mantine-theme.ts` 是颜色、字体、间距、圆角、阴影、断点和组件默认值的唯一入口
- 全局样式从 Mantine theme 读取颜色、字号、间距、圆角、阴影和控件默认值
- 页面局部布局使用 CSS Modules、Mantine `styles` 或 `classNames`
- 旧 CSS 只有在对应页面完成回归后才能删除
- `src/pages/UiShowcasePage.tsx` 是基础组件回归入口，新增基础控件规则后同步更新 Showcase

## 图标与交互

- 继续使用 `@tabler/icons-react`
- 不引入 Lucide、Heroicons 或另一套图标系统
- 图标按钮必须有 `aria-label`，危险操作必须有清晰的语义色和提示
- 复杂表单使用 Mantine 原生组件和共享 `FieldGroup`
- 所有运行任务都显示 idle、running、success、error、cancelled 状态
- 取消按钮必须调用原有取消 API，不能通过卸载组件模拟取消
- 长文本、中文、英文、路径和基因名要允许省略、换行或复制

## 核心功能边界

UI 改造不能改变以下内容。

- qPCR 计算、工作表、输出列、填补色、Excel 图表和 R 绘图参数
- RNA-seq 输入格式、配置字段、R/Rust 调用、输出目录、历史结果和取消
- 科研绘图模板目录、manifest、字段映射、R 渲染、输出格式、预设和 ZIP 导出
- 图片转换格式、压缩策略、水印、输出位置、页码命名、事件顺序和取消
- Tauri capability、fs scope、shell allowlist、原生菜单、窗口行为和 updater
- `src/lib/config.ts` 中现有配置 key 和用户文件兼容性

ExcelJS、JSZip、R runner、Rust service、Tauri command、路径作用域和结果解析属于服务层。组件迁移只能调用这些服务层 API。

## 状态和数据

- 不在 render 中执行文件读写、R 进程、Rust command 或长时间计算
- 不复制 `RnaSeqConfig`、`ChartConfig`、`QpcrPlotRunConfig` 或图片转换 event 类型
- 新增文案同时写入 `src/lib/i18n.tsx` 的中文和英文词典
- 主题状态在根级初始化，设置页不能创建独立主题状态
- 用户输入的路径、样本名、基因名和组名原样传递，显示层只处理视觉省略
- 历史结果和旧配置读取必须保持向后兼容

## 页面迁移顺序

按 `UI_MIGRATION.md` 执行。先完成基线、Provider、应用壳和共享控件，再依次迁移首页与设置、图片转换、qPCR、RNA-seq、科研绘图，最后清理旧 CSS。复杂页面拆分时先移动展示组件，保持服务函数和状态 hook 的调用签名。

## 验证要求

提交前按改动范围执行以下检查。

```text
npm run build
npm run lint
npm test
npm run test:rust
npm run test:r:engine
```

涉及图表、资源或发布时补充以下检查。

```text
npm run charts:check
npm run charts:verify
npm run resources:check
npm run check:release
```

页面改动至少检查浅色、深色、中文、英文、420px、960px、键盘焦点和运行中状态。涉及文件、R、Rust 或 Tauri 的改动必须执行 `FUNCTION_BASELINE.md` 对应回归路径。

## 代码风格

- 保持现有 TypeScript 严格类型和可读命名
- 复用已有方法、类型和服务，不为一次性视觉包装引入多层抽象
- 避免把业务判断塞入通用 UI 组件
- 不为 UI 迁移改写算法、默认值、R 脚本或 Rust 处理流程
- 不提交未使用的 Mantine 依赖、图标、CSS 变量或组件
- 不通过增加阴影、渐变和卡片数量来解决层级问题

## 审查清单

- 是否只使用 Mantine 8 API
- 是否保留 Tabler Icons
- 是否保留现有路由、配置 key、数据格式和用户文件
- 是否保留 R/Rust 调用、日志、取消和历史加载
- 是否新增了中英文文案
- 是否提供焦点、禁用、错误、运行和取消状态
- 是否通过相关自动检查和手工回归
- 是否更新了对应设计或基线文档
