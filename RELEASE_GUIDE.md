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

## 推送前必检清单（避免 CI 报错）

每次推送 tag 前，在本地依次执行以下三项检查。**任何一项不过都不要推送。**

### 检查 1：TypeScript 类型检查

CI 的 build 命令是 `tsc && vite build`——先跑 `tsc` 类型检查，再跑 `vite build`。但本地开发时通常只跑 `npx vite build`，它**跳过了 `tsc`**，所以类型错误在本地不会暴露，到了 CI 才炸。

```bash
npx tsc
```

零输出 = 零错误。有任何 error 必须逐个修复后再推送。

> 常见陷阱：图标库迁移（如 Lucide → Tabler）会引入 `ForwardRefExoticComponent` 类型的组件，它不被 `ComponentType` 接受。用 `ComponentType<any>` 规避。详见坑 6。

### 检查 2：依赖锁定文件同步

CI 用 `npm ci` 安装依赖，要求 `package-lock.json` 与 `package.json` **完全一致**。如果新增或移除了依赖但没跑 `npm install`，CI 会直接报错。

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

### 坑 5：`tauri build` 不生成 NSIS `.sig` 文件

**现象**：GitHub Secret 已正确配置，便携版签名正常，但 `latest.json` 中 `signature` 为空，安装版自动更新失败提示"出错，无法更新"。

**原因**：Tauri v2 的 `tauri build` 构建 NSIS 安装包时，即使设置了 `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量，也可能不生成 `.sig` 签名文件（已知的不稳定行为）。

**解决**：在 CI workflow 中，`tauri build` 完成后用 `npx tauri signer sign` 手动对 NSIS `.exe` 签名（与便携版相同的处理方式）。

**验证方法**：发版后 curl `latest.json`，确认 `platforms.windows-x86_64.signature` 字段非空。

### 坑 4：CSP 配置与 API 协议不一致

**现象**：IP 定位接口在浏览器能访问，但 Tauri 应用里报网络错误。

**原因**：Tauri WebView 受 `tauri.conf.json` 中 CSP `connect-src` 限制，只有白名单域名才能发起请求。

**解决**：每次新增外部 API 调用，确认 CSP 中已添加对应域名。当前白名单：

```
connect-src 'self' ipc: http://ipc.localhost
  https://github.com
  https://objects.githubusercontent.com     （自动更新清单）
  https://release-assets.githubusercontent.com （自动更新下载，GitHub CDN 重定向目标）
  https://api.open-meteo.com                 （天气数据）
  https://ipwho.is                           （IP 定位策略1）
  http://ip-api.com                          （IP 定位策略2）
```

### 坑 6：本地 `vite build` 通过但 CI 的 `tsc` 报错

**现象**：本地 `npx vite build` 成功，推送到 CI 后 `npm run build`（= `tsc && vite build`）在 `tsc` 阶段报大量 TypeScript 错误。

**原因**：`vite build` 使用 esbuild 转译 TypeScript，**不做类型检查**，只去掉类型注解。而 CI 的 `npm run build` 先跑 `tsc`（完整的类型检查），再跑 `vite build`。所以类型错误在本地不可见，只在 CI 暴露。

**典型场景**：更换图标库后，新库的组件类型（如 Tabler 的 `ForwardRefExoticComponent`）与项目自定义的 `IconType`（`ComponentType<...>`）不兼容。`vite build` 不检查类型所以通过，`tsc` 则报 `ForwardRefExoticComponent is not assignable to FunctionComponent`。

**解决**：

1. 本地推送前**必须**跑 `npx tsc`（不只是 `vite build`）
2. 如果类型不兼容，用 `ComponentType<any>` 放宽类型约束：

```typescript
// ❌ 太严格——ForwardRefExoticComponent 不兼容 FunctionComponent
type IconType = ComponentType<SVGProps<SVGSVGElement> & { stroke?: number | string }>;

// ✅ 用 any 绕过 propTypes 逆变问题
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconType = ComponentType<any>;
```

3. 根本原因：React 的 `ComponentType` = `ComponentClass | FunctionComponent`，而 `forwardRef` 返回的 `ForwardRefExoticComponent` 继承自 `ExoticComponent`，两者是不同的类型层级。`any` 参数能让 TypeScript 跳过 `propTypes` 的逆变检查。

### 坑 7：`package-lock.json` 未同步导致 CI `npm ci` 失败

**现象**：CI 的 "Install npm dependencies" 步骤报错，类似 `npm ERR! Could not resolve dependency`。

**原因**：在 `package.json` 中新增或移除了依赖（如 `lucide-react` → `@tabler/icons-react`），但没有运行 `npm install` 更新 `package-lock.json`。CI 用 `npm ci`（严格模式），要求 lock 文件与 `package.json` 完全一致。

**解决**：

```bash
# 修改 package.json 后，立即运行：
npm install

# 确认 lock 文件已更新
git diff package-lock.json

