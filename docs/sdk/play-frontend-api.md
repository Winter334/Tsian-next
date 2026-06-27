# Tsian 游戏前端 API 参考

`@tsian/play-bridge` 是游戏前端与 Tsian 平台之间的**领域 API**。它把桥协议的裸 RPC（`bridge.call("interaction.sendMessage", ...)`、事件名、params 结构）包装成前端开发者心智里的动词：`tsian.send()`、`tsian.onMessage()`、`tsian.history.get()`……

前端开发者（或生成前端的助手 agent）只需要这份文档 + 包的 TS 类型导出，不需要接触 `postMessage` 握手、RPC id 匹配、method 字符串。协议层留在包内部，不公开导出。

> 本文档对应 `@tsian/play-bridge` 领域 API 第一版。API 形态允许后续根据实际前端开发反馈调整。
> 方向背景见 `docs/active/play-frontend-sdk-direction.md`。

---

## 1. 快速开始

```ts
import { createTsian } from "@tsian/play-bridge"

const tsian = createTsian()

// 等握手完成
tsian.waitForReady().then(() => {
  console.log("就绪，会话:", tsian.sessionId)
})

// 订阅流式增量
tsian.onMessage((msg) => {
  if (msg.kind === "content") appendToStory(msg.delta)
})

// 回合定稿（含剧情选项 + token 统计）
tsian.onTurnEnd((result) => {
  if (result.options) renderOptions(result.options)
  if (result.stats) renderTokenCount(result.stats)
})

// 发送玩家行动
await tsian.send("我推开酒馆的门")
```

最小闭环就是这三步：**订阅回调 → 等就绪 → 发送**。其余能力按需接入。

### 导入

```ts
import { createTsian, parseStoryOptions } from "@tsian/play-bridge"
import type {
  TsianApi, MessageDelta, RoundEnd, TurnEndResult,
  ToolEvent, AskRequest, SessionHistory,
  InjectionMessage, SendOptions, InvokeAgentOptions,
} from "@tsian/play-bridge"
```

`createTsian()` 是唯一入口，返回 `TsianApi` 实例。`parseStoryOptions` 是纯解析工具（从流式正文里剥离 `[[选项]]…[[/选项]]` 标记块），不涉及 RPC，独立导出。所有领域类型从包直接导入，无需额外 `import "@tsian/contracts"`。

---

## 2. 生命周期

```ts
const tsian = createTsian()

tsian.ready        // boolean — 桥握手是否已完成
tsian.sessionId    // string | null — 握手后的会话 id
await tsian.waitForReady()  // Promise<void> — resolve 后可通信
```

`createTsian()` 内部自动启动桥握手（与平台 parent 的 `postMessage` 握手）。握手是异步的——构造后 `tsian.ready` 可能为 `false`。

- **`ready`**（只读布尔）：轮询握手状态的同步标志。UI 里做禁用/启用判断用（如发送按钮 `disabled = !tsian.ready`）。
- **`waitForReady()`**：返回一个 Promise，握手完成时 resolve。**推荐用它触发首屏初始化**（拉历史、启用输入），而不是自己轮询 `ready`。
- **`sessionId`**（只读）：握手后的会话 id，握手前为 `null`。用于日志或自定义会话标识。

```ts
tsian.waitForReady().then(() => {
  enableInput()
  tsian.history.get().then(renderHistory)
})
```

---

## 3. 发送

### 3.1 `tsian.send(text, options?)`

玩家行动，推进剧情。走 master agent，生成一整轮 agent 回合（可能含工具调用、多轮思考、最终正文、剧情选项）。

```ts
await tsian.send("我向酒馆老板打听消息")
// → 触发 onMessage(流式) → onRoundEnd(每轮) → onTurnEnd(定稿)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `text` | `string` | 玩家本轮输入正文 |
| `options.injection` | `InjectionMessage[]` | 注入的上下文消息（见 §3.3），可选 |
| `options.attachments` | `unknown[]` | 附件（预留，当前由表现层自行处理） |

`send` 永远走 master，不接受 `agentId`——指定 agent 是 `invokeAgent` 的事。`send` 的 Promise 在回合定稿（`onTurnEnd` 触发后）resolve；中途抛错表示发送/执行失败。

### 3.2 `tsian.invokeAgent(agentId, input, options?)`

旁路调用任意 agent。**不推进 turn、不写历史、不更新运行时快照**——结果直接返回调用方。用于 NPC 视角对话、UI 触发的单次修正、查询类 agent 等不走主线剧情的场景。

```ts
const { response } = await tsian.invokeAgent("npc-merchant", "你这把剑卖多少钱？")
renderNpcDialog(response)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `agentId` | `string` | 目标 agent id |
| `input` | `string` | 给 agent 的输入 |
| `options.injection` | `InjectionMessage[]` | 注入上下文（同 send），可选 |

