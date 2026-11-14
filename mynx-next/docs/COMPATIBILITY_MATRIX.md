# COMPATIBILITY_MATRIX — Mynx 3.x 兼容性

> 旧应用（React/Mantine，仓库根目录 src/ + src-tauri/）保留为 legacy reference。
> 本矩阵记录新应用对既有行为、文件与用户数据的兼容策略。

## 配置与持久化

| Legacy | New | 状态 |
| --- | --- | --- |
| config.json store key `theme`（system/graphite/pearl；dark/light 归一化） | SQLite settings.theme（同枚举；normalize 逻辑一致） | 兼容（Rust 启动迁移 config.json） |
| `alwaysOnTop` | SQLite settings.alwaysOnTop | 兼容 |
| `chartColor`（#RRGGBB[AA]，非法回退 #3C9FDF） | SQLite settings.chartColor（同一校验） | 兼容 |
| `chartStudioPresets`（JSON 数组） | SQLite settings.chartStudioPresets | 兼容 |
| `imageConverterOptions`（JSON blob） | SQLite settings.imageConverterOptions | 兼容 |
| localStorage `mynx-language` / `mynx-search-engine` / `mynx-home-header-height` | settings.language / searchEngine / homeHeaderHeight（settings_migrate_legacy 幂等合并） | 兼容 |
| localStorage `mynx-theme` | 不再使用（SQLite 为主；迁移读取） | 兼容 |

## 路由与窗口

| Legacy | New | 状态 |
| --- | --- | --- |
| HashRouter 路由 `/` `/settings` `/qpcr` `/rnaseq` `/charts` `/image`，`/tiff`→`/image` | 同（自研 hash 路由） | 兼容 |
| `/ui-showcase`（Mantine showcase） | 移除（新组件体系无此页） | 有意退役 |
| 菜单事件 mynx://navigate / toggle-language / help / about / always-on-top | 同名同 payload | 兼容 |
| 无边框窗口、拖拽、最小化/最大化/关闭、置顶 | 同 | 兼容 |
| 拖放 fs scope 补授权（unstable 特性 WebviewEvent 路径） | 同 | 兼容 |
| capability / fs scope / shell allowlist | 逐字保留 legacy default.json | 兼容 |
| updater endpoint + pubkey | 同 | 兼容 |
| 资源 r/ 打包 | 同（mynx-next/src-tauri/r/，57 模板 + 引擎脚本） | 兼容 |

## qPCR

| Legacy | New | 状态 |
| --- | --- | --- |
| transformQpcrData 输出（Transformed Data、黄色填补、冻结窗格、列宽） | Rust math + WorkbookPatch → ExcelJS 哑渲染 worker | golden fixture 逐格对比 |
| calculateQpcr（Summary_All_Genes / 基因表 / Best-Replicates / Outlier-Removed / 方法标注） | 同 | golden fixture 逐格对比 |
| PROTECTED_SHEETS 行为、非保护表删除 | 同（worker 侧展开 __NON_PROTECTED__） | 兼容 |
| Excel 原生图表（chart XML 注入、chartColor 颜色、errBars） | Rust zip + XML 移植（chart-xml.ts 1:1） | 输出 XML 对比 |
| qpcr_plot_runner.R 参数（QpcrPlotRunConfig ~60 字段） | 同一 JSON（Rust 类型生成 TS 绑定） | 兼容 |
| Rscript 检测 / 依赖安装入口 / 取消 / ASCII 输入副本 | Rust 运行器（行为逐行对齐） | 兼容 |

## RNA-seq

| Legacy | New | 状态 |
| --- | --- | --- |
| RnaSeqConfig（params.json，snake_case） | Rust RnaSeqConfig + serde defaults（同字段同默认值） | 兼容（ts-rs 生成 TS） |
| groups/batch/gene_clusters 键序 | serde_json preserve_order | 兼容 |
| counts 导入（csv/tsv/xlsx/featureCounts/htseq、重复基因、取整） | mynx-rnaseq 移植（matrix.ts 1:1） | 冒烟断言移植为 Rust 测试 |
| rnaseq_engine.R 调用（steps 参数、params.json、输出目录结构） | Rust 运行器（同一脚本、同一参数） | 兼容 |
| Windows 非 ASCII 输出 ASCII 暂存 | 同 | 兼容 |
| prepared/params.json 恢复、DE_summary 恢复、历史目录扫描 | mynx-rnaseq results 移植 | 兼容 |
| 取消 → 进程树终止、已生成文件保留 | 同 | 兼容 |

## 科研绘图

| Legacy | New | 状态 |
| --- | --- | --- |
| 57 模板目录/manifest/sample/render.R/参考图 | 同资源（mynx-next/src-tauri/r/chart-templates） | 兼容 |
| chart_runner.R / chart_runtime.R（chart_event JSON 行） | 同脚本；Rust 解析事件行 | 兼容 |
| 输出命名 mynx-<template>.<format>、sidecar JSON | 同 | 兼容 |
| 预设 chartStudioPresets | SQLite 同键迁移 | 兼容 |
| ZIP 图表包 / 模板包导出导入 | Rust zip crate | 格式一致 |

## 图片转换

| Legacy | New | 状态 |
| --- | --- | --- |
| Rust 管线（编解码、压缩、水印、多页 TIFF、EXIF、SVG 栅格化） | mynx-image 1:1 移植（同 crate 依赖同 feature） | 兼容（legacy 测试全移植） |
| ConvertEvent 结构 | 同（contracts 同型） | 兼容 |
| SUPPORTED_EXTENSIONS | 同列表（测试锁定） | 兼容 |
| 输出目录策略 subfolder/alongside/custom、重名变体 | 同 | 兼容 |

## 退役项

- React 18 / Mantine 8 / React Router / 旧 AppShell / 旧 CSS（legacy 树保留但不再使用）
- tauri-plugin-store（新应用不注册；Rust 直读旧 config.json 迁移后该文件不再写入）
- localStorage 作为核心业务存储（仅非核心缓存）
- `/ui-showcase`、天气组件保留但数据面切换到 weather_by_ip（契约不变）
