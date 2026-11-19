# Mynx 3.x 发布流程

## 开发与验证

```text
npm run dev             # Svelte + Vite（端口 1421）
npm run build           # 前端生产构建
npm run typecheck       # svelte-check
npm run lint            # ESLint
npm test                # vitest
npm run test:rust       # Rust workspace
npm run branding:check  # 主应用、安装器和 Windows 图标校验
npm run test:r:engine   # RNA-seq R 引擎契约冒烟
npm run charts:check    # 图表 schema、模板和字段映射
npm run check:release   # 版本、资源、前端、Rust 和安装器 payload 检查
```

## Tauri 构建

```text
npm run tauri dev
npm run tauri -- build
npm run tauri -- build --no-bundle
```

主应用的 Tauri workspace 位于 `src-tauri/`，配置位于
`src-tauri/tauri.conf.json`。配置保留原有 identifier、updater endpoint 与公钥、
图标、macOS 最低版本和 `r/` 资源映射。

## 安装器与发布

Windows 安装器是独立子项目。完整构建顺序如下：

```text
npm ci --legacy-peer-deps
npm run installer:build
```

主应用依赖包含 Tailwind 的可选 WASI bundle；安装时应使用 `--legacy-peer-deps`，让 npm
按现有 lockfile 安装，不重新解析 bundle 内的 peer dependencies。

`installer:build` 会构建主程序、独立卸载器、同步并校验 payload、构建安装器，最后
生成发布清单。主应用构建产物位于 `src-tauri/target/`，R 运行资源位于
`src-tauri/r/`。安装器继续将主程序安装为兼容文件名 `mynx.exe`，并将卸载器与 R
资源一起暂存。

版本以根目录 `package.json` 为准。`npm run version:check` 会检查主应用、安装器和
两套 lockfile 的版本一致性；`npm run resources:check` 会核对主应用和安装器中的 R
资源清单。

发布 workflow 从根目录构建主应用，并在 Windows 上打包安装器、在 macOS Apple
Silicon runner 上生成 `.app`、DMG 和 updater archive。签名密钥通过 GitHub Actions
Secrets 提供；本地不得提交签名凭据或发布产物。

安装器验收流程和 macOS 未签名应用说明见根目录 [RELEASE_GUIDE.md](../RELEASE_GUIDE.md)。
