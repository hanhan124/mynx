# Mynx 聊天页（/chat）交付报告

日期：2026-11-21 · 分支：`feat/ui-redesign-macos` · 工作树基于 HEAD `de535c5`（v3.0.4 系）

> 基线说明：CODEX-PROMPT 按 v3.0.2 / 5c665e3 撰写，本地工作树实际是 v3.0.4 +
> 同分支上未提交的 macOS 视觉重构（晴湾主题、平台 chrome 等）。规格中列出的全部
> 仓库事实仍然成立，因此直接在当前工作树实现。交付 patch 为 `git diff HEAD`
> （包含聊天功能 + 先前的 macOS 视觉工作），对当前 HEAD 可干净应用；对 5c665e3
> 全新克隆应用会因上下文漂移失败。主题注意：现在有 **5 套**界面风格（规格写 4 套），
> 新增的默认风格 `macos`（显示名"晴湾"），聊天页用语义令牌自动跟随，无需特判。

## 一、过渡方案：A（FLIP 幽灵框）+ 兜底

按规格优先实现 A：Enter 瞬间用 `getBoundingClientRect()` 量首页搜索框，在
`document.body` 建 fixed 幽灵框（复制圆角/边框/背景/字体，携带输入文字），真框
只设 `opacity:0`（不用 display:none）；`navigate("/chat")`；ChatPage 挂载后
`tick()` 量 Composer，`element.animate()` 320ms `cubic-bezier(.22,1,.36,1)` 变形滑入，
结束移除幽灵、句子作为**新会话第一条消息**发出、Composer 自动聚焦。
选 A 的原因：规格首选，且实测一次跑通（见验收截图 chat-handoff.png）。
兜底：若 Composer 2.5s 内未出现（冷加载慢），直接移除幽灵，绝不卡在别的页面。
B 方案未启用。

## 二、验收项（手工清单）

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 已配 API：Enter → 文字滑入聊天页，句子为第一条消息，AI 流式，输入框聚焦 | ✅（无真实 API Key，用指向不存在域的配置验证到"发出 + thinking 动画 + 网络错误文案"链路；错误文案由单元测试锁定） |
| 2 | 未配 API：Enter → 系统浏览器打开所选搜索结果，不进聊天、不弹提示 | ✅（`resolveSubmitIntent` 单测 + 现有 searchWeb 未改） |
| 3 | 长回答滚动丝滑、上翻停在原地、右下角"回到底部" | ✅ 实现并审查：贴底阈值 80px、rAF 每帧一次瞬时 scrollTop、离散事件 smooth、上翻不拽回 |
| 4 | 生成中停止：保留已输出、标"已停止"、可继续对话 | ✅（AbortController.abort，状态 stopped，单测覆盖持久化降级 streaming→stopped） |
| 5 | 复制 / 重新生成 / 新建 / 切换 / 删除（confirmDialog 确认）/ 刷新仍在 | ✅（会话持久化单测 round-trip + 坏 JSON 不白屏） |
| 6 | Key 错误显示"Key 不正确或已过期"；断网显示网络错误 | ✅（chatErrorCode 映射 401/404/429/timeout/network，单测） |
| 7 | 深浅主题 / 五套风格 / 中英 / 420–1440px | ✅ 浅色+深色截图核验；配色全走语义令牌无硬编码；420px 下侧栏隐藏、Composer 全宽 |
| 8 | 系统减少动态效果 → 过渡瞬时 | ✅（scroll-behavior / fly 时长 / thinking 动画全部响应 prefers-reduced-motion） |
| 9 | 键盘 Tab/Enter 完成发送/停止/回到底部 | ✅（Composer tabindex 自然顺序，按钮原生 button） |

总时长：Enter → 第一条消息可见 ≈ 320ms（幽灵动画）+ 250ms（消息入场并行），≤500ms ✅。

## 三、命令输出（原文）

```
npm run typecheck  →  svelte-check found 0 errors and 0 warnings
npm run lint       →  （eslint src/ 无输出，exit 0）
npm test           →  Test Files  19 passed (19)
                       Tests  254 passed (254)
npm run build      →  ✓ built in 14.77s
```

