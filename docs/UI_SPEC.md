# UI_SPEC — Mynx 3.x 视觉系统与布局

> 新 UI 不复用旧 CSS/Mantine 规则。本文档定义可编码令牌与布局契约；
> 实现入口：`src/styles/app.css`（Tailwind 4 @theme 令牌）。

## 设计原则

- 以分析流程为主线的桌面应用：左侧导航 / 中央工作区 / 右侧参数检查器 /
  底部任务抽屉；每个功能页遵循 导入 → 配置 → 运行 → 结果 → 历史。
- 视觉方向为“精密实验台”：冷调工作区、系统蓝负责选中与主操作。默认 macOS 风格遵循 Apple HIG：
  系统灰底色、系统蓝强调、交通灯窗口控件、轻透标题栏/侧栏（vibrancy）和低饱和流动渐变；
  卡片与控件保持不透明平面、1px 边框，以提升阅读清晰度。Pearl / Graphite 令牌保持与安装器一致。
- 页面标题统一 20px；正文以 13px 为基准；卡片保持单层表面，层级用背景、边框和留白区分。
- 13px 基准字号；长文本（路径/日志/基因名）一律截断 + 复制或换行。
- 界面文案直接命名功能与状态；不写口号、重复副标题或显而易见的操作提示。保留必要步骤、实验限制、数据风险和错误信息。

## 品牌标记

- Mynx 标志以仓库根目录 `public/icon.svg` 为唯一视觉参照：蓝色盾牌轮廓
  `#227CFF`，内部黄色 Y 形标记 `#FFC81E`。新应用、安装器和 Tauri 包图标必须保持
  相同图形，不使用字母缩写或通用占位图标。
- 主应用网页图标和标题栏使用 `public/mynx.svg`；安装器组件与桌面
  包图标应与该 SVG 图形和颜色一致。

## 界面风格（5 套主题，2026-11-21）

深浅模式（`ThemeId`：system / graphite / pearl，`data-theme`）与界面风格
（`UiStyle`：macos / minimal-linear / liquid-glass / swiss-editorial / memphis-pop，
`data-ui-style`，见 `src/app/ui-style.svelte.ts`）是正交的两个维度：
深浅决定明暗，风格决定配色与圆角。卡片与控件使用不透明平面和 1px 边框；首页背景有主题适配的低饱和流动渐变，标题栏、侧栏和主内容共用同一背景层。默认风格为
macos；旧默认会在升级时迁移一次到新默认（v2：liquid-glass → minimal-linear，
v3：minimal-linear → macos），其他风格选择保留。
风格通过 `mynx-ui-style` localStorage 镜像持久化（与
theme/language 镜像同一模式）；移入 SQLite 需 Rust 侧在 `SettingsDoc`
中加 `ui_style` 字段并重新生成 ts-rs 绑定（见 ui-style.svelte.ts 的 TODO）。

| 风格 | 浅色底色 | 强调色 | 形态 |
| --- | --- | --- | --- |
| macos（默认） | #ececec | 系统蓝 #0088FF（HIG 2025-06 规格，深色 #0091FF） | Apple HIG：交通灯窗口控件（macOS 平台）、轻透工具栏/侧栏、系统语义色（含可读性变体 #008932 / #C55300 / #E9152D）、6px 控件 / 10px 卡片圆角、纯色 iOS 风格工具图标块 |
| minimal-linear | #f5f6f8 | 蓝色 #3478d4 | macOS 灵感、轻透工具栏/侧栏、蓝紫柔和流动背景、白色工具入口 |
| liquid-glass | #edf2f3 | 低饱和湖蓝 #1c62ad | 18px 圆角、纯色表面、1px 边框 |
| swiss-editorial | 纯白 + 墨黑 | 编辑红 #C2452D | 直角、无阴影无渐变、严格网格 |
| memphis-pop | 牛皮纸 #F4ECDB + 白卡 | 琥珀 #8A5A12（亮琥珀 #E9A13B 只做点缀） | 2px 暖墨边、纯色块 |

