# Tsian 游戏前端 API 参考

`@tsian/play-bridge` 是游戏前端与 Tsian 平台之间的**领域 API**。它把底层桥协议包装成前端开发者心智里的动词：`tsian.send()`、`tsian.onMessage()`、`tsian.history.get()`……

前端开发者（或生成前端的助手 agent）只需要这份文档 + 包的 TS 类型导出，不需要接触底层握手、消息路由或协议方法名。协议层留在包内部，不公开导出。

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

// 回合定稿（turn-completed 携带已投影并持久化的 assistant item）
tsian.onTurnEnd((result) => {
  const assistant = result.assistant
  if (!assistant) return
  renderAssistant(assistant.displayContent ?? assistant.content)
  const choices = assistant.projections?.choices
  if (Array.isArray(choices)) renderOptions(choices.filter((it): it is string => typeof it === "string"))
  if (assistant.stats) renderTokenCount(assistant.stats.totalTokens)
})

// 发送玩家行动
await tsian.send("我推开酒馆的门")
```

最小闭环就是这三步：**订阅回调 → 等就绪 → 发送**。其余能力按需接入。

### 导入

```ts
import { createTsian } from "@tsian/play-bridge"
import type {
  TsianApi, MessageDelta, RoundEnd, TurnEndResult,
  ToolEvent, AskRequest, SessionHistory,
  InjectionMessage, SendOptions, InvokeAgentOptions,
  AgentInvocationEvent,
} from "@tsian/play-bridge"
```

`createTsian()` 是唯一入口，返回 `TsianApi` 实例。所有领域类型从包直接导入，无需额外 `import "@tsian/contracts"`。`parseStoryOptions` 仍作为 legacy/default-frontend 兼容 helper 从包导出；新正式回合的结构化 UI 数据应优先由 `TurnEndResult.assistant.projections` 承载，具体 key 由游戏卡/前端约定。

---

## 2. 生命周期

```ts
const tsian = createTsian()

tsian.ready        // boolean — 桥握手是否已完成
tsian.sessionId    // string | null — 握手后的会话 id
await tsian.waitForReady()  // Promise<void> — resolve 后可通信
```

`createTsian()` 内部自动启动与平台 parent 的桥握手。握手是异步的——构造后 `tsian.ready` 可能为 `false`。

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

玩家正式回合输入，推进剧情 turn/history/checkpoint 等正式回合语义。前端不传 `agentId`；入口 Agent 由游戏卡 `game-card.json` 的 `runtime.entrypoints.playerTurn` 决定。

```ts
await tsian.send("我向酒馆老板打听消息")
// → 触发 onMessage(流式) → onRoundEnd(每轮) → onTurnEnd(定稿)
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `text` | `string` | 玩家本轮输入正文 |
| `options.injection` | `InjectionMessage[]` | 注入的上下文消息（见 §3.3），可选 |
| `options.attachments` | `unknown[]` | 附件（预留，当前由表现层自行处理） |

`send` 是“玩家正式回合”入口：会写回剧情历史、turn timeline、workspace 事务，并在成功后创建回合 checkpoint。`send` 的 Promise 在回合定稿（`onTurnEnd` 触发后）resolve；中途抛错表示发送/执行失败。

游戏卡作者通过 `game-card.json` 配置正式回合入口：

```json
{
  "runtime": {
    "entrypoints": {
      "playerTurn": "storyteller"
    }
  }
}
```

`playerTurn` 是 Agent id。平台不会在缺失时静默猜测入口；缺少或为空会作为游戏卡配置错误失败。

### 3.2 `tsian.invokeAgent(agentId, input, options?)`

前端/卡流程指定某个 Agent 执行一次任务。它不推进正式 turn、不写剧情历史、不更新运行时快照；返回最终 `response`，过程流通过 `onAgentInvocation` 订阅。适合开局建模、UI 触发说明、后置维护、NPC/导演/场记等非玩家正式回合任务。

```ts
const invocationId = crypto.randomUUID()
const off = tsian.onAgentInvocation((event) => {
  if (event.invocationId !== invocationId) return
  if (event.type === "delta" && event.kind === "content") appendDraft(event.delta)
  if (event.type === "tool") updateToolCard(event)
})

try {
  const { response } = await tsian.invokeAgent("npc-merchant", "你这把剑卖多少钱？", {
    invocationId,
    purpose: "npc-dialog",
  })
  renderNpcDialog(response)
} finally {
  off()
}
```

