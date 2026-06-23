# Design — 默认前端 UI 重做与协议层原地验证

## 0. 设计总纲

重做 `default-frontend-files.ts` 的三合一默认前端（`index.html` + `style.css` + `app.js` + 新增 `vendor/marked.umd.js`），达成两件事：

1. **UI 成品化**：从半成品到成品，呈现范式改为"小说式正文阅读 + 过程元信息分离 + agent 分流 + 状态栏/操作区"，视觉重新设计（与平台 retro OS 区隔）。
2. **协议层原地验证**：重做后用 `inspect_frontend` 加载真实 packaged 前端 + 驱动一回合，端到端验证桥协议（握手/RPC/事件/snapshot 覆盖）真的没问题。

协议层仍手写在 `app.js`，但**结构上清晰隔离**为"协议层（未来 SDK 的前身）"+"表现层"两大块，为后续抽 `packages/play-bridge` 包留好边界。

## 1. 文件结构与 vendor 机制

### 1.1 packaged 文件清单（4 个）

```
frontend/
  index.html          # 骨架 + <script src> 引用
  style.css           # 新视觉风格
  app.js              # 协议层 + 表现层（清晰隔离）
  vendor/
    marked.umd.js     # 第三方 markdown 库（vendor 范式示范）
```

路径约束：`normalizeFrontendFile` 要求所有 frontend 文件以 `frontend/` 开头（`game-cards.ts:211`），vendor 文件路径 `frontend/vendor/marked.umd.js` 合规。

### 1.2 vendor marked UMD 嵌入方式

**问题**：`marked.umd.js` 是 73KB minified 源码，不能手抄进字符串数组。

**方案**：在 `default-frontend-files.ts` 源码里用 Vite `?raw` 后缀 import：

```ts
// Vite ?raw 把文件内容作为字符串内联进打包产物
import markedUmdSource from "marked/lib/marked.umd.js?raw"

const FRONTEND_VENDOR_MARKED = markedUmdSource  // 73KB string，运行时即此字符串
```

`marked` v15.0.12 已在 root `node_modules`（`lib/marked.umd.js`），是经典 UMD 格式（`(function(global, factory){...})(this, function(){... return module.exports}))`），`<script src>` 加载后挂全局 `window.marked`。无需额外配置，Vite 内置 `?raw` 支持。

### 1.3 index.html 引用方式

```html
<!-- vendor 库：在 app.js 之前加载，app.js 依赖 window.marked -->
<script src="vendor/marked.umd.js" defer></script>
<!-- app.js 也要 defer，且在 marked 之后（defer 保证顺序） -->
<script src="app.js" defer></script>
```

`defer` 保证执行顺序 = 文档顺序，`marked` 在 `app.js` 之前执行，app.js 可直接用 `window.marked`。

### 1.4 defaultFrontendFiles() 导出

```ts
export function defaultFrontendFiles(): PutLocalGameCardFrontendFileInput[] {
  return [
    { path: "frontend/index.html", data: FRONTEND_INDEX_HTML },
    { path: "frontend/style.css", data: FRONTEND_STYLE_CSS },
    { path: "frontend/app.js", data: FRONTEND_APP_JS },
    { path: "frontend/vendor/marked.umd.js", data: markedUmdSource },
  ]
}
```

`data` 接受 string，`normalizeFrontendFile` → `toBlob` 会用 `inferMediaTypeFromPath` 推断 `application/javascript`，SW 返回正确 Content-Type。

### 1.5 三合一真相源的可读性约定

`default-frontend-files.ts` 顶部注释说明 vendor 机制：

```ts
// Vendor 机制：第三方库源码通过 Vite ?raw 内联为字符串，作为额外 packaged 文件。
// index.html 用 <script src="vendor/xxx.js" defer> 加载，app.js 用 window.xxx 访问。
// 这是 packaged 前端引入第三方库的标准范式——玩家自定义前端可同样 vendor
// Three.js/PixiJS/Chart.js 等实现任意前端效果。助手 fork 时一并带走。
```

## 2. app.js 协议层/表现层隔离结构

app.js 用**明显的段落划分 + 注释边界**隔离两大块。未来抽 SDK 时，协议层整块搬进 `packages/play-bridge`，表现层留在 app.js。

### 2.1 文件顶层结构

