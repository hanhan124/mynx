# Mynx 发版与自动更新教程

---

## 一、GitHub Actions 自动发版（推荐）

### 工作流程

```
git tag v1.8.0
git push origin v1.8.0
    ↓
GitHub Actions 自动：
  拉取代码 → 安装 Node/Rust → 编译 → 签名 → 生成 latest.json → 创建 Release
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
git push --set-upstream origin master
```

workflow 文件 `.github/workflows/release.yml` 已存在于项目中，推送后 GitHub 自动识别。

### 日常发版

```bash
git add -A
git commit -m "feat: 你的改动"
git tag v1.8.0
git push origin v1.8.0
```

GitHub Actions 自动完成构建和发布。打开 https://github.com/hanhan124/mynx/actions 查看进度。

---

## 二、本地发版（备用）

如果 GitHub Actions 不可用，在本地发版。

### 环境准备

```powershell
# 安装 GitHub CLI（只需一次）
winget install GitHub.cli
gh auth login

# 设置签名环境变量（每次发版前）
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "C:\Users\HAN\Desktop\mynx-tauri\mynx.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "mynx_dev_key"
```

### 发版

```bash
npm run release 1.8.0
```

---

## 三、自动更新原理

用户打开 Mynx，应用在后台请求：

```
https://github.com/hanhan124/mynx/releases/latest/download/latest.json
```

GitHub 把 `latest` 重定向到最新 Release 的 latest.json。如果 `version` 大于用户当前版本，右下角弹出更新提示，用户点击后下载、安装、重启。

**版本判断：**

| 用户版本 | latest.json 版本 | 结果 |
|---------|----------------|------|
| 1.7.0 | 1.8.0 | 发现新版本，提示更新 |
| 1.8.0 | 1.8.0 | 版本相同，无提示 |
| 1.9.0 | 1.8.0 | 降级被阻止，无提示 |

---

## 四、每个 Release 需要包含的文件

```
Release v1.8.0
├── Mynx_1.8.0_x64-setup.exe     ← 安装程序
├── Mynx_1.8.0_x64-setup.exe.sig ← 签名文件
└── latest.json                    ← 更新清单
```

三个文件缺一不可，否则自动更新无法工作。

---

## 五、私钥安全

签名私钥（`mynx.key`）是安全关键：

- **不要**提交到 GitHub（已通过 `.gitignore` 忽略）
- 私钥内容只存在 GitHub Secrets 里，不打印、不日志
- 如果泄露，立即重新生成密钥对并更新 Secrets

---

## 六、常见问题

**GitHub Actions 报签名失败？**

检查 Secrets 里 `TAURI_SIGNING_PRIVATE_KEY` 是否包含完整内容。必须是 `-----BEGIN RSA PRIVATE KEY-----` 开头、`-----END RSA PRIVATE KEY-----` 结尾的整段文本。

**latest.json 404？**

确认三个文件都上传到了同一个 Release。检查 latest.json 里的 `url` 是否指向正确的 exe 文件路径。

**想先测试不发正式版？**

打预发布 tag：
```bash
git tag v1.8.0-beta.1
git push origin v1.8.0-beta.1
```
