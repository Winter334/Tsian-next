# Design — 子代理并发改造（同轮多 agent_call 并行 + 移除 maxCallsPerTurn + 事件 agentId）

> 子任务 of `06-19-tool-runtime-performance`。
> **依赖子2（tool-token-budget，R1-R4 已落地）**——在其"去硬轮次 + turn 内 token 预算兜底"基础上做 agent_call 执行层并发。
> 本文件 2026-06-20 编写，对应 prd.md 已对齐方向。

## 0. 核心机制（一句话）

**移除 `maxCallsPerTurn` 硬限制（保留 `callCount` 计数 + `maxDepth` 递归安全网）；把 `agent_call` 从串行组移入并行组，同轮多个 agent_call `Promise.all` 并行执行、observation 按原索引回填；runtime 事件层加 agentId、delegated 也发流式/工具事件、bridge 转发带 agentId。**

对标 Claude Code 的 parallel research（多个 subagent 并行探索独立路径）；不抄其"子代理结果包装成用户消息"（破坏 Tsian 剧情/tool 分层）；不做跨 turn 后台子代理（受 turn 原子性约束，当前过度设计）。

## 1. 架构与边界

### 1.1 涉及模块

| 层 | 文件 | 改动性质 |
|---|---|---|
| runtime-core | `apps/platform-web/src/agent-runtime/index.ts` | **核心改动**：①移除 `maxCallsPerTurn`（policy/default/normalize/metadata/trace/拦截/canExpose）；②`createAgentCallRunner` 给 delegated 透传 onDelta/onRoundEnd/onTool（带目标 agentId）；③事件回调签名加 agentId |
| runtime-core | `apps/platform-web/src/agent-runtime/workspace-tools.ts` | `executeRuntimeWorkspaceToolCalls` 把 `agent_call` 从串行组移入并行组（`PARALLEL_TOOL_NAMES` 加入 agentCall，或单独并行处理 agent_call） |
| platform-host | `apps/platform-web/src/platform-host/index.ts` | master 路径 onDelta/onRoundEnd/onTool 闭包绑定 agentId="master"；桌面助手路径适配新签名 |
| platform-web | `apps/platform-web/src/streaming-events.ts` | pub/sub 事件加 agentId 透传（emit/subscribe 签名） |
| platform-web | `apps/platform-web/src/bridge/remote-iframe-bridge.ts` | turn-delta/turn-round-end/turn-tool 转发事件负载加 agentId |
| platform-web | `apps/platform-web/src/views/AssistantView.vue` | onTool/onDelta 回调接收 agentId 参数（忽略，不改变渲染） |
| contracts | `packages/contracts/src/runtime.ts` | **不改**——maxCallsPerTurn 只在 index.ts 内部 policy，不在 contracts；事件 agentId 是 runtime/bridge 内部，不入 contracts |

### 1.2 不动的边界

- **master 的 turn 内压缩兜底**（tool-token-budget R2 落地）——不动。一次压缩 + ContextBudgetExhaustedError 保持。
- **delegated 路径的压缩行为**——仍沿用 tool-token-budget R2 的"跳过压缩、只走预算兜底"（无 agentContextSnapshot）。任务压缩是后续独立任务。
- **agent_call observation 走 tool 通道**——不改。observation 经 `formatRuntimeWorkspaceToolObservationMessage` 序列化，不包装成剧情 user message。
- **`maxDepth=2` 递归安全网**——保留。depth 值传递，并行天然安全。
- **`run_script` 串行**——不改。有副作用 + bounded timeout，不进并行组。
- **staged transaction 写入语义**——不改。共享 stagedFiles 数组，后写覆盖（last-write-wins），并行不改变此语义（JS 单线程交错执行，最终状态按实际执行顺序覆盖）。
- **子代理/助手 messages 结构**——不改（单条 user message）。消息序列化是后续任务压缩改造的前提。
- **AssistantView 渲染**——不改。事件层预留 agentId，渲染保持单 agent 平铺。
- **abort 机制**——不动。并行 agent_call 共享 input.signal，abort 取消所有。

### 1.3 关键技术约束（勘察确认）