```js
"use strict";

// ═══════════════════════════════════════════════════════════
// 协议层（Bridge Layer）
// 桥协议握手 / RPC 传输 / 事件订阅 / 状态暴露。
// 未来抽为 packages/play-bridge 的 useBridge。助手 fork 时
// 这块原样保留，只改表现层。
// ═══════════════════════════════════════════════════════════

const CHANNEL = "tsian.play-bridge.v1";
let sessionId = null;
let nextReqId = 1;
const pending = new Map();
let bridgeReady = false;

// RPC: call(method, params) → Promise
function call(method, params) { ... }

// 握手: 发 hello，等 ready
function initBridge() { ... }

// 事件分发: 收到 event 消息 → onEvent 钩子（表现层注册）
const eventHandlers = { onReady: null, onEvent: null, onSnapshot: null };
function setEventHandlers(handlers) { ... }

// message 路由（ready/response/event）
window.addEventListener("message", function (e) { ... });

// 启动握手
initBridge();

// ═══════════════════════════════════════════════════════════
// 表现层（Presentation Layer）
// 消息渲染 / 流式 / 过程节点 / 状态栏 / 输入。助手地盘，自由改。
// 只通过协议层的 call() 和 eventHandlers 与平台交互，不碰 postMessage。
// ═══════════════════════════════════════════════════════════

// ... 表现层全部逻辑 ...
```

### 2.2 协议层对外 API（表现层只用这些）

协议层向表现层暴露：
- `call(method, params)` — RPC 调用（`runtime.getRuntimeSnapshot` / `interaction.sendMessage` 等）
- `setEventHandlers({ onReady, onEvent, onSnapshot })` — 注册回调
  - `onReady(sessionId)` — 握手完成
  - `onEvent(event, payload)` — 流式事件（turn-delta/turn-tool/turn-round-end/turn-completed）
  - `onSnapshot(snapshot)` — snapshot 到达（§4 红线：覆盖渲染）

**关键红线**：表现层**不出现** `addEventListener("message")`、不自己 `postMessage`、不自己拼 RPC id（§3 红线）。这些全在协议层。这是未来抽 SDK 的边界——协议层 = SDK，表现层 = 助手改的地盘。

### 2.3 与当前 app.js 的协议层差异

当前 app.js 协议层逻辑基本不变（hello/ready/call/事件路由/snapshot 覆盖都对），主要改动：
- **结构隔离**：抽成清晰的协议层段落 + 对外 API（当前是平铺的）。
- **事件分发解耦**：当前 `onEvent` 直接操作 DOM；重做后协议层只调 `eventHandlers.onEvent(event, payload)`，表现层的事件处理器接管 DOM 操作。
- **snapshot 覆盖红线显式化**：`onSnapshot` 钩子专门处理覆盖渲染，注释强调 §4 红线。

## 3. 表现层：过程节点状态机

### 3.1 从 useAssistantTimeline 移植到原生 JS

桌面助手的 `useAssistantTimeline.ts` 是 Vue composable（操作 reactive 对象）。packaged 前端无 Vue，移植为原生 JS 的**过程状态机**：

```js
// 表现层状态（一个回合内）
const turnState = {
  timeline: [],              // 过程节点数组
  streamingText: "",         // 当前轮 content 流式
  streamingReasoning: "",    // 当前轮 reasoning 流式
  content: "",               // 最终回复
};

// onEvent 处理器（注册给协议层）
function handleEvent(event, payload) {
  if (event === "turn-delta") {
    if (payload.kind === "reasoning") {
      turnState.streamingReasoning += payload.delta;
    } else {
      turnState.streamingText += payload.delta;
      renderStreaming();
    }
  } else if (event === "turn-round-end") {
    finalizeRound(payload.round, payload.kind);  // thought|final
  } else if (event === "turn-tool") {
    upsertToolNode(payload);  // 按 callId 去重
  } else if (event === "turn-completed") {
    handleSnapshot(payload.snapshot);  // §4 覆盖渲染
    finalizeTurn();
  }
}
```

### 3.2 过程节点类型（移植 AssistantTimelineNode）

```js
// 节点结构（与桌面助手对齐，便于助手跨场景理解）
// { type: "thought"|"tool"|"interim", id, round, ... , collapsed, agentId }
//
// thought: 思维链，默认折叠
// tool: 工具调用，按 callId 去重，loading→success/failed 更新同节点
// interim: 工具调用轮的过渡文本，始终展开
//
// 新增 agentId: 从事件 payload.agentId 取（桌面助手忽略了 _agentId，
// 本任务消费它做 agent 分流）。
```

