# 默认前端 UI 重做与协议层原地验证

## Goal

原地重做 `default-frontend-files.ts` 的默认前端 UI（`index.html` + `style.css` + `app.js` 的表现层），让它从"半成品"达到"成品"质量；协议层仍手写在 `app.js` 里不抽包，重做过程用 `inspect_frontend` 工具顺带端到端验证协议层（桥握手 / RPC / 事件 / snapshot 覆盖）真的没问题。抽 SDK 留作协议层验证通过后的后续任务。

## User Value

- 玩家开箱即见的官方默认界面从"能用但糙"提升到"成品"。
- 默认前端是方向文档 §5 三合一真相源（官方默认 + 助手起点 + 测试基准），UI 可读性即 API——重做后助手 fork 的起点质量质变。
- 顺带完成方向文档 §8 第 1 步（验收 packaged 前端地基）：之前因 UI 半成品导致协议层从未被完整端到端跑通，重做后用 inspect_frontend 真正验证协议层。

## Confirmed Facts（已通过代码探明，无需重新论证）

- **当前前端结构**（`default-frontend-files.ts`）：3 个文件 `index.html`/`style.css`/`app.js`。HTML 是 `header(title+status) + messages + timeline + composer`；CSS 是 warm CRT brutalist 风格（`--void` 深绿底 + `--neon` 霓虹黄 + JetBrains Mono 等宽字体）；app.js 367 行内含协议层 + 表现层。
- **协议层实现完整但未端到端实测**：hello→ready 握手、`call()` RPC + id 匹配、事件路由（turn-delta/turn-tool/turn-round-end/turn-completed）、`turn-completed.snapshot` 覆盖渲染（遵守 §4 红线）、`loadSnapshot` 初始拉取——代码层面都在，但 UI 半成品导致完整交互流从未被真正跑通验证。这是"协议层不知道是否真的没问题"的根因。
- **当前 UI 的半成品特征**（表现层）：
  - markdown 渲染极简手写：只有 headings/bold/italic/code/lists/代码块，无表格、引用块、链接、图片、分隔线、语法高亮。
  - reasoning delta 被显式忽略（app.js:304 注释 "keep simple: ignore for now"）。
  - 工具节点 timeline 平铺，无折叠、无详情展开、无分组、无 agent 来源标识。
  - 无 agent 分流：多 agent（master/narrative/memory）的输出在消息流里不区分来源。
  - 无移动端/响应式适配（viewport 设了但布局未适配）。
  - 错误状态简陋（`sendMessage` catch 只 `setStatus`，无重试/详情）。
  - 无重连/断线处理。
  - 空状态只有一句"游戏已就绪。输入你的行动开始冒险。"。
- **桌面助手 UI 可作参考**（`AssistantView.vue` + `useAssistantTimeline.ts` + `lib/markdown.ts`）：
  - 流式状态机：`useAssistantTimeline` 把 onDelta/onRoundEnd/onTool 解析成 timeline 节点（interim 过渡文本 / thought 思考折叠 / tool 工具调用折叠），按发生顺序纵向平铺，与正文框视觉分离（左竖线+淡背景的"过程元信息"样式）。
  - markdown 用 `marked`（gfm+breaks）+ `marked-highlight` + `highlight.js`（atom-one-dark 调色），`prose-chat` 样式体系完整（h1-h4/列表/引用/表格/代码块/链接/hr）。
  - 但桌面助手是 Vue + Vite 打包，packaged 游戏前端用不了这套（见下条）。
- **packaged 前端技术约束**：原生 JS 字符串拼成单文件、经 Service Worker 虚拟 URL 加载、sandboxed iframe（`allow-scripts allow-same-origin`），**无 npm/bundler 访问**。但 `frontendFiles` 支持任意文件数量，index.html 的相对引用（`style.css`/`app.js`/`vendor/*.js`）都解析到 SW 虚拟前缀下——**可以 vendor UMD 预构建库作为额外 packaged 文件用 `<script src>` 加载**。
- **bridge 协议能力已支持但前端未用**：
  - agent 分流：`turn-delta`/`turn-tool`/`turn-round-end` 事件 payload **全部带 `agentId`**（`bridge.ts:127/139/146`），当前 app.js 完全忽略。
  - 检查点回溯：`query.query({resource:"checkpoints"})` 列出检查点（`index.ts:508`），`platform.runAction({action:"restore-checkpoint",params:{checkpointId}})` 回滚（`index.ts:362-393`）。前端未接线。
  - history：`query.query({resource:"history"})` 可读回合历史。
  - workspace：`query.query({resource:"workspace.list"})` + `platform.runAction` 的 workspace.* 动作。
