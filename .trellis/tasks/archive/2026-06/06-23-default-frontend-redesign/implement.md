# Implement — 默认前端 UI 重做与协议层原地验证

## 验证命令

```bash
# 类型检查（全流程门槛）
npm run build:contracts && npm run build:web

# dev server（协议层验证用）
npm run dev
```

## 风险文件 / 回退点

- **唯一改动文件**：`apps/platform-web/src/storage/default-frontend-files.ts`（内容替换 + 新增 vendor import）。
- **回退**：`git checkout -- apps/platform-web/src/storage/default-frontend-files.ts`，不影响平台其他功能。
- **不动文件**：`bridge/remote-iframe-bridge.ts`、`package-loader/packaged-frontend.ts`、`public/tsian-game-card-frontend-sw.js`、`platform-host/index.ts`、`packages/contracts/src/bridge.ts`。

## 有序实现 checklist

### 阶段 A：vendor marked 接入骨架

- [ ] **A1** 在 `default-frontend-files.ts` 顶部加 `import markedUmdSource from "marked/lib/marked.umd.js?raw"`（Vite ?raw 内联）。
- [ ] **A2** `defaultFrontendFiles()` 返回数组加 `{ path: "frontend/vendor/marked.umd.js", data: markedUmdSource }`。
- [ ] **A3** `FRONTEND_INDEX_HTML` 加 `<script src="vendor/marked.umd.js" defer></script>`（在 app.js 之前，defer 保证顺序）。
- [ ] **A4** 顶部加 vendor 机制注释（design §1.5 的三合一可读性约定）。
- [ ] **A5** `npm run build:web` 验证 ?raw import 编译通过、打包产物含 marked 源码字符串。
- **验证门**：build 通过 + 打包后 `defaultFrontendFiles()` 返回 4 个文件。

### 阶段 B：app.js 协议层隔离

- [ ] **B1** 重写 `FRONTEND_APP_JS`，顶部加协议层/表现层分隔注释（design §2.1）。
- [ ] **B2** 协议层段落：`CHANNEL`/`sessionId`/`nextReqId`/`pending`/`bridgeReady` 常量 + `call(method, params)` + `initBridge()` + `setEventHandlers({onReady, onEvent, onSnapshot})`。
- [ ] **B3** message 路由（`addEventListener("message")`）放协议层，按 kind 分发：ready → onReady；response → pending resolve/reject；event → onEvent（turn-completed 额外调 onSnapshot）。
- [ ] **B4** 协议层底部 `initBridge()` 发 hello。
- [ ] **B5** 验证协议层逻辑与当前 app.js 等价（hello/ready/call/事件路由/snapshot 覆盖行为不变），只是结构隔离。
- **验证门**：协议层段落清晰、对外 API 只有 call + setEventHandlers、表现层不碰 postMessage。

### 阶段 C：HTML 结构 + CSS 视觉设计

- [ ] **C1** 重写 `FRONTEND_INDEX_HTML` 骨架：`header(标题+状态栏+操作区占位) + main(正文区+过程区) + footer(输入区)`。去掉旧的 timeline div（过程节点改由 app.js 动态生成在正文区相关位置）。
- [ ] **C2** 用 frontend-ui-ux 技能设计新视觉风格（design §6 方向：温暖羊皮纸/旧书阅读调性，与平台 retro OS 区隔）。
- [ ] **C3** 重写 `FRONTEND_STYLE_CSS`：新色板（暖褐黑底 / 暖金强调 / 衬线正文字体）、正文阅读排版（max-width 42em / 行距 1.8 / 段落间距）、过程元信息样式（左竖线+淡背景+小字号）、响应式（移动端单列）。
- [ ] **C4** 剧情正文无气泡无强边框（小说式）；用户消息轻量区分（左竖线+淡背景）；interim 过程元信息与正文视觉区分。
- [ ] **C5** 状态栏样式（turn 号 + 桥状态 + agent 活动指示）；操作区占位样式（disabled 按钮，注释标"后续接线"）。
- **验证门**：视觉风格成品感、正文阅读舒适、过程/正文/状态栏视觉层次清晰、移动端可用。

### 阶段 D：表现层过程节点状态机

- [ ] **D1** 表现层段落：`turnState` 对象（timeline/streamingText/streamingReasoning/content）。
- [ ] **D2** `handleEvent(event, payload)` 处理器（注册给协议层 `setEventHandlers`）：turn-delta 分 reasoning/content；turn-tool 按 callId 去重 upsert；turn-round-end 调 finalizeRound；turn-completed 调 onSnapshot + finalizeTurn。
- [ ] **D3** `finalizeRound(round, kind)` 镜像 `useAssistantTimeline.onRoundEnd`：tool_calls 轮 push interim+thought；stop 轮 push thought + streamingText→content。过程节点带 agentId（从 payload.agentId 取）。
- [ ] **D4** `finalizeTurn()`：折叠所有 thought/tool 节点 + 清空流式缓冲。
- [ ] **D5** 渲染函数：`renderMessages(messages)` 用 `window.marked.parse` 渲染正文（§4 红线：snapshot 覆盖）；`renderStreaming()` 流式临时容器+光标；`renderTimeline()` 过程节点折叠（thought/tool 可折叠，interim 始终展开，标签标 agentId）。
- [ ] **D6** `onSnapshot(snapshot)`：renderMessages(snapshot.state.messages) + 状态栏 turn 更新 + finalizeTurn。
- [ ] **D7** `onReady(sessionId)`：状态栏 ready + `call("runtime.getRuntimeSnapshot")` 初次渲染 + 输入区启用。
- [ ] **D8** 输入区 sendMessage：`call("interaction.sendMessage", {content})` + 状态栏 turn-active + 流式开始。
- **验证门**：过程节点状态机逻辑与 useAssistantTimeline 等价、agentId 分流呈现、snapshot 覆盖红线保持。