新增测试 19 项：分流（工具命中/配置/空 query）· SSE 跨 chunk 解析与 [DONE] ·
CRLF/keep-alive · 配置三缺一 · baseUrl 规范化 · 错误码映射 · markdown 围栏/
标题/列表/加粗/行内码 · `<script>` 与 `<img onerror>` 转义 · 会话 round-trip ·
坏 JSON · 上限裁剪与 streaming→stopped 降级 · router.parse("/chat")。

## 四、文件清单

新增：`src/features/chat/ChatPage.svelte`、`chat.svelte.ts`、`chat-markdown.ts`、`chat.spec.ts`
修改：`router.svelte.ts`、`App.svelte`、`NavRail.svelte`、`CommandPalette.svelte`、
`HomePage.svelte`（仅 Enter 分流 + 清空）、`SettingsPage.svelte`（新增"AI 对话"节）、
`i18n.svelte.ts`（chat.* / nav.chat 全套中英 + home.searchHint + help.home 三条同步）、
`styles/app.css`（聊天页样式）、`src-tauri/tauri.conf.json`（见下）

## 五、有意的规格偏离（均已报告）

1. **CSP 增补（唯一触碰 src-tauri/ 的点，config-only）**：`connect-src` 增加
   `https:` 与 `http://localhost:*`、`http://127.0.0.1:*`。原因：用户自配 baseUrl
   无法穷举预授权；不补则真实应用内任何自定义接口都被 CSP 拦死，功能不可用。
   保留原有逐域枚举与 `http:` 默认拒绝（本地模型服务 Ollama 等走 localhost 白名单）。
2. **重新生成按钮只出现在最后一条 AI 回复**：规格原文"每条 AI 消息下方"，但其对
   重新生成的定义（删上一条 AI 回答、重发最后一条用户消息）只对最后一条有意义；
   中间消息只提供复制。
3. **幽灵落位后 Composer 保持空白**：规格 4.5(a) 写"预填那句话"，但 4.2 与验收
   标准要求句子已作为第一条消息发出——两处矛盾，按验收标准实现（发出后聚焦空
   输入框），避免二次误发。

## 六、没做的事（按规格砍掉）

文件/图片/语音上传、联网搜索、RAG、MCP、代码高亮库、LaTeX、语音、分享导出、
多模型下拉、模型列表拉取、会话重命名、SQLite 迁移（SettingsDoc 需 Rust 改动 +
ts-rs 重生成，留待后续）、任何依赖新增（package.json 未动）。

## 七、已知限制

- Key 与会话存 localStorage 明文；换电脑需重填；设置页有清除按钮与安全说明小字。
- 流式输出滚动为每帧瞬时跟随（非逐字平滑），这是规格 4.5(b) 明确要求的有意行为。
- 极端长上下文不做截断，超模型上限由服务端报错并原样展示错误信息。
- 冷启动首次进入 /chat 需加载懒 chunk（dev 下 >1s），幽灵框有 2.5s 兜底；生产
  构建后影响可忽略。
- 设置页"测试连接"调 `GET {baseUrl}/models`，个别网关不实现该端点会误报 404。

## 八、交付物

- patch：`mynx-feature.patch`（git diff HEAD，含聊天功能 + macOS 视觉工作）
- 源码包：`mynx-src.tar.gz`（排除 node_modules / dist / target / .git）
- 截图：`%TEMP%\mynx-qa\chat-empty.png`、`chat-thread.png`、`chat-handoff.png`、
  `chat-dark.png`、`chat-settings.png`

## 九、v1.1 增量（2026-11-21，用户要求服务商预设 + 模型选择）

设置页"AI 对话"节升级为 DeepSeek 客户端式：

- **服务商预设**：DeepSeek（默认，`https://api.deepseek.com` + `deepseek-chat`）/
  OpenAI（`https://api.openai.com/v1` + `gpt-4o-mini`）/ 自定义（OpenAI 兼容）。
  协议仍是 OpenAI 兼容 SSE——DeepSeek 官方 API 同协议，无需改动请求层。
  未配置时默认选中并预填 DeepSeek（按用户要求），Key 填写时才落盘。
