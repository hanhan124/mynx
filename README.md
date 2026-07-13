# Mynx

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#系统要求)
[![macOS](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-000000.svg)](#系统要求)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131.svg)](https://tauri.app/)

Tauri 2 + React 18 + TypeScript + Rust 构建的桌面工具，处理 qPCR 数据和 TIFF 图片转换。

## 功能

### qPCR 分析
- 读取仪器导出的 Excel，自动识别 Target/Sample/Ct 列
- 转换数据格式，计算相对表达量（RE = 2^-(Ct_target - Ct_ref)）
- 每个基因自动生成柱状图（带误差棒），直接嵌入 Excel sheet
- 支持缺失值标记、多基因归一化到同一内参

### TIFF 转 JPG
- 批量转换 TIFF 到 JPG，支持单页/多页
- 可加文件名水印（字体、字号、粗体/斜体、背景透明度可调）
- JPG 压缩质量可选
- 实时进度显示

### 界面
- 侧边栏导航，深色/浅色主题
- 拖拽导入文件或文件夹

## 安装

从 [Releases](https://github.com/hanhan124/mynx/releases) 下载对应平台的安装包：

| 平台 | 下载文件 | 安装方式 |
|---|---|---|
| Windows 10/11 64-bit | `mynx-installer.exe` | 双击运行安装器 |
| macOS Apple Silicon | `Mynx_*.dmg` | 打开 DMG 后拖拽到 Applications |

> 当前 macOS 版本面向 Apple Silicon（M1/M2/M3/M4）。暂不提供 Intel Mac / Universal 版本。

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