### 3.3 finalizeRound 逻辑（镜像 useAssistantTimeline.onRoundEnd）

```
finishReason === "tool_calls":
  - interimText (streamingText) 非空 → push interim 节点（始终展开）
  - reasoning 非空 → push thought 节点（默认折叠）
  - 清空两个缓冲

finishReason === "stop"（最终轮）:
  - reasoning 非空 → push thought 节点
  - streamingText → content（最终回复）
  - 清空两个缓冲
```

### 3.4 finalizeTurn（回合结束）

- 折叠所有 thought/tool 节点（保留可展开回看）
- 清空流式缓冲
- content 已在 turn-completed 被 snapshot 覆盖（§4 红线）

### 3.5 agent 分流呈现

过程节点带 `agentId`，渲染时在折叠触发器/小标签显示：
- thought 节点：`[agentId] · 思考`（如 `memory · 思考`）
- tool 节点：`[agentId] · [name]`（如 `narrative · skill_load`）
- interim 节点：不标 agentId（过渡文本，当正常可见回复）

剧情正文（content）**不标 agent 来源**——保留阅读小说感。多 agent 协作在过程层可见。

## 4. 表现层：正文阅读感渲染

### 4.1 剧情正文（AI 回复）

- **无气泡、无强边框**：assistant 消息不用 `.msg` 边框样式（当前 app.js 的 `.msg.assistant` 有 border）。
- **小说式排版**：正文宽度限制（`max-width: 42em` 居中），段落间距（`p { margin: 0 0 1em }`），行距 1.8（阅读舒适），正文字体用衬线或可读性高的无衬线（非等宽——当前用 JetBrains Mono 等宽，不适合长文阅读）。
- **markdown 渲染**：用 `window.marked.parse(content)`（gfm + breaks），输出 HTML 注入正文容器。
- **用户消息**：可轻量区分（如左竖线 + 淡背景），但也不做气泡。

### 4.2 工具调用轮 content（interim）

interim 节点是"过程元信息"样式（左竖线 + 淡背景 + 小字号），**不是正文同规格**。与剧情正文视觉区分明确。

### 4.3 流式渲染

- streamingText 实时 `marked.parse` + 注入临时流式容器（带光标动画）。
- turn-completed 的 snapshot 覆盖后，流式容器被正文渲染替换（§4 红线）。

## 5. 表现层：状态栏 + 操作区

### 5.1 状态栏

布局位置：header 区域（title + status）或独立状态条。显示：
- **turn 号**：从 `snapshot.state.turn` 取
- **桥状态**：loading / ready / turn-active / error（从协议层 bridgeReady + 发送状态推）
- **当前回合 agent 活动指示**：流式/工具调用中显示"回合进行中"

### 5.2 UI 操作区（占位）

- 留区域（如 header 右侧或侧边抽屉触发器），放占位按钮/入口。
- 检查点回溯等**不接线**（本任务 out of scope），只留 UI 位置 + 注释标注"后续接线"。
- 占位元素 disabled 或点击提示"功能开发中"。

### 5.3 数据来源

- `call("runtime.getRuntimeSnapshot")` → `snapshot.state.turn` / `snapshot.state.messages`
- `call("platform.getPlatformContext")` → version / activeFrontendId / activeSaveId（状态栏可选显示）
- turn 号随 snapshot 更新（每次 turn-completed 覆盖渲染时同步刷新状态栏）

## 6. 视觉风格设计方向

### 6.1 设计前提

- 平台是 retro OS 风格，游戏前端是独立"应用"，**本就该有自己的视觉调性**。
- 重新设计同时演示"前端自定义风格能力"（对玩家自定义前端是范式示范）。
- 贴合"阅读小说"感 + AIRP 游戏氛围。

### 6.2 调性方向（implement 阶段细化）

倾向：**温暖羊皮纸 / 旧书阅读**调性——
- 背景：暖色调深色（如 `#1a1612` 暖褐黑）或羊皮纸浅色（`#f4ecd8`），倾向深色护眼。
- 正文：衬线字体（如 `"Source Han Serif", "Noto Serif SC", Georgia, serif`），行距 1.8。
- 强调色：暖金 / 烛光黄（呼应 AIRP 氛围，但与平台 neon 区隔——用更柔和的暖金而非霓虹黄）。
- 过程元信息：淡墨色 / 灰褐，左竖线 + 淡背景。
- 整体：沉静、阅读导向，非终端/科技风。

