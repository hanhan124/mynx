# Mynx 发版与自动更新教程

---

## 一、GitHub Actions 自动发版

### 工作流程

```
git tag v1.8.0
git push origin v1.8.0
    ↓
GitHub Actions 自动完成：
  拉取代码 → 安装 Node/Rust → 编译 → 签名
  → 生成 latest.json → 创建 GitHub Release
    ↓
用户打开 Mynx → 检测到新版本 → 右下角提示更新
```

### 第一次配置

**1. 添加 GitHub Secrets**

打开 https://github.com/hanhan124/mynx/settings/secrets/actions，点「New repository secret」添加两个：

| Name | Secret |
|------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | `mynx.key` 文件的**全部内容**（从 `-----BEGIN` 到 `-----END` 整段） |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `mynx_dev_key` |

**2. 推送代码和 workflow**

```bash
git add -A
git commit -m "ci: add release workflow"
git push origin main
```

### 日常发版

```bash
git add -A
git commit -m "feat: 你的改动"
git tag v1.8.0
git push origin v1.8.0
```

打开 https://github.com/hanhan124/mynx/actions 查看构建进度。

### Release 包含的文件

每个 Release 自动包含：

| 文件 | 说明 |
|------|------|
| `Mynx_x.x.x_x64-setup.exe` | NSIS 安装包 |
| `Mynx_x.x.x_x64-setup.exe.sig` | 签名文件 |
| `Mynx_x.x.x_portable.exe` | 便携版 exe（免安装，双击即用） |
| `latest.json` | 自动更新清单 |

---

## 二、本地发版（备用）

如果 GitHub Actions 不可用，在本地发版。

```powershell
# 安装 GitHub CLI（只需一次）
winget install GitHub.cli
gh auth login

# 设置签名环境变量
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "C:\Users\HAN\Desktop\mynx-tauri\mynx.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "mynx_dev_key"

# 发版
npm run release 1.8.0
```

---

## 三、自动更新原理

用户打开 Mynx，应用在后台请求：

```
https://github.com/hanhan124/mynx/releases/latest/download/latest.json
```

GitHub 把 `latest` 重定向到最新 Release 的 latest.json。如果 `version` 大于用户当前版本，右下角弹出更新提示，用户点击后下载、安装、重启。

---

## 四、私钥安全

- **不要**把 `mynx.key` 提交到 GitHub（已通过 `.gitignore` 忽略）
- 私钥内容只存在 GitHub Secrets 里
- 如果泄露，立即重新生成密钥对并更新 Secrets

---

## 五、常见问题

**GitHub Actions 报签名失败？**

检查 Secrets 里 `TAURI_SIGNING_PRIVATE_KEY` 是否包含完整内容。必须是 `-----BEGIN RSA PRIVATE KEY-----` 开头、`-----END RSA PRIVATE KEY-----` 结尾的整段。

**latest.json 404？**

确认三个文件都上传到了同一个 Release。检查 latest.json 里的 `url` 是否指向正确的 exe 文件路径。

**想先测试不发正式版？**

```bash
git tag v1.8.0-beta.1
git push origin v1.8.0-beta.1
```
