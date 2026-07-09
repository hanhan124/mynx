# Mynx

> 科研数据工具集 · qPCR 分析 · TIFF 转 JPG

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#requirements)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131.svg)](https://tauri.app/)

一款为科研人员打造的轻量级桌面工具集,使用 **Tauri 2 + React 18 + TypeScript + Rust** 构建,涵盖 qPCR 数据分析与 TIFF 批量转 JPG 两大高频场景。

---

## ✨ 核心功能

### 🧬 qPCR 分析
- 智能解析 Excel 实验数据,自动识别样本与基因列
- 计算 ΔCt / ΔΔCt / Fold Change,一键生成发表级图表
- 支持多板合并、缺失值标记、异常值提示

### 🖼️ TIFF 转 JPG
- 批量转换 TIFF(单页/多页)到 JPG
- 支持自定义压缩质量、分辨率缩放
- 处理过程中实时进度反馈,支持大文件(数 GB)

### 🎨 现代界面
- 简洁的侧边栏导航,自定义主题色
- 玻璃拟态 / 浅色 / 深色模式
- 实时数据可视化(Chart.js + 原生 Canvas)

---

## 📥 安装

### 用户下载(推荐)
前往 [Releases](https://github.com/hanhan124/mynx/releases) 下载 **`mynx-installer.exe`**,双击安装。

> 💡 安装器由自建 Tauri 应用提供,**单文件 ~20 MB**,内嵌主程序,无需额外下载。

### 系统要求
| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 1803+ / Windows 11(64-bit) |
| 运行时 | Microsoft Edge WebView2 Runtime(Win10 1803+ / Win11 自带) |
| 权限 | 管理员权限(安装到 `Program Files` 时) |

---

## 🚀 快速开始

```powershell
# 1. 下载并运行安装器
mynx-installer.exe

# 2. 安装完成后从开始菜单或桌面启动 Mynx

# 3. 在主界面选择工具:
#    - "qPCR 分析":导入 Excel 文件 → 自动识别 → 查看结果
#    - "TIFF 转 JPG":拖入文件 → 选择输出 → 等待完成
```

---

## 🛠️ 开发

### 前置环境
- Node.js ≥ 22
- Rust ≥ 1.77(stable, MSVC toolchain)
- Windows 10/11 + Visual Studio Build Tools(C++ 工作负载)
- Inno Setup 6+ (可选,仅旧版打包脚本需要)

### 安装依赖
```bash
npm install
cd installer && npm install && cd ..
```

### 开发模式
```bash
# 主应用
npm run tauri dev

# 安装器 UI(单独调试)
npm run installer:dev
```

### 构建
```bash
# 一键出包(主应用 + 安装器)
npm run installer:build

# 产物
release-installer/mynx-installer.exe   # 唯一交付物
```

### 项目结构
```
mynx/
├── src/                # React 主应用源码
├── src-tauri/          # Rust 后端 + Tauri 配置
├── installer/          # 自建 Tauri 安装器(HTML/CSS UI + Rust 安装逻辑)
│   ├── src/            # 安装器 React UI(QQ/Apple 风格)
│   └── src-tauri/      # 安装器 Rust 逻辑(elevate/install/uninstall)
├── scripts/            # 同步版本 / 清理 / payload 同步
├── release-installer/  # 最终安装包产物(单文件)
├── .github/workflows/  # CI/CD
├── LICENSE             # MIT 许可证
└── README.md
```

---

## 📦 发布流程

```bash
# 1. 体检(本地)
npx tsc                     # 类型检查零错误
npm install                 # lockfile 一致

# 2. 升级版本
npm version 2.1.0 --no-git-tag-version
node scripts/sync-version.cjs   # 同步到所有 Cargo.toml / tauri.conf.json

# 3. 本地构建验证(强烈推荐)
npm run installer:build
# 检查 release-installer/mynx-installer.exe

# 4. 提交 + 打 tag + 推送
git add -A
git commit -m "release: v2.1.0"
git tag -a v2.1.0 -m "release: v2.1.0"
git push origin main --follow-tags

# 5. CI 自动构建并发布 Release
# https://github.com/hanhan124/mynx/actions
```

详细发布指南见 [RELEASE_GUIDE.md](./RELEASE_GUIDE.md)。

---

## 🔧 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 · TypeScript · Vite · React Router |
| 后端 | Rust · Tauri 2 |
| 数据 | ExcelJS · JSZip · 原生 Canvas / Chart.js |
| 安装器 | Tauri 自建(HTML/CSS/React + Rust + PowerShell COM + winreg) |
| CI/CD | GitHub Actions(Windows runner) |

---

## 🤝 贡献

欢迎提交 Issue 和 PR!

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交改动 (`git commit -m 'feat: add AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📄 许可证

本项目基于 **MIT 许可证** 开源 — 详见 [LICENSE](./LICENSE) 文件。

Copyright © 2024-2026 **Han**