返回 `InvokeAgentResult`：`{ response: string }`。`invokeAgent` 同样消耗 token，但它是单次调用、不进剧情历史。

### 3.3 injection：注入上下文消息

`send` 和 `invokeAgent` 都可带 `injection`——前端构造的、独立于玩家输入的上下文消息。平台把它按 `role` + `position` 插进 agent 的上下文消息序列，**不落盘、不进 turn 历史、不进 context.json 快照、不解释语义**。

#### 何时用 injection

平台只有一个 `contextPaths` 机制给 agent 注入常驻上下文（文件全文、路径写死、平台组装时机固定）。injection 填的空白：

- 前端加工后的状态（角色卡摘要、当前装备、好感度数值）需要每轮现带进 agent 上下文。
- 需要注入非 `user` 角色的信息（如 `system` 级指令、`assistant` 侧的预设回应）。
- 需要控制注入位置（在玩家输入之前 vs 之后）。

**注入什么由前端决定**——平台只负责按 role + position 放进序列，不校验语义、不限制内容。

#### InjectionMessage

```ts
interface InjectionMessage {
  role: "system" | "user" | "assistant"
  content: string
  position?: "before-input" | "after-input"  // 默认 "before-input"
}
```

- **`position` 是单条级别**：每条 injection 自己带 position，可一次注入混合位置的信息。
- `before-input`（默认）：插在框架信息 user 消息之后、玩家本轮输入之前。
- `after-input`：插在玩家本轮输入之后。

上下文序列结构（`send` 走 master 时）：
```
[system: AGENT.md + 工具说明]
[history: 剧情历史]
[user: 框架信息(轮次号 + contextPaths + notes)]
[before-input injection …]   ← injection 插入点 1
[user: 玩家本轮输入]
[after-input injection …]    ← injection 插入点 2
```

#### 示例：每轮注入角色状态

```ts
// 前端维护的角色状态（不依赖 agent，前端自己持有）
const charState = { name: "流萤", hp: 7, gold: 23, location: "酒馆" }

await tsian.send("我走向角落的陌生人", {
  injection: [
    {
      role: "system",
      content: `当前角色状态：${JSON.stringify(charState)}`,
      position: "before-input",  // 玩家输入之前，让 agent 先知道状态再读行动
    },
    {
      role: "system",
      content: "陌生人似乎在警惕地观察四周。",
      position: "after-input",   // 玩家输入之后，作为本轮环境补充
    },
  ],
})
```

注意：injection **不进 turn 历史**。玩家重载/回溯历史时看不到这些注入消息——它们只作用于被注入的那一轮 agent 上下文。前端若需跨轮保持状态，要么每轮重新注入，要么用 `tsian.workspace.write` 落盘成 save 文件（见 §6）。

---

## 4. 订阅

五个语义回调，每个返回一个 **unsubscribe 函数**。覆盖平台 8 个底层事件（SDK 内部已路由 + 聚合，前端不接触底层事件名）。

```ts
const off = tsian.onMessage((msg) => { ... })
// 不再需要时
off()
```

### 三粒度：增量 / 轮 / 回合

| 回调 | 对应底层事件 | 触发时机 | 用途 |
|---|---|---|---|
| `onMessage` | `turn-delta` | 每个 token 增量 | 流式渲染（累加 delta） |
| `onRoundEnd` | `turn-round-end` | 每轮边界 | 区分中间轮(interim) vs 最终轮(final) |
| `onTurnEnd` | `turn-options` + `turn-stats` + `turn-completed` 聚合 | 回合定稿 | 渲染选项 + 统计 + 收尾 |
| `onTool` | `turn-tool` | 每次工具状态变更 | 渲染工具过程节点 |
| `onAsk` | `interaction-request` | AI 提问时 | 渲染 ask_user 交互面板 |

**为什么需要三粒度**：单靠 `onMessage` 分不清一段 content delta 是中间轮的 interim 文本还是最终轮的剧情正文——`onRoundEnd` 的 `kind` 标记补上这个信息。`onTurnEnd` 把回合收尾的三个独立信号（选项、统计、完成）聚合成一次回调，前端不用自己缓存 `turn-options` 等待 `turn-completed`。

