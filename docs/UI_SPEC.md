# UI_SPEC — Mynx 3.x 视觉系统与布局

> 新 UI 不复用旧 CSS/Mantine 规则。本文档定义可编码令牌与布局契约；
> 实现入口：`src/styles/app.css`（Tailwind 4 @theme 令牌）。

## 设计原则

- 以分析流程为主线的桌面应用：左侧导航 / 中央工作区 / 右侧参数检查器 /
  底部任务抽屉；每个功能页遵循 导入 → 配置 → 运行 → 结果 → 历史。
- 视觉方向为“精密实验台”：冷调纸白工作区、浅冰蓝导航轨、品牌蓝负责选中与主操作。
  参考主题包 Minimal Linear 原型的细分隔线和克制留白；保持平面、1px 边框，不用渐变、
  玻璃拟态或装饰阴影。Pearl / Graphite 令牌保持与安装器一致。
- 页面标题统一 20px；正文以 13px 为基准；卡片保持单层表面，层级用背景、边框和留白区分。
- 13px 基准字号；长文本（路径/日志/基因名）一律截断 + 复制或换行。
- 界面文案直接命名功能与状态；不写口号、重复副标题或显而易见的操作提示。保留必要步骤、实验限制、数据风险和错误信息。

## 品牌标记

- Mynx 标志以仓库根目录 `public/icon.svg` 为唯一视觉参照：蓝色盾牌轮廓
  `#227CFF`，内部黄色 Y 形标记 `#FFC81E`。新应用、安装器和 Tauri 包图标必须保持
  相同图形，不使用字母缩写或通用占位图标。
- 主应用网页图标和标题栏使用 `public/mynx.svg`；安装器组件与桌面
  包图标应与该 SVG 图形和颜色一致。

## 界面风格（4 套主题，2026-11-19）

深浅模式（`ThemeId`：system / graphite / pearl，`data-theme`）与界面风格
（`UiStyle`：liquid-glass / minimal-linear / swiss-editorial / memphis-pop，
`data-ui-style`，见 `src/app/ui-style.svelte.ts`）是正交的两个维度：
深浅决定明暗，风格决定配色、圆角、阴影与玻璃效果。默认风格为
liquid-glass。风格通过 `mynx-ui-style` localStorage 镜像持久化（与
theme/language 镜像同一模式）；移入 SQLite 需 Rust 侧在 `SettingsDoc`
中加 `ui_style` 字段并重新生成 ts-rs 绑定（见 ui-style.svelte.ts 的 TODO）。

| 风格 | 浅色底色 | 强调色 | 形态 |
| --- | --- | --- | --- |
| liquid-glass（默认） | #f3f5f6 + 极浅蓝灰/鼠尾草绿光晕 | 低饱和湖蓝 #1c62ad | 18px 圆角、低饱和 backdrop blur、1px 细边 + 轻内高光、克制阴影 |
| minimal-linear | 纯白 #FBFAF7 + 牛皮纸 #F4F0E8 | 鼠尾草绿 #6E7F6A | 1px 发丝线、无阴影无渐变 |
| swiss-editorial | 纯白 + 墨黑 | 编辑红 #C2452D | 直角、无阴影无渐变、严格网格 |
| memphis-pop | 牛皮纸 #F4ECDB + 白卡 | 琥珀 #8A5A12（亮琥珀 #E9A13B 只做点缀） | 2px 暖墨边、5px 偏移色影 |

每套风格各有对应的深色版（同色板降亮）。`--color-on-accent` 保证
accent 背景上的文字在 8 种组合下均可读；新增文案须同时写入中英文词典。
标题栏透明叠在应用外壳的 `--mynx-page-bg` 上，与工作区连续且没有底部分隔线；标题栏
文字沿用 `--color-text` / `--color-text-secondary`，按钮悬停使用 `--color-surface-2`，
关闭按钮保留 `--color-danger` 语义色。侧栏透明叠在同一张 `--mynx-page-bg` 画布上，
不加右侧分隔线或装饰阴影；导航层级由布局留白表达，选中项用低对比主题底色和 3px 强调线。

