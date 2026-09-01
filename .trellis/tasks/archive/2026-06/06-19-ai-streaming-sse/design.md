# Design — 流式输出 + 思考流可见（SSE 逐字渲染）

> 父任务：`06-19-ai-streaming-response`。依赖子1 `06-19-native-tool-calling`（已归档，commit `636a167`）。
> PRD：`prd.md`。姊妹任务子2b `06-19-ai-agent-process-visible`（工具过程可展开 + 并行执行），依赖本任务。

## 1. 范围与模式边界

- **仅在 `toolCallMode=native` 下流式**。`text` 模式不流式（`callModel` 仍 `Promise<string>` 一次性，行为同现状）。
- 流式只在 native 路径 `callModelNative` → 新增 `streamAssistantReplyNative` 实现。
- 三家协议：OpenAI/DeepSeek（`chat/completions` SSE）、Gemini（`:streamGenerateContent?alt=sse`）、Claude（`messages` SSE）。
- 非流式回退：响应 `content-type` 非 `text/event-stream` 时降级走 `response.json()` + `extractNativeResult`（不调 onDelta）。

## 2. 核心决策：text delta 全推 + 无 onReset（思考流可见）

### 方向（替代原"边显示+工具轮清空"）

原 design 的 `onDelta` 实时推 + `onReset` 撤回工具轮方案**已废弃**。新方向：**text delta 全推、不清空**。

- 思考轮（工具轮）的 text delta 照常 `onDelta` 推 UI——它就是给玩家看的"思考流"，让玩家感知 agent 在动脑，减少等待焦虑。
- 工具轮结束时，已推的思考流**保留显示**（不 onReset 清空）。runtime 执行工具、进下一轮，下一轮 text delta 继续追加。
- 最终轮 text delta 也照常推，流结束即完整最终回复。

### 为什么不再需要 onReset

onReset 原是为了"玩家只看最终正文"而清掉工具轮 text。现方向反转为"过程可见"——思考流要给玩家看，所以不清。整个 onReset 机制消失，流式逻辑简化（少一个易错点：无需判断轮次、无需撤回 UI）。

### 思考/最终的 UI 区分（本任务最小化）

流式时 text delta 到达时无法预知是思考轮还是最终轮（`finishReason` 要本轮结束才知）。本任务在桌面 AssistantView **暂不做区分**：所有 text delta 都追加到同一 assistant 消息 `content`，流式时玩家看到连续文字（思考 + 最终混在一起逐字出现）。理由：
- 桌面 AssistantView 是基础验证界面，小说式/折叠呈现归 play 前端（子2b + 游戏前端）。
- 平台通过 `turn-delta` 事件带 `round` 轮号推给游戏前端，游戏前端按 round-end 归类区分思考/最终（子2b 提供 `turn-round-end` 事件）。
- 桌面只验证"逐字流式 + 思考可见"基础能力，不追求折叠体验。

### 委托 agent_call 不流式

`runAgentRuntimeTurn` 构建 entry agent options 时注入 `onDelta`（`agent-runtime/index.ts:1316`）；构建 delegated agent options 时（`:895`）**不注入**（undefined）。委托 agent 的 `callModelNative` 收到 `onDelta===undefined` → `streamAssistantReplyNative` 内部走非流式回退（见 §4.4）。玩家只看 entry agent 的流式。

## 3. 架构与数据流

```
AssistantView.send()
  ├─ messages.push(reactive({role:"assistant", content:""}))  // 占位空消息
  ├─ runAssistantChat({ message, history, onDelta })
  │    └─ runAgentRuntimeTurn(input{...,onDelta}, capabilities)
  │         └─ callAgentModelWithWorkspaceTools(entry msgs, ..., entryOptions{onDelta})
  │              └─ callAgentModelWithWorkspaceToolsNative(msgs, ..., options, ...)
  │                   └─ for each round:
  │                        capabilities.callModelNative(runtimeMsgs, options{onDelta}, tools)
  │                         └─ streamAssistantReplyNative(msgs, {onDelta, tools, config})
  │                              ├─ fetch + getReader() + TextDecoder 逐块读
  │                              ├─ SSE 切分 → extractStreamDelta/extractStreamToolCalls
  │                              ├─ text delta → onDelta(delta, round)  [全推,含思考流]
  │                              ├─ tool_calls delta → 后台累积(不推UI)
  │                              └─ 轮结束: stop→返回 text; tool_calls→返回 toolCalls(不清UI)
  │                   └─ stop→return text; tool_calls→executeTools→下一轮(思考流保留)
  ├─ 前端: delta 缓冲队列 → rAF 匀速释放到 content  [①打字机]
  ├─ 智能滚动: 仅用户在底部时自动滚  [②智能滚动]
  ├─ (停止按钮) abort controller  [③停止生成]
  ├─ await 后: messages[last].content = result.replyText  // 校正
  └─ persistCurrentSession()
```