- **模型在线拉取**：`GET {baseUrl}/models`（10s 超时），Bits UI Popover 展示，
  带搜索过滤框、当前选中高亮、点击即填；失败时 toast 报具体原因，模型输入框
  始终保留手动输入兜底（部分网关不实现 /models）。
- 新增 `CHAT_PROVIDERS` / `chatProviderForBaseUrl` / `fetchProviderModels`
  （chat.svelte.ts，单测覆盖预设值与 baseUrl 探测）；测试 254 → 256。
- 已知限制：`deepseek-reasoner` 的 `reasoning_content` 增量当前忽略，只渲染
  `content`（DeepSeek 对话/推理两模型正文流式均正常）。

## 十、v1.2 增量（2026-11-21，移植 deepseek-ai/chat-demo 功能，用户确认）

参考 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT）的功能
清单移植（不引入其代码/构建链）：

- **思维链渲染**：SSE 解析 `reasoning_content`，AI 消息上方显示可折叠"思考过程"块，
  流式且正文为空时自动展开；序列化进 v2 信封。
- **回答变体（分支）**：数据模型升级 v2——助手消息含 `variants[] + activeVariant`，
  重新生成不再删除旧答案而是追加新变体，页脚出现 ‹ 1/2 › 切换器；v1 信封加载时
  自动迁移（单变体包装），序列化始终写 v2。
- **编辑用户消息并重发**：铅笔按钮内联编辑，保存后截断后续并重新生成。
- **KaTeX 公式**：`$…$` 行内、`$$…$$` 居中块（新依赖 katex，CSS 经 main.ts 引入）。
- **代码语法高亮**：新依赖 highlight.js/lib/common；令牌色映射到语义变量
  （app.css），深浅主题自适应，无需静态主题 CSS。
- **会话 ZIP 导入/导出**：`chat-export.ts`（JSZip + plugin-dialog/plugin-fs，
  浏览器预览退化为锚点下载/文件选择）；归档内为版本化 sessions JSON，导入按 id
  合并（已有优先）并裁剪上限。
- **朗读**：Web Speech API `speechSynthesis`，按界面语言设置 lang，可停止。

新增依赖（用户确认）：`katex`、`highlight.js`、`@types/katex`（dev）。
测试 256 → 261（v1→v2 迁移、reasoning SSE、变体 round-trip、mergeSessions、
KaTeX/highlight 渲染与回退）。`Mermaid` 图与语音输入/附件上传未做：Mermaid 需
约 2MB 依赖与异步沙箱渲染，附件需按 OpenAI vision content-parts 重构请求体，
留待后续按需单独做。

## 十一、v1.3 增量（2026-11-21，对标 Gemini/Grok/LobeChat 网页端功能集）

- **会话管理**：侧栏会话搜索框（按标题/消息内容过滤）、重命名（内联编辑）、
  置顶（置顶组排在最前，图钉状态可见）。
- **顶栏模型快速切换器**：点击当前模型名弹出列表（在线拉取 + 搜索过滤），
  选中即持久化，无需绕设置页。
- **对话参数浮层**（顶栏滑杆图标）：每会话系统提示词（覆盖设置页默认）、
  温度滑杆（0–2）、最大生成长度；当前会话导出为 Markdown。
- **默认系统提示**：设置页新增文本域（全局默认，每会话可覆盖）。
- **令牌用量**：解析 SSE 末块 `usage`（OpenAI/DeepSeek 兼容），助手页脚显示
  `↑提示 ↓生成` tokens；用量随变体存储。
- **上下文截断**：请求消息超 40 条时自动裁剪为最近 40 条（系统提示始终保留），
  长会话不会撑爆请求。
- 测试 261 → 268（buildRequestMessages 系统提示/裁剪/错误消息剔除、配置扩展
  字段校验、pinned/system round-trip、usage 解析、Markdown 导出）。
