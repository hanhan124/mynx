# UI_SPEC_NEXT — Mynx 3.x 视觉系统与布局

> 新 UI 不复用任何旧 CSS/Mantine 规则。本文档定义可编码令牌与布局契约；
> 实现入口：`mynx-next/src/styles/app.css`（Tailwind 4 @theme 令牌）。

## 设计原则

- 以分析流程为主线的桌面应用：左侧导航 / 中央工作区 / 右侧参数检查器 /
  底部任务抽屉；每个功能页遵循 导入 → 配置 → 运行 → 结果 → 历史。
- 平面、1px 边框、无渐变、无玻璃拟态、无装饰性阴影。
- 13px 基准字号；长文本（路径/日志/基因名）一律截断 + 复制或换行。

## 品牌标记

- Mynx 标志以仓库根目录 `public/icon.svg` 为唯一视觉参照：蓝色盾牌轮廓
  `#227CFF`，内部黄色 Y 形标记 `#FFC81E`。新应用、安装器和 Tauri 包图标必须保持
  相同图形，不使用字母缩写或通用占位图标。
- 新应用网页图标和标题栏使用 `mynx-next/public/mynx.svg`；安装器组件与桌面
  包图标应与该 SVG 图形和颜色一致。

## 颜色令牌

| 令牌                   | Pearl（浅色） | Graphite（深色） |
| ---------------------- | ------------- | ---------------- |
| --color-bg             | #f5f6f8       | #16181d          |
| --color-surface        | #ffffff       | #1f2229          |
| --color-surface-2      | #eef0f3       | #262a33          |
| --color-border         | #d9dde3       | #333947          |
| --color-text           | #1a2233       | #e8eaf0          |
| --color-text-secondary | #5a6376       | #9aa2b1          |
| --color-accent         | #2f6fed       | #5c8dff          |
| --color-accent-hover   | #2758c7       | #7ba3ff          |
| --color-success        | #157f3d       | #3fb96f          |
| --color-warning        | #b45309       | #d97706          |
| --color-danger         | #b91c1c       | #ef5350          |

主题三态：`system`（跟随 prefers-color-scheme）、`graphite`、`pearl`；
legacy `dark`/`light` 值归一化到 graphite/pearl。应用方式：
`document.documentElement.dataset.theme = resolved`。

## 布局常量

- 标题栏高 40px（data-tauri-drag-region；右侧 46px 宽窗口按钮）
- 导航轨宽 56px（左置 5 个工具入口 + 底部网站外链与设置）
- 任务抽屉高 280px（底部 translateY 动画）
- 焦点：`:focus-visible` 2px accent 轮廓；禁用态降透明度；运行态用
  .mynx-badge-running
- 视口宽度 ≤520px 时标题栏隐藏可见的 Ctrl+K 键帽（快捷键和搜索按钮保留），
  任务中心与置顶按钮保持 44px 点击宽度；最小化、最大化、关闭按钮仍为 46px。

## 组件层（.mynx-\*）

`mynx-btn / -primary / -danger`、`mynx-input`、`mynx-badge-{queued,running,
success,error,cancelled}`、`mynx-card`（surface+border+r8，无阴影）、
`mynx-mono`、`mynx-truncate`、`mynx-chip`、`mynx-divider`、`mynx-link`。

## 可访问性

- 图标按钮必须有 aria-label；危险操作用 .mynx-btn-danger + 确认。
- prefers-reduced-motion 降级动画；键盘焦点环不可移除。
- 中文/英文全部走 i18n（zh/en 词典键奇偶校验由测试锁定）。

Windows 安装器沿用本规范的 Pearl/Graphite 颜色、系统字体、40px 标题栏、
46px 窗口控件、1px 边框和无渐变/装饰阴影规则；独立运行时跟随系统浅色或深色，
主程序界面是视觉基准。
`npm run branding:check` 会锁定应用与安装器的品牌路径、浅色/深色令牌、字体和标题栏尺寸，
避免两处样式后续漂移。

## 响应式检查点

420 / 960 / 1280 / 1440px：主界面在 960px 以下折叠右检查器到下方抽屉；
420px 下导航轨保留、文件列表全宽。长中文/英文文本不允许遮挡主操作。

科研绘图页在 1280px 以下将模板、数据/运行、参数检查器依次纵向排列；
1280px 起采用三列。两种布局均使用内容高度和页面纵向滚动，不以剩余窗口
高度压缩网格行。模板列表独立限高（窄屏 20rem、宽屏 36rem），日志正文
限高 16rem；标题、搜索、分类和操作按钮不得被压缩后溢出至下一面板。