**约束1：事件链有两套路径，agentId 注入点不同。**
- **游戏内 master**：runtime onDelta → host `:1488` 闭包 → `emitTurnDelta` → streaming-events pub → remote-iframe-bridge sub → `postEvent("turn-delta")` 给游戏前端。host 闭包已绑 `nextTurn`，加绑 `agentId="master"` 即可。
- **桌面助手**：runtime onDelta → host `:1790` 直接传 `input.onDelta` → AssistantView 回调。不经 streaming-events（进程内）。AssistantView 回调加 agentId 参数（忽略）。
- **delegated（新增）**：runtime 内部 `createAgentCallRunner` 构造 onDelta 闭包（绑目标 agentId）→ 传给 `callAgentModelWithWorkspaceTools` → delegated 工具循环发事件 → 经 host emitTurn* → streaming-events → bridge。delegated 的 agentId 是目标 agent id（如 "memory"）。

**约束2：agentId 注入用"闭包绑定"而非"每事件参数"，最小破坏。**
给 runtime 的 `onDelta`/`onRoundEnd`/`onTool` **回调签名加 agentId 参数**会破坏所有现有消费者（host 两个路径、AssistantView、bridge）。但 agentId 是"哪个 agent 在发事件"的上下文，**可在构造回调闭包时绑定**（host 给 master 绑 "master"，`createAgentCallRunner` 给 delegated 绑目标 id），不必让 runtime 内部每次 emit 都传 agentId。
- **但是**：streaming-events 的 emit/subscribe 是全局 pub/sub，多个 agent（master + 并行 delegated）都往同一个 bus 发，**订阅方（bridge）必须能区分**。所以 streaming-events 层 agentId **必须是事件参数**（emit 时带，subscribe 收到）。这是不可避的签名变更。
- **折中**：runtime 回调签名加 agentId（index.ts 的 onDelta/onRoundEnd/onTool 类型），host 注入闭包绑 agentId；streaming-events 的 emit/subscribe 加 agentId 参数；bridge 转发带 agentId。AssistantView 回调加 agentId 参数（忽略）。这是一条链路的一致变更，不可分割。

**约束3：并行 agent_call 的 observation 回填。**
现有 `executeRuntimeWorkspaceToolCalls` 已有 Map-by-index 回填（observations.set(index, result)），并行组 `Promise.all` 结果按 parallelIndices 顺序回填。agent_call 移入并行组后，多个 agent_call 的 observation 按 `calls` 原索引回填，返回数组与 calls 对齐。native 循环 `result.toolCalls[index].id` 配对、text 循环追加 user message——都依赖此对齐，现有机制保证。

**约束4：callCount 并发原子性。**
`state.callCount += 1`（index.ts:1113）在 `createAgentCallRunner` 返回的闭包内、delegated 执行前。移除 maxCallsPerTurn 后 callCount 只用于 trace 计数。并行 agent_call 的闭包共享同一个 `state` 对象，`+= 1` 在 JS 单线程下原子（无真并发，async 交错但每段同步代码原子）。计数顺序不确定但无影响（trace 展示总数即可）。

**约束5：depth 并发安全。**
`agentCallDepth` 是值传递（每次 agent_call 传 `metadata.targetDepth = callerDepth + 1` 快照）。并行 agent_call 各自拿到调用时的 depth 值，互不影响——depth 天然并发安全，无需加锁。

## 2. 数据与契约

### 2.1 移除 maxCallsPerTurn

`AgentRuntimeCollaborationPolicy`（index.ts:193）移除 `maxCallsPerTurn`：

```ts
// before
export interface AgentRuntimeCollaborationPolicy {
  maxCallsPerTurn: number      // ← 移除
  maxDepth: number
  historyWindows: Record<RuntimeAgentCallHistoryMode, number>
}
```