### 4.1 `tsian.onMessage(cb)`

流式增量。一个回合内会触发多次。

```ts
tsian.onMessage((msg: MessageDelta) => {
  if (msg.kind === "reasoning") {
    reasoningBuffer += msg.delta   // 思维链（通常折叠显示）
  } else {
    storyBuffer += msg.delta       // 可见文本
    renderStreaming(storyBuffer)
  }
})
```

```ts
interface MessageDelta {
  kind: "reasoning" | "content"  // reasoning=思维链；content=可见文本
  delta: string                  // 本段增量文本
  agentId: string                // 产出方 agent id
  round: number                  // 本轮序号
}
```

`content` 的含义取决于它属于哪一轮——用 `onRoundEnd` 的 `kind` 判断：`thought` 轮的 content 是 interim（过渡文本），`final` 轮的 content 才是最终正文。

### 4.2 `tsian.onRoundEnd(cb)`

每轮边界触发。一个回合可能有多轮（master 先思考/调工具，再产出最终正文）。

```ts
tsian.onRoundEnd((end: RoundEnd) => {
  if (end.kind === "thought") {
    // 中间轮/工具轮：本轮的 content 是 interim（过渡文本）
    flushInterim(end.round, end.agentId)
  } else {
    // final 轮：本轮的 content 是最终正文
    finalizeContent(end.round, end.agentId)
  }
})
```

```ts
interface RoundEnd {
  kind: "thought" | "final"
  round: number
  agentId: string
}
```

### 4.3 `tsian.onTurnEnd(cb)`

回合定稿。**SDK 聚合**了 `turn-options`（剧情选项）、`turn-stats`（token 统计）、`turn-completed`（完成信号）三个底层事件，合并成一次回调。前端不用自己缓存选项等完成信号。

```ts
tsian.onTurnEnd((result: TurnEndResult) => {
  // 选项（若有）：玩家点选 = 填输入框发送 = 新 turn
  if (result.options && result.options.length > 0) {
    renderOptionButtons(result.options)
  }
  // token 统计（若有）
  if (result.stats) {
    renderTokenCount(result.stats.totalTokens)
  }
  // 收尾：停计时器、折叠过程节点、流式区转正式态
  finalizeTurn()
})
```

```ts
interface TurnEndResult {
  options?: string[]    // 剧情选项（无则 undefined）
  stats?: TurnStats     // token 消耗统计（无则 undefined）
}
```

### 4.4 `tsian.onTool(cb)`

工具调用过程。一个工具调用可能触发多次（loading → running → success/failed），用 `callId` 去重 upsert。

```ts
tsian.onTool((tool: ToolEvent) => {
  upsertToolNode(tool.callId, tool.status, tool.output)
  renderProcessNodes()
})
```

```ts
interface ToolEvent {
  agentId: string
  round: number
  callId: string
  name: string                                    // 工具名：read/list/search/write/agent_call…
  status: "loading" | "running" | "success" | "failed"
  output?: TurnToolOutput                          // 工具返回（成功后填充）
}
```

`TurnToolOutput` 是 `string`（普通工具 observation）或 `{ type: "agent_call", targetAgent, response, status, error? }`（agent_call 结构化返回）。前端自行决定怎么呈现——折叠卡片、自然语言摘要、或完全隐藏。

### 4.5 `tsian.onAsk(cb)` + `tsian.answer()`

AI 通过 `ask_user` 工具向玩家提问。前端渲染提问面板，玩家选择/输入后用 `answer()` 回复。

```ts
tsian.onAsk((ask: AskRequest) => {
  renderAskPanel(ask.question, ask.options, ask.allowCustom)
})

// 玩家点了某个选项
await tsian.answer(ask.requestId, "接受任务")

// 玩家自定义输入
await tsian.answer(ask.requestId, "我想先讨价还价")

// 玩家取消（可选）
await tsian.answer(ask.requestId, "", true)
```

```ts
interface AskRequest {
  requestId: string
  question: string
  options?: string[]      // 预设选项
  allowCustom?: boolean   // 是否允许自定义回答（默认 true）
}
```

`answer(requestId, text, cancelled?)`：`cancelled` 为 `true` 表示玩家取消（`text` 可为空）。平台只传结构化数据，**前端自由决定怎么渲染**——按钮、输入框、对话框、或完全自定义。

