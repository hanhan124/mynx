# Mynx

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#系统要求)
[![macOS](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-000000.svg)](#系统要求)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131.svg)](https://tauri.app/)

Mynx 是一款科研数据处理桌面工具，提供 qPCR 数据分析、RNA-seq 差异分析和 TIFF 图像转换功能，支持 Windows 与 macOS Apple Silicon。

## 功能

### qPCR 分析

- 导入 `.xlsx` / `.xls` 文件并选择工作表
- 自动识别 `Target` / `Gene`、`Sample` / `Group` 和 `Cq` / `Ct` 列
- 将原始表格整理为 `Transformed Data`，并保留基因、分组和重复信息
- 缺失 Ct 使用同一“样本 + 基因”的有效重复均值补齐；全部缺失时使用 50，并在表格中标记
- 提供“相对内参”和“相对对照（ΔΔCt）”两种计算方法
- 按基因生成明细表和 `Summary_All_Genes` 汇总表，结果写回原 Excel 工作簿
- 可生成 `Summary_Best_Replicates`（择优重复）或 `Summary_Outlier_Removed`（按 SD 阈值剔除离群值）作为 QC 参考

qPCR 绘图工作区读取计算结果 Excel，支持柱状图和表达量热图。柱状图可显示误差棒、重复点和显著性标注，支持 Welch t-test、Wilcoxon、ANOVA + Tukey、Kruskal-Wallis 及多种比较方式；图表可导出为 PNG、SVG 或 PDF，也支持批量处理子文件夹。

### 科研绘图

- 从 CSV、TSV、TXT 或 Excel 导入数据，也可直接载入示例数据
- 提供基础比较、趋势关系、分布、组成、矩阵与层级、空间与网络等图表模板
- 包含柱状图、折线图、散点图、箱线图、热图、相关性矩阵、树状图、网络图、地图、韦恩图、火山图、MA 图、PCA 图、富集分析图、GSEA 曲线和生存曲线等
- 设置字段映射、主题、字体、图例、配色、尺寸和 DPI；提供 Nature 等论文版式预设
- 支持 PNG、TIFF、SVG、PDF 和 EPS 输出
- 保存、导入和导出参数模板；结果目录同时保存可复现的 JSON 参数清单
- 可导出包含图表和模板说明的结果包，并在 SVG 结果上复制源码

科研绘图使用 R 生成图表，运行时会检查环境，并可按当前模板准备所需依赖。

### RNA-seq 分析

- 支持 CSV、TSV、TXT 和 Excel（`.xlsx`）输入
- 提供标准 Counts、featureCounts 和 HTSeq 三种导入预设，自动处理注释列、统计行和重复基因名
- 导入后显示样本数、基因数、非零基因数和分页数据预览，并检查低计数样本
- 可手动分组，也可按样本名前缀自动分组；支持生成两两比较和自定义比较
- 分析引擎支持 DESeq2 Wald、edgeR QL F-test，以及按比较自动选择的模式
- 设置低表达过滤、最小原始计数、`log2FC` 和 FDR 阈值
- 输出差异分析 Excel 结果、运行日志和分析元数据
- 支持保存/加载分析配置、加载已有结果目录、取消运行和查看历史运行记录

绘图与导出工作区提供 16 类结果图：样本 QC、PCA、MDS、整体热图、选定基因热图、火山图、Venn 图、MA 图、箱线图、DEG 柱状图、Top 基因图、样本聚类树、GO/KEGG 富集条形图、GSEA 点图、小提琴图和密度图。支持单图预览、批量导出、结果画廊，以及 PDF、SVG 和 PNG 格式。

RNA-seq 功能依赖本机安装的 R 和相关 R 包。DESeq2/edgeR 需要原始或 estimated counts，不能直接使用 TPM、FPKM 或 log 转换矩阵。含单重复组的比较仅适合作为候选线索，正式结论应使用足够的生物学重复进行验证。

### TIFF 转 JPG

- 批量转换文件夹中的 `.tif` / `.tiff` 文件
- 支持单页和多页 TIFF
- 设置 JPG 压缩质量
- 可选添加文件名水印，设置字体、字号、粗体、斜体、边距、背景透明度和输出质量
- 显示转换进度和失败数量
- 输出到带时间戳的 `JPG_output_` 子目录，不修改原始 TIFF 文件

工具按当前选择的文件夹处理，不会递归扫描更深层子目录。Windows 不需要额外依赖；macOS 启用水印时需要安装 ImageMagick。

### 通用功能

- Windows 和 macOS Apple Silicon 桌面版本
- 中英文界面
- 浅色、深色和跟随系统主题
- 窗口置顶、帮助、官网和关于页面
- 拖放导入文件或文件夹
- 工具搜索和应用内更新提示

## 安装

从 [Releases](https://github.com/hanhan124/mynx/releases) 下载对应平台的安装包。

| 平台                 | 文件                 | 安装方式                       |
| -------------------- | -------------------- | ------------------------------ |
| Windows 10/11 64-bit | `mynx-installer.exe` | 运行安装器                     |
| macOS Apple Silicon  | `Mynx_*.dmg`         | 打开 DMG，将应用拖到“应用程序” |

当前 macOS 发布包面向 Apple Silicon（M1/M2/M3/M4），暂不提供 Intel 或 Universal 版本。

### macOS 首次打开

当前 DMG 未使用 Apple Developer ID 签名和公证。首次打开时，macOS 可能提示应用“已损坏，无法打开”。

1. 打开 DMG，将 `Mynx.app` 拖到“应用程序”。
2. 在 DMG 中找到 `修复损坏.command`，右键选择“打开”。
3. 在安全提示中选择“打开”，等待脚本完成处理。
4. 关闭终端窗口，再从“应用程序”启动 Mynx。

如果脚本无法打开，可在终端执行：

```bash
sudo xattr -cr /Applications/Mynx.app
sudo codesign --force --deep --sign - /Applications/Mynx.app
```

### 系统要求

| 项目     | Windows                                | macOS                            |
| -------- | -------------------------------------- | -------------------------------- |
| 操作系统 | Windows 10 1803+ / Windows 11（64 位） | macOS 11+                        |
| 架构     | x86_64                                 | Apple Silicon / arm64            |
| 运行时   | Microsoft Edge WebView2 Runtime        | 系统 WebKit                      |
| 权限     | 安装到 Program Files 时需要管理员权限  | 首次打开可能需要在系统设置中允许 |

## 开发

### 环境

- Node.js >= 22
- Rust >= 1.77（stable）
- Windows 构建安装器：Windows 10/11 和 Visual Studio Build Tools（C++ 工作负载）
- macOS 构建 DMG：Apple Silicon Mac 和 Xcode Command Line Tools

### 安装依赖

```bash
npm install
cd installer && npm install && cd ..
```

### 开发模式

```bash
npm run tauri dev          # 主应用
npm run installer:dev      # 安装器界面
```

### 构建

```bash
# Windows：主应用和自建安装器
npm run installer:build
# 产物：release-installer/mynx-installer.exe

# macOS Apple Silicon：.app、.dmg 和 updater tarball
npm run mac:build
# 产物：src-tauri/target/aarch64-apple-darwin/release/bundle/

# Intel Mac：开发环境兼容性构建，不作为正式发布产物
npm run mac:build:intel
```

### 检查

```bash
npm run version:check
npm run resources:check
npm run build
npm run lint
npm run check:release
```

## 项目结构

```text
mynx/
├── src/                # React 主应用
├── src-tauri/          # Rust 后端和 Tauri 配置
├── installer/          # Windows 安装器
│   ├── src/            # 安装器 React 界面
│   └── src-tauri/      # 安装器 Rust 逻辑
├── scripts/            # 版本同步和构建脚本
└── .github/workflows/  # GitHub Actions
```

## 许可证

Mynx 使用 MIT 许可证，详见 [LICENSE](./LICENSE)。

Copyright © 2024-2026 Han