- `DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY`（:221）移除 `maxCallsPerTurn: 4`。
- `normalizeAgentRuntimeCollaborationPolicy`（:300）移除 `maxCallsPerTurn` normalize 行。
- `AgentRuntimeCollaborationPolicyInput`（:200 `Partial<Omit<...,"historyWindows">>`）自动收窄，不再有 `maxCallsPerTurn` 键。
- `AgentCallRuntimeMetadata`（:248）移除 `maxCallsPerTurn: number`。
- `agentCallTraceFacts`（:938）移除 `maxCallsPerTurn: metadata.maxCallsPerTurn`。
- `createAgentCallRunner`（:1094）删除 `if (state.callCount >= collaborationPolicy.maxCallsPerTurn)` 整个拦截分支（`AGENT_CALL_LIMIT_EXCEEDED`）。`state.callCount += 1`（:1113）**保留**。
- `canExposeAgentCallInPrompt`（:586）移除 `state.callCount < policy.maxCallsPerTurn` 条件（:592），只保留 `depth < policy.maxDepth`。

**向后兼容**：`maxCallsPerTurn` 不在 contracts，无外部契约破坏。host 若曾注入该字段，TS 编译报错提示移除。

### 2.2 agent_call 移入并行组

`workspace-tools.ts` 两选一（design 选 §2.2 末尾方案）：

**方案 A（简）**：`PARALLEL_TOOL_NAMES` 加入 `agentCall`。agent_call 与只读工具同组 `Promise.all`。
- **问题**：agent_call 不是"无状态只读"——它跑 delegated 工具循环（有 workspace 写入、有 nested agent_call、共享 callCount）。和 workspace.read 混一组语义不清，且 PARALLEL_TOOL_NAMES 注释会矛盾。

**方案 B（推荐）**：agent_call 单独成组，与现有并行组、串行组三组分立。
- 分组逻辑：遍历 calls，`isParallelizableToolCall`（只读无状态）→ parallelGroup；`call.name === agentCall` → agentCallGroup；其余（write/run_script/不可解析）→ serialGroup。
- 执行顺序：parallelGroup `Promise.all` → agentCallGroup `Promise.all` → serialGroup 逐个 await。
- **为什么 agent_call 在 serial 之前**：agent_call 可能产生 workspace 写入（delegated 内 workspace.write），这些写入应在本轮 master 的 serial write 之前落进 staged transaction，让 serial write 能看到 delegated 的写入结果（若 master 这轮既要 agent_call 又要 workspace.write 同文件）。实际上 agent_call 的 observation 回来后 master 才进下一轮，同轮内 agent_call 与 workspace.write 混发时，agent_call 先执行让写入就绪。
- observation 仍 Map-by-index 回填，三组结果合并后按原 index 对齐。

### 2.3 事件层 agentId（签名变更）

**runtime 回调签名**（index.ts:79-99 附近）加 agentId：

```ts
// before
onDelta?: (delta: string, round: number) => void
onRoundEnd?: (round: number, finishReason: "stop" | "tool_calls") => void
onTool?: (round: number, callId: string, name: string, status, output?) => void

// after（agentId 放最前，标明来源 agent）
onDelta?: (agentId: string, delta: string, round: number) => void
onRoundEnd?: (agentId: string, round: number, finishReason: "stop" | "tool_calls") => void
onTool?: (agentId: string, round: number, callId: string, name: string, status, output?) => void
```

`AgentRuntimeModelCallOptions` 的 onDelta/onRoundEnd/onTool 同步加 agentId。

**streaming-events 签名**加 agentId：

```ts
export type TurnDeltaListener = (agentId: string, delta: string, turn: number, round: number) => void
export type TurnRoundEndListener = (agentId: string, turn: number, round: number, kind: TurnRoundEndKind) => void
export type TurnToolListener = (agentId: string, turn: number, round: number, callId: string, name: string, status, output?) => void
// emit 函数同步加 agentId 首参
```

**注入点绑定 agentId**：
- host master 路径（:1488）：`onDelta: (agentId, delta, round) => emitTurnDelta(agentId, delta, nextTurn, round)`——但 master 的 agentId 恒为 "master"，runtime emit 时就带 "master"。
- `createAgentCallRunner`（:1133）：给 delegated 构造 onDelta/onRoundEnd/onTool 闭包，调用时带 `targetContext.agent.id`。delegated 工具循环内部 emit 时用 options.agentId（已是目标 id）。
- AssistantView（:610 onDelta、:632 onTool）：回调加 agentId 首参，忽略（桌面助手单 agent）。
- bridge（:430-450）：postEvent 负载加 agentId。

