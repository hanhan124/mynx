# Mynx 发版指南（Windows + macOS Apple Silicon）

> 目标：每次发版同时产出 Windows 安装器和 macOS Apple Silicon 安装包，并生成可用于自动更新的 `latest.json`。

---

## 一、整体机制

### 1.1 触发链路

```text
git push tag v2.2.0
        │
        ▼
GitHub Actions: .github/workflows/release.yml
        │
        ├─ prepare-tag
        │   └─ workflow_dispatch 时只创建一次 tag，避免 matrix 并发抢 tag
        │
        ├─ windows-latest / x86_64-pc-windows-msvc
        │   ├─ npm ci
        │   ├─ npx tauri build --no-bundle
        │   ├─ npm run installer:payload
        │   ├─ cd installer && npm ci && npm run tauri:build
        │   ├─ npx tauri signer sign mynx-installer.exe
        │   └─ 上传 mynx-installer.exe + mynx-installer.exe.sig
        │
        ├─ macos-14 / aarch64-apple-darwin
        │   ├─ npm ci
        │   ├─ npx tauri build --target aarch64-apple-darwin --bundles app,dmg
        │   └─ 上传 DMG + .app.tar.gz + .app.tar.gz.sig
        │
        └─ release
            ├─ 汇总两个平台产物
            ├─ 生成 latest.json
            └─ 创建 GitHub Release
```

### 1.2 Release 页面产物

CI 成功后，GitHub Releases 页面应至少出现：

| 文件 | 用途 |
|---|---|
| `mynx-installer.exe` | Windows 自建 Tauri 安装器 |
| `mynx-installer.exe.sig` | Windows 自动更新签名 |
| `*.dmg` | macOS Apple Silicon 用户安装包 |
| `*.app.tar.gz` | macOS Tauri updater 下载包 |
| `*.app.tar.gz.sig` | macOS 自动更新签名 |
| `latest.json` | 自动更新清单，包含 `windows-x86_64` 和 `darwin-aarch64` |

当前 macOS 版本只覆盖 **Apple Silicon / arm64**，不包含 Intel Mac / Universal 版本。

### 1.3 版本号同步

版本号同时写在六个地方，必须始终一致：

| 文件 | 字段 | 谁写它 |
|------|------|--------|
| `package.json` | `version` | `npm version` 命令 |
| `src-tauri/tauri.conf.json` | `version` | `scripts/sync-version.cjs` |
| `src-tauri/Cargo.toml` | `[package] version` | `scripts/sync-version.cjs` |
| `installer/package.json` | `version` | `scripts/sync-version.cjs` |
| `installer/src-tauri/tauri.conf.json` | `version` | `scripts/sync-version.cjs` |
| `installer/src-tauri/Cargo.toml` | `[package] version` | `scripts/sync-version.cjs` |

`sync-version.cjs` 从 `package.json` 取版本号，再写到另外五个文件。发版时只直接改 `package.json` 的版本号。

---

## 二、首次发版前准备

### 2.1 GitHub Actions 权限

仓库 **Settings → Actions → General → Workflow permissions** 必须选择 **Read and write permissions**，否则 workflow 无法推 tag 或创建 Release。

### 2.2 Tauri updater 签名密钥

仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加：

| Secret 名称 | 值 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `mynx.key` 的完整私钥文本 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时设置的密码 |

没有密钥时生成：

```bash
npx tauri signer generate -w mynx.key
```

`src-tauri/tauri.conf.json` 已配置对应公钥。配置签名密钥后，CI 会把对应平台写入 `latest.json` 用于自动更新；缺少签名时仍会发布安装包，但 `latest.json` 会省略未签名的平台。

### 2.3 macOS updater 产物开关

`src-tauri/tauri.conf.json` 的 `bundle.createUpdaterArtifacts` 必须为 `true`，否则 macOS 构建只产出 `.dmg`，不会生成 `*.app.tar.gz` 和 `*.app.tar.gz.sig`，`latest.json` 就无法写入 `darwin-aarch64`。请勿删除该字段。

---

## 三、日常发版流程

### 方法 A：手动流程（推荐）