| 参数 | 类型 | 说明 |
|---|---|---|
| `agentId` | `string` | 目标 agent id |
| `input` | `string` | 给 agent 的输入 |
| `options.invocationId` | `string` | invocation 级 id；建议调用前生成并传入，用于过滤并发事件。省略时 SDK 自动生成 |
| `options.purpose` | `string` | 调用目的标签，会出现在 `started` 事件里，便于 UI/日志过滤 |
| `options.checkpoint` | `boolean \| { mode?: "create", ... } \| { mode: "overwrite", checkpointId, ... } \| { mode: "current-turn-auto", ... }` | Workspace 提交成功后执行的 checkpoint 操作。`current-turn-auto` 会覆盖/更新当前回合自动 checkpoint，适合回合后维护 |
| `options.commitMode` | `"workspace" \| "workspace-with-checkpoint"` | 已废弃兼容字段。旧 `"workspace-with-checkpoint"` 会映射为 `checkpoint: { mode: "current-turn-auto" }` |
| `options.checkpointReason` | `string` | 已废弃兼容数据，仅随旧 `commitMode` 使用 |
| `options.injection` | `InjectionMessage[]` | 注入上下文（同 send），可选 |
| `options.contextSlot` | `string` | 可选上下文隔离 slot；配合 `persist` 防止不同调用方上下文串 |
| `options.persist` | `boolean` | `true` 时读写目标 Agent 的 `context[-slot].json`；默认 `false`，一次性调用 |

返回 `InvokeAgentResult`：`{ invocationId: string; response: string }`。`invokeAgent` 同样消耗 token；Promise resolve 表示最终文本可用，流式 delta / round / tool / completed / failed 事件通过 `onAgentInvocation` 到达。

`agent_call` 不是 SDK 入口。它是 Agent 内部工具：一次 `send` 或 `invokeAgent` 过程中，当前 Agent 可以自主调用联系人 Agent 协作。delegated Agent 产生的 delta/tool 会沿同一个 `invocationId`（或同一个 turn 事件流）向外可见，事件里的 `agentId` 表示实际产出者。

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

上下文序列结构（`send` 走卡配置的玩家回合入口 Agent 时）：
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

六个语义回调，每个返回一个 **unsubscribe 函数**。正式回合使用 `onMessage` / `onRoundEnd` / `onTool` / `onTurnEnd`；前端指定 Agent 的任务调用使用 `onAgentInvocation`。SDK 内部路由和聚合底层事件，前端通常不需要接触底层事件名。

```ts
const off = tsian.onMessage((msg) => { ... })
// 不再需要时
off()
```

### 三粒度：增量 / 轮 / 回合

| 回调 | 对应底层事件 | 触发时机 | 用途 |
|---|---|---|---|
| `onMessage` | `turn-delta` | 正式回合每个 token 增量 | 流式渲染（累加 delta） |
| `onRoundEnd` | `turn-round-end` | 正式回合每轮边界 | 区分中间轮(interim) vs 最终轮(final) |
| `onTurnEnd` | `turn-completed` | 正式回合定稿 | projected assistant + 收尾 |
| `onTool` | `turn-tool` | 正式回合每次工具状态变更 | 渲染工具过程节点 |
| `onAsk` | `interaction-request` | AI 提问时 | 渲染 ask_user 交互面板 |
| `onAgentInvocation` | `agent-invocation` | `invokeAgent` 的 started/delta/round/tool/completed/failed | 渲染指定 Agent 调用的流式文本、工具进度与完成/失败状态 |

**为什么需要三粒度**：单靠 `onMessage` 分不清一段 content delta 是中间轮的 interim 文本还是最终轮的剧情正文——`onRoundEnd` 的 `kind` 标记补上这个信息。`onTurnEnd` 把回合收尾信号和已持久化的 projected assistant item 聚合成一次回调，前端不用自己等待 `turn-completed` 后再查询正式 assistant 数据。

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

每轮边界触发。一个回合可能有多轮（入口 Agent 先思考/调工具，再产出最终正文）。

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

回合定稿。`turn-completed` 会携带平台已提交并持久化的 projected assistant timeline item。前端显示时通常使用 `assistant.displayContent ?? assistant.content`；结构化 UI 数据从 `assistant.projections` 读取，key 由游戏卡/前端约定（例如某个卡约定 `choices: string[]`）。Token 统计随 `assistant.stats` 一起到达。