**delegated 流式 round 语义**：delegated 的 round 是它自己工具循环的 round（0,1,2...），与 master 的 round 不同维度。事件里 round 字段在 delegated 场景=delegated 自己的 round。订阅方靠 agentId 区分是哪个 agent 的 round，不靠 round 跨 agent 比较。turn 字段仍是 master turn（delegated 在 master 的某个 turn 内）。

### 2.4 workspace 写入冲突（last-write-wins，不改）

`createRuntimeWorkspaceTransaction`（workspace.ts:1625）的 stagedFiles 是共享数组，所有 agent 写入都 `writeWorkspaceFileToFiles(stagedFiles, ...)` 按 path 覆盖。并行 agent_call 的写入在 JS 单线程下交错执行，最终状态 = 按实际执行顺序的覆盖结果。**语义与串行一致（后写覆盖），并行不引入新冲突模型**。

典型场景：记忆 agent 写 `save/memory/summary.json`，状态 agent 写 `save/state/world.json`——不同 path，无冲突。真冲突（两个 agent 写同 path）是 agent 设计问题，框架 last-write-wins 不做冲突检测（YAGNI）。design 记录此语义，不在本任务加冲突报错。

## 3. 数据流

### 3.1 同轮多 agent_call 并行（正常）

```
master round N: model 返回 3 个 tool_calls: [agent_call(memory), agent_call(state), workspace.write(...)]
  → executeRuntimeWorkspaceToolCalls 分组:
     agentCallGroup: [agent_call(memory), agent_call(state)] → Promise.all 并行
     serialGroup: [workspace.write(...)] → 待 agent_call 组完成后串行
  → 并行: memory agent 工具循环 + state agent 工具循环 同时跑
     各自发 onDelta(agentId="memory"/"state", ...) / onTool(agentId="memory"/"state", ...)
     经 streaming-events → bridge → 游戏前端按 agentId 分组渲染
  → 两个 agent_call 完成, observation 按原 index [0,1] 回填
  → serialGroup: workspace.write 执行
  → observation 数组 [memory结果, state结果, write结果] 按 calls 顺序
  → master round N+1: 看到 3 个 observation, 继续推理
```

### 3.2 同轮单 agent_call（串行，不回归）

```
master round N: model 返回 1 个 tool_call: [agent_call(memory)]
  → agentCallGroup: [agent_call(memory)] → Promise.all(单元素) = 等同串行
  → 行为与改造前一致（除事件现在带 agentId="memory" 且可见）
```

### 3.3 嵌套 agent_call（depth 安全网）

```
master round N: agent_call(narrative)
  → narrative 工具循环 round M: agent_call(memory)  [depth 1→2]
     → depth=2 = maxDepth, 拦截 AGENT_CALL_UNAVAILABLE
  → narrative 收到错误 observation, 继续自己的循环
并行场景: master 同时 agent_call(narrative) + agent_call(memory), 各自 depth=1
  → narrative 想嵌套 agent_call(memory) 时 depth=2 拦截
  → 并行的两个 agent_call depth 各自独立计数, 不互相影响
```

## 4. 权衡

### 4.1 为什么 agent_call 单独成组而非混入 PARALLEL_TOOL_NAMES

- 语义清晰：agent_call 不是"只读无状态"，单独成组反映其"跑 delegated 工具循环"的本质。
- 注释一致：PARALLEL_TOOL_NAMES 注释保持"只读无状态"，不矛盾。
- 执行顺序可控：agent_call 组在 serial 组前，让 delegated 写入就绪后再跑 master serial write。

### 4.2 为什么 agentId 放回调首参而非末参或事件对象

- 首参：类型签名一眼可见来源 agent，IDE 提示友好。
- 末参（output? 后）：与可选参混，签名混乱。
- 事件对象（包成 {agentId, delta, round}）：破坏性最大，所有消费者改结构。首参是渐进的（现有消费者加个忽略的首参）。
- 取舍：首参破坏现有所有回调签名，但变更是一致的（一条链路全改），且 agentId 是"谁在发"的最重要上下文，放首参合理。

