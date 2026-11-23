# Mynx

[![Version](https://img.shields.io/badge/version-3.0.5-2f6f9f.svg)](./CHANGELOG.md)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4.svg)](#系统要求)
[![macOS](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-000000.svg)](#系统要求)

Mynx 是面向科研数据处理的本地桌面应用，提供 qPCR 分析、RNA-seq 分析、科研绘图、图片转 PNG 和可配置的 AI 对话。应用基于 Tauri 2、Svelte 5、Rust 与 R 构建，支持 Windows 10/11 x64 和 macOS 11+ Apple Silicon。

分析、绘图和图片处理任务在本机执行。AI 对话、联网搜索和远程 MCP 仅在用户配置并启用后访问相应服务，模型 API Key 保存于系统钥匙串，会话数据保存于本机 SQLite。

## 当前版本

**3.0.5 · 2026-11-23**

- AI 对话页完成新版会话架构，支持多服务商、流式输出、Markdown、代码高亮、KaTeX 公式、思考过程、附件、引用、会话分支、模型对比、记忆、项目文件夹、联网搜索和远程 MCP。
- 修复流式消息与历史消息中的 LaTeX 公式渲染，兼容块级公式、行内公式和异常转义格式。
- 3.x 主应用完成 Svelte 5 + Rust workspace 重构，界面采用 macOS 27 Liquid Glass 结构，任务状态、取消、历史记录和设置迁移保持兼容。

完整变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 功能

### AI 对话

- 支持 OpenAI、Anthropic、Google、OpenAI 兼容接口和 Ollama，可注册多个服务商并在线获取模型列表。
- 支持流式回答、Markdown、表格、代码高亮、KaTeX、思考过程、继续生成、重新生成、编辑后重发和回答变体。
- 支持图片、文本和 PDF 附件，联网搜索引用，助手、提示词、记忆、临时会话、归档、导入导出和项目文件夹。
- 支持按次确认的远程 MCP 工具调用。模型服务与联网功能均由用户在聊天页设置中启用。

### qPCR 分析

- 导入 `.xlsx` / `.xls`，自动识别基因、样本、分组和 Ct/Cq 列，提供只读预检、转换表预览和质量摘要。
- 支持相对内参和相对对照（ΔΔCt）计算，缺失 Ct 按同组有效重复补齐并标记无法补齐的值。
- 支持择优重复和按 SD 剔除离群值两种互斥 QC 模式，结果写回原工作簿并保留既有工作表结构。
- 支持原生 Excel 图表、柱状图、表达量热图、误差棒、重复点和显著性标注，导出 PNG、SVG、PDF。内置 MIQE 记录模板和 Excel 原始数据模板。

### RNA-seq 分析

- 支持 CSV、TSV、XLSX、featureCounts 和 HTSeq 原始整数 Counts，提供重复基因处理、计数取整、低表达过滤和导入预览。
- 采用三步工作流完成数据导入、分组与差异分析、图形输出。支持 DESeq2、edgeR、批次协变量和单重复探索性比较。
- 输出差异结果、整体与选定基因热图、样本相关性热图、PCA、火山图及清洗数据、日志和 `prepared/params.json`。
- 历史结果可重新加载，分析参数可保存和恢复。R 引擎要求使用原始整数 Counts，单重复比较的 P 值仅用于探索性排序。

### 科研绘图

- 提供 57 个已验证模板，覆盖柱状图、折线图、散点图、箱线图、热图、相关性矩阵、网络图、地图、韦恩图、火山图、MA、PCA、富集分析、GSEA 和生存曲线等类型。
- 支持 CSV、TSV、TXT、Excel 数据，字段映射、主题、字体、图例、配色、尺寸和 DPI 均可配置，内置 Nature 等期刊版式预设。
- 由本地 R 渲染，支持 PNG、TIFF、SVG、PDF、EPS，参数可保存为 JSON，模板包和图表包支持导入、导出与 ZIP 打包。

### 图片转 PNG

- 批量转换 PNG、JPG、TIFF、WebP、BMP、GIF、ICO、TGA、PNM、QOI、DDS 和 SVG。
- 支持无损优化、有损索引色压缩、Floyd–Steinberg 抖动、多页 TIFF 逐页导出、SVG 高分辨率栅格化和 EXIF 方向校正。
- 支持文字水印和图片水印，可输出到源目录子文件夹、原图目录或自定义目录，自动处理重名文件且不覆盖原图。

### 通用能力

- 中文和英文界面，支持 `system`、`graphite`、`pearl` 三种明暗主题与五套界面风格，适配降低透明度、增强对比度和减少动态效果设置。
- 无边框窗口、拖放导入、置顶、任务中心、实时日志、协作取消、历史结果加载和应用内更新。
- 用户路径、中文文件名、样本名、基因名和组名保持原样传递，兼容旧版配置和历史结果目录。

## 安装

从 [GitHub Releases](https://github.com/hanhan124/mynx/releases) 下载对应平台的安装包。

| 平台 | 发布文件 | 说明 |
| --- | --- | --- |
| Windows 10/11 x64 | `mynx-installer.exe` | 运行安装器完成安装，系统需要 WebView2 Runtime。 |
| macOS 11+ Apple Silicon | `Mynx_*.dmg` | 打开 DMG，将应用拖入“应用程序”。 |

当前 macOS 正式发布包面向 Apple Silicon（M1–M4），不提供 Intel 或 Universal 版本。项目暂未使用 Apple Developer ID 公证。若 macOS 首次打开提示应用已损坏，请在 DMG 中运行“修复损坏.command”。

## 系统要求

| 项目 | Windows | macOS |
| --- | --- | --- |
| 系统 | Windows 10 1803+ 或 Windows 11（64 位） | macOS 11 或更高版本 |
| 架构 | x86_64 | arm64 |
| Web 渲染 | Microsoft Edge WebView2 Runtime | 系统 WebKit |
| R 环境 | RNA-seq 和 R 绘图需要 R 4.0+ | RNA-seq 和 R 绘图需要 R 4.0+ |

RNA-seq 和科研绘图会检查所需 R 包并提供安装入口。图片转换不依赖 R 或外部转换程序。

## 开发

开发环境需要 Node.js 22+、Rust stable。Windows 构建需要 Visual Studio Build Tools 的 C++ 工作负载，macOS 构建需要 Xcode Command Line Tools。

```bash
npm ci --legacy-peer-deps

npm run tauri dev          # Tauri 开发模式
npm run build              # 前端生产构建
npm run typecheck          # svelte-check
npm run lint               # ESLint 与 UI 令牌检查
npm test                   # Vitest
npm run test:rust          # Rust workspace 测试
npm run test:r:engine      # RNA-seq R 引擎契约冒烟测试
npm run charts:check       # 图表模板契约检查
npm run check:release      # 发布前版本、资源、前端、Rust 和安装器检查
```

Windows 安装器是独立子项目。完整构建使用 `npm run installer:build`。发布流程见 [docs/RELEASE.md](./docs/RELEASE.md) 和 [RELEASE_GUIDE.md](./RELEASE_GUIDE.md)。

## 项目结构

```text
mynx/
├── src/                  # Svelte 5 前端、功能页与生成的契约类型
├── src-tauri/            # Tauri 应用、Rust workspace 与 R 运行资源
│   ├── crates/           # contracts、jobs、core、image、qpcr、rnaseq、charts
│   └── r/                # RNA-seq、qPCR 和科研绘图脚本
├── contracts/            # JSON Schema
├── installer/            # Windows 安装器子项目
├── docs/                 # 架构、任务协议、兼容矩阵、UI 与发布文档
└── tests/r/              # R 引擎数值回归基准
```

架构说明见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)，任务协议见 [docs/TASK_PROTOCOL.md](./docs/TASK_PROTOCOL.md)，兼容边界见 [docs/COMPATIBILITY_MATRIX.md](./docs/COMPATIBILITY_MATRIX.md)。

## 许可证

Mynx 以 [Apache License 2.0](./LICENSE) 发布。第三方组件和运行时依赖见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。RNA-seq、qPCR 和科研绘图使用的 R 及扩展包不随本软件分发，各自遵循其原始许可证。

Copyright © 2024–2026 Han

[作者主页](https://fanguanghan.dpdns.org/)