v2 抛光（2026-11-19，用户本地截图反馈）：默认液态玻璃光晕降饱和、减弱渐变（卡片
不再是平白卡）、次要文字加深（浅色 #2e4a63）、侧栏与主工作区共享同一
画布且不加分界线、选中态用低对比底色和 accent 边、首页工具卡仅显示图标、
名称和进入箭头、首页顶部加真实数据统计条（工具数 / 最近任务 / 项目 /
输出）、天气摘要替换首页标题下的标语，以一行弱化信息呈现、不使用卡片底色或阴影；
R 环境检测只放在设置页。

> 注意：液态玻璃的渐变光晕与玻璃拟态、孟菲斯的偏移色影是用户
> 2026-11-19 明确要求的四主题方案的一部分；此前“平面、1px 边框、
> 不用渐变/玻璃拟态/装饰阴影”的规则仍适用于 minimal-linear 与
> swiss-editorial，以及安装器（安装器沿用 Pearl/Graphite 令牌不变）。

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

## 布局常量

- 主应用默认窗口尺寸 1120×720px，最小 420×500px；启动后仍可自由调整。
- 标题栏高 40px（data-tauri-drag-region；右侧 46px 宽窗口按钮）
- 导航栏宽 208px，视口 ≤1100px 时收窄为 56px（5 个工具入口带文字标签 + 底部网站外链与设置）
- 任务抽屉高 280px，底部 translateY 动画
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

首页标题下显示紧凑天气摘要（替换标语），然后显示搜索与真实数据统计。工具卡只显示图标、名称和进入箭头；R 环境检测仅在设置页展示。窄屏单列、平板双列、1280px 起四列；
搜索框和搜索引擎选择放在首页标题右侧，输入内容即时筛选工具，按 Enter 时才打开
所选网页搜索引擎。首页不单独显示教程入口；标题栏帮助入口保留。天气按网络 IP 估算城市，
并与最近任务、项目/输出目录一起显示在首页摘要区。
qPCR 计算步骤在 1280px 起将参数与结果预览并排，窄窗口纵向排列；预览表格可独立横向滚动。
qPCR 工作表预览先显示 6 行 × 6 列概览，完整检查器支持全单元格搜索、25/50/100 行分页、
固定表头与行号，并保留原工作簿顺序及黄色参与计算标记；表格交互使用现有 TanStack Table，
不新增表格依赖。
源数据预览后显示只读预检（识别行、跳过行、空/无效 Ct、预计填补单元格）；转换表预览显示
样本/基因数量和实际黄色填补单元格数。预检不得自动筛行或更改 qPCR 计算。帮助页提供 MIQE
参考 Markdown 模板的预览、复制与下载，并提供 Target / Sample / Cq 格式的 Excel 原始数据导入模板；
导入已有 Transformed Data 时仍停留在文件步骤；用户可手动进入第三步设置计算参数。转换表和质控摘要只在第二步查看。
组名重命名放在转换步骤，采用工作表网格和鼠标范围选区，支持多组批量合并；编辑仅更新草稿，点击“应用到 Excel”后才写入转换表，计算步骤只使用已应用的组名。
计算完成后可导出预填运行信息的独立分析记录。

科研绘图页在 1280px 以下将模板、数据/运行、参数检查器依次纵向排列；
1280px 起采用三列。两种布局均使用内容高度和页面纵向滚动，不以剩余窗口
高度压缩网格行。模板列表独立限高（窄屏 20rem、宽屏 36rem），日志正文
限高 16rem；标题、搜索、分类和操作按钮不得被压缩后溢出至下一面板。

## 帮助中心

- 帮助按当前工具展示对应说明；顶部先给简短介绍与编号流程图，再按运行原理、
  使用前准备、操作步骤、控件速查、输出结果和排错建议组织长内容。
- 流程图在窄窗口改为纵向时间线，在宽窗口改为水平连接节点；编号、节点和连线
  共同表达顺序，避免将每一步拆成相互割裂的小卡片。
- 控件速查在窄窗口采用上下堆叠的定义项，在宽窗口采用名称/说明两列；文字必须
  自然换行，不以固定最小宽度强迫横向滚动。
- 长内容只在弹窗正文区域滚动。浅色、深色、系统主题与中英文应保持同一信息层级。
