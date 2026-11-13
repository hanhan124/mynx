# Mynx 功能回归基线

## 基线用途

本文档定义 Mantine 8 UI 迁移前必须保护的输入、输出、文件、运行状态和测试路径。UI 迁移只能改变展示、布局和非核心交互，不得改变本文件中的契约。

基线生成时间为 2026-11-13。当前源码版本为 2.3.9。

## 当前自动检查

| 命令 | 覆盖内容 | 当前结果 |
| --- | --- | --- |
| `npm run build` | TypeScript、Vite production build | 通过，Vite 对大 chunk 给出提示 |
| `npm run lint` | ESLint `src/` | 通过，19 个 warning，新增主题上下文 Fast Refresh warning |
| `npm test` | RNA-seq matrix smoke、chart schema smoke | 通过 |
| `npm run test:rust` | Rust image service tests | 通过，9 个测试 |
| `npm run test:r:engine` | RNA-seq R engine full DE/heatmap/plots 和 DE-only | 通过 |
| `npm run resources:check` | R 资源同步检查 | 发布前执行 |
| `npm run charts:check` | 图表 schema 和模板检查 | 发布前执行 |
| `npm run charts:verify` | 图表契约、R smoke、视觉回归 | 发布前执行 |

当前 build 的 Vite 提示包括 ExcelJS 约 938KB，以及多个超过 500KB 的 chunk。该提示属于性能基线，不得通过删减 ExcelJS 功能来消除。

## 功能不变量

### 通用

- 路由保持 `/`、`/settings`、`/qpcr`、`/rnaseq`、`/charts`、`/image` 和兼容重定向 `/tiff`
- `HashRouter` 和 Tauri `mynx://navigate` 事件继续工作
- Tauri 无边框窗口、拖拽、最小化、最大化、关闭、置顶、原生菜单和更新能力继续工作
- 中文和英文状态由 `LanguageProvider` 管理
- 主题值保持 `system`、`graphite`、`pearl`，历史值 `dark` 和 `light` 继续归一化
- 主题、语言、置顶、图表颜色、绘图预设、图片选项、首页搜索引擎和首页高度持久化行为保持
- 用户选择的路径可包含中文、空格、方括号、非 ASCII 字符和任意允许的磁盘位置
- 取消任务后必须清理临时参数文件，已生成结果按现有服务约定保留

## qPCR 基线

### 输入

- Excel 工作簿，读取逻辑位于 `src/lib/excel-io.ts`
- 用户选择文件和工作表
- 已转换工作簿可被重新打开并自动检测基因名
- 转换阶段使用原始工作表，生成或更新 `Transformed Data`
- 计算阶段读取参考基因、目标基因、分组、重复数、计算方法、对照组、择优重复和离群值设置
- 绘图阶段支持柱状图和表达量热图，配置由 `QpcrPlotRunConfig` 定义

### 数据和算法不变量

- 转置逻辑、组块边界、缺失 Ct 标黄、参考基因识别和基因列识别保持
- 默认计算使用 `2^-(target - reference)`
- `ref-normalized` 和 `control-relative` 方法保持
- control-relative 必须要求对照组，输出方法字符串和汇总列名保持
- 择优重复和离群值剔除互斥规则保持
- 重复数、目标基因、参考基因和工作表缺失时，错误仍在执行前返回
- 保存前的参数校验顺序保持，错误不能留下半清空的工作簿

### Excel 输出

- 原文件保存回用户选择的路径
- 现有受保护工作表保留
- 生成 `Summary_All_Genes`
- 按目标基因生成基因工作表
- 可生成 `Summary_Best_Replicates`
- 可生成 `Summary_Outlier_Removed`
- 方法、平均值、标准差、Ct 值、填补色和 `Removed` 信息保持
- `src/lib/chart-gen.ts` 继续写入 `Charts_All_Genes` 并注入原生 Excel chart XML
- 图表颜色来自 `chartColor` 配置，不由 Mantine 主题色替换

### qPCR R 绘图