```ts
tsian.onTurnEnd((result: TurnEndResult) => {
  const assistant = result.assistant
  if (assistant) {
    renderAssistant(assistant.displayContent ?? assistant.content)
    const choices = assistant.projections?.choices
    if (Array.isArray(choices)) {
      renderOptionButtons(choices.filter((it): it is string => typeof it === "string"))
    }
    if (assistant.stats) {
      renderTokenCount(assistant.stats.totalTokens)
    }
  }
  // 收尾：停计时器、折叠过程节点、流式区转正式态
  finalizeTurn()
})
```

```ts
interface TurnEndResult {
  turn?: number
  assistant?: AssistantTurnTimelineItem
}

interface AssistantTurnTimelineItem {
  kind: "assistant"
  content: string
  displayContent?: string
  projections?: Record<string, JsonValue>
  stats?: TurnStats
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

### 4.6 `tsian.onAgentInvocation(cb)`

`invokeAgent` 的 invocation 级过程事件。多个并发调用共享同一个订阅通道，用 `invocationId` 过滤。

```ts
const invocationId = crypto.randomUUID()
const off = tsian.onAgentInvocation((event) => {
  if (event.invocationId !== invocationId) return
  switch (event.type) {
    case "started": startSpinner(event.purpose); break
    case "delta": appendInvocationText(event.agentId, event.kind, event.delta); break
    case "round-end": closeInvocationRound(event.agentId, event.round, event.kind); break
    case "tool": upsertInvocationTool(event); break
    case "completed": stopSpinner(); break
    case "failed": showError(event.error.message); break
  }
})

await tsian.invokeAgent("stage-manager", prompt, { invocationId, purpose: "post-turn-maintenance" })
off()
```

```ts
type AgentInvocationEvent =
  | { type: "started"; invocationId: string; agentId: string; purpose?: string }
  | { type: "delta"; invocationId: string; agentId: string; round: number; kind: "reasoning" | "content"; delta: string }
  | { type: "round-end"; invocationId: string; agentId: string; round: number; kind: "thought" | "final" }
  | { type: "tool"; invocationId: string; agentId: string; round: number; callId: string; name: string; status: "loading" | "running" | "success" | "failed"; output?: TurnToolOutput }
  | { type: "completed"; invocationId: string; agentId: string }
  | { type: "failed"; invocationId: string; agentId: string; error: PlatformActionError }
```

`agentId` 是实际产出事件的 Agent。若被调用 Agent 在内部用 `agent_call` 调用了联系人，delegated Agent 的事件也会使用同一个 `invocationId`，但 `agentId` 会变成 delegated Agent 的 id。

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

### 5.2 `tsian.checkpoints.*`

检查点（存档）回溯与显式管理。平台在每回合后自动生成 `retention: "auto"` 检查点；前端/卡片可创建或固定 `retention: "pinned"` 检查点。

```ts
const checkpoints = await tsian.checkpoints.list()
// CheckpointSummary[]，按新→旧排序

for (const cp of checkpoints) {
  renderCheckpointCard(cp.turn, cp.retention, cp.createdAt, () => {
    restoreCheckpoint(cp.id)
  })
}

// 从当前活动存档状态创建一个新 checkpoint
const cp = await tsian.checkpoints.create({
  label: "关键选择前",
  retention: "pinned",
  source: "card",
  tags: ["choice"],
})

// 只更新元数据，不重建 manifest，不改变 restore 目标
await tsian.checkpoints.update(cp.id, { label: "关键选择前（已命名）" })

// 保留 id，替换为当前活动存档状态
await tsian.checkpoints.overwrite(cp.id, { label: "关键选择后" })

async function restoreCheckpoint(id: string) {
  const { turn } = await tsian.checkpoints.restore(id)
  // 恢复后必须重载历史（DOM 已失效，从 turn 文件重建）
  const history = await tsian.history.get()
  renderSessionHistory(history.entries)
  setStatus(`已回溯到第 ${turn} 回`)
}
```

```ts
type CheckpointRetention = "auto" | "pinned"
type CheckpointSource = "platform" | "user" | "card" | "agent"

