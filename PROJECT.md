# Mynx 项目结构说明

本文档介绍 Mynx 项目每个文件/文件夹的作用，方便理解项目、修改代码和移植到新电脑。

---

## 目录树

```
mynx-tauri/
├── src/                        前端 React 源码
│   ├── App.tsx                 应用主入口，路由和布局
│   ├── main.tsx               React 挂载点
│   ├── components/             可复用 UI 组件
│   │   ├── Sidebar.tsx       左侧工具导航栏
│   │   ├── UpdateNotification.tsx  右下角更新通知
│   │   └── ...
│   ├── pages/                 页面/功能模块
│   │   ├── Home.tsx           首页（工具卡片展示）
│   │   ├── qpcr/              qPCR 分析工具
│   │   │   ├── QpcrPage.tsx   qPCR 主页面
│   │   │   ├── Transform.tsx  数据转换
│   │   │   ├── Calculate.tsx  相对表达量计算
│   │   │   └── FileSelect.tsx 文件选择
│   │   └── tiff/              TIFF 转 JPG 工具
│   │       └── TiffPage.tsx
│   ├── lib/                   工具模块
│   │   └── tools.tsx          工具注册表（新增工具只需改这里）
│   ├── hooks/                 React 自定义 Hooks
│   └── styles/                全局样式
│       ├── global.css         全局样式
│       └── components.css     组件样式（侧边栏、更新通知等）
│
├── src-tauri/                 Rust 后端
│   ├── src/
│   │   ├── lib.rs             Rust 命令和插件注册（核心逻辑）
│   │   └── main.rs            Rust 程序入口
│   ├── Cargo.toml             Rust 依赖声明
│   ├── Cargo.lock             Rust 依赖锁文件
│   ├── tauri.conf.json        Tauri 配置（窗口、CSP、更新端点）
│   ├── build.rs               Rust 构建脚本（几乎不需要改）
│   ├── capabilities/          权限配置
│   │   └── default.json        各插件权限列表
│   ├── icons/                 应用图标（Windows / macOS / Android / iOS）
│   │   ├── icon.ico            Windows exe 图标
│   │   ├── icon.png / .icns   macOS 图标
│   │   ├── installer-logo.bmp 安装程序 logo
│   │   ├── sidebar.bmp         NSIS 安装界面侧边图
│   │   └── header.bmp         NSIS 安装界面顶部图
│   ├── installer/              安装程序界面模板
│   │   ├── installer.nsi       自定义 NSIS 模板（WinUI3 风格）
│   │   └── original-installer.nsi  原始模板备份
│   └── gen/                    自动生成的 Tauri 内部文件（不要手动改）
│
├── scripts/                    构建自动化脚本
│   ├── sync-version.cjs        版本号同步（package.json → Cargo.toml → tauri.conf.json）
│   ├── build-portable.cjs      便携版构建（npm run portable）
│   ├── build-singlefile.cjs    单文件构建（npm run singlefile）
│   ├── release.cjs             一键发版（npm run release）
│   ├── gen-ico.cjs             从 SVG/PNG 生成 icon.ico
│   └── gen-installer-images.cjs 从 PNG 生成 NSIS 安装界面图片
│
├── public/                     静态资源（直接复制到构建产物）
│   └── icon.svg               网站 favicon
│
├── docs/                      项目文档
│   └── plans/                 过去的开发计划记录
│
├── package.json               npm 依赖和脚本命令
├── package-lock.json           npm 依赖锁（确保多人协作版本一致）
├── Cargo.lock                 Rust 依赖锁
│
├── BUILD.md                   构建教程（改代码后如何构建）
├── RELEASE.md                 发版教程（如何发布 GitHub Release）
│
├── vite.config.ts             Vite 前端构建配置
├── tsconfig.json              TypeScript 配置
├── tsconfig.node.json         Node.js 环境 TypeScript 配置
├── eslint.config.js           ESLint 代码规范配置
├── prettierrc / .prettierignore  代码格式化配置
│
├── index.html                 前端入口 HTML（Vite 挂载点）
├── mynx.key / mynx.key.pub   签名密钥对（不要上传 GitHub）
├── mynx.key.pub
│
├── .git/                     Git 仓库（历史记录）
└── .gitignore                Git 忽略配置（不提交的文件）
```

---

## 核心文件说明

### 前端（src/）

| 文件 | 作用 |
|------|------|
| `App.tsx` | 根组件：路由配置 + 侧边栏 + 更新通知 |
| `lib/tools.tsx` | **工具注册表**。所有工具在此注册，新增工具只需在这里加一行 |
| `pages/Home.tsx` | 首页：展示所有工具卡片 |
| `pages/qpcr/` | qPCR 分析工具的 4 个子页面 |
| `pages/tiff/` | TIFF 转 JPG 工具页面 |
| `components/Sidebar.tsx` | 左侧工具导航栏，工具列表从 tools.tsx 自动生成 |
| `components/UpdateNotification.tsx` | 右下角自动更新通知（检测 → 下载 → 安装 → 重启） |
| `styles/global.css` | 全局样式（CSS 变量、主题色、重置样式） |
| `styles/components.css` | 各组件样式（侧边栏、更新通知、按钮等） |