- **snapshot 状态栏可用数据**：`RuntimeStateShell` = `{turn, messages, globals?}`；`PlatformContextShell` = `{version, activeFrontendId?, activeSaveId?}`。
- **inspect_frontend 工具可用**（06-23-assistant-frontend-inspection 已归档）：加载 packaged 前端、采集结构层+诊断层、驱动一回合（ephemeral save）、DOM 交互、复查 diff。重做后用它验证桥协议 + 渲染。
- **方向文档约束**（`play-frontend-sdk-direction.md`）：
  - §3 红线：助手生成的前端不应出现 `addEventListener("message")`/自己管 postMessage 握手/RPC id 匹配——这些是 SDK 职责。**本任务暂不抽 SDK**，所以协议层仍手写在 app.js，但重做时协议层逻辑应清晰隔离，为未来抽包留好结构。
  - §4 红线：`turn-completed.snapshot` 到达时必须用 snapshot 覆盖渲染，不信任累加结果。当前 app.js 已遵守，重做须保持。
  - §5：默认前端三合一，可读性即 API，关键桥调用/事件处理/snapshot 覆盖位置要有清晰结构与注释。
- **加载路径不变**：`resolvePackagedFrontendUrl` + `mountRemoteIframeFrontend` + Service Worker 虚拟 URL，重做只改前端文件内容（可加文件），不改加载机制。

## Requirements

### 已定（来自用户对齐）

- 协议层仍手写在 app.js，不抽 `packages/play-bridge` 包。
- 保持 `turn-completed.snapshot` 覆盖渲染红线。
- 协议层逻辑在 app.js 内清晰隔离，为未来抽 SDK 留结构。
- **呈现范式**：参考桌面助手 UI 的流式渲染 + 工具调用呈现机制（过程节点纵向平铺、与正文视觉分离、可折叠），但适配 packaged 前端的无 bundler 约束。
- **正文阅读感**：AI 回复（剧情正文）不做气泡式、不要明显边框，要有"阅读小说"的感觉。大段剧情正文做成聊天对话式不好。
- **工具调用轮 content 区分**：工具调用轮的 content（interim 过渡文本）不做正文同规格显示，视觉上与剧情正文区分。
- **agent 调用可视化**：其它 agent（agent_call）的调用过程要显示出来，让玩家看到多 agent 协作。bridge 事件已带 agentId，前端需消费。
- **状态栏 + UI 操作区**：留区域显示状态栏（turn 号、桥状态等）以及一些 UI 操作（检查点回溯之类）。
- **markdown 渲染方案**：vendor marked UMD 作为额外 packaged 文件（`vendor/marked.min.js`），`<script src>` 加载。架构已验证支持 packaged 前端 vendor 第三方库（SW 虚拟 URL 解析任意相对路径 + same-origin sandbox 允许脚本执行）。此决定同时确立"packaged 前端可 vendor 第三方库"作为本任务验证的附加项——玩家自定义前端大都是 packaged 形态，这条能力对它们普遍有用（可引 Three.js/PixiJS/Chart.js 等实现任意前端效果）。语法高亮暂不 vendor hljs（叙事正文几乎不需要，保持包轻）。
- **agent 分流呈现**：过程层标 agentId。agent 的过程（思考/工具调用）折叠在"过程元信息"区（仿桌面助手），折叠触发器或小标签标 agentId（如"memory · 思考"/"narrative · skill_load"）。剧情正文统一渲染为正文、不标 agent 来源，保留阅读小说感。多 agent 协作在过程层可见。
- **视觉风格**：重新设计。平台是 retro OS 风格——打开不同界面像打开不同应用，游戏前端就是其中一个"应用"，本就该有自己的视觉调性，与平台不一致反而对（不同应用视觉不同，无割裂感）。重新设计同时演示"前端自定义风格的能力"，对玩家自定义前端是范式示范。当前 warm CRT brutalist 风格保留给平台/桌面助手，游戏前端走新风格（design 阶段定具体调性，倾向贴合"阅读小说"感 + AIRP 游戏氛围）。
- **协议层验证方案**：用 inspect_frontend（项目内调用，不部署到别处）加载重做后的 packaged 前端 + 驱动一回合，看诊断层 + 事件时间线。理由：inspect_frontend 1:1 复用 `/play` 真实加载路径（SW 虚拟 URL + sandboxed iframe + bridge 握手），能采集诊断层（JS 错误/资源 404/握手状态）+ 结构层（rendered text/bridge state），send 用 ephemeral save 跑回合不碰真实存档。有 API key 环境，send 能跑。验证标准（核心 4 场景）：(1) 加载诊断层无错误、握手 ready；(2) send 驱动一回合事件时间线完整（turn-delta→turn-tool→turn-round-end→turn-completed）；(3) snapshot 覆盖渲染正确（turn-completed 后 renderedText = snapshot.state.messages）；(4) 坏前端能诊断（白屏/JS 崩/资源 404 给出具体原因）。这也顺带让 inspect_frontend 第一次在真实场景端到端跑通（它本身只被 build 验证过）。