---

## 5. 数据

### 5.1 `tsian.history.get()`

从 workspace turn 文件单源重建完整对话历史。返回所有已持久化的回合，每个回合的 timeline 按真实发生顺序排列。

```ts
const { entries, turn } = await tsian.history.get()
// turn = 下一回合序号（最大 turn + 1）
// entries = SessionHistoryEntry[]，每个含一个 turn 的完整 timeline

for (const entry of entries) {
  for (const item of entry.timeline) {
    if (item.kind === "user") renderUserMessage(item.content)
    else if (item.kind === "assistant") renderNarrative(item.content, item.stats)
    else if (item.kind === "options") renderOptionButtons(item.items)
    else renderProcessNode(item)  // interim / thought / tool
  }
}
```

```ts
interface SessionHistory {
  entries: SessionHistoryEntry[]
  turn: number                 // 下一回合序号
}

interface SessionHistoryEntry {
  turn: number
  createdAt: string
  timeline: TurnTimelineItem[]  // user/assistant/interim/thought/tool/options，按发生顺序
}
```

`history.get()` 是重载/回溯后重建对话的唯一入口——它从 workspace 的 turn 文件读回，是数据真相源（不是前端内存累加）。前端刷新、回到剧情视图、恢复检查点后都该调用它。

### 5.2 `tsian.checkpoints.list()` / `tsian.checkpoints.restore()`

检查点（存档）回溯。平台在每回合后自动生成 `after-turn` 检查点，初始有 `initial` 检查点。

```ts
const checkpoints = await tsian.checkpoints.list()
// CheckpointSummary[]，按新→旧排序

for (const cp of checkpoints) {
  renderCheckpointCard(cp.turn, cp.reason, cp.createdAt, () => {
    restoreCheckpoint(cp.id)
  })
}

async function restoreCheckpoint(id: string) {
  const { turn } = await tsian.checkpoints.restore(id)
  // 恢复后必须重载历史（DOM 已失效，从 turn 文件重建）
  const history = await tsian.history.get()
  renderSessionHistory(history.entries)
  setStatus(`已回溯到第 ${turn} 回`)
}
```

```ts
interface CheckpointSummary {
  id: string
  turn: number
  label: string
  reason: "initial" | "after-turn" | "manual"
  createdAt: number
  messageCount: number
  workspaceFileCount: number
}
```

`restore(checkpointId)` 返回 `{ turn: number }`（回溯到的回合号）。**恢复是破坏性操作**——回滚此后所有进度，UI 侧应做二次确认。恢复后前端内存的流式 DOM 已失效，必须用 `history.get()` 从文件重建。

---

## 6. workspace 读写

前端可在 workspace 里读写文件，**自己维护状态**（角色卡、设置、存档元数据等）。这是独立于 agent 工具调用的前端通道——agent 的 `workspace_read`/`workspace_write` 走 agent runtime，前端的 `tsian.workspace.*` 走桥 RPC，两条路径独立。

```ts
tsian.workspace.read(path, scope?)
tsian.workspace.list(path?, scope?)
tsian.workspace.search(query, options?)
tsian.workspace.write(path, content, scope?)
```

### WorkspaceScope

```ts
type WorkspaceScope =
  | "effective"      // 合并视图（读默认）
  | "card-content"   // 卡内容（agent 写，前端只读）
  | "save-runtime"   // 存档运行时（前端写的目标）
  | "platform-meta"
  | "card-frontend"
  | "temp"
```

**权限边界**：前端 `write` 只能写 `save-runtime`（actorLevel 1）。写 `card-content` 是助手 agent（level 4）的事，不是游戏前端的事。读默认 `effective`（合并视图），可指定 scope 限定。

### read

```ts
const file = await tsian.workspace.read("save/character.json")
if (file === null) {
  // null = 文件不存在（不是错误，错误会抛异常）
  initNewCharacter()
} else {
  const char = JSON.parse(file.content)
  renderCharacter(char)
}
```

返回 `WorkspaceReadResult | null`。`null` 表示文件不存在；操作失败抛异常（不吞错）。`WorkspaceReadResult` 含 `content`（文本全文）+ 行级切片元数据（`totalLines`/`offset`/`truncated`），普通消费只读 `content` 即可。

### list

```ts
const entries = await tsian.workspace.list("save/")
// WorkspaceEntry[]：{ path, name, kind: "file"|"directory", updatedAt?, size?, childCount? }
```