### 阶段 E：成品质量收尾

- [ ] **E1** 错误状态完善：sendMessage catch 有可读提示（非简陋 setStatus）；协议层 call reject 的 error 有展示。
- [ ] **E2** 空状态友好（无消息时的引导文案，非一句"游戏已就绪"）。
- [ ] **E3** 滚动行为：流式时贴底、用户滚上去不强制拉回（smart scroll，参考 AssistantView 的 userPinnedToBottom）。
- [ ] **E4** 状态栏数据接线：turn 号从 snapshot.state.turn、桥状态从 bridgeReady + 发送状态。
- [ ] **E5** 三合一可读性终检：协议层/表现层边界注释清晰、关键桥调用/snapshot 覆盖/事件处理位置有注释、vendor 机制有注释。助手 fork 能一眼懂。
- **验证门**：成品质量自检通过、可读性达标。

### 阶段 F：协议层原地验证（inspect_frontend 4 场景）

前置：dev server 启动 + API key 配好 + 用**新建的 local 卡**（或手动重置 frontend 的卡）测试。

- [ ] **F1** 新建 local 卡（或确认 active 卡用的是新 frontend files——检查 `/play` 加载后渲染是新 UI）。
- [ ] **F2 场景 1（加载诊断）**：让助手调 `inspect_frontend({})`。验收：diagnostics.errors 空、resourceFailures 空（含 vendor/marked.umd.js）、bridgeHandshake=ready、bridgeState=ready。
- [ ] **F3 场景 2（回合事件时间线）**：让助手调 `inspect_frontend({send:{message:"测试协议层验证消息"}})`。验收：timeline 非空，事件顺序 turn-delta→(turn-tool)?→turn-round-end→turn-completed，时戳单调递增。
- [ ] **F4 场景 3（snapshot 覆盖渲染）**：场景 2 结果中对比 structure.renderedText 与 timeline 最后 turn-completed 的 payload.snapshot.state.messages。验收：renderedText 反映 snapshot 最新 messages（§4 红线）。
- [ ] **F5 场景 4（坏前端诊断）**：手动构造坏前端（临时改 app.js 故意报错 / 引不存在的资源），让助手 inspect。验收：白屏→bridgeHandshake=timeout + DOM 空态；JS 崩→errors 有 message+stack；资源 404→resourceFailures 有 url+status。验证后恢复 app.js。
- [ ] **F6** inspect_frontend 与玩家 `/play` 并存不冲突（inspect 跑完 ephemeral save 删除，玩家存档不受影响）。
- **验证门**：4 场景全通过 = 协议层端到端验证完成。

### 阶段 G：工程质量门

- [ ] **G1** `npm run build:contracts && npm run build:web` 通过（vue-tsc 类型检查）。
- [ ] **G2** 不破坏现有 PlayView packaged 加载（`/play` 能正常加载新前端）。
- [ ] **G3** 不破坏 playFrontendBridge.sendMessage（玩家发消息能正常跑回合）。
- [ ] **G4** 回退验证：`git diff` 确认只改了 `default-frontend-files.ts`。

## review gates

- 阶段 A→B 间：vendor 接入骨架 build 通过再写协议层。
- 阶段 C→D 间：HTML/CSS 视觉成品感确认后再写状态机（状态机操作 DOM 结构，结构要先定）。
- 阶段 E→F 间：成品质量自检通过再跑协议层验证（验证的是成品，不是半成品）。
- 阶段 F→G 间：4 场景全通过再跑工程质量门。

## rollback points

- 阶段 A 失败：?raw import 不支持 → 检查 Vite 版本，或换 `fs.readFileSync` 构建时内联（vite.config 加 plugin）。
- 阶段 F 场景 1 失败（加载就有错）：vendor 路径或 Content-Type 问题 → 检查 SW fetch 日志 + inferMediaTypeFromPath 对 `.umd.js` 的推断。
- 阶段 F 场景 2/3 失败（回合跑不通）：可能是协议层 bug（正是本任务要发现的）或 API key 问题 → 先确认 API key 可用（普通 `/play` 发消息能跑），再排查协议层。
- 阶段 F 场景 4 失败（坏前端诊断不出）：inspect_frontend 诊断层能力问题 → 参考 06-23-inspection 任务的诊断层实现。
