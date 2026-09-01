# Design — 工具过程可见 + 并行执行

> 父任务：`06-19-ai-streaming-response`。**依赖子2a `06-19-ai-streaming-sse`（流式输出 + 思考流可见）先完成**——本任务在子2a 的流式通道（`turn-delta` 事件 + `streamAssistantReplyNative` + `onDelta` 透传 + `streaming-events.ts`）上叠加工具过程事件与单轮内无状态工具并行执行。
> PRD：`prd.md`。姊妹任务子2a（已提交 `bace0b2`，待真实 key 实测验收后归档）。

## 1. 范围与模式边界

- **仅在 `toolCallMode=native` 下生效**。`text` 模式不产生 `turn-round-end`/`turn-tool` 事件（text 模式不流式，无结构化轮次边界；text 模式的工具过程可见归 play 前端解析 `<tsian-tool-call>` 文本块，不在本任务范围）。
- 事件通道复用子2a 的 `streaming-events.ts`（Set pub/sub，内部模块勿扩散）+ `remote-iframe-bridge.ts` 订阅转发模式。
- 并行执行改 `executeRuntimeWorkspaceToolCalls`（`workspace-tools.ts:1983`），native 与 text 路径共用该函数——**text 模式也享受并行**（text 模式工具循环 `callAgentModelWithWorkspaceTools` 同样调它，见 `index.ts:1255` 区）。并行是工具执行层优化，与流式正交。**这是对 prd 的澄清**：prd R3 措辞偏向 native，但实现上并行对两模式都生效，无需额外门控。
- 桌面 AssistantView 只做最小工具过程呈现（状态行），小说式/折叠/多态卡片归 play 前端消费 `turn-tool` 事件渲染。

## 2. 核心决策：并行分组方案（评审门定）

### 决策点

`executeRuntimeWorkspaceToolCalls` 收到一轮 N 个 `ParsedRuntimeWorkspaceToolCall`，需决定哪些并行、哪些串行。工具名枚举（`workspace-tools.ts:26`）：

```
skill_load          # 只读 skill 注册表
action_call         # 内部 4 种 executor: builtin / platform_action / browser_script / workspace_operation
agent_call          # 共享 agentCallState (callCount/depth budget)
workspace.read      # 只读
workspace.list      # 只读
workspace.search    # 只读
workspace.diff      # 只读
workspace.validate  # 只读
workspace.patch     # 写
workspace.write     # 写
workspace.move      # 写
workspace.delete    # 写
```

### 方案 A（保守，按顶层工具名）— 推荐

- **并行组**：`skill_load`、`workspace.read`、`workspace.list`、`workspace.search`、`workspace.diff`、`workspace.validate`（全是只读、无副作用、无共享状态）。
- **串行组**：`agent_call`、`action_call`、`workspace.patch`、`workspace.write`、`workspace.move`、`workspace.delete`。
- `action_call` **整体串行**——不穿透到 executor type。理由：`action_call` 需先 load skill + resolve executor 才知道子类型，预解析本身是工作且可能触发副作用；builtin（validation/echo）极快，串行损失可忽略；真正高频并行场景是模型一轮查多个文件（`workspace.read`），方案 A 已覆盖。

### 方案 B（穿透，按 prd R3）— prd 倾向

- **并行组**：方案 A 的全部 + `action_call` 的 `builtin` executor + `action_call` 的 `workspace_operation` executor 当 operation 为 read 类（read/list/search/diff/validate）。
- **串行组**：`agent_call`、`action_call` 的 `platform_action`/`browser_script` executor + `action_call` 的 `workspace_operation` write 类、`workspace.{patch,write,move,delete}`。
- 需在分组前对每个 `action_call` 预解析 executor type（load skill → resolve action → 读 `executor.type`），增加复杂度与一次 skill load 副作用风险。

### 推荐：方案 A

收益对比：方案 B 比 A 多并行 `action_call builtin`（validation/echo，毫秒级，串行几乎无延迟）+ `action_call workspace_operation.read`（少见，模型更常用顶层 `workspace.read`）。多得的并行窗口小，但付出的复杂度（预解析 executor + 分组逻辑穿透两层）与风险（预解析副作用）不划算。**方案 A 用一行 `call.name` 判断即可分组**，实现简单、边界清晰、回滚容易。