### search

```ts
const results = await tsian.workspace.search("流萤", { limit: 20, contextLines: 3 })
// WorkspaceSearchResult[]：{ path, name, matches, preview, score, ... }
```

| option | 说明 |
|---|---|
| `scope` | 限定搜索范围 |
| `limit` | 限制结果数 |
| `contextLines` | 每条匹配的上下文行数 |
| `ignoreCase` | 忽略大小写 |

### write

```ts
await tsian.workspace.write("save/character.json", JSON.stringify(charState))
// → WorkspaceWriteResult：{ path, scope, file, changed }
```

**典型用法：前端持有状态 + 每轮注入**

前端要跨轮保持的角色状态，落盘到 `save-runtime`，每轮 `send` 时从文件读出再注入：

```ts
// 状态变更时落盘
async function updateCharState(patch: Partial<CharState>) {
  Object.assign(charState, patch)
  await tsian.workspace.write("save/character.json", JSON.stringify(charState))
}

// 每轮 send 时注入当前状态
async function sendAction(text: string) {
  await tsian.send(text, {
    injection: [{
      role: "system",
      content: `当前角色状态：${JSON.stringify(charState)}`,
      position: "before-input",
    }],
  })
}
```

这样状态持久化在 workspace（回溯可恢复），注入只负责把当前快照带进本轮 agent 上下文。

---

## 7. 通用入口

高频能力走语义化方法（`send`/`onMessage`/`history`...）。冷门或未来新增的平台能力走两个通用入口——领域语言里的"查资源 / 执行动作"，**不暴露 RPC method 字符串**。

### 7.1 `tsian.query(resource, params?)`

查询类资源（只读）。

```ts
const result = await tsian.query("agent-registry")
// → 平台返回的资源数据（结构取决于 resource）
```

### 7.2 `tsian.runAction(action, params?)`

执行类动作（可能有副作用）。

```ts
const result = await tsian.runAction("some-future-action", { foo: "bar" })
```

**何时用通用入口**：当某个平台能力还没有对应的语义化方法时。语义化方法是高频能力的便捷封装，通用入口保证平台所有能力都可达——SDK 是翻译层不是决策层，不丢能力。返回类型是 `unknown`，前端按平台文档断言具体形状。

---

## 8. 类型参考

全部类型从 `@tsian/play-bridge` 导出，无需额外 import contracts。

### TsianApi（完整接口）

```ts
interface TsianApi {
  // 生命周期
  readonly ready: boolean
  waitForReady(): Promise<void>
  readonly sessionId: string | null

  // 发送
  send(text: string, options?: SendOptions): Promise<void>
  invokeAgent(agentId: string, input: string, options?: InvokeAgentOptions): Promise<InvokeAgentResult>

  // 订阅（每个返回 unsubscribe 函数）
  onMessage(cb: (msg: MessageDelta) => void): () => void
  onRoundEnd(cb: (round: RoundEnd) => void): () => void
  onTurnEnd(cb: (result: TurnEndResult) => void): () => void
  onTool(cb: (tool: ToolEvent) => void): () => void
  onAsk(cb: (ask: AskRequest) => void): () => void

  // 回答 ask_user
  answer(requestId: string, text: string, cancelled?: boolean): Promise<void>

  // 数据
  readonly history: { get(): Promise<SessionHistory> }
  readonly checkpoints: {
    list(): Promise<CheckpointSummary[]>
    restore(checkpointId: string): Promise<{ turn: number }>
  }

  // workspace
  readonly workspace: {
    read(path: string, scope?: WorkspaceScope): Promise<WorkspaceReadResult | null>
    list(path?: string, scope?: WorkspaceScope): Promise<WorkspaceEntry[]>
    search(query: string, options?: {
      scope?: WorkspaceScope; limit?: number; contextLines?: number; ignoreCase?: boolean
    }): Promise<WorkspaceSearchResult[]>
    write(path: string, content: string, scope?: WorkspaceScope): Promise<WorkspaceWriteResult>
  }

  // 通用入口
  query(resource: string, params?: Record<string, unknown>): Promise<unknown>
  runAction(action: string, params?: Record<string, unknown>): Promise<unknown>
}
```

### 发送选项

```ts
interface SendOptions {
  injection?: InjectionMessage[]
  attachments?: unknown[]
}
interface InvokeAgentOptions {
  injection?: InjectionMessage[]
}
```

