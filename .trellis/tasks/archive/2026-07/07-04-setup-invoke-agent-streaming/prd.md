# 开局向导 invokeAgent 流式化与旧心跳清理

## Goal

将开局向导对 `invokeAgent` 的无内容 `agent-activity` 心跳依赖迁移到新的 `onAgentInvocation` 流式事件，并删除旧心跳兼容层。

> **状态更新（2026-07-05）**：开局向导 UI/访谈流程已重构完成。Step 2 与 Step 4 已通过 `onAgentInvocation` 按 `invocationId` 过滤流式事件，Step 4 已实现 `delta` 累积渲染，`apps/play-frontend-dev/src` 中 `onAgentActivity` grep 0 命中。R1/R2/R3/R4 的运行时部分已在重构中顺带完成；本任务剩余工作仅为**兼容层清理 + purpose 补全**，转为轻量收尾任务。

## Requirements

- ~~R1: 当前阶段只记录 PRD，不立即实现；等待后续开局向导 UI/访谈阶段调整时一并处理。~~ **已失效**：向导 UI 重构已完成，本任务转为立即收尾。
- R2: 迁移现有开局向导中依赖 `onAgentActivity` / `agent-activity` 的运行中状态、动画或等待逻辑。**（已由向导重构完成）**
- R3: 使用 `invokeAgent` 的 `invocationId` 与 `purpose` 区分一次开局向导 Agent 调用，并通过 `onAgentInvocation` 接收过程事件。**（`invocationId` + `onAgentInvocation` 已实现；`purpose` 尚未补，本任务要补）**
- R4: 向导 UI 应适配流式文本：能展示 `delta`，处理 `tool` / `round-end` / `completed` / `failed` 状态，并在失败时给出可重试或可恢复的界面状态。**（已由向导重构完成）**
- R5: 不在本任务里重构开局职责分工；世界架构师、导演、说书人多 Agent 编排属于 `07-04-opening-multi-agent-orchestration`。
- R6: 不在本任务里解耦正式回合入口或替换 `master`；这属于 `07-04-agent-entrypoint-id-decoupling`。
- R7: 向导迁移完成并确认无引用后，删除旧兼容层：`agent-activity` bridge event、platform-web 事件总线、play-bridge `onAgentActivity` API、相关文档说明。**（本任务核心剩余工作）**
- R8: 保持 `send` 与 `invokeAgent` 的公开语义不变；本任务只改变开局向导如何消费 `invokeAgent` 过程流。

## Acceptance Criteria

- [x] 开局向导不再依赖 `onAgentActivity` / `agent-activity`。（向导重构时已达成）
- [x] 开局向导每次 `invokeAgent` 调用都有可追踪 `invocationId`，并用 `onAgentInvocation` 过滤对应事件。（已实现，`useSetupState.ts:93,108`）
- [x] 向导 UI 能流式展示 Agent 输出，且能处理工具过程、完成和失败状态。（Step 4 delta 渲染、Step 2 tool→stage 映射已实现）
- [ ] 向导 3 处 `invokeAgent` 调用补上 `purpose`（`opening-understanding` / `opening-play-setup`）。
- [ ] 旧 `agent-activity` 兼容 API 和事件在确认无引用后被删除（bridge contract `onAgentActivity` + 平台事件总线 + `tsian-api.ts:139` 过时注释）。
- [ ] SDK 文档和 specs 不再推荐旧心跳；若完全删除，则不再暴露 `onAgentActivity`。
- [ ] 不提前实施多 Agent 开局编排，不引入说书人/导演职责变化。
- [ ] `npm run build:contracts` 与 `npm run build:web` 通过。

## Notes

向导 UI 重构已完成，本任务现在的工作量很小：
1. 删除 `onAgentActivity` / `agent-activity` 兼容层（bridge contract、平台事件总线、文档），清理 `tsian-api.ts:139` 那条"useSetupState 用此做 understanding running 心跳脉冲"的过时注释。
2. 给向导 3 处 `invokeAgent` 调用（`useSetupState.ts:318,605,647`）补 `purpose` 字段。
3. 跑 `npm run build:contracts` 与 `npm run build:web` 验证。

走 PRD-only 轻量流程（用户 2026-07-05 确认）。