### Rust 后端（src-tauri/）

| 文件 | 作用 |
|------|------|
| `lib.rs` | Rust 核心逻辑：插件注册、VBS 脚本执行（qPCR 图表生成） |
| `tauri.conf.json` | Tauri 全局配置：窗口大小、标题、CSP 安全策略、更新端点、签名公钥 |
| `capabilities/default.json` | 各插件权限白名单（fs、dialog、shell、updater 等） |
| `installer/installer.nsi` | 安装程序界面模板（NSIS 脚本），控制安装界面外观 |
| `icons/` | 各种尺寸的应用图标，用于 exe、NSIS 安装界面、快捷方式等 |

### 构建脚本（scripts/）

| 脚本 | 作用 |
|------|------|
| `sync-version.cjs` | 构建前自动运行（prebuild hook），把 package.json 的版本号同步到 Cargo.toml 和 tauri.conf.json |
| `build-portable.cjs` | 构建便携版 exe，`npm run portable` 调用 |
| `build-singlefile.cjs` | 构建单文件版 + 准备 GitHub Release 文件，`npm run singlefile` 调用 |
| `release.cjs` | 一键发版：提交 → 升级版本 → 构建 → 签名 → 推送 → 创建 GitHub Release |
| `gen-ico.cjs` | 从 SVG/PNG 生成 Windows ico 文件 |
| `gen-installer-images.cjs` | 从 PNG 生成 NSIS 安装程序用的 BMP 图片 |

---

## 新增工具的流程

只需要修改一个文件 `src/lib/tools.tsx`，在数组里加一个对象即可。

例如新增一个「计算器」工具：

```tsx
// src/lib/tools.tsx
import { Calculator } from "lucide-react";

export const tools: Tool[] = [
  // ... 现有工具
  {
    id: "calculator",
    title: "计算器",
    description: "简单的加减乘除",
    path: "/calculator",
    accent: "#ff9500",
    icon: Calculator,
    navLabel: "计算器",
    showInSidebar: true,
  },
];
```

然后创建页面 `src/pages/calculator/CalculatorPage.tsx`，路由和导航栏会自动生成。

---

## 配置文件说明

| 文件 | 作用 |
|------|------|
| `tauri.conf.json` | 版本号、窗口配置、CSP 安全策略、自动更新端点、签名公钥 |
| `package.json` | npm 脚本命令（dev / build / portable / release 等）|
| `vite.config.ts` | Vite 开发服务器配置（端口 1420）|
| `tsconfig.json` | TypeScript 编译配置 |
| `eslint.config.js` | 代码质量检查规则 |
| `.gitignore` | 告诉 Git 忽略哪些文件（node_modules、target、*.key 等）|

---

## 移植到新电脑

克隆代码后，只需要：

```bash
# 1. 安装 npm 依赖（自动）
npm install

# 2. 安装 Rust（如果没有）
# 去 https://rustup.rs 下载安装

# 3. 放入签名密钥（如果需要发版和自动更新）
# 把 mynx.key 放到 C:\Users\用户名\.tauri\mynx.key

# 4. 开发调试
npm run tauri dev

# 5. 构建便携版
npm run portable

# 6. 发版
npm run release 1.8.0
```

---

## 文件来源说明

| 目录/文件 | 来源 | 是否需要保留 |
|-----------|------|-------------|
| `src/` | 自己写的 | ✅ 核心源码 |
| `src-tauri/src/` | 自己写的 | ✅ 核心源码 |
| `src-tauri/icons/` | 用脚本生成或下载的 | ✅ 应用图标 |
| `src-tauri/installer/` | 自己改的 | ✅ 安装界面样式 |
| `scripts/` | 自己写的 | ✅ 构建流程 |
| `package.json` | 框架自动生成 + 自己加脚本 | ✅ |
| `Cargo.toml` / `Cargo.lock` | 框架自动生成 | ✅ |
| `tauri.conf.json` | 自己配置 | ✅ |
| `mynx.key` | 自动生成 | ⚠️ 安全保管，不要上传 GitHub |
| `mynx.key.pub` | 自动生成 | ✅ 可以上传 |
| `.git/` | Git 自动管理 | ✅ 如果用 Git 的话 |
| `docs/` | 自己写的 | ✅ 开发记录 |
| `public/icon.svg` | 静态资源 | ✅ |
| `工具.svg` | Logo 原始文件 | ✅ |

---

## 不要提交到 GitHub 的文件

以下文件通过 `.gitignore` 已自动忽略：

- `node_modules/` — npm 包（通过 `npm install` 恢复）
- `src-tauri/target/` — Rust 编译缓存（重新 `cargo build` 恢复）
- `dist/` — 前端构建产物（`npm run build` 恢复）
- `*.key` — 私钥（不要泄露）
- `.env` — 环境变量