> **评审门决策项**：采用方案 A（推荐）还是方案 B（prd R3 倾向）？若选 B，implement.md 需加 executor 预解析步骤。

### 不变量（两方案共享）

- **observations 与 toolCalls index 严格对齐**：`executeRuntimeWorkspaceToolCalls` 返回的 `observations[i]` 必须对应 `calls[i]`。native 循环回填处（`index.ts:1135` `for [index, observation] of observations.entries()` 用 `result.toolCalls[index]?.id` 作 callId）依赖此对齐。并行化后用 `Map<index, observation>` 收集，最后按 index 升序还原成数组。
- **并行组内顺序无关**：只读工具无依赖，并行执行结果互不影响。
- **串行组保持原相对顺序**：有状态/有依赖工具按 calls 中的出现顺序执行。
- **abort 生效**：并行组用 `Promise.all`，任一 reject 即整体 reject（观测仍按 index 还原）；串行组每步 `assertNotAborted(context.signal)`。abort 后已完成的 observation 保留，未完成的不补。

## 3. 架构与数据流

```
platform-host interaction.sendMessage / runAssistantChat
  ├─ runAgentRuntimeTurn(input{...,onDelta,onRoundEnd,onTool}, capabilities)
  │    └─ callAgentModelWithWorkspaceToolsNative(msgs, ..., options, ...)
  │         └─ for each round:
  │              ├─ callModelNative → streamAssistantReplyNative  [子2a, text delta→onDelta]
  │              ├─ 轮结束: options.onRoundEnd?.(round, finishReason)  [新增 R1]
  │              │    └─ platform-host 包装: emitTurnRoundEnd(turn, round, kind)
  │              │         kind = finishReason==="tool_calls" ? "thought" : "final"
  │              └─ if tool_calls:
  │                   executeRuntimeWorkspaceToolCalls(context, toolCalls)
  │                    ├─ 分组: 并行组(read-only) / 串行组(write+agent_call+action_call)
  │                    ├─ 并行组 Promise.all，每个执行前后 emitTurnTool(turn,round,callId,name,status)  [新增 R2]
  │                    ├─ 串行组顺序 await，每个执行前后 emitTurnTool
  │                    └─ 合并 observations 按 index 还原  [不变量]
  ├─ remote-iframe-bridge 订阅 turn-round-end / turn-tool → postEvent  [新增]
  └─ 桌面 AssistantView: onTool 回调直接渲染状态行（非 bridge 路径）  [R5]
```

### turn 号的来源（关键澄清）

`turn` 是 platform-host 层概念（`nextTurn`），runtime 层（`callAgentModelWithWorkspaceToolsNative`）只知道 `round`。子2a 的 `onDelta(delta, round)` 已体现此分层：runtime 传 round，platform-host 在 `onDelta: (delta, round) => emitTurnDelta(delta, nextTurn, round)` 处绑 turn。

本任务沿用同一模式：runtime 层新增 `onRoundEnd(round, finishReason)` 与 `onTool(round, callId, name, status, output?)` 回调（**不含 turn**），platform-host 包装时绑 turn：

```ts
// platform-host 注入（镜像 onDelta 包装）
onRoundEnd: (round, finishReason) => emitTurnRoundEnd(nextTurn, round, finishReasonToKind(finishReason)),
onTool: (round, callId, name, status, output) => emitTurnTool(nextTurn, round, callId, name, status, output),
```

`finishReasonToKind`: `"tool_calls" → "thought"`，`"stop" → "final"`。

## 4. 事件层（R1 turn-round-end + R2 turn-tool）

### 4.1 contracts（`packages/contracts/src/bridge.ts`）

