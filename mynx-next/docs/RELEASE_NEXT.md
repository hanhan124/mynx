# RELEASE_NEXT — Mynx 3.x 发布流程

> 根级 `npm run dev/build/test/lint/test:rust` 已切换到 `mynx-next/`；
> legacy 入口保留为 `npm run legacy:*`。R/图表契约验证（test:r:engine、
> charts:* 系列）继续验证共享的 R 资源（两套应用使用同一份 r/ 副本）。

## 开发与验证

```text
npm run dev            # mynx-next Vite dev server (端口 1421)
npm run build          # mynx-next 前端构建
npm run typecheck      # svelte-check
npm run lint           # ESLint (Svelte 5)
npm test               # vitest
npm run test:rust      # cargo test --locked (mynx-next workspace)
npm run branding:check # app / installer / Windows bundle logo parity
npm run test:r:engine  # rnaseq_engine.R 契约冒烟（共享 R 资源）
npm run charts:check   # 图表 schema/清单检查（共享资源）
npm run check:release # 版本、资源、前端、Rust 与主应用 Release 构建
```

性能、启动测量口径和安装体积基线见
[PERFORMANCE_BASELINE.md](./PERFORMANCE_BASELINE.md)。

Windows 安装器开发预览使用端口 1422，可与主应用的 1421 并行运行。

## Tauri 构建

```text
npm run tauri dev      # 开发模式（mynx-next/src-tauri）
npm run tauri --prefix mynx-next -- build    # 打包
```

mynx-next/src-tauri/tauri.conf.json 保留 legacy 相同的 identifier
(com.fanguanghan.mynx)、updater endpoint 与公钥、图标、macOS 最低版本、
`r/` 资源打包；CSP 在 legacy 基础上为 img-src 增加 blob:（为 qPCR worker
走 asset 协议前的临时预览保留，可移除）。

## 安装器与发布链路

发布主应用以 `mynx-next/` 为唯一源；仓库根目录 `src/` 和 `src-tauri/`
只保留 legacy reference，不参与安装包或 macOS 发布构建。根级发布脚本和 CI
必须从 `mynx-next/src-tauri/target` 取主程序，从
`mynx-next/src-tauri/r` 取运行资源。

Windows 安装器将 `mynx-next.exe` 嵌入并安装为兼容文件名 `mynx.exe`，原有
快捷方式、升级路径、进程检测和用户配置保持不变。发布先运行
`installer:uninstaller` 构建带 `uninstaller` feature 的独立卸载程序；该变体不嵌入
主程序或 R 资源，复制到 `resources/Uninst.exe` 前会校验 Windows PE 头及 16 MiB
大小上限。随后 `installer:payload` 校验根 package 与 Tauri 版本一致、主程序复制前后
SHA-256 一致，并生成未跟踪的 `mynx-payload.json`，其中记录源码路径、版本、原始程序
大小/哈希、gzip 载荷大小/哈希以及独立卸载器大小/哈希。

安装器只压缩其内部嵌入的主程序；安装过程中会校验 gzip CRC 和解压字节数，写出与
原始 payload 相同的 `mynx.exe`，并将独立 `Uninst.exe` 与 R 资源一同暂存、提交。
安装目录占用估算由主程序、R 文件和轻量卸载程序构成，不再复制完整安装器充当卸载器。
`release-installer/mynx-installer.exe.build.json` 记录安装器及内嵌程序/卸载器版本、
来源、大小和哈希。

本地隔离构建可通过 `MYNX_RELEASE_EXE` 指定 `mynx-next/src-tauri/target/` 下的
另一个 Release EXE；同步脚本会记录实际相对来源并拒绝 target 目录以外的路径。
常规发布不设置该变量，仍固定使用 `target/release/mynx-next.exe`。

安装前的目录可写探测使用独占临时文件，不会覆盖已有用户文件。卸载程序先核对
注册安装目录与当前 `Uninst.exe` 路径；安装目录会在用户关闭卸载窗口后由隐藏清理
进程删除，只有目录清理成功后才移除注册表卸载入口。

完整 Windows 安装器构建：

```text
npm ci
npm ci --prefix mynx-next
npm run installer:build
```

`installer:build` 会按“构建 Mynx → 构建独立卸载器 → 同步并校验 payload → 构建完整安装器 →
生成发布清单”的顺序执行。CI 使用相同依赖顺序。

构建完成后核对 `release-installer/mynx-installer.exe.build.json` 中的应用来源、
版本和 SHA-256。安装器大小、实际安装占用及未完成的人工验收项以性能基线记录为准。

发布 workflow 同样先构建 `mynx-next`，再同步 payload、构建并签名安装器；
macOS `.app`、DMG 和 updater archive 也全部来自 `mynx-next/src-tauri/target`。
发布前版本核对覆盖根 package、mynx-next 与 installer；legacy 不作为交付源。