# 一起提交
git add package.json package-lock.json
git commit -m "deps: update icon library"
```

### 坑 8：从 zip 解压的工作目录与仓库版本不一致

**现象**：把改动复制到 git 仓库后推送，CI 报大量莫名错误（如 `Property 'setupUrl' does not exist on type 'UpdateInfo'`）。

**原因**：从 GitHub 下载的 release zip（如 `mynx-1.9.6.zip`）是某个版本的快照。仓库 main 分支可能已经有更新的提交（如 v1.9.7 修复了 updater 逻辑）。如果把 zip 的文件直接覆盖到仓库，会**回退掉仓库已有的改进**。

**解决**：

1. 不要盲目 `cp -r src/ repo/src/`——只复制你**实际修改过**的文件
2. 复制后检查 diff：`git diff --stat`，确认没有意外回退
3. 如果 diff 显示大量你未修改的文件有变化（只有行尾差异），用 `git checkout -- <file>` 还原

```bash
# 只复制你改过的文件
cp mynx-1.9.6/src/components/Sidebar.tsx repo/src/components/Sidebar.tsx
cp mynx-1.9.6/src/styles/*.css repo/src/styles/

# 检查——只应看到你改过的文件
git diff --stat

# 如果有意外的文件变化（行尾差异等），还原它们
git checkout -- src/App.tsx src/main.tsx src/lib/updater.ts
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

---

## AI 自动修复循环（让 AI 帮你改到 CI 通过）

如果不想手动排查 CI 错误，把以下提示词**完整复制**发给 AI 助手（QoderWork / Cursor / Claude Code 等），它会自动循环"检查 CI → 读错误 → 修代码 → 本地验证 → 重新推送"直到构建成功。

### 前提

- 仓库已 clone 到本地，且在 main 分支上
- 已推送过 tag（如 `v1.9.7`），CI 已触发
- 本地已安装依赖（`npm install`）

### 提示词

```
我刚向 GitHub 仓库 hanhan124/mynx 推送了 tag vX.Y.Z，CI 正在跑。
请帮我监控构建状态，如果失败则读取错误日志、修复代码、本地验证后重新推送，循环直到构建成功。

仓库本地路径：<填写你的仓库路径，如 C:/Users/HAN/Downloads/mynx-repo>

每次循环执行以下步骤：

1. 检查 CI 状态：
   curl -s "https://api.github.com/repos/hanhan124/mynx/actions/runs?per_page=1" | python -c "import json,sys; d=json.load(sys.stdin); r=d['workflow_runs'][0]; print(f'Run {r[\"id\"]} | {r[\"status\"]} | {r.get(\"conclusion\") or \"running\"}')"

2. 如果 status 是 in_progress，等待 60 秒后回到步骤 1。

3. 如果 conclusion 是 success，结束——构建已通过。

4. 如果 conclusion 是 failure，获取失败步骤：
   curl -s "https://api.github.com/repos/hanhan124/mynx/actions/runs/<RUN_ID>/jobs" | python -c "
   import json,sys
   d=json.load(sys.stdin)
   for job in d.get('jobs',[]):
       for step in job.get('steps',[]):
           if step.get('conclusion')=='failure':
               print(f'FAILED: {step[\"number\"]}. {step[\"name\"]}')
   "

5. 获取构建日志（替换 RUN_ID 和 JOB_ID）：
   curl -s "https://api.github.com/repos/hanhan124/mynx/actions/jobs/<JOB_ID>/logs" | tail -100

6. 分析错误，修复代码。

7. 本地验证（三项全过才能推送）：
   npx tsc              # TypeScript 类型检查
   npx vite build       # 前端构建
   # 如果改了 package.json：
   npm install          # 同步 lock 文件

8. 提交并重新推送：
   cd <仓库路径>
   git add -A
   git commit -m "fix: resolve CI build errors"
   git tag -d vX.Y.Z
   git push origin :refs/tags/vX.Y.Z
   git tag -a vX.Y.Z -m "release: vX.Y.Z"
   git push origin main --follow-tags

9. 回到步骤 1。

注意：
- 把 vX.Y.Z 替换为实际版本号
- 如果同一版本重复推送超过 3 次仍失败，停下来告诉我具体错误
- 常见错误：tsc 类型不兼容（用 ComponentType<any>）、package-lock.json 未同步（跑 npm install）、旧版代码覆盖了新版改进（只复制实际修改的文件）
```

### 流程图

```
推送 tag → CI 触发
               │
        ┌──────┴──────┐
        │ in_progress  │ ──→ 等待 60s ──→ 重新检查
        └──────┬──────┘
               │
        ┌──────┴──────┐
        │  success?   │ ──→ ✅ 完成
        └──────┬──────┘
               │ failure
               ▼
     读错误日志 → 修代码
               │
     npx tsc + vite build （本地验证）
               │
     删旧 tag → 提交 → 重新打 tag → 推送
               │
         回到检查 CI ──→ 循环
```
