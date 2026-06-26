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

### 安装界面

已移除自定义 NSIS 模板（`src-tauri/installer/installer.nsi`），改用 Tauri 内置默认安装界面。如需恢复自定义界面，需在 `tauri.conf.json` 的 `bundle.windows.nsis` 中添加 `"template": "installer/installer.nsi"`。

---

## 日常发版流程

### 方法一：一键脚本（推荐）

```bash
npm run release 1.9.5
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
npm version 1.9.5 --no-git-tag-version
node scripts/sync-version.cjs
git add -A
git commit -m "release: v1.9.5"
git tag -a v1.9.5 -m "release: v1.9.5"
git push origin main --follow-tags
```

---

## Release 产物

CI 成功后自动创建 GitHub Release：

| 文件 | 说明 |
|---|---|
| `Mynx_X.Y.Z_x64-setup.exe` | NSIS 安装程序 |
| `Mynx_X.Y.Z_x64-setup.exe.sig` | 安装程序签名 |
| `Mynx_X.Y.Z_portable.exe` | 便携版 |
| `Mynx_X.Y.Z_portable.exe.sig` | 便携版签名 |
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

**如果 CI 还在跑 / 刚失败**：

```bash
# 先在 GitHub Releases 页面手动删除旧 Release

# 删除本地和远程 tag
git tag -d v1.9.5
git push origin :refs/tags/v1.9.5

# 修正提交后重新打 tag
git add -A
git commit --amend --no-edit          # 或新建 commit
git tag -a v1.9.5 -m "release: v1.9.5"

# 推送
git push origin main --force
git push origin v1.9.5
```

> **注意**：如果 `main` 上已有新 commit 且你 amend 了旧的 tag commit，需要 `--force` 推送 main。确保远程没有其他人基于旧的 main 进行开发。

---

## 🕳️ 踩坑记录

以下是实际发版中遇到的问题和解决方案。

### 坑 1：`npm version` 只提交了 `package.json`

**现象**：运行 `npm run release 1.9.5` 后，`tauri.conf.json` 和 `Cargo.toml` 的版本号没变。

**原因**：`npm version` 自带 git 操作，但它只提交 `package.json`。`sync-version.cjs` 修改的其他两个文件不在那次 commit 里。

**解决**：已将 `release.cjs` 改为三步走：

```
npm version <ver> --no-git-tag-version   ← 抑制自动 git 操作
node scripts/sync-version.cjs            ← 手动同步其他文件
git add -A && git commit                  ← 手动提交所有文件
```

**验证方法**：执行发版后，确认三个文件的版本号一致：

```bash
node -e "console.log(require('./package.json').version)"
node -e "console.log(require('./src-tauri/tauri.conf.json').version)"
grep '^version' src-tauri/Cargo.toml
```

### 坑 2：天气 API 定位服务不可用

**现象**：天气组件始终显示"天气获取失败，点击重试"。

**原因**：

| 服务 | 问题 |
|------|------|
| `ipapi.co` | 免费层已关闭，返回 "sign up for a paid plan" |
| `ip-api.com` HTTPS | 免费层不支持 HTTPS，必须用 HTTP |

**解决**：

| 链路 | 之前 | 修复后 |
|------|------|--------|
| 策略 1 | ~~ipapi.co~~ | `ipwho.is` (HTTPS, 免费) |
| 策略 2 | ~~ip-api.com HTTPS~~ | `ip-api.com` HTTP |

**CSP 同步**：在 `tauri.conf.json` 的 `csp` 中添加 `https://ipwho.is` + `http://ip-api.com`。

### 坑 3：`\u00B0` 在 JSX 中显示为字面字符

**现象**：温度显示为 `31\u00B0雷阵雨` 而不是 `31°雷阵雨`。

**原因**：`\u00B0` 写在 JSX 纯文本里（`{}` 外面），React 不会做 JavaScript 转义。

```jsx
// ❌ JSX 文本 → 字面渲染 \u00B0
<span>{weather.temperature}\u00B0</span>

// ✅ 直接用 ° 字符 或 放在 {} 里
<span>{weather.temperature}°</span>
<span>{weather.temperature + "\u00B0"}</span>
```

**规则**：`{ }` 里 = JavaScript → 支持 `\uXXXX`。`{ }` 外 = 纯文本 → 不支持。

### 坑 4：CSP 配置与 API 协议不一致

**现象**：IP 定位接口在浏览器能访问，但 Tauri 应用里报网络错误。

**原因**：Tauri WebView 受 `tauri.conf.json` 中 CSP `connect-src` 限制，只有白名单域名才能发起请求。

**解决**：每次新增外部 API 调用，确认 CSP 中已添加对应域名。当前白名单：

```
connect-src 'self' ipc: http://ipc.localhost
  https://github.com
  https://objects.githubusercontent.com     （自动更新下载）
  https://api.open-meteo.com                 （天气数据）
  https://ipwho.is                           （IP 定位策略1）
  http://ip-api.com                          （IP 定位策略2）
```

---

## 架构说明

```
你 (npm run release 1.9.5 → 推送 tag)
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
| `scripts/sync-version.cjs` | 版本号同步脚本（package.json → tauri.conf.json + Cargo.toml） |
| `scripts/release.cjs` | 一键发版脚本（commit → version → sync → tag → push） |
| `src-tauri/tauri.conf.json` | Tauri 配置（updater pubkey、NSIS、CSP 等） |
| `src-tauri/Cargo.toml` | Rust 依赖和版本号 |
| `src/components/UpdateNotification.tsx` | 更新检测与通知 UI |
| `src/components/WeatherWidget.tsx` | 天气组件（含定位 + 天气 API 调用） |