- 验收截图：`%TEMP%\mynx-qa\bench-chat.png`（置顶+变体+用量）、
  `bench-params.png`（参数浮层）、`bench-models.png`（模型列表）。
- 未做（后续可选）：附件/图片 vision 输入、联网检索与引用、追问建议 chips
  （需额外模型调用）、Mermaid。

## 十七、v1.9 增量（2026-11-22，用户布局反馈）

- **居中阅读列**：消息流与 Composer 收进 `max-w-[760px]` 居中列（宽屏不再
  整卡贴左拉伸），对齐 ChatGPT/Gemini 的阅读排布。
- **侧栏可隐藏**：顶栏新增侧栏开关（layout-sidebar 图标，pressed 态高亮），
  状态持久化（`mynx-chat-sidebar` localStorage 镜像）；侧栏关闭时拖动轨
  一并隐藏。
- **侧栏宽度可调**：复用 ColumnResizeHandle（180–360px，edgeStart 贴边），
  宽度持久化到 SQLite `panelWidths.chatSidebar`（bootstrap 自动载入）。
- 验证：279/279 · 截图 `final-chat-markdown.png`（1440px 居中布局 +
  可调宽侧栏 + Markdown/公式渲染）。

### v2.1.1 修复（用户标注：白框 + 多线）
- **白色大框**：main 列的 `mynx-card` 套壳此前一批次实际未移除（批量替换
  中断导致），本轮确认后彻底移除——聊天页背景与窗口渐变统一，无白框。
- **重复线条**：清理过程中产生的**双拖动轨**去重（单条拖动轨）；侧栏
  border-r 即唯一分隔线。
- 教训记录：批量重构后必须 grep 校验结构标记的唯一性（本次
  `{#if sidebarOpen}` 出现 3 次、双 handle 均由中断的批量脚本残留）。

## 十九、v2.1 补丁（2026-11-22，用户"丑陋/未 ZCode 化"反馈）

消息行重构（对齐 ZCode/ChatGPT 桌面端惯例）：

- **AI 头像锚点**：每条回复左侧 24px 圆形品牌头像（accent 底 + chatbot 图标），
  内容列缩进对齐——回复不再是"浮在左边的裸文本"。
- **操作悬停显隐**：用户/AI 消息的操作按钮（复制/编辑/朗读/重新生成）默认
  隐藏，悬停该轮或键盘聚焦时显现（focus-within 保留键盘可达性）。
- **阅读列收窄**：760 → 720px，轮间距 gap-3 → gap-6，Composer 悬浮面板与
  消息列同宽对齐。
- 验证：279/279 · 截图 `final-chat-markdown.png`（头像锚点 + 720 列 +
  公式/表格渲染正确）。

## 十八、v2.0 增量（2026-11-22，用户界面反馈两项）

1. **聊天界面 macOS/ZCode 化改版**：去除"大卡片套壳"（mynx-card 边框），
   聊天改为**页面级布局**——细线分隔的会话侧栏（px-2 + border-r）、消息流
   直接置于页面底色、Composer 变为**悬浮式面板**（bg-elevated + shadow-pop +
   modal 圆角），对齐 ZCode/ChatGPT 的阅读排布。
2. **设置页分节式侧边导航**：整页重构为左右两栏——左侧节导航（外观 / 模型
   设置 / 联网搜索 / 窗口 / 关于 Mynx，图标 + 选中高亮，窄屏横向滚动），
   右侧仅渲染所选节（R 环境与关于归入"关于"节；联网搜索从模型设置中拆出
   独立节）。解决"设置页太乱"的长滚动问题。
- 验证：279/279 · 截图 `ui2-chat.png`（聊天新版式）、`ui2-settings-models.png`
  （模型设置两栏 + 预设网格）、`ui2-settings-websearch.png`（联网搜索节）、
  `ui2-settings-about.png`（关于节）。

## 十四、v1.6 增量（2026-11-22，ZCode 式模型设置 + 完整 Markdown）

### 模型设置重构（对标 ZCode 提供商管理页）
- **多供应商注册表**：`ChatConfig.providers[] + activeProviderId`（旧扁平配置
  加载时自动迁移为单条目），baseUrl/apiKey/model 成为当前使用供应商的运行时
  镜像——聊天/模型拉取/测试连接全部无感切换。
