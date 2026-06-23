# Mynx

轻量级科研工具箱，集成 qPCR 数据分析与 TIFF 批量转换。

![版本](https://img.shields.io/github/v/release/hanhan124/mynx)
![平台](https://img.shields.io/badge/platform-Windows-blue)
![许可](https://img.shields.io/github/license/hanhan124/mynx)

## 功能

### qPCR 分析
- 导入 Excel 数据，自动识别 Ct 值与基因分组
- 支持 2^(-ΔΔCt) 法相对定量计算
- 生成带图表的 Excel 报告

### TIFF 批量转换
- 将 TIFF 文件批量转换为 JPG
- 可配置边距、填充、输出质量
- 支持子文件夹递归处理

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 原生层 | Rust (Tauri v2) |
| 样式 | CSS Custom Properties (无框架) |
| 图标 | lucide-react |
| 构建 | tauri-cli + NSIS 安装包 |

## 开发

```bash
# 前置依赖
# - Node.js 18+
# - Rust (MSVC toolchain on Windows)
# - Windows SDK

# 安装依赖
npm install

# 启动开发服务器
npm run tauri dev

# 构建安装包
npm run tauri build

# 代码检查 & 格式化
npm run lint
npm run format
```

## 发版流程

```bash
# 设置签名环境变量
set TAURI_SIGNING_PRIVATE_KEY_PATH=./mynx.key
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<密钥密码>

# 一键发版 (bump 版本 → build → push → GitHub Release)
npm run release 1.0.0
```

发版脚本会自动：
1. 提交当前改动
2. 同步版本号 (package.json → tauri.conf.json → Cargo.toml)
3. 构建带签名的安装包
4. 推送到 GitHub 并创建 Release

应用内置自动更新检查，连接 GitHub Release 的 `latest.json`。

## 项目结构

```
mynx-tauri/
├── src/
│   ├── components/     # 共享 UI 组件
│   ├── hooks/          # React hooks (useTheme 等)
│   ├── lib/            # 业务逻辑 (chart-gen, tiff-convert, qpcr-*)
│   ├── pages/          # 页面组件
│   │   ├── Home.tsx
│   │   ├── qpcr/       # qPCR 功能页
│   │   └── tiff/       # TIFF 转换页
│   └── styles/         # CSS (themes / layout / pages / components)
├── src-tauri/          # Rust 后端
│   ├── src/            # Rust 源码
│   ├── icons/          # 应用图标
│   └── capabilities/   # Tauri 权限配置
├── scripts/            # 工具脚本 (release)
└── public/             # 静态资源
```

## 许可证

MIT
