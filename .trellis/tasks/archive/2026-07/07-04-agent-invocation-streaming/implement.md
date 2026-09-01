# 通用 AgentInvocation 与 invokeAgent 流式实施计划

## Scope

本任务优先实现/设计 `invokeAgent` 的 invocationId 与可订阅文本/工具/完成事件流，并为后续统一 AgentInvocation 编排层打基础。

公开 SDK/API 保留 `send` 与 `invokeAgent` 两个语义入口；底层逐步统一。Agent 内部 `agent_call` 保留。

## Implementation Steps

### 1. 合同类型更新

更新 `packages/contracts/src/runtime.ts`：

- `InvokeAgentRequest` 增加：
  - `invocationId?: string`
  - `purpose?: string`
  - 可选 commit/checkpoint 字段（如本阶段决定只预留，也要在注释中明确暂未完全实现）。
- `InvokeAgentResult` 增加：
  - `invocationId: string`
- 新增 `AgentInvocationEvent` 判别联合，至少包括：
  - `started`
  - `delta`
  - `round-end`
  - `tool`
  - `completed`
  - `failed`

更新 `packages/contracts/src/bridge.ts`：

- `RemotePlayBridgeEventName` 增加 `agent-invocation`。
- `RemotePlayBridgeEventPayload` 增加 `AgentInvocationEvent`。
- 确认 `src/index.ts` 已导出相关类型。

### 2. 平台事件总线

更新 `apps/platform-web/src/streaming-events.ts`：

- 添加 AgentInvocation 专用 listener set。
- 添加 `subscribeAgentInvocation` / `emitAgentInvocation`。
- 继续保留旧 `agent-activity`，直到默认前端迁移完成；不要立即删除以降低风险。

### 3. bridge 转发

更新 `apps/platform-web/src/bridge/remote-iframe-bridge.ts`：

- 订阅 `subscribeAgentInvocation`。
- 转发为 remote event：

```text
agent-invocation
```

- cleanup 时取消订阅。

### 4. host invokeAgent 流式

更新 `apps/platform-web/src/platform-host/index.ts`，或优先抽到 focused 子模块（遵循 platform-web directory spec，避免 index.ts 继续膨胀）：

- 接收/生成 `invocationId`。
- 在开始前 emit `started`。
- 将 `runAgentRuntimeTurn` 的 `onDelta` 转发为 `delta`，不再丢弃文本。
- 将 `onRoundEnd` 转发为 `round-end`。
- 将 `onTool` 转发为 `tool`，带 tool output。
- 成功后 emit `completed` 并返回 `{ invocationId, response }`。
- 失败后 emit `failed`，再 reject。
- 保留 trace 写入。
- 保持 queueKey 语义，避免同 agent/contextSlot 并发写 context 竞争。

注意：`streamAssistantReplyText` / `streamAssistantReplyNative` 当前 invokeAgent 分支传 `onDelta: undefined`，需要改为传入适配函数。

### 5. play-bridge SDK

更新 `packages/play-bridge/src/tsian-api.ts`：

- `InvokeAgentOptions` 增加 `invocationId?` / `purpose?` / commit options。
- `invokeAgent` 未传 invocationId 时自动生成。
- 新增：

```ts
onAgentInvocation(cb: (event: AgentInvocationEvent) => void): () => void
```

- 可保留 `onAgentActivity` 作为兼容/过渡，但 docs 应推荐新事件。

### 6. 默认前端迁移

更新 `apps/play-frontend-dev` 中使用 `onAgentActivity` 的 setup/understanding running 逻辑：

- 优先用 `onAgentInvocation` 过滤对应 invocationId 或 agentId/purpose。
- 如果改动超出本任务范围，可以先保持旧心跳并在后续开局向导任务迁移，但需要记录。

### 7. 文档更新

更新 `docs/sdk/play-frontend-api.md`：

- `send` 与 `invokeAgent` 共存但底层统一。
- `invokeAgent` 支持流式事件。
- `agent_call` 是 Agent 内部协作工具，不是 SDK 入口。
- 不再称 invokeAgent 为只返回最终文本、无内容流的旁路黑盒。

### 8. 验证

必跑：

```bash
npm run build:contracts
npm run build:web
```

手动/最小验证：

- `send` 正常流式、turn-completed、options 不回退。
- `invokeAgent` 返回最终 response。
- `invokeAgent` 过程中能收到同 invocationId 的 delta / completed 事件。
- 两个并发 invocation 事件可按 invocationId 区分。
- Agent 内部 `agent_call` 仍可用，且 delegated agent 的 delta/tool 归属于同一个 invocationId。

## Non-goals

- 不在本任务中重写正式 novel 前端说书人→场记流程。
- 不移除公开 `send`。
- 不移除内部 `agent_call`。
- 不把平台核心改成固定 novel AIRP pipeline。
- 不一次性完成所有 send/invoke 公共编排抽象；先补能力，再逐步抽取。