## 4. 模型层（runtime-host/ai.ts）

### 4.1 类型

```ts
export interface StreamAssistantReplyNativeOptions extends GenerateAssistantReplyNativeOptions {
  onDelta?: (delta: string, round: number) => void
}
```
> `round` 由调用方（`callModelNative` 闭包）从 `options` 传入；`streamAssistantReplyNative` 本身只处理单轮 SSE，round 透传给 `onDelta`。实际 round 来源：`callAgentModelWithWorkspaceToolsNative` 的循环变量。需在 `AgentRuntimeModelCallOptions` 加 `round?` 字段，或 `onDelta` 签名直接含 round 由 runtime 在调用时绑定。**采用后者**：`onDelta?: (delta: string, round: number) => void`，runtime 调 `callModelNative` 前用闭包绑定当前 round 传给 streamAssistantReplyNative。

### 4.2 ProviderAdapter 扩展

每个 adapter 新增 5 个流式方法：

| 方法 | OpenAI/DeepSeek | Gemini | Claude |
|---|---|---|---|
| `buildStreamUrl(config)` | 同 `buildUrl` | `buildUrl` + `:streamGenerateContent?alt=sse` | 同 `buildUrl` |
| `buildStreamRequestBody(config, messages, tools)` | `buildNativeRequestBody` + `stream:true`（custom merge 后赋值） | `buildNativeRequestBody`（靠 URL，body 不加 stream） | `buildNativeRequestBody` + `stream:true` |
| `extractStreamDelta(dataLine)` | `choices[0].delta.content` | `candidates[0].content.parts[].text` | `content_block_delta` → `data.delta.text` |
| `extractStreamToolCalls(dataLine)` | `choices[0].delta.tool_calls[].function.{name,arguments增量}` | `candidates[0].content.parts[].functionCall`（一次性完整） | `content_block_start` tool_use + `input_json_delta` 累积 |
| `extractStreamFinish(dataLine)` | `choices[0].finish_reason` | `candidates[0].finishReason` | `message_delta.stop_reason` |

- Claude 的 event/data 配对：`streamAssistantReplyNative` 维护 `currentEvent` 上下文，按 event 分派调对应 extract（OpenAI/Gemini 纯 data 行，忽略 event）。
- OpenAI 流式 `tool_calls.arguments` 按 `index` 累积拼接，本轮结束再 `JSON.parse`。
- Gemini `functionCall` part 在流中通常一次性完整出现，直接解析成 `NativeToolCall`。

### 4.3 streamAssistantReplyNative

```ts
export async function streamAssistantReplyNative(
  messages: RuntimeChatMessage[],
  options: StreamAssistantReplyNativeOptions = {},
): Promise<ModelCallResult>
```

流程：
1. `config = options.config ?? getBrowserAiConfig()`（同 `generateAssistantReplyNative`）。
2. `adapter = selectAdapter(config.kind)`；`url = adapter.buildStreamUrl(config)`；`requestBody = adapter.buildStreamRequestBody(config, messages, tools)`。
3. `pushAiDebugRecord` + `logDebugGroup`（label `chat-stream`）。
4. `createTimedAbortSignal`（`DEFAULT_CHAT_TIMEOUT_MS` 10 分钟）。
5. `fetch(url, {method:"POST", headers, body, signal})`。
6. **非 SSE 回退**：`!response.headers.get("content-type")?.includes("text/event-stream")` → `payload = await response.json()` → `adapter.extractNativeResult(payload)` 返回（不调 onDelta）。
7. **SSE 路径**：`reader = response.body!.getReader()`；`decoder = new TextDecoder()`；`lineBuffer=""`；`textBuffer=""`；`isToolRound=false`；`toolCallAccumulator=new Map<index,{id,name,args:string}>`；`finishReason`；`currentEvent=""`（Claude）。
8. 读循环：`{done, value} = await reader.read()`；`done` → 处理 lineBuffer 残留 + 终止。`lineBuffer += decoder.decode(value, {stream:true})`；按 `\n` 切分；每行：
   - `event: X` → `currentEvent = X`（Claude）。
   - `data: <json>` → 按协议解析 delta/tc/finish（见 §4.2 表）。
   - `if (delta) { textBuffer += delta; onDelta?.(delta, round) }`（**全推，含工具轮思考流**）
   - `if (tc) { isToolRound = true; 累积 toolCallAccumulator }`（不推 UI）
   - `if (fr) finishReason = fr`
   - 终止条件：OpenAI `data:[DONE]`；Gemini reader done；Claude `event:message_stop`。