### InjectionMessage

```ts
interface InjectionMessage {
  role: "system" | "user" | "assistant"
  content: string
  position?: "before-input" | "after-input"  // 默认 "before-input"
}
```

### 事件回调类型

```ts
interface MessageDelta {
  kind: "reasoning" | "content"
  delta: string
  agentId: string
  round: number
}
interface RoundEnd {
  kind: "thought" | "final"
  round: number
  agentId: string
}
interface TurnEndResult {
  options?: string[]
  stats?: TurnStats
}
interface ToolEvent {
  agentId: string
  round: number
  callId: string
  name: string
  status: "loading" | "running" | "success" | "failed"
  output?: TurnToolOutput
}
interface AskRequest {
  requestId: string
  question: string
  options?: string[]
  allowCustom?: boolean
}
```

### 数据类型

```ts
interface SessionHistory {
  entries: SessionHistoryEntry[]
  turn: number
}
interface SessionHistoryEntry {
  turn: number
  createdAt: string
  timeline: TurnTimelineItem[]
}
interface CheckpointSummary {
  id: string
  turn: number
  label: string
  reason: "initial" | "after-turn" | "manual"
  createdAt: number
  messageCount: number
  workspaceFileCount: number
}
interface InvokeAgentResult {
  response: string
}
interface TurnStats {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}
```

`TurnTimelineItem` 是判别联合（`kind: "user" | "assistant" | "interim" | "thought" | "tool" | "options"`），各变体字段不同——见 `@tsian/contracts` 的 `runtime.ts` 完整定义。`TurnToolOutput` 是 `string | { type: "agent_call", targetAgent, response, status, error? }`。

### workspace 类型

```ts
type WorkspaceScope =
  | "effective" | "card-content" | "save-runtime"
  | "platform-meta" | "card-frontend" | "temp"

interface WorkspaceEntry {
  path: string; name: string; kind: "file" | "directory"
  updatedAt?: number; size?: number; childCount?: number
}
interface WorkspaceReadResult {  // extends WorkspaceFile
  path: string; content: string
  createdAt: number; updatedAt: number
  totalLines?: number; returnedLines?: number
  offset?: number; truncated?: boolean
  // …（图片/二进制相关字段见 contracts）
}
interface WorkspaceSearchResult {
  path: string; name: string; updatedAt: number
  score: number; matches: WorkspaceSearchMatch[]
  matchesTruncated: boolean; preview: string
}
interface WorkspaceWriteResult {
  path: string; scope: WorkspaceScope; file: WorkspaceFile; changed: boolean
}
```

---

## 附：从裸 bridge 迁移

旧版 SDK 暴露裸 `bridge.call` + `bridge.on({...})`。迁移到领域 API 的对应关系：

| 旧（裸 bridge） | 新（领域 API） |
|---|---|
| `bridge.call("interaction.sendMessage", {content})` | `tsian.send(content)` |
| `bridge.call("interaction.invokeAgent", {agentId, input})` | `tsian.invokeAgent(agentId, input)` |
| `bridge.respondInteraction(requestId, text)` | `tsian.answer(requestId, text)` |
| `bridge.on({ onReady })` | `tsian.waitForReady().then(...)` |
| `bridge.on({ onEvent })` 里 `turn-delta` | `tsian.onMessage(cb)` |
| `bridge.on({ onEvent })` 里 `turn-round-end` | `tsian.onRoundEnd(cb)` |
| `bridge.on({ onEvent })` 里 `turn-tool` | `tsian.onTool(cb)` |
| `bridge.on({ onEvent })` 里 `turn-completed` + `onTurnOptions` | `tsian.onTurnEnd(cb)`（聚合） |
| `bridge.on({ onInteractionRequest })` | `tsian.onAsk(cb)` |
| `createSessionHistory(bridge)` | `tsian.history.get()` |
| `listCheckpoints(bridge)` | `tsian.checkpoints.list()` |
| `restoreCheckpoint(bridge, id)` | `tsian.checkpoints.restore(id)` |
| `bridge.call("query.query", {resource:"workspace.read", ...})` | `tsian.workspace.read(path)` |
| `bridge.call("query.query", {resource:...})` | `tsian.query(resource)` |
| `bridge.call("platform.runAction", {action, params})` | `tsian.runAction(action, params)` |

参考实现：`apps/play-frontend-dev/src/main.ts` 是迁移到领域 API 的完整前端示例，可作 fork 起点。