**注**：具体色板和字体在 implement 阶段用 frontend-ui-ux 技能细化，design 只定方向。关键是不与平台 retro OS / CRT neon 风格同质化。

### 6.3 响应式

- 桌面：正文居中 max-width，过程节点 + 状态栏 + 输入区垂直布局。
- 移动：单列，正文占满，输入区固定底部，状态栏简化。

## 7. inspect_frontend 协议层验证执行

### 7.1 验证入口

`inspect_frontend` 通过助手 agent workspace tool 调用（`assistant-chat.ts:462` 注入 `runInspectFrontend: createFrontendInspector()`）。验证有两种执行方式：

- **方式 A（推荐）**：在 dev server 让助手 agent 调 `inspect_frontend` 工具（这是它的设计用途）。
- **方式 B**：在浏览器 dev console 直接调暴露的 `createFrontendInspector()`（需手动接线导出，非默认）。

本任务验证走方式 A：dev server 启动后，让助手调 `inspect_frontend` 加载重做后的 active 卡 packaged 前端。

### 7.2 核心 4 场景执行细节

**场景 1：加载诊断**
```
inspect_frontend({})  // 无 send/actions，纯加载观测
```
验收：
- `diagnostics.errors` 为空（无 JS 错误）
- `diagnostics.resourceFailures` 为空（无资源 404，含 vendor/marked.umd.js）
- `diagnostics.bridgeHandshake === "ready"`
- `structure.bridgeState === "ready"`

**场景 2：驱动一回合事件时间线**
```
inspect_frontend({ send: { message: "测试协议层验证消息" } })
```
验收：
- `timeline` 数组非空，事件按顺序：turn-delta → (turn-tool)? → turn-round-end → turn-completed
- 每条带 `t` 时戳，单调递增

**场景 3：snapshot 覆盖渲染**
```
// 场景 2 的 send 后，inspect_frontend 结果含 structure.renderedText
// 对比 timeline 最后一条 turn-completed 的 payload.snapshot.state.messages
```
验收：
- `structure.renderedText` 反映 `snapshot.state.messages` 的最新内容（§4 红线：snapshot 覆盖渲染，不信任累加）
- turn-completed 后前端 DOM 的消息区 = snapshot 的 messages

**场景 4：坏前端诊断**
```
// 手动构造坏前端（如 app.js 故意报错 / 引不存在的资源），让助手 inspect
inspect_frontend({})
```
验收：
- 白屏（不发 ready）：`diagnostics.bridgeHandshake === "timeout"`，`structure.bridgeState === "loading"`，DOM 空态推断
- JS 崩：`diagnostics.errors` 有具体 message + stack
- 资源 404：`diagnostics.resourceFailures` 有 url + status

### 7.3 验证前置条件

- dev server（`npm run dev`）启动
- provider API key 配置好（用户确认有）
- active 卡存在（内置空白卡即用，`createDefaultPlatformGameCard` seed）
- inspect_frontend 工具在助手 `platformTools.enabled`（06-23-inspection 任务已配）

## 8. 数据流与契约

### 8.1 协议层数据流（不变，只是结构隔离）

```
parent (platform-host)
  └─ mountRemoteIframeFrontend → iframe (packaged frontend)
       └─ app.js 协议层
            ├─ initBridge() → postMessage(hello)
            ├─ 收 ready → eventHandlers.onReady(sessionId)
            ├─ call(method, params) → postMessage(request) → 收 response → resolve Promise
            └─ 收 event → eventHandlers.onEvent(event, payload)
                 ├─ turn-delta → 表现层流式累积
                 ├─ turn-tool → 表现层过程节点
                 ├─ turn-round-end → 表现层 finalizeRound
                 └─ turn-completed → eventHandlers.onSnapshot(payload.snapshot) → 覆盖渲染
```

### 8.2 表现层数据流

```
onReady(sessionId)
  └─ 状态栏 ready + call("runtime.getRuntimeSnapshot") → 初次渲染 messages

onEvent("turn-delta", {agentId, delta, kind})
  ├─ kind=content → streamingText += delta → renderStreaming()
  └─ kind=reasoning → streamingReasoning += delta（不流式显示）

onEvent("turn-tool", {agentId, callId, name, status, output})
  └─ upsertToolNode（按 callId 去重，带 agentId 标签）

onEvent("turn-round-end", {agentId, round, kind})
  └─ finalizeRound：interim/thought 节点入 timeline

onEvent("turn-completed", {snapshot})
  └─ onSnapshot(snapshot)
       ├─ renderMessages(snapshot.state.messages)  // §4 覆盖渲染
       ├─ 状态栏 turn = snapshot.state.turn
       └─ finalizeTurn（折叠过程节点 + 清缓冲）
```