interface CheckpointSummary {
  id: string
  turn: number
  label: string
  createdAt: number
  updatedAt?: number
  retention: CheckpointRetention
  source?: CheckpointSource
  tags?: string[]
  visible?: boolean
  metadata?: Record<string, JsonValue>
  messageCount: number
  workspaceFileCount: number
  /** 兼容数据，不再作为行为开关。 */
  reason?: string
}
```

- `list(options?)` 返回当前活动存档 checkpoint，默认不含 `visible: false` 的隐藏项；可传 `includeHidden`、`retention`、`source`、`tags` 过滤。
- `create(options?)` 从当前活动存档状态创建一个新 checkpoint。兼容 `create("label")`。
- `update(id, patch)` 只改 metadata/label/retention/source/tags/visible/reason，不重建 snapshot/manifest。
- `overwrite(id, options?)` 保留 checkpoint id，使用当前活动存档状态替换 snapshot/manifest，并可同时更新 metadata。
- `delete(id)` 显式删除 checkpoint；受前端调试保护的 baseline checkpoint 会被拒绝删除。
- `restore(id)` 返回 `{ turn: number }`（回溯到的回合号）。**恢复是破坏性操作**——回滚此后所有进度，UI 侧应做二次确认。恢复后前端内存的流式 DOM 已失效，必须用 `history.get()` 从文件重建。

---

## 6. workspace 读写

前端可在 workspace 里读写文件，**自己维护状态**（角色卡、设置、存档元数据等）。这是独立于 agent 工具调用的前端通道——agent runtime 里的 `read` / `write` 等短工具名受 `workspace_read` / `workspace_write` platformTools gate 控制，前端使用 `tsian.workspace.*`，两条路径独立。

```ts
tsian.workspace.read(path, scope?)
tsian.workspace.list(path?, scope?)
tsian.workspace.search(query, options?)
tsian.workspace.write(path, content, scope?)
```

`content` 可以是 `string`（文本写入）或 `Blob`（二进制/媒体写入，如图片）。文本写入保持原有语义；`Blob` 写入走同一 `save-runtime` workspace 通道，适合玩家上传头像等媒体资产。

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
// 文本写入
await tsian.workspace.write("save/character.json", JSON.stringify(charState))
// → WorkspaceWriteResult：{ path, scope, file, changed }

// 二进制/媒体写入（Blob）
const blob = new Blob([bytes], { type: "image/webp" })
await tsian.workspace.write("save/assets/portraits/characters/萧玄.webp", blob, "save-runtime")
```

`content` 接受 `string | Blob`。`string` 用于文本文件（JSON/MD/配置等），`Blob` 用于二进制/媒体资产（图片等）。两种写入都走同一 `save-runtime` workspace 通道，返回相同的 `WorkspaceWriteResult`。

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

## 7. 卡配置

前端通过 `tsian.card.entrypoints()` 读取当前卡 runtime 入口配置，决定调用哪个 agent，**不硬编码 agent 名**。改名只动卡模板，前端零改动。

### 7.1 `tsian.card.entrypoints()`

```ts
const ep = await tsian.card.entrypoints()
// → { playerTurn?: string, postTurnMaintenance?: string }
```

返回 `GameCardRuntimeEntrypoints`：

| 字段 | 说明 |
|---|---|
| `playerTurn` | `send` / `interaction.sendMessage` 正式玩家回合入口 agent id。 |
| `postTurnMaintenance` | 回合后维护入口 agent id。默认 novel 前端在正文落定后用它调 `invokeAgent` 发起回合后维护（场记）。省略则无同步流程。 |

卡未配置 `runtime.entrypoints` 时返回空对象 `{}`。

#### 示例：回合后同步

```ts
const ep = await tsian.card.entrypoints()
const maintenanceAgentId = ep.postTurnMaintenance?.trim()
if (!maintenanceAgentId) return // 卡未配置，无同步流程

const invocationId = `sync-turn-${turn}-${Date.now().toString(36)}`
await tsian.invokeAgent(maintenanceAgentId, input, {
  invocationId,
  purpose: "post-turn-maintenance",
  checkpoint: { mode: "current-turn-auto" },
  persist: true,
})
```

**Toast 文案不应引用 agent 名**：UI 只描述阶段行为（如"本回合整理中"），不出现 `postTurnMaintenance` 的值或 agent title——这样 agent 改名只动模板，前端和 Toast 零改动。

---

## 8. 低层 escape hatch

高频能力都应该走语义化方法（`send` / `invokeAgent` / `onMessage` / `history` / `checkpoints` / `workspace` / `card`）。`query` 和 `runAction` 只作为**临时逃生入口**保留：当平台能力还没有 SDK 语义封装、且当前前端确实需要访问时才使用。