```ts
export type RemotePlayBridgeEventName =
  | "turn-completed"
  | "turn-debug-ready"
  | "turn-delta"           // 子2a
  | "turn-round-end"       // 新增 R1
  | "turn-tool"            // 新增 R2

export type RemotePlayBridgeEventPayload =
  | { snapshot: RuntimeSnapshotShell }
  | { turn: number }
  | { delta: string; turn: number; round: number }                          // 子2a
  | { turn: number; round: number; kind: "thought" | "final" }              // 新增 R1
  | { turn: number; round: number; callId: string; name: string;
      status: "loading" | "running" | "success" | "failed"; output?: string } // 新增 R2
```

union 追加，向后兼容（旧前端忽略未知 event name）。

### 4.2 streaming-events.ts 扩展

镜像 `subscribeTurnDelta`/`emitTurnDelta`，新增两对：

```ts
export type TurnRoundEndListener = (turn: number, round: number, kind: "thought" | "final") => void
export type TurnToolListener = (turn: number, round: number, callId: string, name: string, status: "loading" | "running" | "success" | "failed", output?: string) => void

export function subscribeTurnRoundEnd(cb: TurnRoundEndListener): () => void
export function emitTurnRoundEnd(turn: number, round: number, kind: "thought" | "final"): void
export function subscribeTurnTool(cb: TurnToolListener): () => void
export function emitTurnTool(turn: number, round: number, callId: string, name: string, status: "loading" | "running" | "success" | "failed", output?: string): void
```

复用同一 Set pub/sub + 浅克隆迭代 + 异常吞掉 console.error 模式（与 `turn-delta`/`debug-events` 一致）。

### 4.3 remote-iframe-bridge.ts 订阅转发

镜像子2a 的 `subscribeTurnDelta` 转发块（`:429`），新增：

```ts
const unsubscribeTurnRoundEnd = subscribeTurnRoundEnd((turn, round, kind) => {
  postEvent("turn-round-end", { turn, round, kind })
})
const unsubscribeTurnTool = subscribeTurnTool((turn, round, callId, name, status, output) => {
  postEvent("turn-tool", { turn, round, callId, name, status, ...(output !== undefined ? { output } : {}) })
})
```

dispose 处 `unsubscribeTurnRoundEnd?.()` + `unsubscribeTurnTool?.()`。

> **桌面 AssistantView 路径不发 bridge 事件**：桌面 chat 走 `runAssistantChat`（in-process），工具过程通过 `onTool` 回调直接进 view 渲染（R5），不经 `streaming-events`/bridge。只有 AIRP play turn（`interaction.sendMessage`）走 emitTurnRoundEnd/emitTurnTool → bridge → play 前端。这与子2a 的 `turn-delta` 分流一致（子2a spec §Bridge State 明确"桌面 Assistant chat path does not emit turn-delta"）。

## 5. runtime 层透传（agent-runtime/index.ts）

### 5.1 类型扩展

```ts
export interface AgentRuntimeTurnInput {
  // ...子2a 已有 onDelta...
  onDelta?: (delta: string, round: number) => void
  /** 本轮结束通知（R1）。runtime 传 round + finishReason，调用方绑 turn。 */
  onRoundEnd?: (round: number, finishReason: "stop" | "tool_calls") => void
  /** 工具调用状态/输出通知（R2）。runtime 传 round + 工具信息，调用方绑 turn。 */
  onTool?: (round: number, callId: string, name: string, status: "loading" | "running" | "success" | "failed", output?: string) => void
}

export interface AgentRuntimeModelCallOptions {
  // ...子2a 已有 onDelta + round...
  onDelta?: (delta: string, round: number) => void
  round?: number
  onRoundEnd?: (round: number, finishReason: "stop" | "tool_calls") => void
  onTool?: (round: number, callId: string, name: string, status: "loading" | "running" | "success" | "failed", output?: string) => void
}
```

### 5.2 callAgentModelWithWorkspaceToolsNative 注入点

- **entry agent options**（`:1338`）：注入 `onRoundEnd: input.onRoundEnd`、`onTool: input.onTool`（与 `onDelta: input.onDelta` 并列，子2a 已注入 onDelta）。
- **delegated agent**（`:899`）：**不注入** onRoundEnd/onTool（与 onDelta 同理，委托 agent 静默，过程不给玩家看）。
- native 循环（`:1040`）每轮 `callModelNative` 返回后（`:1047` 之后、stop/tool 分支之前）调：
  ```ts
  options.onRoundEnd?.(round, result.finishReason)
  ```