macos 风格细则（视觉语言，双平台一致）：侧栏选中项使用
accent 填充 + 白色内容（无 3px 强调线）；输入框聚焦带 3px 蓝色光环；
页面标题用 macOS Title1 语气（22px/700）；
success/warning/danger 使用 Apple 可读性变体（#008932 / #C55300 / #E9152D，取自 HIG 2025-06 Specifications）；
悬停态为灰度高亮而非抬升位移；工具图标块为系统色实底 + 白色符号。
窗口 chrome 跟随平台规范，与风格无关：Windows 保留右侧 46px 系统按钮
（关闭悬停红底），macOS 在左上渲染红黄绿交通灯（12px 圆点，hover 显示符号，
窗口失焦时置灰）；macOS 顶栏不显示品牌图标，Windows 保留图标 + 标题。
其余风格保持原有声音。

每套风格各有对应的深色版（同色板降亮）。`--color-on-accent` 保证
accent 背景上的文字在 8 种组合下均可读；新增文案须同时写入中英文词典。
标题栏与主工作区同色，高 48px，显示品牌标记和系统按钮（macOS 平台显示
交通灯 + 13px 半粗标题，不显示品牌标记）；首页隐藏帮助、任务和命令面板按钮。
侧栏默认恢复窗口宽 72px、最大化 208px，可拖动调整至 64–280px 并保存；宽度小于 168px 时只显示图标，达到该宽度后显示导航文字。选中项默认使用浅蓝底色和 3px 强调线（macos 风格为 accent 填充），底部设置区以细线分组。
侧栏与主工作区同色，不加分界边框。默认风格只在标题栏和侧栏使用轻透材质；所有主题的卡片、图标块和搜索框均保持平面不透明表面。

2026-11-20 首页参照历史截图及 GitHub v2.3.9 启动器：品牌居中，天气紧随其下，大搜索框居中，
工具数量和三列入口在细分隔线之后。工具入口统一使用 Tabler 图标，尺寸与描边一致，配以低饱和
系统色图标块（紫、蓝、绿、橙）；悬停轻抬和按压回弹，支持减少动态效果设置。卡片保持白底和
1px 边框。首页隐藏最近工作统计、最近项目/输出及多余说明。功能步骤侧栏使用一致的单色导航
图标与强调色选中状态。网站链接仍保留在设置页，
任务和帮助入口在其他功能页标题栏显示。

