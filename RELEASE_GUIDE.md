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
npm run release 1.9.0
```

脚本自动完成：提交改动 → 升级版本号 → 创建 commit + tag → 推送到 GitHub → 触发 CI 构建。

### 方法二：手动操作

```bash
npm run version 1.9.0
git add -A
git commit -m "release: v1.9.0"
git tag -a v1.9.0 -m "release: v1.9.0"
git push origin main
git push origin v1.9.0
```

---

## Release 产物

CI 成功后自动创建 GitHub Release：

| 文件 | 说明 |
|---|---|
| `Mynx_1.9.0_x64-setup.exe` | NSIS 安装程序 |
| `Mynx_1.9.0_x64-setup.exe.sig` | 安装程序签名 |
| `Mynx_1.9.0_portable.exe` | 便携版 |
| `Mynx_1.9.0_portable.exe.sig` | 便携版签名 |
| `latest.json` | 自动更新清单 |

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
git tag -d v1.9.0
git push origin :refs/tags/v1.9.0
git tag -a v1.9.0 -m "release: v1.9.0"
git push origin v1.9.0
```

需先在 GitHub Releases 页面手动删除旧 Release。

---

## 架构说明

```
你 (npm run release 1.9.0 → 推送 tag)
  │
  ▼
GitHub Actions (Windows runner)
  │
  ├─ npm ci
  ├─ cargo build (release)
  ├─ tauri build (NSIS + 签名)
  ├─ 复制 mynx.exe → portable + 签名
  ├─ 生成 latest.json
  │
  ▼
GitHub Release (自动创建)
  ├─ setup.exe + .sig
  ├─ portable.exe + .sig
  └─ latest.json
```

---

## 自动更新机制

- **安装版**：Tauri 内置 updater 下载 NSIS 安装包，静默安装后重启
- **便携版**：检测到新版本后右下角侧滑弹出通知，点击「更新」后应用内下载新 exe（带进度条和网速显示），下载完成后 1.5 秒自动重启替换，无需手动操作。

---

## 相关文件

| 文件 | 作用 |
|---|---|
| `.github/workflows/release.yml` | CI 构建发布流水线 |
| `scripts/sync-version.cjs` | 版本号同步脚本 |
| `scripts/release.cjs` | 一键发版脚本（version + commit + tag + push） |
| `src-tauri/tauri.conf.json` | Tauri 配置（updater pubkey、NSIS 等） |
| `src/components/UpdateNotification.tsx` | 更新检测与通知 UI |
