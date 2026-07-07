# Mynx 发版指南 (Release Guide)

整个流程全自动：打 tag 推送 → GitHub Actions 自动构建、签名、创建 Release。

---

## 一次性准备（首次发版前必做）

### 配置 GitHub Secrets

打开仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加两个：

| Secret 名称 | 值 | 说明 |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | 密钥文件 `mynx.key` 的**全部文本内容**（base64 字符串） | 签名验证用 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时设置的密码 | 解密私钥用 |

> 如何生成密钥：`npx tauri signer generate -w mynx.key`，按提示输入密码。`.key.pub` 公钥已配置在 `tauri.conf.json`。

---

## 日常发版流程

### 方法一：一键脚本（推荐）

```bash
npm run release 1.9.20
```

脚本自动完成：

```
① git add -A + pre-release commit（如果有未提交改动）
② npm version <ver> --no-git-tag-version   （只改 package.json，不自动提交）
③ node scripts/sync-version.cjs             （同步到 tauri.conf.json + Cargo.toml）
④ git add -A + commit "release: vX.Y.Z"     （三个文件一起提交）
⑤ git tag -a vX.Y.Z                         （创建带注释的标签）
⑥ git push origin HEAD --follow-tags        （推送代码和标签）
```

### 方法二：手动操作

```bash
npm version 1.9.20 --no-git-tag-version
node scripts/sync-version.cjs
git add -A
git commit -m "release: v1.9.20"
git tag -a v1.9.20 -m "release: v1.9.20"
git push origin main --follow-tags
```

---

## 推送前必检清单（避免 CI 报错）

每次推送 tag 前，在本地依次执行以下三项检查。**任何一项不过都不要推送。**

### 检查 1：TypeScript 类型检查

```bash
npx tsc
```

零输出 = 零错误。有任何 error 必须逐个修复后再推送。

### 检查 2：依赖锁定文件同步

```bash
npm install          # 同步 lock 文件
git diff package-lock.json   # 确认有改动（如果有新依赖）
```

### 检查 3：版本号三文件一致

```bash
node -e "console.log(require('./package.json').version)"
node -e "console.log(require('./src-tauri/tauri.conf.json').version)"
grep '^version' src-tauri/Cargo.toml
```

三个输出必须相同。不一致时运行 `node scripts/sync-version.cjs`。

---

## Release 产物

CI 成功后自动创建 GitHub Release，包含两个并行 job：

### Windows（runner: windows-latest）

| 文件 | 说明 |
|---|---|
| `Mynx_X.Y.Z_x64-setup.exe` | NSIS 安装程序 |
| `Mynx_X.Y.Z_x64-setup.exe.sig` | 安装程序签名（Tauri updater 校验用） |
| `latest.json` | 自动更新清单（包含 Windows 平台签名） |

### macOS（runner: macos-latest, Apple Silicon）

| 文件 | 说明 |
|---|---|
| `Mynx_X.Y.Z_aarch64.dmg` | DMG 安装包 |

> macOS 使用 ad-hoc 签名（`signing.identity: "-"`），用户安装时需要 **右键→打开** 绕过门禁。如需正式签名，配置 `APPLE_*` 系列 Secrets。

---

## 自动更新流程

```
启动 → 2 秒后自动检查 latest.json
         │
    Tauri updater 检查签名
         │
    ┌────┴────┐
    │ 有新版本? │──否→ 静默忽略
    └────┬────┘
         是
         ▼
    显示通知 → 用户点击"立即更新"
         │
    downloadAndInstall() (带进度条)
         │
    安装完成 → relaunch()
```

### 关键配置

- `tauri.conf.json` → `plugins.updater` 配置了 `endpoints` 和 `pubkey`
- macOS 更新暂未配置（DMG 签名需要苹果开发者证书），后续可通过 `plugins.updater` 的 `platforms` 添加

---

## 监控构建状态

推送 tag 后打开 https://github.com/hanhan124/mynx/actions 查看进度。构建约需 10-15 分钟。

---

## 故障排查

### 构建失败？

进入 Actions 页面，点击失败的 run，展开步骤查看日志。

### `failed to decode base64 secret key`

`TAURI_SIGNING_PRIVATE_KEY` 填错了。应填密钥内容（base64 字符串），不是文件路径。

### tag 推送后没触发 Actions

确认 tag 以 `v` 开头，且 workflow 文件在 `main` 分支上。

### 重新发布同一版本

```bash
# 先在 GitHub Releases 页面手动删除旧 Release

# 删除本地和远程 tag
git tag -d v1.9.20
git push origin :refs/tags/v1.9.20

# 修正提交后重新打 tag
git add -A
git commit --amend --no-edit          # 或新建 commit
git tag -a v1.9.20 -m "release: v1.9.20"

# 推送
git push origin main --force
git push origin v1.9.20
```

> **注意**：如果 `main` 上已有新 commit 且你 amend 了旧的 tag commit，需要 `--force` 推送 main。确保远程没有其他人基于旧的 main 进行开发。

---

## 相关文件

| 文件 | 作用 |
|---|---|
| `.github/workflows/release.yml` | CI 构建发布流水线（Win + Mac 并行） |
| `scripts/sync-version.cjs` | 版本号同步脚本（package.json → tauri.conf.json + Cargo.toml） |
| `scripts/release.cjs` | 一键发版脚本（commit → version → sync → tag → push） |
| `src-tauri/tauri.conf.json` | Tauri 配置（updater pubkey、NSIS、DMG、CSP 等） |
| `src-tauri/Cargo.toml` | Rust 依赖和版本号 |
| `src-tauri/src/lib.rs` | Rust 命令（app_exe_path, is_portable, cleanup_update_bak） |
| `src/lib/updater.ts` | 更新检测逻辑 |
| `src/components/UpdateNotification.tsx` | 更新通知 UI |
| `src/components/AboutModal.tsx` | 关于对话框（含手动检查更新按钮） |
