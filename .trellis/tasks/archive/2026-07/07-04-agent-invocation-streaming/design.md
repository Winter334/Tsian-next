# 通用 AgentInvocation 与 invokeAgent 流式设计

## 1. 决策摘要

公开 SDK/API 层继续保留两个语义入口：

- `send(text, options?)`：玩家正式回合输入，负责 turn/history/checkpoint/options 等正式回合语义。
- `invokeAgent(agentId, input, options?)`：前端/卡流程指定某个 Agent 做一次任务，例如场记维护、导演刷新、开局建模、UI 触发说明。

底层不保留两套模型调用基础设施。`send` 与 `invokeAgent` 应逐步汇合到统一的 AgentInvocation 编排层，并继续复用现有 `runAgentRuntimeTurn`、模型 streaming、workspace tools、staged transaction 等基础能力。

Agent 内部 `agent_call` 继续保留：它用于一次 Agent 调用内部由当前 Agent 自主调用同事协作，和前端发起的 AgentInvocation 是两层互补能力。

## 2. 当前实现事实

### `sendMessage`

`apps/platform-web/src/platform-host/index.ts` 的 `interaction.sendMessage` 已支持主剧情流式：

- 固定入口 agent 当前为 `master`。
- 调用 `runAgentRuntimeTurn`。
- 通过 `turn-delta` / `turn-round-end` / `turn-tool` 推送过程事件。
- 写 turn history / timeline。
- 写回 entry agent context。
- 调用 `commitSuccessfulRuntimeTurnForSave` 创建回合 checkpoint。

它成熟但绑定“正式剧情回合”语义太重，不适合直接作为任意 Agent 调用的唯一公开形态。

### `invokeAgent`

`interaction.invokeAgent` 已经更接近通用 Agent 调用：

- 可指定任意 `agentId`。
- 同样调用 `runAgentRuntimeTurn`。
- 默认不推进 turn，不写剧情 history。
- 可选 `persist/contextSlot` 读写目标 Agent context。
- 可提交 workspace 写入。

当前不足：

- 只发 `agent-activity` 心跳，不携带文本 delta。
- 没有 invocationId，多个并发调用难以区分事件。
- bridge / SDK 文档把它描述成“旁路调用，不污染主 turn stream”，但未来需要让它成为通用可流式调用。
- workspace commit 与 checkpoint 策略还不足以覆盖“正文已完成后场记维护并可恢复”的场景。

## 3. 事件模型

新增 invocation 级事件。推荐使用单一桥事件名承载判别联合，而不是为每种子事件都增加一个桥事件名：

```ts
type AgentInvocationEvent =
  | {
      type: "started"
      invocationId: string
      agentId: string
      purpose?: string
    }
  | {
      type: "delta"
      invocationId: string
      agentId: string
      round: number
      kind: "reasoning" | "content"
      delta: string
    }
  | {
      type: "round-end"
      invocationId: string
      agentId: string
      round: number
      kind: "thought" | "final"
    }
  | {
      type: "tool"
      invocationId: string
      agentId: string
      round: number
      callId: string
      name: string
      status: "loading" | "running" | "success" | "failed"
      output?: TurnToolOutput
    }
  | {
      type: "completed"
      invocationId: string
      agentId: string
    }
  | {
      type: "failed"
      invocationId: string
      agentId: string
      error: PlatformActionError
    }
```

桥事件名建议：

```text
agent-invocation
```

这样 remote bridge 只新增一个 event name，SDK 再提供：

```ts
onAgentInvocation(cb: (event: AgentInvocationEvent) => void): () => void
```

## 4. invocationId 归属

为了让前端在调用开始前就能关联后续流式事件，`invocationId` 应允许由调用方生成并传入：

```ts
invokeAgent(agentId, input, {
  invocationId,
  purpose,
})
```

SDK 可在未传入时自动生成一个 id，并放进请求。平台也需要兜底生成，防御裸 bridge 调用。

`InvokeAgentResult` 应返回同一个 `invocationId`：

```ts
interface InvokeAgentResult {
  invocationId: string
  response: string
}
```

## 5. API 语义

### `send`

保留为正式玩家回合语义：

```ts
await tsian.send(playerInput)
```

它不要求前端显式指定 agentId。后续入口应来自卡配置，而不是硬编码 `master`。

### `invokeAgent`

保留为指定 Agent 的任务调用：

```ts
const invocationId = crypto.randomUUID()
const off = tsian.onAgentInvocation((event) => {
  if (event.invocationId !== invocationId) return
  // render streaming/progress
})
const result = await tsian.invokeAgent("stage-manager", prompt, {
  invocationId,
  purpose: "post-turn-maintenance",
})
off()
```

`invokeAgent` 的 Promise 仍在完成后 resolve 最终 `response`，流式内容通过事件订阅获得。