> GitHub 公开发布记录没有 v2.8；源码参考采用最新的 2.x 正式发布
> [v2.3.9](https://github.com/hanhan124/mynx/tree/v2.3.9)。

> 注意：首页渐变只铺在应用背景层，卡片与控件仍保持不透明平面；轻透材质仅用于默认风格的标题栏与侧栏。
> 安装器沿用 Pearl/Graphite 令牌和扁平样式。


## macOS 27 Liquid Glass（默认 macos 风格，2026-11-22 重建）

> 取代本文件中 macos 风格旧条款（“卡片不透明 / 6px 控件 / 侧栏 accent 填充 / 漂移色块”）。其余四套风格不变。

**材质**：`tauri.conf.json` 主窗口 `transparent: true` + `windowEffects`（macOS `underWindowBackground`，
Windows 11 `mica`）。`src/app/window-material.ts` 在首帧前写入 `html[data-window-material="glass|solid"]`；
Windows 10 与浏览器预览为 solid，外壳保持不透明。三档玻璃令牌：`--mynx-glass-clear`（工具栏/侧栏）、
`--mynx-glass-regular`（卡片、工具胶囊、搜索）、`--mynx-glass-thick`（弹窗、菜单、提示、任务中心），
统一 `--mynx-glass-shadow`（0.5px 外沿 + 顶部高光 + 柔和投影）。

**外壳**：内容在玻璃工具栏下滚动（工具栏绝对定位 + 滚动边缘模糊渐隐，主区 `padding-top: 48px`）；
侧栏为距窗口 8px 的浮动玻璃面板，窗口宽 ≥900px 时默认带文字（208px），否则 72px 图标模式，拖动宽度仍保存；
侧栏选中为中性胶囊 + 强调色图标（不再 accent 满填充）。标题栏显示当前页面名；帮助/任务/置顶合成玻璃胶囊组；
Mac 显示 ⌘K。交通灯 14px、左边距 20px。Windows 仍保留右侧 46px 系统按钮。

**颜色**：label `#1d1d1f / #f5f5f7`，secondary `#6e6e73 / #a1a1a6`，tertiary `#86868b / #8d8d93`（仅占位符等）；
accent `#0071e3 / #0a84ff`（白字 ≥4.5:1 / 深底 ≥4.5:1）；success `#008932 / #30d158`，warning `#c55300 / #ff9f0a`，
danger `#d70015 / #ff453a`；填充 `--color-fill / --color-fill-strong`（120 120 128 / 12–36%）。文本选中为 28% 强调色底、保留文字色。

**字体**：SF Pro 优先，Windows 回落 Segoe UI Variable / 微软雅黑 UI。Large Title 26/700（页面标题）、Headline 15/600、
Body 13/400（字段标签由 12/500 映射为 13/400）、Callout 12、Subheadline 11（10px 映射为 11）；全大写分组标签改为 11/600 常规大小写。
Tabler 图标统一描边 1.75。

**形状**：同心圆角——窗口 16、面板/卡片 14、浮层 14、对话框 20、输入框/弹出按钮 8、按钮与工具胶囊为全圆角；控件高 28px。

**控件**：按钮悬停不变色、按下加深；主按钮强调色；破坏性按钮红色文字 + 原有确认；输入框单层 3.5px 焦点光晕；
`select.mynx-input` 为弹出按钮（右侧蓝色上下箭头）；开关、复选、单选、滑块、`<details>` 披露三角均为 macOS 形态；
选中态统一为 `--color-selected` + 1px 强调内描边，芯片选中为强调色填充。

**浮层**：弹窗/命令面板（Spotlight，20px 输入）/提示（通知横幅，16px 圆角）/任务中心（浮动玻璃面板）均使用厚玻璃。
提示在任务中心打开时按其实际高度 `min(17.5rem,42dvh)` 上移。

**可访问性**：`prefers-reduced-transparency` 全部回落为不透明表面；`prefers-contrast: more` 加深分隔与次级文字；
`forced-colors` 为玻璃面板补 1px 边框；减少动态效果时取消所有动画。滚动条为悬停显现的覆盖式。

**逐页细修（第二阶段，2026-11-22）**：
- 页面标题并入工具栏：TitleBar 显示页面名，页内 `.mynx-page-title` 视觉隐藏但保留给读屏；只有标题的头部折叠，带操作的头部保留操作并右对齐。
- 面板内分隔线一律用 `--color-separator`；面板标题行 40px、13/600；拖放区为 1.5px 虚线 + 12px 圆角 + 淡填充。
- qPCR / RNA-seq 步骤栏（`.mynx-step-rail`）去掉第二层卡片，改为普通源列表：32px 行、20px 圆形序号、状态徽章改为 8px 圆点（文字仍保留给读屏）。
- 设置页为系统设置样式：侧栏 30px 行 + 22px 彩色图标块；`legend` 为 20/700 面板标题；字段在宽于 720px 时左标签右控件；
  各块为 12px 圆角玻璃分组，说明文字放在分组下方；`.mynx-form-rows` 组内用细线分隔；主题卡片选中为 2px 强调环；颜色井 44×24。
- 聊天：会话列表去掉右边框，30px 行，中性选中；顶栏去掉下边框；用户气泡为 18px 圆角填充色；输入框为 22px 圆角厚玻璃，聚焦时有光晕。
- 图表检查器：分区去掉方框，改为细线分隔的披露列表。
- 表格：表头 11/600 二级色 + 厚玻璃底（吸顶可读）、细线、斑马纹、悬停高亮；带 `bg-*` 的语义单元格（如 qPCR 黄色标记）不被覆盖。

**控件组件化与令牌约束（第三阶段，2026-11-22）**：
- 字号令牌：`text-body`13 / `text-callout`12 / `text-footnote`11 / `text-caption2`10（macOS 映射为 11）/ `text-subheadline`14 /
  `text-headline`15 / `text-title3`20，定义在 `@theme`，各风格可重映射。页面禁止 `text-[Npx]`；首页品牌字用 `text-brand`21 / `text-brand-lg`24。水印颜色预览点用 `.mynx-swatch-white/black`（表示输出色本身，不随主题）。整卡开关用 `components/SwitchCard.svelte`。基线已清零。
- 开关：统一用 `components/Switch.svelte`（`checked` / `label` / `onchange(next)` / `disabled` / `title`）；整行即开关时内部用
  `SwitchTrack.svelte`。macOS 尺寸为 38×22，按下时滑块拉宽。
- 弹出菜单：`src/lib/popup-menu.ts` 在 macOS 风格下接管 `select.mynx-input` 的下拉列表，改为玻璃弹出菜单（选中项覆盖在按钮上、对勾、
  强调色高亮、方向键/Home/End/Enter/Esc/首字母跳转、按住拖动选择）。`<select>` 仍是唯一数据源：选择后设置 `selectedIndex`
  并派发 `input` + `change`，所有 `bind:value` / `onchange` 保持不变。对话框/浮层内、`multiple`、带 `data-native-select` 的下拉框保留原生列表。
- 约束检查：`scripts/check-ui-tokens.cjs` 随 `npm run lint` 运行，按文件统计像素字号、标记中的十六进制颜色、`bg-white/black`、
  Tailwind 调色板色和内联 `role="switch"`；任何文件新增即失败。减少后用 `npm run ui:tokens:update` 下调基线
  `scripts/ui-token-baseline.json`。

**剩余页面细修（第四阶段，2026-11-22）**：
- 帮助：工具图标为强调色图标块，h2 20/700、h3 15/600；流程序号为实心强调圆、连线用分隔色；原理/准备两栏去掉左竖线；
  控件速查与示例表为 12px 圆角分组（细线外沿），模板预览为等宽字体的填充色块。
- 关于：仿 macOS 关于面板，64px 图标居中、名称 20/700、版本与技术栈居中，按钮居中。
- 天气：一行显示，温度 15/600 等宽数字，刷新为圆形按钮；R 状态卡为设置页分组样式，刷新为无边框按钮；复制按钮为 22px 点击区。
- RNA-seq：步骤栏里结果/历史保留数量徽章（`.mynx-count`），其余步骤仍为状态圆点；参数网格标签为 12px 次级色、16/12 间距；
  警告/错误/成功提示条去掉边框，改为 10px 圆角淡色底，文字为偏深语义色以保证可读。

**全部风格适配 macOS 27（第五阶段，2026-11-22）**：五套界面风格共用 macOS 27 结构——窗口材质、玻璃工具栏/侧栏/浮层、控件、
弹出菜单、字号、同心圆角、动效与无障碍降级（`app.css` 的 “macOS 27 structure, shared by every style” 令牌块 + 原 macOS 层，
选择器统一为 `html[data-ui-style]`）。各风格只保留配色（`--color-*`、`--mynx-accent-2`、`--mynx-page-bg`），玻璃色调由各自的
surface / elevated / bg 推导；弹出按钮箭头块使用各自强调色。swiss-editorial 的直角、memphis-pop 的 2px 描边不再保留。
增强对比度按各配色的正文色推导。上文表格与“其余四套风格保持平面”的条款以本节为准。

## 颜色令牌

| 令牌                   | Pearl（浅色） | Graphite（深色） |
| ---------------------- | ------------- | ---------------- |
| --color-bg             | #e9eef4       | #151c26          |
| --color-surface        | #ffffff       | #1c2735          |
| --color-surface-2      | #e1e8f0       | #253345          |
| --color-border         | #c5d0dd       | #35465b          |
| --color-text           | #172a40       | #edf3fa          |
| --color-text-secondary | #506278       | #adbdcf          |
| --color-accent         | #256fd1       | #7eaff7          |
| --color-accent-hover   | #1b5db5       | #a1c5ff          |
| --color-nav-bg         | #d6e0eb       | #222f40          |
| --color-nav-border     | #becbd9       | #374b62          |
| --color-nav-text       | #334a63       | #d5e1ee          |
| --color-nav-active     | #f8fafc       | #344b66          |
| --color-success        | #157f3d       | #3fb96f          |
| --color-warning        | #b45309       | #d97706          |
| --color-danger         | #b91c1c       | #ef5350          |

主题三态：`system`（跟随 prefers-color-scheme）、`graphite`、`pearl`；
legacy `dark`/`light` 值归一化到 graphite/pearl。应用方式：
`document.documentElement.dataset.theme = resolved`。

## 语义令牌扩展（2026-11-21 重构）

所有风格共用一套语义层级，禁止页面内自定义局部配色。在 legacy 令牌之上新增：

| 语义 | 令牌 | 用途 |
| --- | --- | --- |
| 辅助文字 | `--color-text-tertiary` | 弱化说明、占位符之上的第三层级 |
| 交互表面 | `--color-hover` / `--color-selected` / `--color-active` | 悬停 / 选中 / 按压背景 |
| 分隔线 | `--color-separator` | 弱于 border 的 1px 细分隔 |
| 浮层 | `--color-elevated` | Popover / Modal 表面 |
| 焦点 | `--color-focus-ring` | `:focus-visible` 轮廓色 |
| 图表隔离 | `--color-chart-canvas` / `--color-chart-grid` / `--color-chart-axis` | 图表容器 chrome，与科研数据系列色板严格解耦 |

圆角梯度：`--mynx-radius-control`（控件）< `--mynx-radius-panel`（面板）<
`--mynx-radius-popover`（浮层）< `--mynx-radius-modal`（对话框）< `--mynx-radius-card`。
minimal-linear 浅色基线（macOS 冷灰白）：bg `#f5f6f8`、侧栏 `#eff1f4`、表面 `#ffffff`、
次级表面 `#f8f9fb`、hover `#f0f3f7`、selected `#e8f0fc`、文字 `#20242b / #697383 / #929ba8`、
分隔 `#e3e7ed`、accent `#3478d4`、success/warning/danger `#278568 / #b7822d / #c7545a`。
深色为石墨灰多层级（bg `#1d222a` → surface `#262c35` → surface-2 `#2e3540`），
禁用纯黑铺底。字体栈以 `-apple-system, BlinkMacSystemFont, "SF Pro Text"` 优先，
Windows 回落 `"Segoe UI", "PingFang SC", "Microsoft YaHei"`；
数据表格与参数数值统一 `font-variant-numeric: tabular-nums`（`.mynx-num`）。

## 布局常量

- 主应用默认窗口尺寸 1120×630px（16:9），最小 420×500px，启动后仍可自由调整。
- 标题栏高 48px（data-tauri-drag-region；macos 风格左侧为交通灯，右侧工具按钮
  26px 内嵌；其余风格右侧为 46px 宽窗口按钮）
- 导航栏恢复窗口时宽 72px，仅显示图标；最大化时展开至 208px 并显示中英文名称。
- 任务中心浮在主栏底部，最大高 280px，按窗口高度收缩；左右边缘对齐主栏内容的 16px 内边距，左边缘跟随侧栏宽度和拖动轨宽度。打开时用柔和投影与工作区区分，内容超出时内部滚动，底部 translateY 动画
- 焦点：`:focus-visible` 2px accent 轮廓；禁用态降透明度；运行态用
  .mynx-badge-running
- 视口宽度 ≤520px 时标题栏隐藏可见的 Ctrl+K 键帽（快捷键和搜索按钮保留），
  任务中心与置顶按钮保持 44px 点击宽度（macos 风格为内嵌幽灵按钮）；其余风格
  最小化、最大化、关闭按钮仍为 46px。

## 组件层（.mynx-\*）

共享动效按操作距离分为 120ms、180ms 和 280ms。导航和页面切换应用短淡入，弹窗轻缩放，任务中心从底部滑入，通知轻移淡入。原位控件用色彩、边框、按压或选中标记反馈。系统开启减少动态效果后直接显示最终位置和状态，仍保留颜色与焦点反馈。

`mynx-btn / -primary / -danger`、`mynx-input`、`mynx-badge-{queued,running,
success,error,cancelled}`、`mynx-card`（surface+border+主题圆角）、
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

首页采用历史 2.x 启动器结构：居中品牌标记与名称、天气、居中搜索框、分隔线、工具数量和三列工具入口。首页不显示最近工作统计、任务/项目/输出列表或工具说明；工具卡只显示图标、名称和进入箭头。窄屏单列、平板双列、宽屏三列；默认启动器采用紧凑尺寸，窗口较矮时再压缩头部留白和卡片高度。Windows 保留系统窗口阴影；DWM 扩展窗体绘制区域以隐藏细边框，Windows 11 同时设置专用边框属性。
首页搜索区与工具区之间的分隔条可用鼠标或触控上下拖动，也可聚焦后用方向键调整；高度保存在 `SettingsDoc.homeHeaderHeight`。
搜索框和搜索引擎选择放在首页中央，输入内容即时筛选工具，按 Enter 时才打开
所选网页搜索引擎。首页不显示教程入口，帮助按钮仅在其他功能页标题栏出现。天气按网络 IP 估算城市，单独显示在品牌下方。
qPCR 计算步骤在 1280px 起将参数与结果预览并排，窄窗口纵向排列；预览表格可独立横向滚动。
qPCR、RNA-seq、图片转换和科研绘图工作区的主栏分隔条可用鼠标或触控横向拖动，
也可聚焦后用方向键、Home/End 调整；列宽保存在 SQLite 的 `SettingsDoc.panelWidths`，
窄屏纵向布局时隐藏拖动条。
qPCR 工作表预览先显示 6 行 × 6 列概览，完整检查器支持全单元格搜索、25/50/100 行分页、
固定表头与行号，并保留原工作簿顺序及黄色参与计算标记；表格交互使用现有 TanStack Table，
不新增表格依赖。
源数据预览后显示只读预检（识别行、跳过行、空/无效 Ct、预计填补单元格）；转换表预览显示
样本/基因数量和实际黄色填补单元格数。预检不得自动筛行或更改 qPCR 计算。帮助页提供 MIQE
参考 Markdown 模板的预览、复制与下载，并提供 Target / Sample / Cq 格式的 Excel 原始数据导入模板；
导入已有 Transformed Data 时仍停留在文件步骤；用户可手动进入第三步设置计算参数。转换表和质控摘要只在第二步查看。
组名重命名放在转换步骤，采用工作表网格和鼠标范围选区，支持多组批量合并；编辑仅更新草稿，点击“应用到 Excel”后才写入转换表并记录 `Group Mapping`，计算步骤只使用已应用的组名。批量填入支持 Enter 确认。
计算完成后可导出预填运行信息的独立分析记录。

科研绘图页在 1280px 以下将模板、数据/运行、参数检查器依次纵向排列；
1280px 起采用三列。两种布局均使用内容高度和页面纵向滚动，不以剩余窗口
高度压缩网格行。模板列表独立限高（窄屏 20rem、宽屏 36rem），日志正文
限高 16rem；标题、搜索、分类和操作按钮不得被压缩后溢出至下一面板。

## 聊天页（/chat，2026-11-23 重写）

实现位于 `src/features/chat-next/`（旧版已删除）。布局：左侧会话栏（项目文件夹 / 按时间分组 / 搜索 / 归档，窄于 960px
时为浮层）+ 顶栏（标题点击重命名、预览面板开关、「…」对话菜单）+ 居中阅读列（768px）+ 可选 Artifacts 侧面板 +
底部玻璃输入框（附件、联网、对比、助手、模型、发送 / 停止；Enter 发送、Shift+Enter 换行、`/` 提示词、空输入框 ↑ 编辑上一条）。
贴底 80px 内才自动跟随；上翻出现「回到底部」。Markdown 由 svelte-streamdown 渲染并按令牌重新上色；HTML/SVG 预览在
无同源、无脚本、无网络的 iframe 中。所有配色走语义令牌，五套风格 × 深浅色一致；减少动态效果时取消动画。

## 帮助中心

- 帮助按当前工具展示对应说明；顶部先给简短介绍与编号流程图，再按运行原理、
  使用前准备、操作步骤、控件速查、输出结果和排错建议组织长内容。
- 流程图在窄窗口改为纵向时间线，在宽窗口改为水平连接节点；编号、节点和连线
  共同表达顺序，避免将每一步拆成相互割裂的小卡片。
- 控件速查在窄窗口采用上下堆叠的定义项，在宽窗口采用名称/说明两列；文字必须
  自然换行，不以固定最小宽度强迫横向滚动。
- 长内容只在弹窗正文区域滚动。浅色、深色、系统主题与中英文应保持同一信息层级。
