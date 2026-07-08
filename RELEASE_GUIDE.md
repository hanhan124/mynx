# Mynx 发版完全指南（零失败的 GitHub Actions Release 流程）

> 目标：每次发版，按下面流程一步步走，**绝不会让 CI 失败**。
> 核心：本地 3 项检查全过 → 打 tag → 推送 → CI 自动构建并发布 Release。

---

## 一、整体机制（理解了就不会犯错）

### 1.1 触发链路

```
git push tag v2.0.5
        │
        ▼
GitHub Actions: .github/workflows/release.yml
        │
        ▼
windows-latest runner:
  checkout → 装 Node 22 → 装 Rust → 装 VS linker → 缓存 Rust 依赖 →
  npm ci → npm run tauri build → 签名 → 上传 Release 资源
        │
        ▼
GitHub Release 页面自动出现：
  Mynx_2.0.5_x64-setup.exe      ← NSIS 安装程序
  Mynx_2.0.5_x64-setup.exe.sig ← 签名（自动更新校验用）
  latest.json                   ← 自动更新清单
```

**关键事实：**
- 只有打 **`v` 开头的 tag** 推送到远程才会触发 CI。普通提交到 `main` 不触发。
- CI 只跑 **windows-latest**，只生成 **NSIS 安装程序**（无 macOS DMG、无 Linux 包）。
- tag 名格式必须是 `vX.Y.Z`，例如 `v2.0.5`（不是 `2.0.5`、不是 `V2.0.5`）。

### 1.2 版本号三文件同步

版本号同时写在三个地方，**必须始终一致**：

| 文件 | 字段 | 谁写它 |
|------|------|--------|
| `package.json` | `version` | `npm version` 命令 |
| `src-tauri/tauri.conf.json` | `version` | `scripts/sync-version.cjs` |
| `src-tauri/Cargo.toml` | `[package] version` | `scripts/sync-version.cjs` |

`sync-version.cjs` 从 `package.json` 取版本号，再写到另外两个文件。
所以**永远只在 `package.json` 里改版本号**，不要直接编辑 `tauri.conf.json` / `Cargo.toml` 的 version 字段。

### 1.3 一键发版脚本做了什么

`npm run release 2.0.5` 等价于依次执行：

```
① git add -A                              暂存全部改动
② git commit "chore: pre-release changes"  如果有改动，先提交一个
③ npm version 2.0.5 --no-git-tag-version   改 package.json（不自动 tag）
④ node scripts/sync-version.cjs             同步到 tauri.conf.json + Cargo.toml
⑤ git add -A && git commit "release: v2.0.5"  三文件一起提交
⑥ git tag -a v2.0.5 -m "release: v2.0.5"    创建带注释的标签
⑦ git push origin HEAD --follow-tags        推代码 + 推 tag → 触发 CI
```

---

## 二、首次发版前的准备（仅做一次）

### 2.1 配置 GitHub Secrets

仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加两个：

| Secret 名称 | 值 |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | 密钥文件 `mynx.key` 的**全部文本内容**（一长串 base64 字符串） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时设置的密码 |

> 没有密钥就生成：`npx tauri signer generate -w mynx.key`，按提示输入密码。
> 生成的 `.key.pub` 公钥已经预先配置在 `tauri.conf.json` 的 `plugins.updater.pubkey` 里，不用再动。

### 2.2 确认权限

仓库 **Settings → Actions → General → Workflow permissions**，必须选 **Read and write permissions**，否则 Release 创建步骤会因 token 权限不足而失败。

### 2.3 确认默认分支

默认分支是 `main`。CI 不能在其它分支跑触发（release.yml 的触发条件就是 tag 推送，但代码必须在 `main` 上）。

---

## 三、日常发版流程

### 方法 A：一键脚本（推荐，最不易错）

```bash
npm run release 2.0.5
```

先看下一节"推送前必检清单"再决定跑不跑。

### 方法 B：手动操作（如果你想更可控）

```bash
# 1. 改版本号
npm version 2.0.5 --no-git-tag-version
node scripts/sync-version.cjs

# 2. 确认三文件版本号一致（见 4.3 检查 3）
node -e "console.log(require('./package.json').version)"
node -e "console.log(require('./src-tauri/tauri.conf.json').version)"
grep '^version' src-tauri/Cargo.toml

# 3. 提交 + 打 tag + 推送
git add -A
git commit -m "release: v2.0.5"
git tag -a v2.0.5 -m "release: v2.0.5"
git push origin main --follow-tags
```

---

## 四、推送前必检清单（**任何一项不过都不要推送 tag**）