- `executeRuntimeWorkspaceToolCalls` 调用处（`:1095`）把 `onTool` + `round` 透传入 context（见 §6）。

### 5.3 callModelNative 闭包透传（platform-host/index.ts）

两处闭包（AIRP `:1547` + Assistant `:1819`）在 `streamAssistantReplyNative` 调用旁加 `onRoundEnd`/`onTool` 透传（已绑 round 的版本由 runtime 循环注入，闭包只透传 `options.onRoundEnd`/`options.onTool`）：

```ts
return streamAssistantReplyNative(messages, {
  debugLabel, signal, tools,
  onDelta: options.onDelta,
  round: options.round,
  // 新增：runtime 循环内调 onRoundEnd/onTool 时带 round，闭包只透传引用
  ...(options.onRoundEnd ? { onRoundEnd: options.onRoundEnd } : {}),
  ...(options.onTool ? { onTool: options.onTool } : {}),
  ...(agentConfig ? { config: agentConfig } : {}),
})
```

> 实际上 `onRoundEnd`/`onTool` 不进 `streamAssistantReplyNative`（它只管单轮 SSE），它们在 runtime 循环层调用。闭包只需确保 `AgentRuntimeModelCallOptions` 上的 `onRoundEnd`/`onTool` 被传到 `callModelNative` 的 options——而 options 是 runtime 循环直接构建的（`:1043 callOptions`），闭包不干预。**故闭包无需改动**，只在 runtime 循环 `callOptions` 里带上 `onRoundEnd`/`onTool`（来自 `...options` 展开，`:1044`）。此条澄清 implement.md。

### 5.4 platform-host 绑 turn

`interaction.sendMessage`（AIRP）的 `runAgentRuntimeTurn` input（`:1525` 区）注入：

```ts
onDelta: (delta, round) => emitTurnDelta(delta, nextTurn, round),       // 子2a
onRoundEnd: (round, finishReason) => emitTurnRoundEnd(nextTurn, round, finishReasonToKind(finishReason)),
onTool: (round, callId, name, status, output) => emitTurnTool(nextTurn, round, callId, name, status, output),
```

`runAssistantChat`（桌面）的 input（`:1801` 区）注入 `onTool: input.onTool`（桌面不绑 turn、不发 bridge，直接透传给 AssistantView 渲染）；`onRoundEnd` 桌面可选不传（桌面 AssistantView 不区分 thought/final，子2a 已述）。

```ts
function finishReasonToKind(fr: "stop" | "tool_calls"): "thought" | "final" {
  return fr === "tool_calls" ? "thought" : "final"
}
```

## 6. workspace-tools 并行化（workspace-tools.ts）

### 6.1 executeRuntimeWorkspaceToolCalls 改造

```ts
export async function executeRuntimeWorkspaceToolCalls(
  context: RuntimeWorkspaceToolExecutionContext,
  calls: ParsedRuntimeWorkspaceToolCall[],
): Promise<RuntimeWorkspaceToolObservation[]> {
  // 并行分组（方案 A）：只读工具并行，有状态/写工具串行
  const parallelIndices: number[] = []
  const serialIndices: number[] = []
  for (const [index, call] of calls.entries()) {
    if (call.error || !call.call) {
      // 解析失败的 call 不参与并行，单独串行处理（保持现有 executeRuntimeWorkspaceToolCall 的 error 分支行为）
      serialIndices.push(index)
      continue
    }
    if (isParallelizableToolName(call.call.name)) {
      parallelIndices.push(index)
    } else {
      serialIndices.push(index)
    }
  }

  const observations = new Map<number, RuntimeWorkspaceToolObservation>()

  // 并行组：Promise.all，index 对齐回填
  if (parallelIndices.length > 0) {
    const parallelResults = await Promise.all(
      parallelIndices.map((index) => executeRuntimeWorkspaceToolCall(context, calls[index], index)),
    )
    for (let i = 0; i < parallelIndices.length; i += 1) {
      observations.set(parallelIndices[i], parallelResults[i])
    }
  }

  // 串行组：顺序 await，每步 assertNotAborted
  for (const index of serialIndices) {
    assertNotAborted(context.signal)
    observations.set(index, await executeRuntimeWorkspaceToolCall(context, calls[index], index))
  }

  // 按 index 升序还原（不变量）
  return calls.map((_, index) => observations.get(index)!)
}
```