- 运行器为 `src/lib/qpcr-plot-runner.ts` 和 `src-tauri/r/qpcr_plot_runner.R`
- 支持 PNG、SVG、PDF
- 支持柱状图、热图、误差棒、原始点、显著性统计、控制组、p 值校正、标签和热图聚类
- 支持批量模式、输出目录、统计 CSV 和安装缺失依赖入口
- Windows 非 ASCII 路径继续复制到 ASCII 临时路径后运行
- 运行中可取消，临时 JSON 和输入副本完成后清理

### qPCR 回归路径

1. 导入最小有效 xlsx
2. 选择工作表
3. 执行转换
4. 检查 `Transformed Data`、基因名和缺失值颜色
5. 执行默认计算并检查 `Summary_All_Genes`
6. 执行 control-relative 并检查 control 归一化
7. 执行择优重复和离群值剔除的互斥校验
8. 保存并重新打开 xlsx
9. 生成 Excel 原生图表
10. 在 qPCR 绘图区生成 PNG、SVG、PDF
11. 取消一次正在运行的 R 绘图

## RNA-seq 基线

### 输入和导入

- CSV、TSV、XLSX、featureCounts 和 HTSeq 输入
- 支持 `counts_matrix`、`featurecounts`、`htseq`
- 基因列识别、空基因过滤、重复基因处理、计数取整和导入警告保持
- 导入后可生成缓存的规范化 CSV
- 预览分页、列名、非零计数、总基因数和警告保持

### 配置契约

`src/lib/rnaseq/types.ts` 的 `RnaSeqConfig` 必须与 `src-tauri/r/rnaseq_engine.R` 的 params.json 一一对应。

- `data_file`
- `output_dir`
- `run_name`
- `sample_labels`
- `batch`
- `overall_genes`
- `gene_clusters`
- `input`
- `groups`
- `de`
- `comparisons`
- `heatmap`
- `overall_heatmap`
- `selected_heatmaps`
- `plots`
- 运行时注入的 `steps`

### 分析和图形

- DESeq2 和 edgeR
- `filterByExpr`、`min_count`、`none`
- padj 和 log2FC 阈值
- 有重复与无重复路径，保留 BCV
- DESeq2 shrink 选项
- batch 协变量
- overall heatmap、selected heatmap、PCA、volcano 和额外 QC 图
- 结果图、DE 表、汇总表、参数、日志和清洗数据保持输出目录结构

### 输出目录

一次完整运行继续生成以下结构。

```text
<output-base>/<run-name>/
├─ DE/
│  ├─ DE_summary.csv
│  └─ DE_<comparison>.csv
├─ heatmap/
├─ plots/
├─ data/
├─ logs/
└─ prepared/
   └─ params.json
```

### 运行状态和历史

- `idle`、`running`、`done`、`failed`、`cancelled` 状态保持
- Rscript 检测、依赖检测、安装入口和日志级别保持
- Windows 非 ASCII 输出目录继续通过临时 ASCII staging 运行并复制回目标目录
- 取消后已生成文件保留，历史目录可重新加载
- `prepared/params.json` 可以恢复 UI 配置
- `DE/DE_summary.csv` 可以恢复差异结果摘要

### RNA-seq 回归路径

1. 使用 `tests/r/rnaseq-engine-test` fixture 导入 counts
2. 验证 groups、comparisons 和 batch 配置
3. 执行全步骤 `de + heatmap + plots`
4. 检查 DE summary、DE CSV、heatmap、PCA、volcano、data、logs、prepared
5. 检查中文组名在结果和 params.json 中保留
6. 执行仅 `de` 步骤并确认不生成 heatmap PNG
7. 取消一次运行并确认 R 进程树结束
8. 重新加载历史结果目录
9. 从保存的配置恢复后再次运行

## 科研绘图基线

### 模板目录

- 真实目录在 `src/lib/charts/catalog.ts`
- 当前有 57 个已验证模板
- family、id、名称、描述、icon、resource path、manifest 和 outputs 保持
- 模板 schema 由 `src/lib/charts/schema.ts` 校验
- 模板资源至少包含 manifest、sample、render.R、说明和参考图时，资源检查必须通过

### 输入和配置

- CSV、TSV、XLSX、XLS
- 字段映射和数据预览
- 模板专用参数、通用图形外观、主题、字体、图例、调色板、尺寸和 dpi
- 预设保存到 `chartStudioPresets`
- 支持模板包导入、模板资源安装、参考图加载和 ZIP 导出