### 8.3 契约不变项

- bridge 协议 `tsian.play-bridge.v1` 不变（`bridge.ts` 不改）
- `PlayFrontendBridge` 接口不变
- `resolvePackagedFrontendUrl` / `mountRemoteIframeFrontend` 不改
- `defaultFrontendFiles()` 返回值多一个 vendor 文件，结构不变
- `DEFAULT_FRONTEND_BINDING` 不变（entry 仍 `frontend/index.html`）

## 9. 兼容性与迁移

### 9.1 已有存档的默认卡（seed 逻辑已探明）

`defaultFrontendFiles()` 在两处注入（都是**创建新卡时**）：
- `platform-host/game-cards.ts:396` — `copyPlatformGameCardAsLocal`（builtin 卡复制为可编辑 local 卡）
- `storage/game-cards.ts:758` — `createEditableLocalGameCardFromBuiltin`（storage fallback 创建）

builtin 空白卡本身**不带 frontend**（`ensureBuiltinBlankGameCard` re-seed 只检查 content files，不传 frontendFiles）。

**结论**：
- 新建的 local 卡自动用新前端（`defaultFrontendFiles()` 返回新 4 文件含 vendor）。
- 已存在的 local 卡（用户之前创建/fork 的）frontend files 不自动更新，保持旧版——这是 packaged 隔离语义（fork 是快照，官方更新不冲掉已 fork 的卡，方向文档 §5）。
- **无需迁移步骤**。但 implement 验证时必须用**新建的卡**或**手动重置 frontend** 的卡测试新前端，不能用旧卡（旧卡还是旧前端）。

### 9.2 不破坏现有的保证

- 不改 `mountRemoteIframeFrontend`（复用不改）
- 不改 `playFrontendBridge`（前端只消费 bridge，不改 host 侧）
- 不改 SW（`tsian-game-card-frontend-sw.js` 不动，vendor 文件走同一路径）
- 不改 `resolvePackagedFrontendUrl`
- sandbox 不变（`allow-scripts allow-same-origin allow-forms`）

## 10. 权衡与风险

### 10.1 vendor marked 的包体积

73KB UMD 进 IndexedDB。对比：当前 3 文件总大小 < 10KB。增重明显但可接受——markdown 完整渲染是成品质量刚需，且示范了 vendor 范式。若未来要减重，可换更轻的 markdown 库或手写子集，但本次优先成品质量。

### 10.2 协议层隔离的结构债

当前 app.js 协议层是平铺的，重做要抽成隔离段落。这是**为未来抽 SDK 的前期投资**——不抽包但留边界。风险：隔离不彻底会导致未来抽 SDK 时还得重构。缓解：design §2 的边界清晰（协议层 = postMessage/握手/RPC/事件分发，表现层 = DOM/渲染/状态），implement 时严格按边界写。

### 10.3 过程节点状态机移植正确性

`useAssistantTimeline` 是 Vue reactive，移植到原生 JS 需手动管理状态更新 + DOM 渲染触发。风险：状态更新后忘记 re-render。缓解：状态机操作后统一调 `render()` 重渲染相关区域，不依赖响应式自动更新。

### 10.4 视觉风格 design 阶段未完全定死

色板/字体在 implement 阶段用 frontend-ui-ux 技能细化。风险：implement 时风格方向跑偏。缓解：design §6 定了方向（温暖羊皮纸/旧书阅读），implement 时有 frontend-ui-ux 技能保证 UI 质量，且可用 inspect_frontend 实时看效果迭代。

### 10.5 协议层验证依赖 API key

场景 2/3 的 send 需调 master agent，依赖 provider API key。用户确认有，但若实测时 API 不可用，降级到只验证场景 1+4（加载诊断 + 坏前端诊断），场景 2/3 留待 API 可用时补。

### 10.6 回退

整块是 `default-frontend-files.ts` 内容替换 + 新增 vendor 文件。出问题可 git revert 该文件回旧版，不影响平台其他功能。协议层验证失败说明桥协议有 bug，那是更深层问题，需单独排查（但正是本任务要发现的目标）。
