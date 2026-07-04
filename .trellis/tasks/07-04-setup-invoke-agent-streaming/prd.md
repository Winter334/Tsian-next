# 开局向导 invokeAgent 流式化与旧心跳清理

## Goal

在后续开局向导 UI/访谈流程重构时，将当前向导对 `invokeAgent` 的无内容 `agent-activity` 心跳依赖迁移到新的 `onAgentInvocation` 流式事件，并删除旧心跳兼容层。该任务暂不立即实施，用于记录后续迁移范围，避免遗忘。

## Requirements

- R1: 当前阶段只记录 PRD，不立即实现；等待后续开局向导 UI/访谈阶段调整时一并处理。
- R2: 迁移现有开局向导中依赖 `onAgentActivity` / `agent-activity` 的运行中状态、动画或等待逻辑。
- R3: 使用 `invokeAgent` 的 `invocationId` 与 `purpose` 区分一次开局向导 Agent 调用，并通过 `onAgentInvocation` 接收过程事件。
- R4: 向导 UI 应适配流式文本：能展示 `delta`，处理 `tool` / `round-end` / `completed` / `failed` 状态，并在失败时给出可重试或可恢复的界面状态。
- R5: 不在本任务里重构开局职责分工；世界架构师、导演、说书人多 Agent 编排属于 `07-04-opening-multi-agent-orchestration`。
- R6: 不在本任务里解耦正式回合入口或替换 `master`；这属于 `07-04-agent-entrypoint-id-decoupling`。
- R7: 向导迁移完成并确认无引用后，删除旧兼容层：`agent-activity` bridge event、platform-web 事件总线、play-bridge `onAgentActivity` API、相关文档说明。
- R8: 保持 `send` 与 `invokeAgent` 的公开语义不变；本任务只改变开局向导如何消费 `invokeAgent` 过程流。

## Acceptance Criteria

- [ ] 开局向导不再依赖 `onAgentActivity` / `agent-activity`。
- [ ] 开局向导每次 `invokeAgent` 调用都有可追踪 `invocationId`，并用 `onAgentInvocation` 过滤对应事件。
- [ ] 向导 UI 能流式展示 Agent 输出，且能处理工具过程、完成和失败状态。
- [ ] 旧 `agent-activity` 兼容 API 和事件在确认无引用后被删除。
- [ ] SDK 文档和 specs 不再推荐旧心跳；若完全删除，则不再暴露 `onAgentActivity`。
- [ ] 不提前实施多 Agent 开局编排，不引入说书人/导演职责变化。
- [ ] `npm run build:contracts` 与 `npm run build:web` 通过。

## Notes

本任务适合在开局向导 UI/访谈体验重构时执行。当前先不做，是为了避免在现有向导 UI 尚未彻底适配流式展示时做半成品迁移，后续仍要返工。

推荐后续顺序：先完成 Agent 入口/id 解耦或默认 Agent/Skill 模板相关前置，再在开局向导重构时统一处理流式 UI 与旧心跳清理。