### 输出和运行

- PNG、SVG、PDF、TIFF、EPS
- Rscript 检测和安装入口保持
- 运行事件包含 stage、message 和 tone
- 支持取消和错误日志
- 输出文件名沿用 `mynx-<template>.<format>` 约定
- SVG、PNG 预览和结果下载保持

### 科研绘图回归路径

1. 使用 `demoData` 和一个已验证模板生成 PNG
2. 生成 SVG、PDF、TIFF、EPS
3. 检查字段缺失提示
4. 检查 Rscript 缺失和依赖错误显示
5. 取消一次运行
6. 保存并加载一个绘图预设
7. 导入一个模板包并检查 manifest
8. 生成 ZIP 图表包
9. 抽样验证基础柱状图、火山图、PCA、热图、Venn、表格和一个高级模板

## 图片转换基线

### 输入格式

Rust `SUPPORTED_EXTENSIONS` 和前端 `IMAGE_EXTENSIONS` 必须保持同步。

```text
png, jpg, jpeg, jfif, tif, tiff, webp, bmp, gif, ico,
tga, pnm, pbm, pgm, ppm, pam, qoi, dds, svg
```

### 选项

- `lossless` 和 `lossy`
- optimize level 1、2、3
- lossy colors 和 Floyd–Steinberg dither
- `subfolder`、`alongside`、`custom`
- text 或 image watermark
- 字体、字号、粗体、白色或黑色、透明度、九宫格位置、背景、logo scale
- 原图不被覆盖

### 事件和输出

- `started`
- 每个文件一个 `item`
- 最终 `finished`
- `taskId` 可取消
- 多页 TIFF 生成带页码的 PNG 文件
- 水印资源缺失时转换继续，`watermarkApplied` 为 false
- 结果表显示输入大小、输出大小、比例、状态、失败原因和输出目录

### 图片回归路径

1. PNG、JPEG、单页 TIFF、SVG 各转换一次
2. 多页 TIFF 验证每一页的文件名和像素尺寸
3. Unicode 路径和带空格路径各执行一次
4. 无损模式验证源文件不变
5. 有损模式验证颜色上限和输出 PNG
6. 文本水印、图片水印、缺失字体各执行一次
7. subfolder、alongside、custom 各执行一次
8. 取消批量任务并检查事件顺序
9. 打开输出目录并重新加载结果表

## 主题、语言和原生能力基线

### 主题

- 启动时读取保存的 `theme`
- `system` 跟随系统 light/dark
- `graphite` 和 `pearl` 可直接切换
- 设置页切换后当前页面立即更新
- 重启后主题仍保留

### 语言

- 启动语言保持当前行为
- `zh` 和 `en` 切换后页面标题、导航、按钮、字段、教程、toast 和状态同步
- 原生菜单语言事件继续触发
- 长中文和英文不遮挡主操作

### Tauri 和更新

- 无边框窗口控制正常
- 置顶状态同步 TitleBar、Settings 和原生菜单
- 文件拖放会更新 fs scope
- `assetProtocol` 可加载结果图片和模板参考图
- 更新提示、下载、重试、稍后和重启行为保持

## 回归记录模板

每次迁移提交至少记录以下信息。

```text
Mynx version:
Commit:
OS:
Node/npm:
React:
Tauri:
R/Rscript:
Rust:
Fixture SHA-256:

npm run build: PASS/FAIL
npm run lint: PASS/FAIL
npm test: PASS/FAIL
npm run test:rust: PASS/FAIL
npm run test:r:engine: PASS/FAIL

qPCR numerical diff:
RNA-seq output diff:
Chart output diff:
Image output diff:
Theme/light-dark result:
zh/en result:
Cancel result:
Historical load result:
```

## 迁移期间禁止通过 UI 改变的内容

- R 脚本算法、统计方法和参数默认值
- Rust 图像编解码、压缩、水印、页码命名和输出策略
- Excel 工作表、列名、填补色、计算结果和 chart XML
- RNA-seq params.json 字段、输出目录、DE 文件、热图文件和日志文件
- 图表模板 manifest、sample、render.R、参考图和输出格式
- Tauri capability、fs scope、shell allowlist、菜单事件和 updater endpoint