### 待探索（需求探索中，逐项与用户对齐后填入）

（需求探索已收敛，剩余为 design 阶段技术细节）

### 已澄清范围

- **UI 操作区（检查点回溯等）**：本任务只留区域（状态栏 + 操作区布局/占位），不接线 bridge。后续逐步把功能接好，最终抽 SDK。因此本任务协议层验证聚焦核心游玩流，`query.query({resource:"checkpoints"})` / `platform.runAction restore-checkpoint` / history / workspace 等路径不在本次验证范围。

## Acceptance Criteria

### UI 成品质量
- [ ] 剧情正文（AI 回复）阅读小说感：无气泡/无强边框，大段散文排版舒适（段落间距/行距/正文宽度限制）。
- [ ] 工具调用轮 content（interim 过渡文本）与剧情正文视觉区分（过程元信息样式，非正文同规格）。
- [ ] 过程节点（思考/工具）可折叠，纵向平铺，与正文视觉分离，折叠触发器/小标签标 agentId（如"memory · 思考"）。
- [ ] markdown 完整渲染（vendor marked UMD）：表格/引用/链接/hr/列表/代码块/加粗斜体/标题。
- [ ] reasoning（思维链）呈现为可折叠 thought 节点（不再被忽略）。
- [ ] 状态栏显示 turn 号、桥状态；UI 操作区留区域（检查点回溯等占位，不接线）。
- [ ] 移动端/响应式适配（viewport 已设，布局需适配窄屏）。
- [ ] 错误状态完善（sendMessage catch 有可读提示，非简陋 setStatus）；空状态友好。
- [ ] 视觉风格重新设计（贴合阅读小说感 + AIRP 游戏氛围，与平台 retro OS 风格区隔，无割裂感）。

### 协议层原地验证（核心 4 场景，inspect_frontend）
- [ ] 场景 1：加载重做后的 packaged 前端，诊断层无 JS 错误、无资源 404、握手 ready。
- [ ] 场景 2：inspect_frontend send 驱动一回合，事件时间线完整（turn-delta→turn-tool→turn-round-end→turn-completed，按顺序+时戳）。
- [ ] 场景 3：snapshot 覆盖渲染正确——turn-completed 后 inspect_frontend 采集的 renderedText = snapshot.state.messages（验证 §4 红线）。
- [ ] 场景 4：坏前端（白屏/JS 崩/资源 404）inspect_frontend 诊断层能给出具体原因。

### 三合一真相源可读性
- [ ] 关键桥调用（call/hello/ready）、事件处理（onEvent 各分支）、snapshot 覆盖渲染位置有清晰结构与注释，助手 fork 能一眼懂。
- [ ] 协议层逻辑在 app.js 内清晰隔离（明显的段落划分/注释边界），为未来抽 SDK 留好结构。
- [ ] vendor marked 的引入方式（额外 packaged 文件 + `<script src>`）有清晰注释，示范"packaged 前端可 vendor 第三方库"范式。

### 工程质量
- [ ] vue-tsc 类型检查通过。
- [ ] 不破坏现有 PlayView packaged 加载、playFrontendBridge.sendMessage、Service Worker 虚拟 URL 机制。
- [ ] inspect_frontend 与玩家 `/play` 游玩同一张卡并存不冲突。

## Out of Scope

- 抽 `packages/play-bridge` SDK 包（留作协议层验证通过后的后续任务）。
- 发 CDN / 写 useBridge skill。
- 平台 WebUI（platform-web 的 Vue 视图：Lobby/Play/Assistant）改动——本任务只改 packaged 游戏前端文件。
- 检查点回溯 / history / workspace 等 bridge 路径的接线与验证（UI 操作区只留占位，后续逐步接）。
- 语法高亮（hljs）vendor（叙事正文几乎不需要，保持包轻）。
- 截图 / mock runtime / remote 前端自检（inspect_frontend 延后项，不在本次）。

## Open Questions

- 视觉风格的具体调性（design 阶段定：倾向贴合"阅读小说"感 + AIRP 游戏氛围，具体色板/字体/布局待 design 探索）。
- 已无阻塞 planning 的 open question；剩余为 design 阶段技术细节。