9. 流结束：
   - `isToolRound || finishReason === "tool_calls"` → 返回 `{text:"", toolCalls: accumulated→NativeToolCall[], raw:"", finishReason:"tool_calls"}`。**不调 onReset**（思考流已推，保留显示）。
   - 否则 → 返回 `{text: textBuffer, toolCalls: [], raw: textBuffer, finishReason:"stop"}`。
10. 错误处理同 `generateAssistantReplyNative`（`updateAiDebugRecord({error})` + rethrow）。

### 4.4 无 onDelta 时走非流式

`callModelNative` 闭包内：`if (!options.onDelta) return generateAssistantReplyNative(...)`。委托 agent（onDelta undefined）自动走非流式，避免无谓 SSE 解析开销。

### 4.5 不改 generateAssistantReply / generateAssistantReplyNative

两者保持不变（text 模式与非流式 native 仍走它们）。`streamAssistantReplyNative` 是新增并行函数。

## 5. agent-runtime 集成

### 5.1 类型扩展

```ts
export interface AgentRuntimeModelCallOptions {
  debugLabel: RuntimeTraceDebugLabel
  signal?: AbortSignal
  agentId?: string
  onDelta?: (delta: string, round: number) => void   // 新增,带轮号
}
export interface AgentRuntimeTurnInput {
  ...
  onDelta?: (delta: string, round: number) => void   // 新增
}
```

### 5.2 callAgentModelWithWorkspaceToolsNative 透传 + round 绑定

`agent-runtime/index.ts:1026` 调 `callModelNative` 前，用闭包绑定当前 round：
```ts
const result = await capabilities.callModelNative!(runtimeMessages, options, tools)
```
`options.onDelta` 已含 round（由上层构建时绑定），或在此处包装：`const roundOnDelta = options.onDelta ? (d:string)=>options.onDelta!(d, round) : undefined`。**采用包装方式**：runtime 循环内绑定 round，`callModelNative` 闭包收到的 onDelta 已是 `(d)=>onDelta(d, round)`。需调整 `AgentRuntimeModelCallOptions.onDelta` 签名为 `(delta:string)=>void`（round 在 runtime 绑定），`AgentRuntimeTurnInput.onDelta` 为 `(delta, round)=>void`（入口接收带轮号的）。

> 签名细节：`AgentRuntimeTurnInput.onDelta(delta, round)` 是入口回调（platform-host/UI 提供）；runtime 内部转成 `AgentRuntimeModelCallOptions.onDelta(delta)`（已绑 round）传给 `callModelNative` → `streamAssistantReplyNative`。

native 循环本体逻辑（`:1044`）不变：`finishReason==="stop"` 返回 text，`tool_calls` 执行工具进下一轮。**不丢弃工具轮 text**（已通过 onDelta 推 UI，无需 runtime 处理）。

### 5.3 runAgentRuntimeTurn 注入点

- entry agent options（`:1316`）：注入 `onDelta`（包装带 round）。
- delegated agent options（`:895`）：**不注入**（undefined → 非流式）。

## 6. platform-host 集成

### 6.1 runAssistantChat（`:1703`）

