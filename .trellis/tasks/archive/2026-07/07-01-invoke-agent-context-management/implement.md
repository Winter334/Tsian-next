# Implement — 旁路调用上下文管理完善

## Step 1: context-lifecycle.ts — agentContextPath 扩展

- [ ] `agentContextPath(agentId, slot?)`：slot 省略时路径不变；有 slot 时返回 `save/agents/<id>/context-<safeSlot>.json`
- [ ] slot 消毒：`slot.replace(/[^a-zA-Z0-9_-]/g, "-")` 防路径注入
- [ ] 验证：`agentContextPath("master")` → `save/agents/master/context.json`（不变）
- [ ] 验证：`agentContextPath("world-architect", "understanding")` → `save/agents/world-architect/context-understanding.json`

## Step 2: history-turns.ts — read/stage 加 slot 参数

- [ ] `readAgentContextFromWorkspace` 增加可选 `slot?: string`，传给 `agentContextPath`
- [ ] `stageAgentContextFile` input 类型增加 `slot?: string`
- [ ] `stageAgentContextFile` 内部 `readAgentContextFromWorkspace` 调用传 slot（line 119）
- [ ] `stageAgentContextFile` 的 `workspaceTransaction.write` 路径用 `agentContextPath(agentId, slot)`（line 129）
- [ ] 确认主 turn 调用点（index.ts:778、965）和 frontend-inspector（:771）不传 slot，行为不变

## Step 3: contracts/runtime.ts — InvokeAgentRequest 扩展

- [ ] 增加 `contextSlot?: string` 字段 + JSDoc
- [ ] 增加 `persist?: boolean` 字段 + JSDoc
- [ ] `npm run build --workspace contracts` 通过

## Step 4: play-bridge/tsian-api.ts — InvokeAgentOptions + 实现

- [ ] `InvokeAgentOptions` 增加 `contextSlot?: string` + `persist?: boolean`
- [ ] `invokeAgent` 实现传 `contextSlot` / `persist` 到 wire params（undefined 不传）
- [ ] `npm run build --workspace play-bridge` 通过

## Step 5: remote-iframe-bridge.ts — normalizeInvokeAgentRequest 扩展

- [ ] 解析 `contextSlot`：string 且非空时 trim，否则 undefined
- [ ] 解析 `persist`：boolean 时保留，否则 undefined
- [ ] 返回对象展开 contextSlot / persist（undefined 不展开）

## Step 6: platform-host/index.ts — invokeAgent 核心改造

- [ ] 声明模块级/闭包级 `invokeAgentQueue = new Map<string, Promise<unknown>>()`
- [ ] invokeAgent 入口：校验 agentId/input → 计算 slot/shouldPersist/queueKey → 排队链
- [ ] 排队：`previous.catch(() => {}).then(() => executeInvokeAgentBody())`
- [ ] 排队清理：`currentPromise.finally(() => { if map still has self → delete })`
- [ ] 执行体内：`isPersistent` → `shouldPersist = input.persist === true`
- [ ] 执行体内：`readAgentContextFromWorkspace(..., agentId, slot)` 传 slot
- [ ] 执行体内：`...(shouldPersist ? { taskStartedAt, timeoutMs } : {})`
- [ ] 执行体内：`if (shouldPersist && result.contextUpdate)` 写回
- [ ] 执行体内：`stageAgentContextFile(tx, { ..., agentId, slot })` 传 slot
- [ ] 删除 `entryMode` 读取（`targetContext.agent.entryMode === "persistent"` 行）

## Step 7: 前端适配

- [ ] `useSetupState.ts:221`：invokeAgent 加 `{ contextSlot: "understanding", persist: false }`
- [ ] `source-import.legacy.ts:882`：invokeAgent 加 `{ contextSlot: "understanding", persist: false }`
- [ ] `npm run build --workspace play-frontend-dev` 通过

## Step 8: 全量构建验证

- [ ] `npm run build --workspace contracts` 通过
- [ ] `npm run build --workspace play-bridge` 通过
- [ ] `npm run build --workspace platform-web` 通过
- [ ] `npm run build --workspace play-frontend-dev` 通过

## Step 9: 手动验证（remote 回路）

- [ ] understanding 阶段调用 invokeAgent 后，检查 `save/agents/world-architect/context.json` **不被写入**（persist:false）
- [ ] 检查 `save/agents/world-architect/context-understanding.json` 也**不被写入**（persist:false 不写）
- [ ] 系统监视器（DebugView）旁路 trace 正常显示
- [ ] agent heartbeat 正常跳动（agent-activity 事件不受影响）

## Step 10: commit

- [ ] commit message: `feat(invoke-agent): contextSlot + persist + 同 slot 排队`