每次推送 tag 前，在工作区依次执行这三项。三项全过才推送。

### 检查 1：TypeScript 类型检查零错误

```bash
npx tsc
```

**判定：** 零输出 = 零错误。有任何 `error TSxxxx` 都必须逐个修掉再推。

> CI 里的 `npm run tauri build` 会先跑 `npm run build = tsc && vite build`，tsc 在本地不过、CI 也必然不过。本地秒级反馈、CI 要 10 多分钟才发现，差距很大。

### 检查 2：依赖锁定文件同步

```bash
npm install         # 同步 package-lock.json
git diff package-lock.json
```

**判定：** 如果你最近 `npm install <pkg>` 加过依赖，`package-lock.json` 必须有变化并已暂存。CI 跑 `npm ci`（严格按 lock 文件装），lock 与 `package.json` 不一致就直接挂掉。

### 检查 3：版本号三文件一致

```bash
node -e "console.log(require('./package.json').version)"
node -e "console.log(require('./src-tauri/tauri.conf.json').version)"
grep '^version' src-tauri/Cargo.toml
```

**判定：** 三个输出必须完全相同（都是 `2.0.5`）。

不一致时跑：

```bash
node scripts/sync-version.cjs
```

它会用 `package.json` 的版本号覆盖另外两个文件，让它们重新对齐。

### 检查 4（可选但推荐）：本地构建一次

```bash
npm run tauri build
```

完全模拟 CI 做的事，本地过 CI 基本就过。耗时 5–10 分钟，但能在本地立刻看到错误信息，比等 CI 强很多。

产物位置：`src-tauri/target/release/bundle/nsis/Mynx_2.0.5_x64-setup.exe`

---

## 五、推送后：监控 CI 状态

```bash
# 浏览器打开
https://github.com/hanhan124/mynx/actions
```

- 黄色转圈：正在构建，约 10–15 分钟。
- 绿色 ✓：成功，进 Releases 页面看产物。
- 红色 ✗：失败，展开失败的 step 看日志。

CI 成功后，**GitHub Releases 页面** 会出现：
- `Mynx_2.0.5_x64-setup.exe`
- `Mynx_2.0.5_x64-setup.exe.sig`
- `latest.json`

应用启动后会通过 `latest.json` 检测新版本并提示用户升级。

---

## 六、如果失败了：重新发同一版本

**先在 GitHub Releases 页面手动删除旧的 Release**（如果已创建），然后：

```bash
# 1. 删除本地和远程 tag
git tag -d v2.0.5
git push origin :refs/tags/v2.0.5

# 2. 修正问题（改代码、修 tsc 错误、修版本号等）
#    ...改完之后
npx tsc          # 重新确认 tsc 通过

# 3. 把修正提交掉（amend 旧 commit 或新建 commit 都行）
git add -A
git commit --amend --no-edit     # 或者 git commit -m "fix: ..."
# 注意：如果用 amend，且远程 main 已经走过这个 tag commit，后续推 main 需要 --force

# 4. 重新打 tag 并推送
git tag -a v2.0.5 -m "release: v2.0.5"
git push origin main --force-with-lease   # --force-with-lease 比 --force 安全
git push origin v2.0.5
```

> **关键提醒：** `--force-with-lease` 比 `--force` 安全（如果远程被别人推过会被拒）。`main` 分支只你自己用就行，多人协作时不要 force push main。

---

## 七、常见失败原因（按出现频率排序）+ 修复

### 7.1 `error TSxxxx` —— tsc 类型错误

**症状：** CI 步骤 `Build (NSIS installer)` 在 `tsc && vite build` 阶段挂掉。

**修复：**
```bash
npx tsc            # 本地复现
# 看 error 文件名:行号，逐个修
```

最常见的触发：
- 改了某个函数签名，调用方没更新
- 删了某个 export，别处还在 import
- 引入了新依赖但忘了 `npm install`（虽然这本身是 lock 问题）

### 7.2 `npm ci` 失败 —— `package-lock.json` 与 `package.json` 不同步

**症状：** CI 步骤 `Install npm dependencies` 失败，错误信息包含 `npm ci` / `lock` / `package-lock`。

**修复：**
```bash
rm -rf node_modules          # 干净起手
npm install                   # 重新生成 lock
git add package.json package-lock.json
git commit -m "chore: sync lock"
```

### 7.3 `failed to decode base64 secret key`

**症状：** 签名步骤报错 `failed to decode base64 secret key`。

**修复：** `TAURI_SIGNING_PRIVATE_KEY` Secret 的值填错了。应该填 `mynx.key` 这个文件**的全部内容**（一长串 base64 字符串），**不是文件路径**。粉末空格、引号、换行都不能有。

