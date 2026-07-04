# 通用 AgentInvocation 与 invokeAgent 流式

## Goal

基于现有 `invokeAgent` / `sendMessage` / `runAgentRuntimeTurn` 的共享基础，补齐 `invocationId` 与文本/工具/完成事件流，形成可由前端指定 Agent 入口的通用 Agent 调用能力。避免重新实现模型调用和工具循环。

## Requirements

- R1: 评估并记录当前 `sendMessage` 与 `invokeAgent` 的差异：二者已共用 `runAgentRuntimeTurn`，但 host/bridge 层流式事件、history、checkpoint、context 持久化语义不同。
- R2: 为 `invokeAgent` 增加 invocation 级唯一 id，用于并发调用时区分事件。
- R3: 为前端提供真正文本流事件，而不是仅有不携带内容的 `agent-activity` 心跳。
- R4: invocation 事件至少支持 started / delta / round-end / tool / completed / failed。
- R5: 保留现有 `agent_call` 工具能力：它用于一次 Agent 调用内部的自主多 Agent 协作，不被前端发起的 AgentInvocation 替代。
- R6: 评估并设计通用调用的 commit/checkpoint 策略，满足回合后场记维护这类“正文已完成后仍需写 workspace 并可恢复”的场景。
- R7: 不把 novel AIRP 的说书人/场记流程硬编码到平台；平台只提供通用调用能力。
- R8: 更新 contracts、bridge、play-bridge SDK 和相关文档。
- R9: 尽量抽取公共 host 编排层，减少 `sendMessage` 与 `invokeAgent` 重复逻辑，但避免过度抽象导致 turn 语义混乱。

## Acceptance Criteria

- [ ] 前端可发起指定 Agent 的 invocation，并订阅该 invocation 的文本 delta。
- [ ] 多个并发 invocation 可通过 invocationId 区分事件。
- [ ] tool / round / completed / failed 事件能服务 UI 进度与调试。
- [ ] `sendMessage` 的现有流式剧情回合能力不回退。
- [ ] `agent_call` 仍可在 Agent 内部使用，且语义清晰区别于前端 AgentInvocation。
- [ ] SDK 文档不再把 `invokeAgent` 描述为只能返回最终文本、无流式内容的旁路黑盒。
- [ ] 通过必要构建/类型检查。

## Notes

短期优先升级现有 `invokeAgent`，因为它已经支持任意 agentId。中期再抽出统一 `AgentInvocation` 编排层，让 `send` 成为某种 purpose 的 AgentInvocation，而不是继续维持“主路/旁路”两套概念。