### 4.3 已知残留风险

**并行 agent_call 的 token 累积**：多个并行子代理同时跑工具循环，各自涨 token。当前 delegated 路径无压缩（tool-token-budget R2 跳过），并行多个 delegated 同时撑大——但每个 delegated 的 token 独立估算（各自的 runtimeMessages），不累加到 master 的 runtimeMessages。master 的 token 预算只管 master 自己的 runtimeMessages（含 agent_call observation 回填后的体积）。**并行不加重 master 的 token 压力**（observation 体积与串行一致，只是回填时间不同）。delegated 各自的 token 撑爆走各自兜底（当前 ContextBudgetExhaustedError，后续任务压缩改造后走多次压缩+时长）。

**并行 agent_call 的 abort**：共享 input.signal，abort 取消所有并行 delegated（各自的 callModelNative 检查 signal）。abort 语义不变。

## 5. 兼容性与回滚

- **配置 shape 破坏**：`maxCallsPerTurn` 移除。不在 contracts，原型期可接受。host 若显式传该字段，TS 编译报错兜底。
- **事件签名破坏**：onDelta/onRoundEnd/onTool 加 agentId 首参。所有消费者同步改，编译期捕获遗漏。
- **无数据迁移**：纯执行层 + 事件层，无持久化变更。
- **回滚**：revert 该任务提交。旧 maxCallsPerTurn + 串行 agent_call + 无 agentId 事件从 git 恢复。

## 6. 验证策略

- **构建**：`npm run build:contracts && npm run build:web` 通过（事件签名变更靠 vue-tsc 兜底捕获遗漏消费者）。
- **真实 API 实测**（依赖可游玩游戏卡 + API key 环境）：
  - 同轮多 agent_call 并行：模型一轮发 agent_call(memory)+agent_call(state)，确认并行执行（trace 时间戳/事件交错）、等待时间短于串行、observation 按 index 回填。
  - delegated 过程可见：游戏前端收到带 agentId="memory"/"state" 的 turn-delta/turn-tool 事件，能区分。
  - 单 agent_call 不回归：一轮一个 agent_call 行为同改造前（除事件带 agentId）。
  - 嵌套 depth 限制：delegated 想嵌套 agent_call 到 depth=2 仍被拒。
  - maxCallsPerTurn 移除：模型发 5+ 个 agent_call 不再被 AGENT_CALL_LIMIT_EXCEEDED 拒（token 预算兜底）。
  - master 压缩兜底不回归：master turn 内压缩 + ContextBudgetExhaustedError 行为不变。

## 7. 与上下游子任务的接口

- **上游子2（tool-token-budget）**：本任务在其"去硬轮次 + token 预算兜底"基础上移除 agent_call 次数硬限制。delegated 路径仍沿用其"跳过压缩、只走预算兜底"。本任务不改 tool-token-budget 的任何已落地逻辑（R1-R4 保持）。
- **下游任务压缩改造**：本任务的并行执行 + 事件 agentId 是其执行层基础。任务压缩改造会：①子代理/助手 messages 改消息序列；②加任务压缩（多次）+ 时长兜底 + 压缩无效早退；③修正 master 兜底共存。本任务不碰这些。
- **同父子3（tool-rename-and-glob）/子4（tool-executor-policy）**：无直接依赖。子3/子4 改工具命名/policy，不改循环调度。

## 8. 开放问题（design 已决）

- ~~agent_call 混入 PARALLEL_TOOL_NAMES vs 单独成组~~：单独成组（方案 B，§2.2）。
- ~~事件 agentId 签名形态~~：回调首参 + streaming-events 首参（§2.3）。
- ~~delegated round 语义~~：delegated 自己的 round，靠 agentId 区分（§2.3 末）。
- ~~workspace 写入冲突~~：last-write-wins，不加冲突检测（§2.4）。

**无遗留开放问题，可进入 implement.md。**
