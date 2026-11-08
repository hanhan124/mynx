# Mynx

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#系统要求)
[![macOS](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-000000.svg)](#系统要求)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131.svg)](https://tauri.app/)

Mynx 是一款本地运行的科研数据处理桌面工具,包含 qPCR 分析、RNA-seq 差异分析、科研绘图与图片转 PNG 四个模块,支持 Windows 与 macOS Apple Silicon。所有计算与绘图均在本机完成,数据不经过任何在线服务。

## 功能

### qPCR 分析

- 导入 `.xlsx` / `.xls`,自动识别 Target/Gene、Sample/Group 与 Ct/Cq 列
- 缺失 Ct 按同组有效重复均值补齐,并标记无法补齐的值
- 支持"相对内参"与"相对对照(ΔΔCt)"两种计算方法,结果写回原工作簿
- 汇总表支持择优重复与按 SD 剔除离群值两种 QC 模式
- 绘图工作区读取计算结果,支持带误差棒、重复点与显著性标注的柱状图(Welch t / Wilcoxon / ANOVA+Tukey / Kruskal-Wallis)及表达量热图,导出 PNG / SVG / PDF,支持批量处理子文件夹

### RNA-seq 分析

- 分析引擎 `rnaseq_engine.R` 与实验室参考脚本逐行一致:每个比较仅用两组样本单独建模;两组各 ≥2 重复走 DESeq2(Wald)或 edgeR QL F 检验,任一组单重复自动走 edgeR exactTest + 固定 BCV(人 0.4 / 同基因型 0.1 / 技术重复 0.01)
- 低表达过滤默认 `filterByExpr`(可切换 min_count / none);重复基因名支持 sum / max_mean / make_unique 三种合并策略;计数取整支持 round / floor / ceiling
- 界面为三步向导:数据导入(样本显示名)→ 分组与差异分析 → 图形输出;实验分组支持拖拽
- 图形输出:整体热图(标记基因连线 + 聚类色块)、样本相关性热图、选定基因热图(基因簇分块)、PCA、火山图;样式参数(色板、Z-score 范围、聚类方法、期刊毫米尺寸等)可配置,默认值即参考脚本默认配置
- 输出目录:`DE/`(差异表与汇总)、`heatmap/`(热图与矩阵)、`plots/`(PCA 与火山图)、`data/`(清洗后计数与样本表)、`logs/`、`prepared/params.json`(完整可复现参数)
- 依赖本机 R 与 DESeq2 / edgeR / ComplexHeatmap 等包;必须使用原始整数 Counts,不能用 TPM / FPKM;单重复比较的 P 值仅用于探索性排序

### 科研绘图

- 57 种图表模板:柱状图、折线图、散点图、箱线图、热图、相关性矩阵、树状图、网络图、地图、韦恩图、火山图、MA 图、PCA 图、富集分析图、GSEA 曲线、生存曲线等
- 从 CSV / TSV / TXT / Excel 导入数据,或载入示例数据
- 字段映射、主题、字体、图例、配色、尺寸与 DPI 可配置;内置 Nature 等期刊版式预设
- 由本地 R(ggplot2)渲染,导出 PNG / TIFF / SVG / PDF / EPS
- 参数可保存、导入、导出(JSON);结果目录同时保留可复现的参数清单

### 图片转 PNG

- PNG / JPG / TIFF / WebP / BMP / GIF / ICO / TGA / PNM / QOI / DDS / SVG 批量转 PNG
- 无损优化(oxipng 分档)与有损压缩(量化为 256 / 128 / 64 / 32 色索引色,可开抖动)
- 多页 TIFF 逐页导出;动图取首帧;SVG 按矢量高清栅格化;自动识别 EXIF 方向
- 文字水印(字体、字号、位置、平铺、半透明底色)与图片水印(logo、缩放、不透明度)
- 输出到源目录时间戳子文件夹 / 原图同目录 / 自定义目录;重名自动加后缀,不覆盖原文件
- 由 image-rs、oxipng、resvg 等开源库驱动,无需安装外部程序;不支持 HEIC 输入

### 通用

- 中英文界面,浅色 / 深色 / 跟随系统主题,窗口置顶,拖放导入,应用内更新提示

## 安装

从 [Releases](https://github.com/hanhan124/mynx/releases) 下载对应平台的安装包。

| 平台                 | 文件                 | 安装方式                       |
| -------------------- | -------------------- | ------------------------------ |
| Windows 10/11 64-bit | `mynx-installer.exe` | 运行安装器                     |
| macOS Apple Silicon  | `Mynx_*.dmg`         | 打开 DMG,将应用拖到"应用程序" |

当前 macOS 发布包面向 Apple Silicon(M1–M4),不提供 Intel 或 Universal 版本。

DMG 未做 Apple Developer ID 公证,首次打开若提示"已损坏":在 DMG 中右键 `修复损坏.command` 选择"打开",按提示完成后再启动应用;或手动执行:

```bash
sudo xattr -cr /Applications/Mynx.app
sudo codesign --force --deep --sign - /Applications/Mynx.app
```

### 系统要求

| 项目     | Windows                                | macOS                            |
| -------- | -------------------------------------- | -------------------------------- |
| 操作系统 | Windows 10 1803+ / Windows 11(64 位) | macOS 11+                        |
| 架构     | x86_64                                 | Apple Silicon / arm64            |
| 运行时   | Microsoft Edge WebView2 Runtime        | 系统 WebKit                      |
| 权限     | 安装到 Program Files 时需要管理员权限  | 首次打开可能需要在系统设置中允许 |

## 开发

环境:Node.js ≥ 22,Rust ≥ 1.77(stable);Windows 构建需 Visual Studio Build Tools(C++ 工作负载),macOS 构建需 Xcode Command Line Tools。

```bash
npm install && cd installer && npm install && cd ..

npm run tauri dev          # 主应用开发模式
npm run installer:dev      # 安装器开发模式

npm run installer:build    # Windows:主应用 + 自建安装器(产物 release-installer/)
npm run mac:build          # macOS Apple Silicon:.app / .dmg / updater tarball

npm run build              # 前端类型检查与构建
npm run lint               # ESLint
npm run check:release      # 测试套件 + cargo test + 安装器 payload 同步
npm run test:r:engine      # RNA-seq 引擎契约冒烟测试(需本机 R)
npm run version:check && npm run resources:check
```

## 项目结构

```text
mynx/
├── src/                # React 主应用
├── src-tauri/          # Rust 后端、Tauri 配置与 R 引擎(r/)
├── installer/          # Windows 安装器
├── scripts/            # 版本同步、资源校验与冒烟测试脚本
├── tests/r/            # R 引擎数值回归基准
└── .github/workflows/  # GitHub Actions
```

## 许可证

本项目以 [Apache License 2.0](./LICENSE) 发布,第三方组件声明见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。RNA-seq / qPCR / 科研绘图依赖运行时安装的 R 及其扩展包(DESeq2、edgeR、ComplexHeatmap 等),这些包不随本软件分发,各自遵循其原始许可证。

Copyright © 2024-2026 Han

作者主页:<https://fanguanghan.dpdns.org/>