常规游戏前端不应优先使用它们，也不应通过它们重新实现本文档已经包装好的能力。新增高频用法时，优先给 `TsianApi` 增加明确的领域方法。

### 8.1 `tsian.query(resource, params?)`

临时查询 escape hatch。返回值是 `unknown`，调用方必须知道目标 resource 的具体形态并自行断言。

```ts
const result = await tsian.query("agent-registry")
// → 平台返回的资源数据（结构取决于 resource）
```

### 8.2 `tsian.runAction(action, params?)`

临时动作 escape hatch。动作可能有副作用；调用方必须知道目标 action 的具体返回形态并自行处理错误。

```ts
const result = await tsian.runAction("some-future-action", { foo: "bar" })
```

返回类型是 `unknown`。不要在普通前端逻辑中直接拼平台 action/resource 来绕过已有 SDK 方法；如果某个能力开始频繁使用，应补一个语义化 SDK 方法。

---

## 9. 类型参考

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
  onAgentInvocation(cb: (event: AgentInvocationEvent) => void): () => void

  // 回答 ask_user
  answer(requestId: string, text: string, cancelled?: boolean): Promise<void>

  // 数据
  readonly history: { get(): Promise<SessionHistory> }
  readonly checkpoints: {
    list(options?: ListCheckpointOptions): Promise<CheckpointSummary[]>
    create(options?: string | CreateCheckpointOptions): Promise<CheckpointSummary>
    update(checkpointId: string, patch: UpdateCheckpointOptions): Promise<CheckpointSummary>
    overwrite(checkpointId: string, options?: OverwriteCheckpointOptions): Promise<CheckpointSummary>
    delete(checkpointId: string): Promise<void>
    restore(checkpointId: string): Promise<{ turn: number }>
  }

  // workspace
  readonly workspace: {
    read(path: string, scope?: WorkspaceScope): Promise<WorkspaceReadResult | null>
    list(path?: string, scope?: WorkspaceScope): Promise<WorkspaceEntry[]>
    search(query: string, options?: {
      scope?: WorkspaceScope; limit?: number; contextLines?: number; ignoreCase?: boolean
    }): Promise<WorkspaceSearchResult[]>
    write(path: string, content: string | Blob, scope?: WorkspaceScope): Promise<WorkspaceWriteResult>
  }

  // 卡配置
  readonly card: {
    entrypoints(): Promise<GameCardRuntimeEntrypoints>
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
  invocationId?: string
  purpose?: string
  checkpoint?: InvokeAgentCheckpointOption
  /** @deprecated use checkpoint */
  commitMode?: "workspace" | "workspace-with-checkpoint"
  /** @deprecated compatibility data */
  checkpointReason?: string
  injection?: InjectionMessage[]
  contextSlot?: string
  persist?: boolean
}
```

```ts
type InvokeAgentCheckpointOption =
  | boolean
  | ({ mode?: "create" } & CreateCheckpointOptions)
  | ({ mode: "overwrite"; checkpointId: string } & OverwriteCheckpointOptions)
  | { mode: "current-turn-auto"; label?: string; tags?: string[]; metadata?: Record<string, JsonValue> }
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
  turn?: number
  assistant?: AssistantTurnTimelineItem
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
type AgentInvocationEvent =
  | { type: "started"; invocationId: string; agentId: string; purpose?: string }
  | { type: "delta"; invocationId: string; agentId: string; round: number; kind: "reasoning" | "content"; delta: string }
  | { type: "round-end"; invocationId: string; agentId: string; round: number; kind: "thought" | "final" }
  | { type: "tool"; invocationId: string; agentId: string; round: number; callId: string; name: string; status: "loading" | "running" | "success" | "failed"; output?: TurnToolOutput }
  | { type: "completed"; invocationId: string; agentId: string }
  | { type: "failed"; invocationId: string; agentId: string; error: PlatformActionError }
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
  createdAt: number
  updatedAt?: number
  retention: "auto" | "pinned"
  source?: "platform" | "user" | "card" | "agent"
  tags?: string[]
  visible?: boolean
  metadata?: Record<string, JsonValue>
  messageCount: number
  workspaceFileCount: number
  reason?: string
}
interface InvokeAgentResult {
  invocationId: string
  response: string
}
interface TurnStats {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}
interface AssistantTurnTimelineItem {
  kind: "assistant"
  content: string
  displayContent?: string
  projections?: Record<string, JsonValue>
  stats?: TurnStats
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