### 6.2 isParallelizableToolName（方案 A）

```ts
const PARALLEL_TOOL_NAMES = new Set<string>([
  RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad,
  RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead,
  RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList,
  RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch,
  RUNTIME_WORKSPACE_TOOL_NAMES.workspaceDiff,
  RUNTIME_WORKSPACE_TOOL_NAMES.workspaceValidate,
])

function isParallelizableToolName(name: string): boolean {
  return PARALLEL_TOOL_NAMES.has(name)
}
```

> 方案 B 则需把 `action_call` 穿透到 executor type 判断，见 §2。

### 6.3 turn-tool 事件发射点

`executeRuntimeWorkspaceToolCall`（`:1890` 区，单个工具执行）内部，执行前后发 `emitTurnTool`。需把 `turn`/`round`/`onTool` 透传入 `RuntimeWorkspaceToolExecutionContext`：

```ts
export interface RuntimeWorkspaceToolExecutionContext {
  // ...现有字段...
  /** 工具过程事件回调（R2）。undefined 时不发事件（text 模式或委托 agent）。 */
  onTool?: (callId: string, name: string, status: "loading" | "running" | "success" | "failed", output?: string) => void
}
```

> context 层的 `onTool` 签名**不含 turn/round**——turn/round 在 platform-host 绑定（§5.4），runtime 循环传给 context 的 `onTool` 已是绑好 round 的闭包 `(callId, name, status, output) => input.onTool!(round, callId, name, status, output)`。与 onDelta 同样的分层。

`executeRuntimeWorkspaceToolCall` 内部：

```ts
// 执行前
context.onTool?.(callId, call.name, "loading")
try {
  const observation = await /* 现有执行逻辑 */
  context.onTool?.(callId, call.name, "success", truncateOutput(observation))
  return observation
} catch (error) {
  context.onTool?.(callId, call.name, "failed", errorMessage(error))
  throw error
}
```

- `callId`：native 模式有 provider id（`NativeToolCall.id`，子1 确认）；text 模式无 id，用 `tool-${index}` 兜底（与 `index.ts:1136` 一致）。
- `truncateOutput`：超过阈值截断 + "…(已截断)"。阈值**定 500 字符**（收敛 prd 开放问题），JSON.stringify 后截断。
- `running` 状态：workspace 工具内存级快，loading→success 直接跳过 running；`browser_script` 有 timeoutMs 兜底，可在执行前发 `running`（但 `browser_script` 走 `action_call` 串行组，且属可选，**本任务不实现 running**，收敛 prd R2 "running 状态可选" + 开放问题"不做长耗时心跳"）。

### 6.4 callId 透传

`executeRuntimeWorkspaceToolCall(context, call, index)` 当前签名不含 callId。native 模式 callId = `result.toolCalls[index].id`（在 runtime 循环层可知），但 `executeRuntimeWorkspaceToolCalls` 内部只有 `calls[index]`（`ParsedRuntimeWorkspaceToolCall`，无 id 字段）。

**方案**：给 `RuntimeWorkspaceToolCall` 或 `ParsedRuntimeWorkspaceToolCall` 加可选 `id?: string`，native 循环调用 `executeRuntimeWorkspaceToolCalls` 前把 `result.toolCalls[i].id` 写入 `calls[i].call.id`。text 模式无 id，`callId = call.call?.id ?? \`tool-${index}\``。

> 这是对 `ParsedRuntimeWorkspaceToolCall` 的小幅扩展，向后兼容（可选字段）。

## 7. system prompt 引导并行（R4，可选）

`buildWorkspaceToolInstructions`（native 模式工具说明）追加：

> 如果需要同时调用多个独立的只读工具（如查询多个文件、列出多个目录），可以在一轮中同时发起多个工具调用，它们会并行执行以减少等待。

