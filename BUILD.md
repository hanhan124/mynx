# Mynx 构建与发版教程

---

## 一、发版方式

**推荐：GitHub Actions（推送 tag 自动发版）**

改完代码 → 打 tag 推送 → GitHub 自动构建、签名、发布

本地不需要装任何工具。详见下方配置步骤。

---

## 二、日常开发循环

```bash
# 开发调试（热重载）
npm run tauri dev

# 改完代码，构建便携版自测
npm run portable
```

---

## 三、GitHub Actions 自动发版

### 第一次配置（只需做一次）

**第一步：添加 GitHub Secrets**

1. 打开 https://github.com/hanhan124/mynx/settings/secrets/actions
2. 点「New repository secret」，添加两个：

| Name | Secret |
|------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | `mynx.key` 文件的**全部内容**（-----BEGIN 开头到 -----END 结尾，整段复制） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `mynx_dev_key` |

**第二步：推送代码**

```powershell
git add -A
git commit -m "ci: add GitHub Actions release workflow"
git push --set-upstream origin master
```

**第三步：打 tag 发版**

```powershell
git tag v1.8.0
git push origin v1.8.0
```

打开 https://github.com/hanhan124/mynx/actions 查看构建进度。

---

## 四、备用：本地构建

如果不想用 GitHub Actions，可以在本地构建。

### 构建便携版

```bash
npm run portable
```

产物：`src-tauri/target/release/mynx.exe`，双击即可运行。

### 环境要求

| 工具 | 说明 |
|------|------|
| Node.js 18+ | 前端构建 |
| Rust 1.75+ | 后端编译 |
| Windows 10/11 | 目标平台 |

缺 Rust 去 https://rustup.rs 下载安装。

---

## 五、常见问题

**Q: GitHub Actions 报签名失败？**

检查 Secrets 里 `TAURI_SIGNING_PRIVATE_KEY` 是否包含完整内容（必须是 `-----BEGIN RSA PRIVATE KEY-----` 开头、`-----END RSA PRIVATE KEY-----` 结尾的整段文本，不能有多余空格或换行）。

**Q: 本地 `npm run portable` 报拒绝访问？**

Windows Defender 拦截了新编译的 exe。管理员 PowerShell 运行：

```powershell
Add-MpPreference -ExclusionPath "C:\Users\HAN\Desktop\mynx-tauri"
Add-MpPreference -ExclusionPath "C:\Users\HAN\.cargo"
```

**Q: `latest.json` 没有生成？**

签名成功后才会有 latest.json。没有签名时 exe 可以正常运行，但自动更新功能不可用。

**Q: 想测试 workflow 先不发正式版？**

打预发布 tag：
```powershell
git tag v1.8.0-beta.1
git push origin v1.8.0-beta.1
```