```ts
export interface AssistantChatInput {
  message: string
  history?: ConversationMessageRecord[]
  onDelta?: (delta: string, round: number) => void   // 新增
}
```
- `runAgentRuntimeTurn(input, capabilities)` 的 input 加 `onDelta: input.onDelta`。
- `callModelNative` 闭包（`:1776`）：
  ```ts
  async callModelNative(messages, options, tools) {
    const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
    if (!options.onDelta) {
      return generateAssistantReplyNative(messages as RuntimeChatMessage[], {...})
    }
    return streamAssistantReplyNative(messages as RuntimeChatMessage[], {
      debugLabel: options.debugLabel, signal: options.signal, tools,
      onDelta: options.onDelta,   // 已绑 round
      ...(agentConfig ? { config: agentConfig } : {}),
    })
  }
  ```

### 6.2 AIRP play turn（`:1543` callModelNative 闭包）

同理改为 `streamAssistantReplyNative`，onDelta 来源是 AIRP turn input（见 §7 emitTurnDelta）。

## 7. bridge 通道（play 前端，R5）

### 7.1 contracts（`packages/contracts/src/bridge.ts`）

```ts
export type RemotePlayBridgeEventName =
  | "turn-completed"
  | "turn-debug-ready"
  | "turn-delta"                        // 新增

export type RemotePlayBridgeEventPayload =
  | { snapshot: RuntimeSnapshotShell }
  | { turn: number }
  | { delta: string; turn: number; round: number }   // 新增
```
> `turn-round-end`/`turn-tool` 归子2b，本任务不加。

### 7.2 新建 `apps/platform-web/src/streaming-events.ts`

镜像 `debug-events.ts`（Set pub/sub，浅克隆迭代，异常吞掉 console.error）：
```ts
export type TurnDeltaListener = (delta: string, turn: number, round: number) => void
const turnDeltaListeners = new Set<TurnDeltaListener>()
export function subscribeTurnDelta(cb: TurnDeltaListener): () => void
export function emitTurnDelta(delta: string, turn: number, round: number): void
```

### 7.3 remote-iframe-bridge.ts（`:422` 区）

```ts
const unsubscribeTurnDelta = subscribeTurnDelta((delta, turn, round) => {
  postEvent("turn-delta", { delta, turn, round })
})
// dispose 时 unsubscribeTurnDelta?.()
```

### 7.4 AIRP turn 发射 delta

`interaction.sendMessage` 的 `runAgentRuntimeTurn` input 注入：
```ts
onDelta: (delta, round) => emitTurnDelta(delta, currentTurnNumber, round)
```

### 7.5 平台只提供通道

play 前端如何消费 `turn-delta`（小说式/折叠/思考区分）不在本任务范围（归游戏前端，子2b 补 round-end 归类事件）。

## 8. AssistantView UI（R4，含 ①②③）

### 8.1 send() 改造

```ts
async function send() {
  ...
  sending.value = true
  const assistantMsg = reactive({ role: "assistant", content: "" })
  messages.value.push(assistantMsg)
  // ① 打字机队列
  const deltaQueue: string[] = []
  let rafId: number | null = null
  const flushQueue = () => {
    rafId = null
    if (deltaQueue.length) {
      // 每帧释放一批（按时间预算或字符数），匀速
      const chunk = deltaQueue.splice(0, Math.max(1, Math.ceil(deltaQueue.length / 4)))
      assistantMsg.content += chunk.join("")
      maybeScrollToBottom()  // ② 智能滚动
    }
    if (deltaQueue.length) rafId = requestAnimationFrame(flushQueue)
  }
  const onDelta = (delta: string) => { deltaQueue.push(delta); if (rafId === null) rafId = requestAnimationFrame(flushQueue) }

  try {
    const result = await runAssistantChat({ message: content, history, onDelta })
    // 清空队列残留 + 校正
    if (rafId !== null) cancelAnimationFrame(rafId)
    assistantMsg.content += deltaQueue.join("")  // 冲刷剩余
    assistantMsg.content = result.replyText      // 校正（消除 trim/缓冲差异）
    await persistCurrentSession()
  } catch (error) {
    if (rafId !== null) cancelAnimationFrame(rafId)
    assistantMsg.content += deltaQueue.join("")
    if (!assistantMsg.content) messages.value.pop()  // 撤空占位
    errorMessage.value = error instanceof Error ? error.message : String(error)
    await persistCurrentSession()
  } finally {
    sending.value = false
    await scrollToBottom()
    nextTick(() => inputRef.value?.focus())
  }
}
```

