# 旁路调用上下文管理完善

## Goal

完善 `invokeAgent` 旁路调用的上下文管理机制，支持上下文隔离、持久化控制、并行安全和压缩复用，覆盖卡片助手持久对话、world-architect 一次性理解等多种场景。

## Background — 已确认事实（代码库调研得出）

### 当前旁路调用上下文管理（待完善对象）

- `invokeAgent`（`platform-host/index.ts:1050-1275`）是旁路调用入口：不推进 turn、不写历史，结果直接返回前端调用方。
- 按 `entryMode` 分流（`index.ts:1093-1097`）：
  - persistent：读 `save/agents/<agentId>/context.json`（`readAgentContextFromWorkspace`），执行完写回（`stageAgentContextFile`），跨调用持久化上下文。
  - ephemeral：不读不写，调完即弃。
- `entryMode` 在 agent.json 声明，`registry.ts:660-664` 默认 persistent。
- context.json 路径由 `agentContextPath(agentId)` 生成（`context-lifecycle.ts`），**按 agentId 索引，不按调用方/slot 索引**——不同地方旁路调用同一个 agent 会共享同一份 context，上下文会串。
- 旁路调用用 `compressionMode: "task"`（`index.ts:1116`），persistent 时传 `taskStartedAt/timeoutMs`，ephemeral 不传。
- task 模式压缩：turn 内工具交互段压缩（`compressTaskContext`）+ turn 开头快照压缩（`compressContext`），不限压缩次数，有时长兜底。

### agent_call（工具调用）对比

- agent_call（`agent-runtime/index.ts:1108-1326`）是 master agent 在 turn 内通过工具调用其他 agent。
- **完全不读写 context.json**——用 `buildDelegatedAgentMessages` 从 `recentHistory` 临时构建消息，调完即弃。
- 也用 task 模式压缩，但 `contextTokenBudget` 用 256k 默认（runtime 层不知目标 agent contextWindow）。
- 有 `collaborationPolicy.maxDepth` 递归深度限制。

### 当前缺口

1. **上下文会串**：context.json 按 agentId 索引，不同调用方旁路调用同一 agent 共享上下文。
2. **无法选择性持久化**：persistent agent 永远读写 context.json，无法选择"这次不持久化"。
3. **无并行控制**：两个 `invokeAgent` 同时调用同一 agent，context.json 读写会竞争（后写覆盖前写）。
4. **world-architect understanding 阶段不需要持久化**：初始化理解是一次性任务，不需要跨调用上下文，但 world-architect 是 persistent agent，当前机制会读写 context.json。

### 已修复的相关问题（本任务前置）

- `workspaceMutations: undefined` → 已修复（`6f2b9b5`）
- `emitTrace: undefined` → 已修复（`d44818c`）
- agent context `agentId` 恒为 master → 已修复（`481f4b7`）
- browser skill worker `message is not defined` → 已修复（`481f4b7`）

## Decisions

- **D1 — contextSlot 显式参数**：`invokeAgent` 增加 `contextSlot?: string` 参数。persistent agent 的 context.json 路径变为 `save/agents/<agentId>/context-<slot>.json`。`slot` 省略或 null = 共享默认 context（当前行为，路径 `save/agents/<agentId>/context.json`）。前端按场景传不同 slot，自然隔离。
  - world-architect understanding 传 `slot: "understanding"`（一次性，配合 `persist: false`）。
  - 卡片助手传 `slot: "card-<cardId>"`（每张卡独立持久上下文）。

- **D2 — persist: boolean 参数**：`invokeAgent` 增加 `persist?: boolean` 参数。`true` = 读写 context-slot.json（持久化跨调用）；`false` = 不读不写（一次性调用）。**默认值：`false`**（默认不持久化，需要时显式开启）。与 contextSlot 正交：slot 决定隔离，persist 决定是否持久化。
  - persist:false 时不读 context.json，注入 `undefined`（runtime 兜底初始化），不写回。相当于当前 ephemeral 行为，但不需要改 agent.json 的 entryMode。
  - **默认 false 意味着 invokeAgent 不再读取 agent.json 的 `entryMode`**——持久化完全由调用方通过 `persist: true` 显式开启。entryMode 保留在 agent.json 中（不改配置），但 invokeAgent 不再消费它。当前唯一调用点（understanding）本就不需要持久化，无破坏性影响。

- **D3 — 同 slot 自动排队**：同一 `agentId + contextSlot` 的并发调用自动串行排队。用 `Map<string, Promise>` 做排队链——key 为 `agentId:slot`，value 为当前正在执行的 Promise。新调用等前一个完成后再执行，确保 context.json 读写不竞争。不同 slot 或不同 agent 可真并行。