### `agent_call`

保持 Agent 内部工具能力：

```text
说书人信息不足 → agent_call(资料员)
场记发现 schema 空缺 → agent_call(世界架构师)
导演需要事实 → agent_call(资料员)
```

`agent_call` 产生的 delegated agent 流程仍应通过当前 invocation 的事件流向外可见，事件的 `agentId` 表示实际产生 delta/tool 的 Agent，`invocationId` 表示它属于哪次前端发起的 invocation。

## 6. commit / checkpoint 策略

本任务至少需要设计 commit 策略；是否一次实现完整 checkpoint 可按实施风险拆分。

当前语义：

- `sendMessage`：正式回合提交 history + workspace + checkpoint。
- `invokeAgent`：提交 workspace，但不推进 turn/history/checkpoint。

未来需要支持默认 novel 前端：正文完成后调用场记维护，如果场记更新不进入可恢复状态，会造成 checkpoint 与状态栏/runtime 漂移。

建议为 `invokeAgent` 预留提交策略：

```ts
type AgentInvocationCommitMode =
  | "workspace"
  | "workspace-with-checkpoint"
```

第一版可先保持默认：

```text
commitMode omitted -> workspace
```

场记子任务需要：

```text
commitMode: "workspace-with-checkpoint"
checkpointReason: "post-turn-maintenance"
```

如果完整 checkpoint 牵涉较大，可先在本任务 design/contract 中预留字段，实际 checkpoint 行为放入场记编排子任务实现，但不能忘记验收。

## 7. 实施范围分层

### 第一阶段：流式 invokeAgent

- 添加 `invocationId`。
- 添加 `agent-invocation` 事件总线和 bridge event。
- `invokeAgent` 真正转发文本 delta、round、tool、completed、failed。
- SDK 暴露 `onAgentInvocation`。
- 保持 `sendMessage` 行为不变，避免回归。

### 第二阶段：公共编排层

抽取 `executeAgentInvocation` 或若干 focused helper，减少 `sendMessage` 与 `invokeAgent` 的重复：

- active save / workspace transaction 装配；
- provider preset map；
- model callback；
- browser script runners；
- workspace mutation adapter；
- trace 写入。

不要一开始做过度参数化。正式 turn 的 history/checkpoint 语义仍应清晰独立。

### 第三阶段：send 作为 AgentInvocation 特例

在入口 id 解耦后，`send` 变成：

```text
purpose = player-turn
agentId = card entrypoint storyteller
historyPolicy = append-turn
checkpointPolicy = after-turn
streamTarget = turn events
```

但公开 API 仍保留 `send`，不要求前端直接用 `invokeAgent` 拼正式回合。

## 8. 涉及文件

预计涉及：

- `packages/contracts/src/runtime.ts`
  - `InvokeAgentRequest` 增加 `invocationId?` / `purpose?` / commit 策略字段。
  - `InvokeAgentResult` 增加 `invocationId`。
  - 新增 `AgentInvocationEvent` 等共享类型。
- `packages/contracts/src/bridge.ts`
  - remote bridge event name / payload 增加 `agent-invocation`。
- `packages/play-bridge/src/tsian-api.ts`
  - `InvokeAgentOptions` 增加 invocationId / purpose / commit options。
  - 新增 `onAgentInvocation`。
  - `invokeAgent` 自动生成 invocationId。
- `apps/platform-web/src/streaming-events.ts`
  - 新增 invocation event bus。
  - 评估是否保留旧 `agent-activity`，实施阶段尽量迁移默认前端到新事件。
- `apps/platform-web/src/bridge/remote-iframe-bridge.ts`
  - 转发 `agent-invocation` 事件。
- `apps/platform-web/src/platform-host/index.ts` 或新 host 子模块
  - `invokeAgent` 生成/接收 invocationId。
  - 真正转发 `onDelta` 文本。
  - emit started/completed/failed/tool/round events。
  - 保持 `sendMessage` 不回退。
- `apps/play-frontend-dev/src/**`
  - setup 向导等使用 `onAgentActivity` 的地方迁移到 `onAgentInvocation` 或兼容新事件。
- `docs/sdk/play-frontend-api.md`
  - 更新 send / invokeAgent / agent_call 三层语义。

## 9. 风险与约束

- 不要把 novel AIRP 的说书人/场记流程写进平台核心。
- 不要用 `invokeAgent` 取代公开 `send` 语义。
- 不要移除 Agent 内部 `agent_call`。
- 事件总线仍应保持显式、专用，不发展成通用全局 EventBus。
- `sendMessage` 的流式剧情回合、turn timeline、options 提取、checkpoint 行为不能回退。
- 如果 contracts 改动，必须跑 `npm run build:contracts` 和 `npm run build:web`。