```bash
# 1. 改版本号并同步
npm version 2.2.1 --no-git-tag-version
node scripts/sync-version.cjs

# 2. 同步 lock 文件
cd src-tauri && cargo generate-lockfile && cd ..
cd installer/src-tauri && cargo generate-lockfile && cd ../..
cd installer && npm install --package-lock-only && cd ..
npm install --package-lock-only

# 3. 本地检查
git diff --stat
npm run build
npm run lint

# 4. 提交、打 tag、推送
git add -A
git commit -m "release: v2.2.1"
git tag -a v2.2.1 -m "release: v2.2.1"
git push origin main --follow-tags
```

推送 `v*` tag 后，CI 会自动同时构建 Windows 和 macOS Apple Silicon。

### 方法 B：GitHub Actions 手动触发

在 Actions 页面选择 **Build & Release** → **Run workflow**，输入 `vX.Y.Z` 格式的 tag。workflow 会在 `prepare-tag` job 中只创建一次 tag，然后启动 Windows/macOS matrix 构建。

注意：手动触发前仍需确认当前 `main` 分支上的版本号、lock 文件和代码都已提交。

---

## 四、推送前必检清单

### 检查 1：TypeScript / Vite 构建

```bash
npm run build
```

CI 的 Tauri build 会先执行前端构建。本地不过，CI 也会失败。

### 检查 2：Lint

```bash
npm run lint
```

如果 lint 失败，先修复再发版。

### 检查 3：依赖锁定文件同步

```bash
npm install --package-lock-only
cd installer && npm install --package-lock-only && cd ..
git diff --stat package-lock.json installer/package-lock.json
```

`npm ci` 严格使用 lock 文件；lock 与 package 不一致会直接失败。

### 检查 4：六文件版本号一致

```bash
node -e "console.log(require('./package.json').version)"
node -e "console.log(require('./src-tauri/tauri.conf.json').version)"
grep '^version' src-tauri/Cargo.toml
node -e "console.log(require('./installer/package.json').version)"
node -e "console.log(require('./installer/src-tauri/tauri.conf.json').version)"
grep '^version' installer/src-tauri/Cargo.toml
```

不一致时运行：

```bash
node scripts/sync-version.cjs
```

### 检查 5：Cargo.lock 版本一致

```bash
grep -A2 'name = "mynx"' src-tauri/Cargo.lock | head -2
grep -A2 'name = "mynx-installer"' installer/src-tauri/Cargo.lock | head -2
```

不一致时分别运行 `cargo generate-lockfile`。

### 检查 6：平台产物预期

- Windows 本地验证：

  ```bash
  npm run installer:build
  ```

  预期产物：`release-installer/mynx-installer.exe`

- macOS Apple Silicon 本地验证（需要 Apple Silicon Mac）：

  ```bash
  npm run mac:build
  ```

  `mac:build` 等价于 `tauri build --target aarch64-apple-darwin`，与 CI 一致。预期产物：`src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg` 以及 `bundle/macos/*.app.tar.gz` + `.sig`。tarball 的 `.sig` 只有在设置了 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量时才会生成。

在 Windows 开发机上无法本地产出 macOS DMG，最终以 `macos-14` GitHub Actions runner 为准。

---

## 五、推送后监控

打开：

```text
https://github.com/hanhan124/mynx/actions
```

必须确认以下 jobs 全部绿色：

- `prepare-tag`
- `build (windows-latest, x86_64-pc-windows-msvc)`
- `build (macos-14, aarch64-apple-darwin)`
- `release`

Release 创建后，下载并检查：

1. Windows：`mynx-installer.exe` 可启动安装。
2. macOS：`*.dmg` 可打开，拖拽安装后应用可启动。
3. `latest.json` 同时包含：
   - `windows-x86_64`
   - `darwin-aarch64`

---

## 六、失败后重新发布同一版本

如果 Release 已创建，先在 GitHub Releases 页面删除失败版本，然后：

```bash
# 1. 删除本地和远程 tag
git tag -d v2.2.1
git push origin :refs/tags/v2.2.1

# 2. 修复问题并验证
npm run build
npm run lint

# 3. 提交修复
git add -A
git commit -m "fix: release build"

# 4. 重新打 tag 并推送
git tag -a v2.2.1 -m "release: v2.2.1"
git push origin main --follow-tags
```

---

## 七、常见失败原因

### 7.1 `npm ci` 失败

通常是 `package-lock.json` 或 `installer/package-lock.json` 未同步。运行：

```bash
npm install --package-lock-only
cd installer && npm install --package-lock-only && cd ..
```

### 7.2 macOS 没有 `.app.tar.gz.sig`