### 7.4 tag 推送后 Actions 没触发

**症状：** `git push origin v2.0.5` 推上去了，但 Actions 页面空空如也。

**排查清单：**
1. tag 是否以 `v` 开头？(`v2.0.5` ✓，`2.0.5` ✗)
2. `release.yml` 是否在 `main` 分支上？（在其它分支上改不会被触发条件读到）
3. tag 是否真的推出了？`git ls-remote --tags origin | grep v2.0.5`
4. workflow 文件 push 后是否已生效？（在该 tag 时点的 main 上）

### 7.5 Rust 编译失败：`error: linker 'link.exe' not found`

**症状：** CI 步骤 `Setup Visual Studio` 后或 `Build` 步骤报 linker 错误。

> 这理论上不该出现（workflow 已经配了 `ilammy/msvc-dev-cmd`），但如果你本地报这个错：装 Visual Studio Build Tools，勾选 "Desktop development with C++"。

CI 上不会出这个错，因为 workflow 配置完整。

### 7.6 CI 超时 / OOM 杀进程

**症状：** 构建在 ~90s 左右突然失败，日志没有明确报错。

**根因：** Rust release 编译极高内存占用，GitHub-hosted Windows runner 7GB 内存放不下，被 OS 杀掉。

**修复（已应用）：** `src-tauri/Cargo.toml` 不写 `[profile.release]`（让 Rust 用默认配置，避免出现额外的 LTO/codegen-units=1 这种吃内存选项）。

如果再次出现，可以做：
- 增加分页文件（CI runner 默认有，但 LTO 会爆）
- 让某些大依赖只开一个 codegen-unit

---

## 八、相关文件速查

| 文件 | 作用 |
|---|---|
| `.github/workflows/release.yml` | CI 构建发布流水线（Windows NSIS） |
| `scripts/release.cjs` | 一键发版脚本（commit → version → sync → tag → push） |
| `scripts/sync-version.cjs` | 版本号同步脚本（package.json → tauri.conf.json + Cargo.toml） |
| `scripts/gen-installer-images.cjs` | 生成 NSIS 安装界面 BMP 图（header/sidebar/installer-logo）|
| `src-tauri/tauri.conf.json` | Tauri 配置（版本、updater pubkey、NSIS 安装样式、CSP） |
| `src-tauri/Cargo.toml` | Rust 依赖清单和版本号 |
| `src-tauri/src/lib.rs` | Rust 命令（app_exe_path, is_portable, cleanup_update_bak） |
| `src/lib/updater.ts` | 自动更新检测逻辑 |
| `src/components/UpdateNotification.tsx` | 更新通知 UI |
| `src/components/AboutModal.tsx` | 关于对话框（含手动检查更新按钮） |

---

## 九、一个真实可复制的发版工作流（手把手）

假设你刚改完一个 bug 想发 `v2.0.5`：

```bash
# ＝＝ 第 0 步：在 main 分支 ＝＝
git checkout main
git pull origin main

# ＝＝ 第 1 步：跑推送前必检 ＝＝
npx tsc                                      # ① 零 tsc 错误
npm install && git diff package-lock.json    # ② lock 一致

# ＝＝ 第 2 步：改版本号并同步 ＝＝
npm version 2.0.5 --no-git-tag-version
node scripts/sync-version.cjs

# ＝＝ 第 3 步：复核三文件版本号一致 ＝＝
node -e "console.log(require('./package.json').version)"
node -e "console.log(require('./src-tauri/tauri.conf.json').version)"
grep '^version' src-tauri/Cargo.toml
# 三个都应该是 2.0.5

# ＝＝ 第 4 步：本地构建验证（强烈推荐）＝＝
npm run tauri build
# 看到 Finished 另起一行没有红色错误，去 src-tauri/target/release/bundle/nsis/ 双击安装包测一下

# ＝＝ 第 5 步：提交、打 tag、推送 ＝＝
git add -A
git commit -m "release: v2.0.5"
git tag -a v2.0.5 -m "release: v2.0.5"
git push origin main --follow-tags

# ＝＝ 第 6 步：盯 CI ＝＝
# 浏览器开 https://github.com/hanhan124/mynx/actions
# 绿勾 → 完成。红叉 → 进 Actions 看日志，按第七节修。
```

---

## 十、一句话总结

> **本地 tsc 过 + lock 一致 + 三文件版本号一致 + tag 是 vX.Y.Z 格式**，CI 99% 会过。
> 不放心就再加一步本地 `npm run tauri build`，本地过 CI 基本就过。