- **D4 — 复用 task 模式压缩**：`persist: true` 的旁路调用继续用 `compressionMode: "task"`（turn 内工具交互段压缩 + turn 开头快照压缩）。`persist: false` 不传 `taskStartedAt/timeoutMs`（同当前 ephemeral）。只需确保 contextSlot 路径下压缩读写用新路径。

## Requirements

- **R1 contextSlot 参数**：`invokeAgent(agentId, input, options?)` 的 `options` 增加 `contextSlot?: string`。context.json 路径按 slot 分隔：`save/agents/<agentId>/context-<slot>.json`（slot 省略时为 `save/agents/<agentId>/context.json`，向后兼容）。contracts 的 `InvokeAgentRequest` 增加可选 `contextSlot` 字段。play-bridge 的 `InvokeAgentOptions` 增加可选 `contextSlot` 字段。

- **R2 persist 参数**：`invokeAgent(agentId, input, options?)` 的 `options` 增加 `persist?: boolean`（**默认 `false`**）。`persist: false`（默认）时不读 context.json、不写回，注入 `undefined` 给 runtime，不传 `taskStartedAt/timeoutMs`。`persist: true` 时读写 context-slot.json，复用 task 模式压缩。invokeAgent 不再读取 `entryMode`，持久化完全由 `persist` 参数控制。contracts 的 `InvokeAgentRequest` 增加可选 `persist` 字段。play-bridge 的 `InvokeAgentOptions` 增加可选 `persist` 字段。

- **R3 并行排队**：同一 `agentId + contextSlot` 的并发 `invokeAgent` 自动串行排队。前一个完成（resolve/reject）后后一个才开始执行，确保 context.json 读写不竞争。不同 agentId 或不同 contextSlot 可真并行。排队在 host 层 `invokeAgent` 入口实现，不影响 runtime 层。

- **R4 路径兼容**：slot 省略时 context.json 路径不变（`save/agents/<agentId>/context.json`），已有存档和数据不受影响。`agentContextPath(agentId)` 函数扩展为 `agentContextPath(agentId, slot?)`。

- **R5 旁路 trace 路径适配**：旁路 trace 路径（`formatAgentTracePath`）已有 agentId + timestamp，不受 contextSlot 影响，不需要改。

- **R6 前端适配**：`useSetupState.startOpeningUnderstanding` 调用 `invokeAgent("world-architect", prompt, { contextSlot: "understanding", persist: false })`（persist:false 是默认值，显式传出于可读性）。legacy `source-import.legacy.ts` 中的调用点同理。未来新增需要持久化的调用点须显式传 `persist: true`。

## Acceptance Criteria

- [ ] `invokeAgent` 支持 `contextSlot` 参数，不同 slot 的旁路调用上下文隔离（读写不同 context-slot.json）。
- [ ] `invokeAgent` 支持 `persist` 参数，`persist: false` 时不读写 context.json。
- [ ] 同一 `agentId + contextSlot` 的并发调用串行排队，不出现 context 覆盖丢失。
- [ ] slot 省略时 context.json 路径不变，已有存档向后兼容。
- [ ] `useSetupState.startOpeningUnderstanding` 传 `contextSlot: "understanding", persist: false`，understanding 阶段不读写 world-architect 的 context.json。
- [ ] `persist: true` 的旁路调用 task 模式压缩正常工作（turn 内工具交互段压缩 + turn 开头快照压缩）。
- [ ] contracts `InvokeAgentRequest` + play-bridge `InvokeAgentOptions` 增加 `contextSlot` + `persist` 可选字段。
- [ ] `npm run build --workspace platform-web` 通过。
- [ ] `npm run build --workspace play-frontend-dev` 通过。
- [ ] `npm run build --workspace contracts` 通过。

## Out of Scope

- agent_call（工具调用）的上下文管理——agent_call 本就不读写 context.json，不需要改。
- agent.json 的 `entryMode` 配置——不改配置文件，但 invokeAgent 不再读取 `entryMode`，持久化由 `persist` 参数控制（默认 false）。`entryMode` 字段保留在 schema 中以备其他用途。
- 上下文合并策略（OT/CRDT）——D3 用排队避免竞争，不需要合并。
- 新增 compressionMode——D4 复用 task 模式。
- 旁路调用的历史写入（turn 文件/snapshot）——旁路调用本质不推进 turn、不写历史，这个不变。

## Open Questions

- 无阻塞问题。D1-D4 已确认，R1-R6 覆盖完整。