通常是 `TAURI_SIGNING_PRIVATE_KEY` 或密码未配置。确认 GitHub Secrets 后重新跑 workflow。

### 7.3 workflow_dispatch tag 已存在

手动触发输入的 tag 已经存在。删除旧 tag，或换一个新版本号。

### 7.4 macOS DMG 缺失

查看 `Build macOS app` 和 `Verify macOS artifacts` 日志。常见原因是 Tauri bundle 配置错误、图标缺失或 macOS runner 构建失败。

### 7.5 Windows installer 签名失败

检查 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 是否与 `src-tauri/tauri.conf.json` 中的公钥匹配。

### 7.6 macOS step 的 `run:` 缩进错误

`release.yml` 中 `Build macOS app` 步骤的 `run:` 必须与 `shell:`、`env:` 同级（step 下一层），不能缩进到 `env:` 里面。一旦缩进错误，`run` 会被当成一个环境变量，构建命令根本不执行，macOS 不产出任何产物，`release` job 会在 `if-no-files-found: error` 处失败。改动该步骤后务必核对缩进。

### 7.7 缺少 `*.app.tar.gz` / `.sig`（非签名原因）

若签名密钥已配置但仍缺 updater 产物，检查 `src-tauri/tauri.conf.json` 的 `bundle.createUpdaterArtifacts` 是否为 `true`。为 `false` 或缺失时，Tauri 只打包 `.dmg`，不会生成 updater tarball 与签名。

### 7.8 macOS DMG 提示「已损坏，无法打开」

**根因**：当前 CI 的 macOS 构建只执行 `npx tauri build --bundles app,dmg`，**没有配置 Apple Developer ID 代码签名（codesign）和公证（notarization）**。`TAURI_SIGNING_PRIVATE_KEY` 是 Tauri updater 的签名密钥，跟 macOS Gatekeeper 验证的 Apple 代码签名是两回事。浏览器下载的未签名 DMG 会被 Gatekeeper 打上 `com.apple.quarantine` 隔离属性，显示「已损坏」。

**已实现的方案（用户侧免终端）**：CI 在 Tauri 构建 DMG 后，用 `create-dmg`（`brew install create-dmg`，即 `andreyvit/create-dmg`）重建 DMG，把 `src-tauri/scripts/fix-damaged.command` 一并放进 DMG 根目录。用户在 DMG 窗口里**右键 → 打开**该 `.command` 文件，脚本会自动执行 `xattr -cr` 清除隔离属性，并通过 `osascript` 弹出中文图形提示框引导。`.command` 同样会被 Gatekeeper 拦截，但「右键 → 打开」对所有 macOS 版本都能稳定放行，用户全程不需打开终端输命令。详见 `release.yml` 的 `Rebuild DMG with fix script` 步骤。

关键实现细节：
- `create-dmg` 必须加 `--sandbox-safe`，否则 CI 的无头 macOS runner 上 AppleScript 美化步骤会失败。
- Tauri 原生不支持往 DMG 加额外文件（官方 issue #11996 已拒绝），只能后处理重建。
- 重建只影响 `.dmg`；`.app.tar.gz` 和 `.sig` 是 `tauri build` 独立产出的，不受影响，updater 正常工作。
- `fix-damaged.command` 脚本自动定位 `/Applications/Mynx.app`，找不到时弹出提示让用户先拖到「应用程序」。

**兜底方案**：若用户右键打开 `.command` 仍失败，可在终端执行 `xattr -cr /Applications/Mynx.app`。

**永久方案（开发者侧）**：获取 Apple Developer Program 会员（$99/年）后，在 CI 的 macOS 构建步骤中添加 codesign + notarize + staple 流程。需要在 GitHub Secrets 中配置：

| Secret 名称 | 用途 |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application 证书（.p12 base64） |
| `APPLE_CERTIFICATE_PASSWORD` | 导出 .p12 时设置的密码 |
| `APPLE_ID` | Apple Developer 账号邮箱 |
| `APPLE_PASSWORD` | App-Specific Password（appleid.apple.com 生成） |
| `APPLE_TEAM_ID` | Developer Team ID |

然后在 `release.yml` 的 `Build macOS app` 步骤前导入证书到 Keychain，并在 `tauri build` 时通过环境变量 `APPLE_SIGNING_IDENTITY` 指定签名身份。详见 [Tauri macOS 签名文档](https://v2.tauri.app/distribute/macos-application/)。
