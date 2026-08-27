# Mynx

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#系统要求)
[![macOS](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-000000.svg)](#系统要求)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131.svg)](https://tauri.app/)

Mynx 是一个给科研数据处理准备的小型桌面工具。目前包含 qPCR 数据处理、RNA-seq 差异分析和 TIFF 图片转换几个功能，目标是把平时需要在 Excel、脚本和图片工具之间来回切换的操作集中到一个界面里。

## 目前能做什么

### qPCR 分析

- 导入仪器导出的 Excel，自动识别 Target、Sample、Ct 等列
- 将原始表格转换为分析格式
- 按内参计算相对表达量：`RE = 2^-(Ct_target - Ct_ref)`
- 支持缺失值标记，以及多个基因使用同一内参进行归一化
- 按基因生成带误差棒的柱状图，并写入 Excel 工作簿

### RNA-seq 分析（测试版）

- 导入 gene count 矩阵
- 设置样本分组和比较组
- 使用 DESeq2 或 edgeR 进行差异表达分析
- 导出分析结果和常用图表
- 保存、加载分析配置，也可以从已有结果目录继续绘图

RNA-seq 功能依赖本机安装的 R 和相关 R 包。当前仍在完善中，正式分析前请保留原始数据，并核对分组、比较组和分析结果。

### TIFF 转 JPG

- 批量转换文件夹中的 `.tif` / `.tiff` 文件
- 支持单页和多页 TIFF
- 可选择 JPG 压缩质量
- 可添加文件名水印，设置字体、字号、粗体、斜体和透明度
- 显示转换进度和失败数量

### 其他

- Windows 和 macOS Apple Silicon 桌面版本
- 深色和浅色主题
- 支持拖拽导入文件或文件夹
- 首页提供工具搜索，也可以使用网页搜索
- 支持应用内更新提示

## 安装

从 [Releases](https://github.com/hanhan124/mynx/releases) 下载对应平台的安装包：

| 平台 | 下载文件 | 安装方式 |
|---|---|---|
| Windows 10/11 64-bit | `mynx-installer.exe` | 双击运行安装器 |
| macOS Apple Silicon | `Mynx_*.dmg` | 打开 DMG 后拖拽到 Applications |

> 当前 macOS 版本面向 Apple Silicon（M1/M2/M3/M4）。暂不提供 Intel Mac / Universal 版本。

> 💡 **macOS 首次打开提示**：由于当前 DMG 未做 Apple 代码签名公证，双击 Mynx 可能提示「已损坏，无法打开」。这是 macOS Gatekeeper + AMFI 的安全机制，应用本身没有问题。请按以下步骤操作（全程图形界面，无需打开终端输命令）：
>
> 1. 打开下载的 DMG，将 Mynx.app 拖到「应用程序」文件夹
> 2. 回到 DMG 窗口，找到 **`修复损坏.command`**，**右键 → 打开**（注意必须右键，普通双击仍会被拦）
> 3. 弹出的安全对话框点「打开」，终端会自动完成修复（清除隔离属性 + 应用签名）并弹出成功提示
> 4. 关掉终端窗口，现在双击「应用程序」里的 Mynx 即可正常使用
>
> 此修复只需执行一次。若第 2 步右键打开仍失败（macOS 26 上 `.command` 也可能被 AMFI 拦截），可打开终端手动执行以下两条命令作为兜底：
> ```bash
> sudo xattr -cr /Applications/Mynx.app
> sudo codesign --force --deep --sign - /Applications/Mynx.app
> ```

### 系统要求

| 项目 | Windows | macOS |
|---|---|---|
| 操作系统 | Windows 10 1803+ / Windows 11 (64-bit) | macOS 11+ |
| 架构 | x86_64 | Apple Silicon / arm64 |
| 运行时 | Microsoft Edge WebView2 Runtime | 系统 WebKit |
| 权限 | 管理员权限（安装到 Program Files 时） | 首次打开可能需要在系统设置中允许 |

## 开发

### 前置环境
- Node.js >= 22
- Rust >= 1.77 (stable)
- Windows 构建安装器：Windows 10/11 + Visual Studio Build Tools (C++ 工作负载)
- macOS 构建 DMG：Apple Silicon Mac + Xcode Command Line Tools

### 安装依赖
```bash
npm install
cd installer && npm install && cd ..
```

### 开发模式
```bash
npm run tauri dev          # 主应用
npm run installer:dev      # Windows 安装器 UI
```

### 构建
```bash
# Windows: 主应用 + 自建安装器
npm run installer:build
# 产物: release-installer/mynx-installer.exe

# macOS Apple Silicon: .app + .dmg + updater tarball
npm run mac:build
# 产物: src-tauri/target/aarch64-apple-darwin/release/bundle/
```

### 项目结构
```
mynx/
├── src/                # React 主应用
├── src-tauri/          # Rust 后端 + Tauri 配置
├── installer/          # Windows 自建 Tauri 安装器
│   ├── src/            # 安装器 React UI
│   └── src-tauri/      # 安装器 Rust 逻辑
├── scripts/            # 版本同步 / 构建脚本
├── release-installer/  # Windows 安装包产物
└── .github/workflows/  # CI/CD
```

Copyright © 2024-2026 Han
