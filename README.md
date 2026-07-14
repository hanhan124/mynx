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