实测后定：若模型不响应此引导（仍一轮一个 tool_call），不强加（避免 prompt 噪音）。implement 标为可选步骤。

## 8. 桌面 AssistantView 工具过程基础呈现（R5，最小）

桌面 AssistantView 走 `runAssistantChat`（非 bridge），`onTool` 回调直接进 view。**最小呈现**（收敛 prd 开放问题"只状态行 vs 折叠 + output"→**只状态行**）：

- 流式期间，`onTool` 收到 `loading` → 在当前 assistant 消息下方追加一行状态："🔧 {name} 执行中…"。
- `success`/`failed` → 更新该行为："🔧 {name} ✓" / "🔧 {name} ✗ {output摘要}"。
- 不做可展开 output 折叠（归 play 前端）。
- 工具过程行与 text delta 同区显示（不分区思考/最终，子2a 已述桌面不区分）。

实现：AssistantView 维护 `toolLines: Ref<string[]>`（或挂在 assistantMsg 上的字段），`onTool` 更新对应行。UI 在 `v-for` 渲染。

> 若实现成本高，可降级为只显示"正在调用工具…"单行（prd R5 允许）。implement 标实际呈现度。

## 9. 契约不变性

- `AiChatMessage` / `RuntimeChatMessage` / `ModelCallResult` / `NativeToolCall` 不变。
- `AgentRuntimeCapabilities` 签名不变（onRoundEnd/onTool 经 `options`/`input` 传，不改 capability）。
- `AgentRuntimeTurnInput` / `AgentRuntimeModelCallOptions` / `RuntimeWorkspaceToolExecutionContext` 加可选 `onRoundEnd`/`onTool`（向后兼容）。
- `ParsedRuntimeWorkspaceToolCall` / `RuntimeWorkspaceToolCall` 加可选 `id`（向后兼容）。
- `RemotePlayBridgeEventName`/`Payload` 新增 `turn-round-end`/`turn-tool`（向后兼容，旧前端忽略）。
- `executeRuntimeWorkspaceToolCalls` 签名不变（返回值仍是 `RuntimeWorkspaceToolObservation[]` 且 index 对齐）。

## 10. 回滚形态

- 事件层：`turn-round-end`/`turn-tool` 是新增 union 成员 + 新增 pub/sub，不消费时无副作用。回滚 = 移除 emitTurnRoundEnd/emitTurnTool 调用 + 删 subscribe 转发。
- 并行化：`executeRuntimeWorkspaceToolCalls` 回滚 = 恢复 `for await` 顺序循环（一行改动）。方案 A 的 `isParallelizableToolName` 判断移除即退回串行。
- onRoundEnd/onTool 全部可选，不传则不发事件，runtime/workspace-tools 行为同子2a。
- 桌面 AssistantView 工具行：`onTool` 不传则无工具行，回退子2a 纯流式。

## 11. 实测限制（构建无法覆盖，归浏览器实测）

- `turn-round-end`/`turn-tool` 事件在真实 native tool-call 流程中正确触发（需真实 key + 触发工具调用的对话）。
- 单轮内多个只读工具实际并行（实测：让模型一轮发 2+ 个 `workspace.read`，观察总耗时 ≈ 最慢一个而非累加）。
- 有状态工具（`agent_call`/`workspace.write`）保持串行，预算/状态正确（实测多轮工具循环）。
- abort 中途取消时并行组的 `Promise.all` 行为（任一 reject 即整体 reject，已完成 observation 保留）。
- system prompt 引导是否让模型多发 tool_calls（R4 可选，实测后定去留）。

## 12. 开放问题收敛

- 并行分组方案 A vs B → **推荐 A，评审门定**（§2）。
- `turn-tool` output 截断阈值 → **500 字符**（§6.3）。
- 桌面 AssistantView 呈现度 → **只状态行**（§8）。
- `running` 状态 → **不实现**（workspace 工具内存级快；§6.3）。
- R4 system prompt 引导 → **可选，实测后定**（§7）。
- text 模式是否并行 → **是，并行是工具执行层优化，与流式正交**（§1 澄清）。