### 8.2 ① 打字机节流（Token Throttling）

delta 缓冲队列 + `requestAnimationFrame` 匀速释放（见 8.1）。避免来一个 token 就 `content +=` 触发重渲染抖动。每帧释放一批（按队列长度自适应，避免队列堆积时永远追不上）。

### 8.3 ② 智能滚动锚定（Smart Scroll）

修现有 `scrollToBottom`（`:593`）不检查用户位置的 bug：
```ts
const userPinnedToBottom = ref(true)
function handleScroll(event: Event) {
  const el = event.target as HTMLElement
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  userPinnedToBottom.value = distanceFromBottom < 80
  showJumpToBottom.value = distanceFromBottom > 120
}
function maybeScrollToBottom() {
  if (userPinnedToBottom.value) scrollToBottom()  // 仅用户在底部时自动滚
  // 否则不滚，showJumpToBottom 提示"下方有新消息"
}
```
流式 onDelta 调 `maybeScrollToBottom`，不强行拉视线。

### 8.4 ③ 停止生成按钮（Abort）

- `send()` 作用域提一个 `abortController: AbortController | null` ref。
- `runAssistantChat` 前置需暴露 abort 入口：**方案**：`runAssistantChat` 接受可选 `signal`（调用方传 controller.signal），或新增 `abortAssistantChat()`。**采用前者**：`AssistantChatInput` 加 `signal?: AbortSignal`，`runAssistantChat` 用它而非内部 `new AbortController()`（或合并：外部 signal abort 时 abort 内部 controller）。
- UI：流式时（`sending.value`）显示"停止"按钮，点击 `abortController.abort()`。
- 停止后：保留半截 `assistantMsg.content` + 标注"（已停止）"。`runAssistantChat` 需在 abort 时抛 AbortError，catch 里保留半截。

### 8.5 typing dots

`v-if="sending && !firstDeltaReceived"`；`onDelta` 首次置 `firstDeltaReceived.value = true`。

## 9. stream 解禁（R6）

`config/ai.ts:130` `PROTECTED_CUSTOM_REQUEST_KEYS` 移除 `"stream"`。
- `buildStreamRequestBody` 的 `stream:true` 在 `parseBrowserAiCustomRequestParams` merge **之后**赋值，确保不被用户覆盖。
- 确认 `buildChatCompletionsRequestBody` merge 顺序：`{...body, ...customParams, model, messages}`——custom 在后。流式版需 `stream` 在 custom merge 后赋值。

## 10. 契约不变性

- `AiChatMessage`（contracts）不变。
- `RuntimeChatMessage` / `ModelCallResult` / `NativeToolCall`（runtime-host 内部类型）不变。
- `AgentRuntimeCapabilities.callModelNative` 签名不变（onDelta 经 `options` 传，不改 capability 签名）。
- `AgentRuntimeModelCallOptions` / `AgentRuntimeTurnInput` 加可选 `onDelta`（向后兼容）。
- `RemotePlayBridgeEventName`/`Payload` 新增 `turn-delta`（向后兼容，旧前端忽略）。

## 11. 回滚形态

- 流式是 native 路径新增并行函数 `streamAssistantReplyNative`；非流式 `generateAssistantReplyNative` 保留。
- `callModelNative` 闭包 `!options.onDelta` 分支走 `generateAssistantReplyNative`——切回非流式一行改动，text 模式完全不受影响。
- `turn-delta` 事件新增，play 前端不消费时无副作用。
- `onDelta` 全部可选，不传则 `streamAssistantReplyNative` 走非 SSE 回退或 `!onDelta` 分支退化为非流式。

## 12. 实测限制

- 三家 SSE 格式正确性需真实 API key 实测（OpenAI/Claude/Gemini），构建无法验证。
- 非 SSE 回退需端点不支持 SSE 的场景实测。
- AbortSignal 中途取消需实测（停止按钮）。
- 打字机节流/智能滚动需 Playwright 实测。

## 13. 开放问题收敛

- 原 PRD 开放问题"工具轮 text delta 是否推 UI" → **收敛：全推（思考流可见），无 onReset**。工具轮 text 即思考流，照常推 UI 保留显示，让玩家感知过程、可展开复查干预。
- 停止生成后保留半截 vs 清空 → 倾向保留半截 + "（已停止）"标注，实现时定。