- **设置页两栏**：左侧"已配置"列表（绿色状态点=就绪、"当前使用"徽章），右侧
  编辑器（名称/地址/Key 显隐+清除/模型+在线拉取搜索/设为当前使用/测试连接/
  删除供应商带确认）。空注册表默认展示预设网格。
- **预设卡片目录**：常用（DeepSeek / Kimi / 智谱 BigModel / OpenAI /
  阿里云百炼 / MiniMax）· 更多（火山方舟 / NVIDIA NIM / 自定义 OpenAI 兼容）·
  本地（Ollama）；全部 OpenAI 兼容端点，应用即建、可编辑。
- **Key 改为可选**（baseUrl+model 即视为配置完成）：本地 Ollama、Pollinations
  等免 Key 服务可用；空 Key 请求完全省略 Authorization 头（空 Bearer 会 403）。
- i18n：新增 modelSettings/providersTitle/addProvider/presetsTitle/group.*
  /providerName/currentProvider/setActive/deleteProvider* /noProviders 等
  中英成对 key；移除旧单服务商 select 的 deepseek/openai/custom key。

### Markdown 渲染补全（"输出应该是 markdown 格式"）
新增：**表格**（|…| + 对齐分隔行 → 圆角边框表，横向滚动）、**有序列表**、
**引用块**、**分隔线**。既有：标题/无序列表/加粗/行内代码/代码块+复制/KaTeX。
表格 HTML 由转义后的单元格构建，无注入面（escape 前置不变量由测试锁定）。
新增样式：mynx-chat-table/-olist/-quote/-hr（全部走语义令牌）。

### 本轮验证
typecheck 0/0 · lint 干净 · **276/276 测试**（新增：多供应商迁移/round-trip/
预设探测/Markdown 表格）· build ✓ · cargo check ✓ ·
截图：`%TEMP%\mynx-qa\ms-list.png`（两栏列表+编辑器）、`ms-presets.png`
（预设卡片网格分组）、`e2e-real-answer.png`（Markdown 表格/有序列表/引用块）。

## 十六、v1.8 增量（2026-11-22，ZCode 标准上下文压缩机制）

替换"仅截断 40 条"为 ZCode 同款**摘要压缩**机制（摘要 + 保留最近轮次完整语义）：

- **自动压缩**：未压缩尾部 ≥36 条时，下次发送前自动把更早的对话经 LLM 压缩为
  ≤300 字要点摘要（合并既有摘要），**最近 20 条始终完整发送**；失败降级为
  截断并 toast 提示，不阻塞回答。
- **手动触发**：参数浮层新增"压缩上下文"按钮（压缩中禁用）+ 状态行
  "最近 {kept} 条完整发送；更早 {compacted} 条已折叠为摘要"。
- **语义**：已折叠进摘要的轮次不再随请求发送（省 token），摘要作为 system
  消息注入（位于系统提示之后）；随会话持久化（v2 信封附加
  `summary`/`summarizedCount` 字段，向后兼容）。
- 纯函数：`contextPlan`（阈值判定/保留计划）、`buildCompactPrompt`（合并既有
  摘要 + 300 字要点要求）、`buildCompactTranscript`、`buildRequestMessages`
  （签名升级为 session 感知：system + summary + summarizedCount 之后的尾部，
  40 条安全兜底仍保留）。
- 端到端验证：45 条消息会话 → 状态"最近 44 条完整发送；更早 0 条" → 点击
  压缩 → toast "上下文已压缩" → 状态"最近 20 条完整发送；更早 24 条已折叠为
  摘要" ✓（截图 compact-done.png；mock 流式回答继续正常）。
- 测试 274 → 279（contextPlan 阈值、摘要注入与折叠语义、buildRequestMessages
  session 签名、cap 20）。

## 十五、v1.7 增量（2026-11-22，用户四项反馈）

