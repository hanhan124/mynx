# Mynx

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#系统要求)
[![macOS](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-000000.svg)](#系统要求)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131.svg)](https://tauri.app/)

Mynx 是一款科研数据处理桌面工具，提供 qPCR 数据分析、RNA-seq 差异分析和 TIFF 图像转换功能，支持 Windows 与 macOS Apple Silicon。

## 功能

### qPCR 分析

- 导入仪器导出的 Excel 文件，识别 Target、Sample、Ct 等常用列
- 将原始表格整理为分析格式
- 使用内参计算相对表达量：`RE = 2^-(Ct_target - Ct_ref)`
- 标记缺失值，支持多个基因共用内参
- 按基因生成带误差棒的柱状图，并写入 Excel 工作簿

### RNA-seq 分析

- 导入 gene count 矩阵
- 设置样本分组和比较组
- 使用 DESeq2 或 edgeR 进行差异表达分析
- 导出分析结果和常用图表
- 保存、加载分析配置，也可从已有结果目录继续绘图

RNA-seq 功能依赖本机安装的 R 和相关 R 包，当前仍在持续完善。正式分析前请保留原始数据，并核对分组、比较组和结果。

### TIFF 转 JPG

- 批量转换文件夹中的 `.tif` / `.tiff` 文件
- 支持单页和多页 TIFF
- 设置 JPG 压缩质量
- 添加文件名水印，设置字体、字号、粗体、斜体和透明度
- 显示转换进度和失败数量

### 通用功能

- Windows 和 macOS Apple Silicon 桌面版本
- 浅色和深色主题
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
