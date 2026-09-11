# Mynx 发版指南

适用于 Windows 安装器和 macOS Apple Silicon 安装包。当前版本：**2.3.6**。

## 1. GitHub 上传边界

### 应上传到 GitHub 仓库

以下内容是源码、构建配置或 CI 必需文件：

- `src/`、`public/`、`src-tauri/`、`installer/` 源码与配置
- `scripts/`
- `package.json`、`package-lock.json`
- `installer/package.json`、`installer/package-lock.json`
- `src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`
- `installer/src-tauri/Cargo.toml`、`installer/src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`、`installer/src-tauri/tauri.conf.json`
- `.github/workflows/release.yml`
- `CHANGELOG.md`、`README.md`、`RELEASE_GUIDE.md`、`LICENSE`

### 不要提交到 GitHub 仓库

| 文件或目录 | 原因 |
|---|---|
| `node_modules/`、`installer/node_modules/` | npm 依赖，可由 lock 文件恢复 |
| `dist/`、`installer/dist/` | 前端构建产物 |
| `src-tauri/target/`、`installer/src-tauri/target/`、`target/` | Rust/Tauri 构建产物 |
| `src-tauri/gen/`、`.cargo/` | Tauri/Rust 本地生成文件 |
| `release-installer/` | 本地安装器输出 |
| `installer/src-tauri/resources/mynx.exe` | CI 构建时由 `npm run installer:payload` 生成 |
| `*.key`、`*.key.pub`、`.env`、`.env.local` | 签名密钥和环境变量，禁止公开 |
| `docs/` | 内部文档和计划 |
| `.claude/`、`.workbuddy/`、`.zcode/`、`.mimosa/` | 本地工具数据 |
| `.visual-output*/`、`tmp-icons/`、`tmp-tools/` | 临时检查和生成文件 |
| 已废弃的 `scripts/build-portable.cjs`、`scripts/build-singlefile.cjs` | 不再使用的便携版构建脚本 |

检查忽略规则：

```bash
git status --short --ignored
git check-ignore -v <文件路径>
```

`RELEASE_GUIDE.md` 本身属于仓库文档，应保留并提交；不要再把它加入 `.gitignore`。

### GitHub Release 页面才上传的文件

这些不是仓库源码，不要手动提交到 Git：

- Windows：`mynx-installer.exe`、`mynx-installer.exe.sig`
- macOS：`*.dmg`、`*.app.tar.gz`、`*.app.tar.gz.sig`
- 自动更新清单：`latest.json`

它们由 GitHub Actions 构建并上传到 Release 页面。Tauri updater 私钥只放在 GitHub Actions Secrets：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

## 2. 版本号规则

以根目录 `package.json` 的 `version` 为唯一来源。运行同步脚本后，以下六处必须一致：

1. `package.json`
2. `src-tauri/tauri.conf.json`
3. `src-tauri/Cargo.toml`
4. `installer/package.json`
5. `installer/src-tauri/tauri.conf.json`
6. `installer/src-tauri/Cargo.toml`

锁文件也必须保持最新：

- `package-lock.json`
- `installer/package-lock.json`
- `src-tauri/Cargo.lock`
- `installer/src-tauri/Cargo.lock`

可用以下命令一次性校验版本与 R 运行时资源：

```bash
npm run version:check
npm run resources:check
```

## 3. 发版流程

### 3.1 更新版本和日志

```bash
npm version 2.3.6 --no-git-tag-version
node scripts/sync-version.cjs
```

在 `CHANGELOG.md` 顶部添加：

```markdown
## [2.3.6] - YYYY-MM-DD

### 新增 / 优化 / 修复
- ...
```

### 3.2 更新锁文件

```bash
npm install --package-lock-only
cd installer && npm install --package-lock-only && cd ..
cargo generate-lockfile --manifest-path src-tauri/Cargo.toml
cargo generate-lockfile --manifest-path installer/src-tauri/Cargo.toml
```

如果 Cargo 锁文件只发生无关依赖变化，应检查后再提交，不要盲目覆盖已有修改。

### 3.3 本地检查

```bash
npm run build
npm run lint
npm run check:release
npm run version:check
npm run resources:check
git diff --check
git status --short
```

确认没有密钥、依赖目录、构建产物或本地工具目录进入暂存区：

```bash
git diff --cached --name-only
```

### 3.4 提交、打标签并推送

```bash
git add -A
git commit -m "release: v2.3.6"
git tag -a v2.3.6 -m "release: v2.3.6"
git push origin main --follow-tags
```

也可以使用脚本完成版本提交和推送：

```bash
npm run release -- 2.3.6
```

该脚本会提交当前工作区、更新版本、创建 `v2.3.6` 标签并推送，请确认工作区内容后再运行。

## 4. GitHub Actions 构建结果

推送 `v2.3.6` 后，`.github/workflows/release.yml` 会执行：

1. 校验 tag、主应用、安装器及全部锁文件的版本一致性，并检查 R 运行时资源。
2. 在 Windows 与 macOS 上运行前端数据契约和 Rust 测试。
3. Windows 构建主程序和自建安装器，并生成签名。
4. macOS 14 构建 Apple Silicon `.dmg`、`.app.tar.gz` 和签名。
5. 从 `CHANGELOG.md` 提取 `2.3.6` 更新摘要，并生成 `latest.json` 和 GitHub Release。

Release 页面至少应有：

- `mynx-installer.exe`
- `mynx-installer.exe.sig`
- 一个 `*.dmg`
- 一个 `*.app.tar.gz`
- 一个 `*.app.tar.gz.sig`
- `latest.json`

当前 macOS 仅支持 Apple Silicon / arm64，不包含 Intel 或 Universal 版本。

## 5. 发版后检查

Actions 页面：

<https://github.com/hanhan124/mynx/actions>

确认以下 jobs 全部成功：

- `prepare-tag`
- `build (windows-latest, x86_64-pc-windows-msvc)`
- `build (macos-14, aarch64-apple-darwin)`
- `release`

下载检查：

- Windows 安装器可以启动并完成安装。
- macOS DMG 可以打开，应用可以启动。
- `latest.json` 同时包含 `windows-x86_64` 和 `darwin-aarch64`。

## 6. macOS 未签名 DMG 说明

项目目前没有 Apple Developer ID 证书和公证。CI 会向 DMG 注入 `修复损坏.command`，并进行 ad-hoc 签名。

用户从浏览器下载 DMG 后，如果 macOS 提示应用「已损坏」：

1. 在 DMG 中右键 `修复损坏.command`，选择「打开」。
2. 按脚本提示清除隔离属性并完成本机 ad-hoc 签名。
3. 再打开 `Mynx.app`。

Tauri updater 的私钥签名与 Apple Developer ID 签名不同，不能替代公证。

## 7. 同版本重新发布

如果 Release 已创建但产物有问题：

1. 在 GitHub Releases 删除失败的 Release。
2. 删除本地和远程 tag。
3. 修复并重新运行本地检查。
4. 重新创建并推送同名 tag。

```bash
git tag -d v2.3.6
git push origin :refs/tags/v2.3.6
git tag -a v2.3.6 -m "release: v2.3.6"
git push origin main --follow-tags
```