1. **首页搜索栏 Safari 化**：胶囊形（macos 风格下圆角+半透明+聚焦光晕）、
   空输入时占位文案**居中**（placeholder-shown）、生硬的 `<select>` 换成
   **引擎弹出菜单**（右端地球+chevron，菜单带勾选标记与回退说明小字——引擎
   选择仍有意义：未命中工具且未接入 AI 时回退使用）；placeholder/hint 文案
   重写为覆盖三分流（工具直达 / 提问 AI / 网页搜索）。
2. **首页第 5 张工具卡片 = AI 聊天**（青色 tile，浅/深主题色板），
   "5 个工具"计数随之更新。
3. **LaTeX 括号定界符跨行修复**：`\[…\]` 跨多行时逐行渲染断裂——重构
   renderTextBlock 为两级管线（splitBlockMath 先提取跨行块级公式，再逐行
   处理文本块）；KaTeX 兼容 `\text{中文}`；测试锁定。
4. **上下文截断显式化**：参数浮层底部标注"上下文自动保留最近 40 条消息"
   （该机制 v1.3 已实现，本轮补 UI 说明）。
- 验证：278/278 测试（+2：多行括号数学/中文 \text）·
  截图 `final-home.png`（5 卡片+Safari 搜索栏）、`final-chat-markdown.png`
  （公式/表格/列表混合渲染）。

### v1.6.1 补丁（2026-11-22，用户实测反馈）
DeepSeek 等模型常输出 **`\(...\)` / `\[…\]` 括号定界符的 LaTeX**，此前渲染为
裸文本。`splitMath` 已扩展识别四种定界符（`$$…$$` / `\[…\]` 显示、`$…$` /
`\(…\)` 行内），KaTeX 统一渲染。测试 275 → 277（括号定界符用例锁定不再出现
裸 `\(` / `\[`）；截图 `latex-render.png`（用户原场景：`N = N_0(1+E)^{Ct}`
居中公式 + 行内 `N_0`/`E` 全部正确渲染）。

## 十三、v1.5（2026-11-21，端到端输出验证 + CORS 修复 + 免 Key 支持）

用户追问"测试配置 key 之后到底能不能输出"——验证过程发现并修复了一个**真实
bug** 与一个**架构级缺口**：

### 发现的 bug：流式期间 UI 不更新（Svelte 5 响应性盲区）
`streamInto` 通过创建时捕获的**裸对象**引用写入 token（`variant.content += …`），
而 UI 读的是 Svelte 5 的 proxy——裸对象变更不触发重渲染，任何 Key 配置后都会
"看不到输出"。修复：streamInto 先按 id 从 store 解析出 **proxied message** 再写入。
修复后用本地 OpenAI 兼容 mock 服务（真实 SSE over HTTP，含
reasoning_content/usage/[DONE]）端到端验证：流式渲染、KaTeX/加粗/列表、
`↑24 ↓N` 令牌、思维链折叠、停止保留半截（"已停止"）全部 ✓。

### 架构级缺口：CORS 会阻断多数服务商（WebView2 直连 fetch）
实测预检：DeepSeek 官方 API **对浏览器 CORS 友好 ✓**（预检直接放行任意 Origin），
可直接用 Key 流式；OpenAI 则 **403 封锁浏览器** ✗。集成
`@tauri-apps/plugin-http`（Tauri 内经 Rust 转发请求，绕过 CORS；浏览器预览退化为
原生 fetch）：Cargo/npm 同版本 =2.6.0（查 crates.io 依赖矩阵确定与
tauri 2.11.5 + fs 2.5.1 兼容的最高组合；2.7.0+ 需要 fs ^2.5.2，2.8.0+ 需要
tauri ^2.12），fs 插件随链升级 2.5.1 → 2.5.2（Cargo+npm）。capabilities 增加
`http:default` + URL scope（`https://**`、`http://localhost:**`、
`http://127.0.0.1:**`）。`getPlatformFetch()` 统一出口（chat 流式/模型拉取/
设置页测试连接/联网搜索均走它）。

