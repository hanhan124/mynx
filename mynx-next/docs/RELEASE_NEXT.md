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
npm run test:r:engine  # rnaseq_engine.R 契约冒烟（共享 R 资源）
npm run charts:check   # 图表 schema/清单检查（共享资源）
```

## Tauri 构建

```text
npm run tauri dev      # 开发模式（mynx-next/src-tauri）
npm run tauri build    # 打包
```

mynx-next/src-tauri/tauri.conf.json 保留 legacy 相同的 identifier
(com.fanguanghan.mynx)、updater endpoint 与公钥、图标、macOS 最低版本、
`r/` 资源打包；CSP 在 legacy 基础上为 img-src 增加 blob:（为 qPCR worker
走 asset 协议前的临时预览保留，可移除）。

## 安装器切换步骤（mynx-next 完成全部回归后执行）

当前 `installer/` 仍打包 legacy 主程序二进制（installer:build =
legacy:build + `npx tauri build --no-bundle`(src-tauri) + payload 同步）。
切换步骤：

1. `scripts/sync-installer-payload.cjs`：源目录 `src-tauri/target` →
   `mynx-next/src-tauri/target`；产物名 `mynx.exe` → `mynx-next.exe`
   （default-run = mynx-next；同步时重命名为 Mynx.exe，identifier 未变，
   升级路径保持）。
2. `scripts/check-r-resources.cjs`：rRoot 指向
   `mynx-next/src-tauri/r`，校验 mynx-next/tauri.conf.json 的 r/ 映射，
   installer 侧 generated_resources.rs 不变。
3. installer 的资源清单（generated_resources.rs）无需变更：payload 文件
   集合与 legacy 相同（LICENSE/THIRD-PARTY-NOTICES 也可同样拷入）。
4. CI（.github/workflows）release job 的 build 步骤从 legacy 切到
   `npm run tauri build`（mynx-next）后重跑 full pipeline。
5. up-to-date 检查：updater endpoint 与 pubkey 不变；新版本号通过
   `npm version`（sync-version.cjs 已覆盖 mynx-next 全部目标）。