### 免 Key 服务支持
`isChatConfigured` 放宽为 baseUrl + model（apiKey 可空）：本地 Ollama、
Pollinations 等免 Key 服务可用；请求头在 Key 为空时完全省略 Authorization
（空 Bearer 会被部分网关 403）。**真实公网流式已验证**：Pollinations
（`text.pollinations.ai/openai`，无 Key）真实流式回答成功渲染。

### 本轮全部验证
typecheck 0/0 · lint 干净 · **274/274 测试** · build ✓ · cargo check ✓ ·
tauri dev 带 http 插件重启成功（Rust 2m08s 编译）✓ ·
端到端截图：`%TEMP%\mynx-qa\e2e-streaming.png`（流式中）、`e2e-complete.png`
（完成：公式/加粗/令牌/思维链）、`e2e-stopped.png`（停止保留半截）、
`e2e-real-complete.png`（真实公网配置生效）。

## 十二、v1.4 增量（2026-11-21，联网搜索，用户确认）

"让用户自己配 API + 给选项"：

- **三个可选服务商**（设置页 AI 节新增"联网搜索"块，可关闭）：
  Tavily（`https://api.tavily.com/search`，Bearer Key）· Serper/Google
  （`google.serper.dev/search`，X-API-KEY）· SearXNG 自托管
  （`{url}/search?format=json`，无需 Key）。结果条数 1–10 可调。
- **输入框地球开关**：配置了服务商后可点亮（accent 高亮 + aria-pressed），
  状态持久化在 `mynx-chat-config.webSearch.enabled`；未配置时点击给引导提示。
- **流程**：开启后每次提问先搜索（15s 超时）→ 结果构造为上下文消息注入
  （紧跟系统提示之后），并要求模型以 `[n]` 标注引用 → 回答下方渲染"来源"列表
  （点击经 openExternal 在系统浏览器打开）。搜索失败只 toast 报码，回答继续
  （不阻塞）。
- 数据：`ChatVariant.sources` 随变体序列化；`WebSearchConfig` 存于
  `mynx-chat-config.webSearch`（provider/apiKey/url/resultCount/enabled，
  解析时非法 provider 丢弃）。CSP 已有 `https:` 通配，无需再改。
- 测试 268 → 274（三适配器 mock fetch 请求头/URL/结果映射、非 http 链接过滤、
  buildSearchContext 编号引用、searchConfigured 判定、webSearch 配置解析）。
- 已知限制：SearXNG 需实例开启 JSON 输出（`format=json`）；Tavily/Serper 免费
  额度有限；引用编号依赖模型遵循指令，极小概率漏标。

## v3 重写（2026-11-23）：新版聊天取代旧版

- 旧版 `src/features/chat/`（ChatPage / chat.svelte.ts / chat-export / chat-markdown / chat.spec）已删除，
  备份在 `.ui-backup-20261122/legacy-chat/`。`/chat` 现在加载 `src/features/chat-next/ChatNextPage.svelte`，
  `/chat-next` 重定向到 `/chat`。旧数据（localStorage `mynx-chat-sessions` / `mynx-chat-config`）首次打开时
  只读导入一次（`core/migrate.ts`），原数据不删除。
- 技术栈：Vercel AI SDK（四种协议按需动态加载）+ svelte-streamdown（按需加载）+ pdf.js（按需加载）；
  存储为 SQLite `chat.sqlite3`（Rust `mynx-core::chat_store`）+ 系统钥匙串（`mynx-core::secrets`）。
- 首页搜索框交接改走 `chat-next/handoff.ts`（不依赖聊天包）：`isChatConfigured()` 读取聊天页写入的
  `mynx-chat-ready` 标记，未打开过聊天时回退到旧配置判断。
- 应用设置页的「AI 对话 / 联网搜索」两节移除，改为「打开聊天设置」入口（`requestChatSettings()`）。
- 新增：会话树分支、对比、Artifacts、联网引用、远程 MCP（逐次确认）、记忆、项目文件夹、归档、临时对话、
  提示词库、助手、每会话参数、重试 / 继续生成 / 换模型重新生成、↑ 编辑上一条、上下文压缩（摘要 + `summaryUntil`）、
  起始建议、图片查看、读屏播报。
